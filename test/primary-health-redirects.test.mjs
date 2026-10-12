import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PRIMARY_HEALTH_TARGETS,chargeOf,readPrimaryHealth,runPrimaryHealthPulse} from '../src/primary-health.mjs';
const target=PRIMARY_HEALTH_TARGETS.find(x=>x.id==='l-space.561.group');
const response=(status,location,cancel=()=>{},extra={})=>({status,headers:new Headers({...extra,...(location===undefined?{}:{location})}),body:{cancel:async()=>cancel()}});
const read=async(probe,options={})=>(await readPrimaryHealth({targets:[target],probe,...options})).systems[0];

test('the declared L-Space handoff reports terminal 503 instead of held 308',async()=>{
  const urls=[],signals=[];let cancelled=0;
  const result=await read(async(url,init)=>{urls.push(url);signals.push(init.signal);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');return urls.length===1?response(308,'https://bare-cedar-fog.561.group/knowledge/entry',()=>cancelled++):response(503,undefined,()=>cancelled++,{'retry-after':'120'});});
  assert.equal(result.status,503);assert.equal(result.charge,'contested');assert.equal(cancelled,2);
  assert.deepEqual(urls,[target.url,'https://bare-cedar-fog.561.group/knowledge/entry']);assert.equal(signals[0],signals[1]);
});
test('a same-origin relative handoff can receive an answering destination',async()=>{
  const urls=[];const value=await read(async url=>{urls.push(url);return urls.length===1?response(301,'/entry'):response(200);});
  assert.equal(value.charge,'held');assert.deepEqual(urls,[target.url,'https://l-space.561.group/entry']);
});
for(const location of ['https://unowned.example/','http://l-space.561.group/','https://user:secret@l-space.561.group/','https://l-space.561.group:444/','file:///tmp/snapshot']){
  test(`unadmitted redirect is never fetched: ${location.replace('secret','redacted')}`,async()=>{
    let calls=0,cancelled=false;const value=await read(async()=>{calls++;return response(308,location,()=>{cancelled=true;});});
    assert.equal(calls,1);assert.ok(cancelled);assert.notEqual(value.charge,'held');assert.equal(value.status,undefined);
    assert.ok(!JSON.stringify(value).includes(location));
  });
}
test('missing location and non-followable 3xx never count as healthy',async()=>{
  for(const status of [300,301,302,303,304,305,307,308]){
    const value=await read(async()=>response(status));assert.notEqual(value.charge,'held');
    assert.equal(chargeOf({status}),'unknown');
  }
});
test('missing Location remains unknown and the health consumer cancels its terminal body',async()=>{
  let cancelled=0,calls=0;
  const value=await read(async()=>{calls++;return response(308,undefined,()=>cancelled++);});
  assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(value.charge,'unknown');assert.equal(value.status,308);
});
test('loop and redirect count are bounded and cancel every received body',async()=>{
  let calls=0,cancelled=0;
  const loop=await read(async()=>{calls++;return response(308,target.url,()=>cancelled++);});
  assert.notEqual(loop.charge,'held');assert.equal(calls,1);assert.equal(cancelled,1);
  calls=0;cancelled=0;
  const chain=await read(async()=>response(308,`/hop-${++calls}`,()=>cancelled++));
  assert.notEqual(chain.charge,'held');assert.equal(calls,6);assert.equal(cancelled,6);
});
test('machine health never follows a redirect or receives destination readiness',async()=>{
  const machine=PRIMARY_HEALTH_TARGETS[0];let calls=0;
  const value=(await readPrimaryHealth({targets:[machine],probe:async()=>{calls++;return response(308,'https://bare-cedar-fog.561.group/healthz');}})).systems[0];
  assert.equal(calls,1);assert.notEqual(value.charge,'held');assert.equal(value.readiness,undefined);
});
test('deadline applies to the whole chain rather than resetting per hop',async()=>{
  let signal;let calls=0;
  const keepalive=setTimeout(()=>{},1000);
  try {
    const value=await read(async(_url,init)=>{
      calls++;if(calls===1){signal=init.signal;return response(308,'/entry');}
      assert.equal(init.signal,signal);
      return await new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    },{timeoutMs:20});
    assert.equal(calls,2);assert.equal(value.error,'TimeoutError');assert.notEqual(value.charge,'held');
  }finally{clearTimeout(keepalive);}
});
test('existing status and journal receive destination failure then one recovery',async t=>{
  const root=await mkdtemp(join(tmpdir(),'health-redirect-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let status=503;const records=[];
  const pulse=()=>runPrimaryHealthPulse({targets:[target],statusDirectory:root,journal:{record:value=>records.push(value)},probe:async url=>url===target.url?response(308,'https://bare-cedar-fog.561.group/knowledge/entry'):response(status)});
  await pulse();await pulse();assert.equal(records.length,1);assert.equal(records[0].record.status,503);assert.equal(records[0].record.charge,'denied');
  assert.match(await readFile(join(root,'index.html'),'utf8'),/<td>not answering<\/td><td>503/u);
  status=200;await pulse();assert.equal(records.length,2);assert.equal(records[1].record.charge,'held');
  assert.equal(JSON.parse(await readFile(join(root,'status.json'),'utf8')).systems[0].status,200);
});
