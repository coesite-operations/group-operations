import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {baseSpotRecordId} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
import {persistBaseFleetRecord} from '../src/base-record-store.mjs';
import {discoverObservedBaseTokens} from '../src/base-observed-tokens.mjs';
const address='0x224c08a8526751887a83e2711b167f890c6d078d',a='0x1111111111111111111111111111111111111111',b='0x2222222222222222222222222222222222222222';
const unavailable=async()=>({checked:false,reason:'offline fixture',attempts:[]});
const filename=id=>createHash('sha256').update(id).digest('hex')+'.json';
async function record(directory,tokenBalances,changes={}){
 const body={type:'BaseSpotAccountObservation',chainId:8453,address,observedAt:'2026-10-07T00:00:00Z',...(tokenBalances===undefined?{}:{tokenBalances}),...changes};
 const stored=await persistBaseFleetRecord({directory,record:{id:baseSpotRecordId(body),...body}});return stored.id;
}
test('verified holdings survive later core-only observations without treating refusals or other wallets as assets',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-observed-'));try{
 const source=await record(directory,[{token:a,status:'observed',balanceAtomic:'100'},{token:b,status:'refused',reason:'unavailable'}]);
 await record(directory,undefined);await record(directory,[{token:b,status:'observed',balanceAtomic:'100'}],{address:b});await record(directory,[{token:b,status:'observed',balanceAtomic:'0'}]);
 const result=await discoverObservedBaseTokens({directory,address,maxTokens:128,discover:unavailable});assert.deepEqual(result.tokens,[a]);assert.deepEqual(result.sourceFleetRecords,[source]);
 const second=await record(directory,[{token:b,status:'observed',balanceAtomic:'900719925474099300000'}]);const next=await discoverObservedBaseTokens({directory,address,maxTokens:128,discover:unavailable});assert.deepEqual(next.tokens,[a,b]);assert.ok(next.sourceFleetRecords.includes(second));
 await assert.rejects(discoverObservedBaseTokens({directory,address,maxTokens:1,discover:unavailable}),/capacity|token-set/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('content mutation and malformed observed balances refuse before influencing automatic monitoring',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-observed-'));try{const id=await record(directory,[{token:a,status:'observed',balanceAtomic:'1'}]);await writeFile(join(directory,filename(id)),'{}\n');await assert.rejects(discoverObservedBaseTokens({directory,address,maxTokens:128,discover:unavailable}),/identity-mismatch/);await rm(join(directory,filename(id)));await record(directory,[{token:a,status:'observed',balanceAtomic:'1.5'}]);await assert.rejects(discoverObservedBaseTokens({directory,address,maxTokens:128,discover:unavailable}),/exact-observed/);}finally{await rm(directory,{recursive:true,force:true});}
});


test('native portfolio witnesses retain assets when discovery is unavailable, without accepting another wallet',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-portfolio-history-'));
 try{
  const body={type:'BaseTreasuryPortfolioObservation',chainId:8453,address,observedAt:'2026-10-08T00:00:00Z',portfolio:{chains:[{chain:'base',checked:true,wallets:[{address,checked:true,verifiedTokens:{checked:false,holdings:[{token:a,checked:true,raw:'123'},{token:b,checked:false,balanceObserved:true,raw:'456'}]}},{address:a,checked:true,verifiedTokens:{holdings:[{token:'0x3333333333333333333333333333333333333333',checked:true,raw:'999'}]}}]}]}};
  const stored=await persistBaseFleetRecord({directory,record:{id:baseSpotRecordId(body),...body}});
  const result=await discoverObservedBaseTokens({directory,address,maxTokens:128,discover:unavailable});
  assert.deepEqual(result.tokens,[a,b]);assert.deepEqual(result.sourceFleetRecords,[stored.id]);
  assert.equal(result.discovery.status,'unavailable');assert.equal(result.fullWallet,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
