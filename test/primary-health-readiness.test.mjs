import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const owner = await import(process.env.PRIMARY_HEALTH_UNDER_TEST
  ? pathToFileURL(process.env.PRIMARY_HEALTH_UNDER_TEST).href : '../src/primary-health.mjs');
const target = {id:'native',kind:'machine',url:'https://example.invalid/healthz'};
const response = (body, status=200) => ({status,headers:new Headers(),json:async()=>body});
const reading = async (body,status=200) => (await owner.readPrimaryHealth({targets:[target],probe:async()=>response(body,status)})).systems[0];

test('HTTP success does not hide explicit failed machine readiness', async()=>{
  const value=await reading({ok:false,state:'failed'});
  assert.equal(value.status,200);assert.equal(value.charge,'denied');
  assert.equal(value.readiness.ok,false);
});
test('native actor failure overrides contradictory top-level success',async()=>{
  const value=await reading({ok:true,state:'ready',nativeActor:{ok:false}});
  assert.equal(value.charge,'denied');assert.equal(value.readiness.nativeActorOk,false);
});
test('explicit unready service state overrides top-level success',async()=>{
  assert.equal((await reading({ok:true,state:'unready'})).charge,'denied');
});
test('missing readiness is unknown for an answering machine',async()=>{
  for(const body of [undefined,null,[],{}, {release:'r'}, {ok:'true'}])
    assert.equal((await reading(body)).charge,'unknown');
});
test('malformed machine health is unknown rather than held',async()=>{
  const value=(await owner.readPrimaryHealth({targets:[target],probe:async()=>({status:200,headers:new Headers(),json:async()=>{throw new SyntaxError('bad JSON');}})})).systems[0];
  assert.equal(value.charge,'unknown');assert.equal(value.readiness.reason,'unreadable-machine-health');
});
test('explicit healthy machine remains held',async()=>{
  const value=await reading({ok:true,state:'ready',nativeActor:{ok:true}});
  assert.equal(value.charge,'held');assert.equal(value.readiness.state,'ready');
});
test('503 machine body retains failed actor evidence',async()=>{
  const value=await reading({ok:false,state:'failed',nativeActor:{ok:false},release:'r'},503);
  assert.equal(value.charge,'denied');assert.equal(value.readiness.nativeActorOk,false);assert.equal(value.release,'r');
});
test('invalid optional release metadata cannot erase known failed readiness',async()=>{
  const value=await reading(JSON.parse('{"ok":false,"release":{"toString":null},"deployment":{"outcome":{"toString":null}}}'));
  assert.equal(value.charge,'denied');assert.equal(value.readiness.ok,false);
  assert.equal(value.release,undefined);assert.equal(value.deployment,undefined);
});
test('property HTTP behavior remains unchanged',async()=>{
  const values=(await owner.readPrimaryHealth({targets:[{...target,kind:'property'}],probe:async()=>response({ok:false})})).systems;
  assert.equal(values[0].charge,'held');assert.equal(values[0].readiness,undefined);
  assert.equal(owner.chargeOf({status:503,retryAfter:'120'}),'contested');
});
test('readiness changes remain observable while charge stays denied',()=>{
  const a={id:'native',charge:'denied',readiness:{state:'failed',ok:false,nativeActorOk:false}};
  const b={...a,readiness:{state:'failed',ok:false,nativeActorOk:true}};
  assert.equal(owner.primaryHealthChanges({systems:[a]},{systems:[b]}).length,1);
  assert.equal(owner.primaryHealthChanges({systems:[b]},{systems:[structuredClone(b)]}).length,0);
});
test('pulse carries readiness through its journal boundary, then records recovery once',async t=>{
  const root=await mkdtemp(join(tmpdir(),'health-readiness-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const records=[];const journal={record:value=>{records.push(value);return{id:String(records.length)};}};
  let healthy=false;let count=0;
  const run=()=>owner.runPrimaryHealthPulse({statusDirectory:root,journal,targets:[target],probe:async()=>response({ok:healthy,nativeActor:{ok:healthy}}),clock:()=>`2026-10-10T20:40:0${count++}Z`});
  await run();await run();healthy=true;await run();
  assert.equal(records.length,2);assert.equal(records[0].record.readiness.nativeActorOk,false);
  assert.equal(records[1].record.readiness.state,'ready');
  assert.equal(JSON.parse(await readFile(join(root,'status.json'),'utf8')).systems[0].charge,'held');
  assert.match(await readFile(join(root,'index.html'),'utf8'),/<td>ready<\/td>/u);
});

// The actual selected producer accepts ready or degraded. Optional fields are
// not required universally, but present indeterminate claims cannot imply ready.
test('degraded and optional readiness fields follow the producer contract',async()=>{
  assert.equal((await reading({ok:true,state:'degraded',nativeActor:{ok:true}})).charge,'held');
  assert.equal((await reading({ok:true})).charge,'held');
});
test('present indeterminate machine or actor readiness stays unknown',async()=>{
  for(const body of [
    {ok:true,state:'unknown'}, {ok:true,state:'starting'}, {ok:true,state:null}, {ok:true,state:[]},
    {ok:true,nativeActor:{}}, {ok:true,nativeActor:{ok:null}}, {ok:true,nativeActor:{ok:'true'}},
    {ok:true,nativeActor:null}, {ok:true,nativeActor:'invalid'}, {ok:true,nativeActor:[]},
  ]) assert.equal((await reading(body)).charge,'unknown',JSON.stringify(body));
  const value=await reading({ok:true,nativeActor:{ok:null}});
  assert.equal(value.readiness.nativeActorOk,null);
  assert.equal(value.readiness.reason,'indeterminate-native-actor');
});
test('explicit negative readiness survives other indeterminate fields',async()=>{
  const value=await reading({ok:false,state:'unknown',nativeActor:{ok:null}});
  assert.equal(value.charge,'denied');assert.equal(value.readiness.ok,false);
  assert.equal(value.readiness.serviceState,'unknown');assert.equal(value.readiness.nativeActorOk,null);
});
test('readiness comparison ignores JSON key order while retaining raw unknown evidence',()=>{
  const left={id:'native',charge:'unknown',readiness:{state:'unknown',ok:true,nativeActorOk:null}};
  const right={...left,readiness:{nativeActorOk:null,ok:true,state:'unknown'}};
  assert.equal(owner.primaryHealthChanges({systems:[left]},{systems:[right]}).length,0);
  assert.equal(owner.primaryHealthChanges({systems:[left]},{systems:[{...left,readiness:{...left.readiness,nativeActorOk:'unknown'}}]}).length,1);
});
