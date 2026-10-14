import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {address,utteranceCell,triple} from '@red-cup-engineering/signcell/cell';
import {seavtOfJson} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {get,put,readHead,writeHead} from '@red-cup-engineering/semiotic-eavt-services-section/store';
import {receiveCloudResourceRow,readCloudResource} from '../src/cloud-resource-receiving.mjs';

const subjects=()=>{
  const witness=utteranceCell('cloud-compute-native-observation',{sourceCommitment:'native-fixture',at:'2026-10-13'});
  return {witness,resource:address(utteranceCell('cloud-resource-coordinate',
    {provider:'oracle-cloud',kind:'compute-instance',native:'ocid1.instance.fixture'}))};
};
const timestamp='2026-10-13T20:00:00Z';
const row=(resource,witness,time=timestamp,availability='unknown')=>({
  ...seavtOfJson(resource,{event:'cloud-resource-observed',provider:'oracle-cloud',resourceKind:'compute-instance'},
    {provider:'oracle-cloud',availability:{exists:'held',freeHeadroom:availability},
      commerce:{offer:'not-admitted',settlement:'unobserved'}},time),
  causes:[{type:'cloud-observation',id:address(witness)}],
});
function withRoot(fn){
  const root=mkdtempSync(join(tmpdir(),'cloud-resource-head-'));
  try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}

test('one native cloud resource is queryable by its stable SCA NI, with durable witness',()=>withRoot(root=>{
  const {witness,resource}=subjects();
  const record=row(resource,witness);
  assert.throws(()=>receiveCloudResourceRow(root,record),/witness must be committed/);
  assert.equal(put(root,'cloud-observation',triple(witness)),address(witness));
  const first=receiveCloudResourceRow(root,record);
  assert.equal(first.subject,resource);
  assert.equal(first.status,'received');
  const observed=readCloudResource(root,resource);
  assert.equal(observed.kind,'561-group.cloud-resource-current');
  assert.equal(observed.state,'one-observation');
  assert.equal(observed.asOf,timestamp);
  assert.equal(observed.recordIds.length,1);
  assert.deepEqual(observed.observations,[record]);
  assert.deepEqual(readHead(root,'cloud-resource',resource).frontier,observed.recordIds);
  assert.equal(receiveCloudResourceRow(root,record).status,'already-received');
  assert.equal(readCloudResource(root,resource).recordIds.length,1);
}));

test('older observations remain addressable without overriding the latest native head',()=>withRoot(root=>{
  const {witness,resource}=subjects();
  put(root,'cloud-observation',triple(witness));
  const latest=row(resource,witness,'2026-10-13T20:02:00Z','quota-observed');
  const historic=row(resource,witness,'2026-10-13T19:59:00Z','earlier');
  const received=receiveCloudResourceRow(root,latest);
  const stale=receiveCloudResourceRow(root,historic);
  assert.equal(stale.status,'historical-observation-retained');
  assert.deepEqual(readCloudResource(root,resource).recordIds,[received.record]);
  assert.deepEqual(get(root,'cloud-resource',stale.record),historic);
}));

test('contrary simultaneous observations are retained together, not overwritten',()=>withRoot(root=>{
  const {witness,resource}=subjects();
  put(root,'cloud-observation',triple(witness));
  const first=receiveCloudResourceRow(root,row(resource,witness,timestamp,'available'));
  const opposed=receiveCloudResourceRow(root,row(resource,witness,timestamp,'unavailable'));
  assert.equal(opposed.status,'contested-at-source-time');
  const reading=readCloudResource(root,resource);
  assert.equal(reading.state,'multiple-simultaneous-observations');
  assert.equal(reading.recordIds.length,2);
  assert.deepEqual(new Set(reading.recordIds),new Set([first.record,opposed.record]));
  assert.equal(receiveCloudResourceRow(root,row(resource,witness,timestamp,'available')).status,'already-received');
  const next=receiveCloudResourceRow(root,row(resource,witness,'2026-10-13T20:01:00Z','unknown'));
  assert.equal(next.status,'received');
  assert.deepEqual(readCloudResource(root,resource).recordIds,[next.record]);
  assert.ok(get(root,'cloud-resource',first.record),'prior contrary evidence persists');
}));

test('unproven and malformed native state cannot become a current resource',()=>withRoot(root=>{
  const {witness,resource}=subjects();
  assert.equal(readCloudResource(root,resource),null);
  assert.throws(()=>readCloudResource(root,'a mutable URL'),/canonical NI/);
  put(root,'cloud-observation',triple(witness));
  const good=row(resource,witness);
  assert.throws(()=>receiveCloudResourceRow(root,{...good,t:'2026-02-30T12:00:00Z'}),/absolute/);
  assert.throws(()=>receiveCloudResourceRow(root,{...good,causes:[]}),/cause/);
  assert.throws(()=>receiveCloudResourceRow(root,{...good,e:['not native SEN']}),/SEAVT|inferable|notation/);
  // A claimed current frontier whose addressed record does not exist is
  // corruption rather than a plausible empty/missing resource.
  writeHead(root,'cloud-resource',resource,{frontier:[address(witness)]},{expect:null});
  assert.throws(()=>readCloudResource(root,resource),/missing|another subject/);
}));

test('the installed Group MCP exposes an operator-scoped SCA resource read, without hidden writes',()=>{
  const source=readFileSync(new URL('../src/group-operations.mjs',import.meta.url),'utf8');
  assert.match(source,/name: "compute_resource"/);
  assert.match(source,/visible: mayReadCompute/);
  assert.match(source,/readOnlyHint:true/);
  assert.match(source,/return readCloudResource\(config.dataDir,subject\)/);
  assert.match(source,/signed-peer-projection-not-locally-stored/);
  assert.doesNotMatch(source,/writeHead\(|put\(|append\(/);
  const operation=readFileSync(new URL('../src/group-compute-operation.mjs',import.meta.url),'utf8');
  assert.match(operation,/receiveCloudResourceRow\(environment.METROPLAT_WEB_DATA_DIR,row\)/);
});

test('Coesite retains cloud policy but no longer forks Red Cup resource-head storage law',()=>{
 const source=readFileSync(new URL('../src/cloud-resource-receiving.mjs',import.meta.url),'utf8');
 assert.match(source,/semiotic-eavt-services-section\/causal-resource-head/u);
 assert.match(source,/createCausalResourceHead/u);
 assert.match(source,/recordType:'cloud-resource'/u);
 assert.match(source,/witnessType:'cloud-observation'/u);
 assert.match(source,/event:'cloud-resource-observed'/u);
 assert.doesNotMatch(source,/writeHead\(|put\(|HeadConflict|compareAbsoluteSeavtClocks/u);
});
