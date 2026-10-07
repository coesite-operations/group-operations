import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {baseSpotRecordId} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
import {persistBaseFleetRecord,readBaseFleetRecord} from '../src/base-record-store.mjs';
import {discoverObservedBaseTokens} from '../src/base-observed-tokens.mjs';
test('native Base identity is sufficient to persist, retrieve and discover holdings; changed content is refused',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-record-store-'));
 try{
  const body={type:'BaseSpotAccountObservation',chainId:8453,address:'0x224C08A8526751887a83e2711B167f890c6D078d',observedAt:'2026-10-07T00:00:00Z',tokenBalances:[{token:'0x4200000000000000000000000000000000000006',status:'observed',balanceAtomic:'1'}],tokenSelection:{method:'synthetic-test-only',sourceFleetRecords:[]}};
  const record={id:baseSpotRecordId(body),...body},stored=await persistBaseFleetRecord({directory,record});assert.equal(stored.fleetRecord,record.id);
  assert.deepEqual(await readBaseFleetRecord({directory,reference:record.id}),record);await persistBaseFleetRecord({directory,record});assert.equal((await readdir(directory)).length,1);
  assert.equal((await discoverObservedBaseTokens({directory,address:body.address,maxTokens:128})).tokens.length,1);
  const file=join(directory,(await readdir(directory))[0]),tampered=JSON.parse(await readFile(file,'utf8'));tampered.tokenBalances[0].balanceAtomic='2';await writeFile(file,JSON.stringify(tampered)+'\n');
  await assert.rejects(readBaseFleetRecord({directory,reference:record.id}),/semantic-content-mismatch/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('historical wrapper-addressed observations retain witnessed holdings without becoming executable record aliases',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-historical-holdings-'));
 try{
  const body={type:'BaseSpotAccountObservation',chainId:8453,address:'0x224C08A8526751887a83e2711B167f890c6D078d',observedAt:'2026-10-06T00:00:00Z',tokenBalances:[{token:'0x4200000000000000000000000000000000000006',status:'observed',balanceAtomic:'1'}]};
  const id=baseSpotRecordId(body),legacy={venue:'evm',id,...body,tokenSelection:{method:'historical-wrapper',sourceFleetRecords:[]}},content=JSON.stringify(legacy),key=createHash('sha256').update(content).digest('hex');
  await writeFile(join(directory,key+'.json'),content+'\n',{mode:0o600});
  assert.equal((await discoverObservedBaseTokens({directory,address:body.address,maxTokens:128})).tokens.length,1);
  await assert.rejects(readBaseFleetRecord({directory,reference:id}),{code:'ENOENT'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
