import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {termToJson} from '@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/json-codec';
import {inferTy,isClosed} from '@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/typing';
import {semanticId} from '@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address';
import {put,get,walk} from '@red-cup-engineering/semiotic-eavt-services-section/store';
import {projectCloudResourceClaims} from '../src/cloud-resource-claims.mjs';

const sample=()=>({
  kind:'compute-resource-observation',observedAt:'2026-10-13T19:34:00.000Z',
  googleCloud:{status:'observed',projects:[{
    projectId:'five-six-one-group-dev',billing:{status:'observed',enabled:false},
    enabledComputeServices:['cloudbuild.googleapis.com','run.googleapis.com','storage.googleapis.com'],
    cloudRunUsCentral1:{status:'observed',services:[{
      name:'wuxian-gui',ready:'True',latestReadyRevision:'wuxian-gui-00001',
    }]},
    storageBuckets:{status:'observed',buckets:[{
      name:'native-weather-records',location:'US',storageClass:'STANDARD',
    }]},
    computeInstances:{status:'unavailable',reason:'billing-disabled'},
  }]},
  oracleCloud:{status:'observed',tenancyName:'test-real-tenancy',tenancyIdentity:'ni:///sha-256;'+'a'.repeat(43),
    configuredRegion:'us-ashburn-1',instances:[{compartmentId:'ocid1.compartment.fake',
      status:'observed',items:[]}],objectStorage:{status:'observed',buckets:[{
      compartmentId:'ocid1.compartment.fake',status:'observed',items:[{
        name:'astronomy-data',namespace:'native-space',storageTier:'Standard',
      }]
    }]}},
  cloudflare:{status:'observed',accountId:'f'.repeat(32),workersBuildMinutes:{status:'not-exhausted'},
    workers:[{name:'market-561-group',modifiedOn:'2026-10-13T00:00:00Z'}],
    r2Buckets:{status:'observed',coverage:'complete',buckets:[{
      name:'naval-data',jurisdiction:'default',location:'enam',storageClass:'Standard',
    }]}},
});

test('genuine provider observations become addressable SCA/SEAVT subjects, not fake offers',()=>{
  const facts=projectCloudResourceClaims(sample());
  assert.equal(facts.kind,'561-group.cloud-resource-predications');
  assert.equal(facts.asOf,'2026-10-13T19:34:00.000Z');
  assert.equal(facts.rows.length,8);
  assert.match(facts.observationWitness,/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/);
  assert.equal(new Set(facts.resourceSubjects).size,8);
  assert.equal(semanticId(facts.witnessRecord),facts.observationWitness);
  assert.match(facts.sourceCommitment,/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/);
  for(const row of facts.rows){
    for(const key of ['e','a','v']){
      assert.ok(Array.isArray(row[key]),key+' must be native SEN');
      assert.notEqual(inferTy([],row[key]),null);
      assert.equal(isClosed(row[key]),true);
    }
    assert.match(termToJson(row.e),/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(row.causes,[{type:'cloud-observation',id:facts.observationWitness}]);
    assert.equal(termToJson(row.a).event,'cloud-resource-observed');
    assert.equal(row.t,facts.asOf);
    assert.equal(termToJson(row.v).commerce.offer,'not-admitted');
    assert.equal(termToJson(row.v).custody.rightsToResell,'unverified');
    assert.equal(termToJson(row.v).custody.rightsToPublish,'unverified');
  }
  const project=facts.rows.find(r=>termToJson(r.v).kind==='project');
  assert.equal(termToJson(project.v).availability.billing,'disabled');
  assert.equal(termToJson(project.v).availability.newExecution,'denied');
  const bucketRows=facts.rows.filter(r=>termToJson(r.v).kind==='storage-bucket');
  assert.equal(bucketRows.length,3);
  assert.ok(bucketRows.every(r=>termToJson(r.v).availability.license==='unknown'));
  assert.equal(JSON.stringify(facts).includes('CLOUDFLARE_API_TOKEN'),false);
});

test('stable resource subjects survive new observations; the witnessed statement changes',()=>{
  const first=projectCloudResourceClaims(sample());
  const next=sample();next.observedAt='2026-10-13T20:34:00Z';
  const second=projectCloudResourceClaims(next);
  assert.deepEqual(first.resourceSubjects,second.resourceSubjects);
  assert.notEqual(first.observationWitness,second.observationWitness);
  assert.notDeepEqual(first.rows[0].causes,second.rows[0].causes);
});

test('missing native coverage never asserts buckets or capacity',()=>{
  const record=sample();record.googleCloud.status='unavailable';
  record.oracleCloud={status:'observed',instances:[],objectStorage:{status:'unavailable'}};
  record.cloudflare={status:'credential-unavailable'};
  const facts=projectCloudResourceClaims(record);
  assert.equal(facts.rows.length,0);
});

test('duplicate foreign coordinates and malformed evidence refuse rather than invent data',()=>{
  const invalid=sample();
  invalid.googleCloud.projects[0].storageBuckets.buckets.push({...invalid.googleCloud.projects[0].storageBuckets.buckets[0]});
  assert.throws(()=>projectCloudResourceClaims(invalid),/duplicate resource identity/);
  const noID=sample();delete noID.googleCloud.projects[0].projectId;
  assert.throws(()=>projectCloudResourceClaims(noID),/native ID missing/);
  assert.throws(()=>projectCloudResourceClaims({kind:'compute-resource-observation'}),/native observation envelope/);
});

test('consumer uses the established signed SEN peer and SEAVT journal, not a shadow dispatcher',()=>{
  const source=readFileSync(new URL('../src/group-compute-operation.mjs',import.meta.url),'utf8');
  assert.match(source,/projectCloudResourceClaims\(record\)/);
  assert.match(source,/put\(environment.METROPLAT_WEB_DATA_DIR, "cloud-observation", facts.witnessRecord\)/);
  assert.match(source,/put\(environment.METROPLAT_WEB_DATA_DIR, "cloud-resource", row\)/);
  assert.ok(source.indexOf('"cloud-observation", facts.witnessRecord')<
    source.indexOf('"cloud-resource", row'));
  assert.match(source,/sendPeerEvidence\(/);
  assert.match(source,/resourceSubjects:facts.resourceSubjects/);
  assert.doesNotMatch(source,/machines\.json|sources\.json|new CloudScheduler/);
});

test('SCA observation witness is durable in SEAVT store and its causes can be walked',()=>{
  const root=mkdtempSync(join(tmpdir(),'cloud-seavt-'));
  try{
    const facts=projectCloudResourceClaims(sample());
    const witness=put(root,'cloud-observation',facts.witnessRecord);
    assert.equal(witness,facts.observationWitness);
    assert.deepEqual(get(root,'cloud-observation',witness),facts.witnessRecord);
    const records=facts.rows.map(row=>put(root,'cloud-resource',row));
    assert.equal(new Set(records).size,facts.rows.length);
    const path=[...walk(root,'cloud-resource',[records[0]])];
    assert.deepEqual(path.map(x=>x.type),['cloud-resource','cloud-observation']);
    assert.ok(path.every(x=>x.record&&!x.missing&&!x.truncated));
    assert.equal(path[1].address,witness);
    assert.equal(termToJson(path[0].record.e),facts.resourceSubjects[0]);
    assert.deepEqual(facts.rows.map(row=>put(root,'cloud-resource',row)),records);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('changed native evidence changes witness but preserves resource coordinates',()=>{
  const before=projectCloudResourceClaims(sample());
  const changed=sample();changed.googleCloud.projects[0].billing.enabled=true;
  const after=projectCloudResourceClaims(changed);
  assert.deepEqual(before.resourceSubjects,after.resourceSubjects);
  assert.notEqual(before.sourceCommitment,after.sourceCommitment);
  assert.notEqual(before.observationWitness,after.observationWitness);
  const project=after.rows.find(x=>termToJson(x.v).kind==='project');
  assert.equal(termToJson(project.v).availability.billing,'enabled');
  assert.equal(termToJson(project.v).availability.newExecution,'unknown');
});

test('nonexistent calendar days cannot be native SEAVT clocks',()=>{
  const bad=sample();bad.observedAt='2026-02-30T12:00:00Z';
  assert.throws(()=>projectCloudResourceClaims(bad),/native observation envelope/);
});
