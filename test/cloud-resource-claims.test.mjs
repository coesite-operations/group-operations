import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  assert.equal(new Set(facts.rows.map(r=>r.e)).size,8);
  for(const row of facts.rows){
    assert.match(row.e,/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(row.causes,[facts.observationWitness]);
    assert.equal(row.a.event,'cloud-resource-observed');
    assert.equal(row.t,facts.asOf);
    assert.equal(row.v.commerce.offer,'not-admitted');
    assert.equal(row.v.custody.rightsToResell,'unverified');
    assert.equal(row.v.custody.rightsToPublish,'unverified');
  }
  const project=facts.rows.find(r=>r.v.kind==='project');
  assert.equal(project.v.availability.billing,'disabled');
  assert.equal(project.v.availability.newExecution,'denied');
  const bucketRows=facts.rows.filter(r=>r.v.kind==='storage-bucket');
  assert.equal(bucketRows.length,3);
  assert.ok(bucketRows.every(r=>r.v.availability.license==='unknown'));
  assert.equal(JSON.stringify(facts).includes('CLOUDFLARE_API_TOKEN'),false);
});

test('stable resource subjects survive new observations; the witnessed statement changes',()=>{
  const first=projectCloudResourceClaims(sample());
  const next=sample();next.observedAt='2026-10-13T20:34:00Z';
  const second=projectCloudResourceClaims(next);
  assert.deepEqual(first.rows.map(r=>r.e),second.rows.map(r=>r.e));
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
  assert.match(source,/put\(environment.METROPLAT_WEB_DATA_DIR, "cloud-resource", row\)/);
  assert.match(source,/sendPeerEvidence\(/);
  assert.match(source,/resourceSubjects:facts.rows.map\(row=>row.e\)/);
  assert.doesNotMatch(source,/machines\.json|sources\.json|new CloudScheduler/);
});
