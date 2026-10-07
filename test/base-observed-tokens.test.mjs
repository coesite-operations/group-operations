import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {discoverObservedBaseTokens} from '../src/base-observed-tokens.mjs';
const address='0x224c08a8526751887a83e2711b167f890c6d078d',a='0x1111111111111111111111111111111111111111',b='0x2222222222222222222222222222222222222222';
async function record(directory,tokenBalances,changes={}){const body={venue:'evm',type:'BaseSpotAccountObservation',chainId:8453,address,observedAt:'2026-10-07T00:00:00Z',tokenBalances,...changes};const text=JSON.stringify(body),id=createHash('sha256').update(text).digest('hex');await writeFile(join(directory,id+'.json'),text+'\n');return id;}
test('verified holdings survive later core-only observations without treating refusals or other wallets as assets',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-observed-'));try{
 const source=await record(directory,[{token:a,status:'observed',balanceAtomic:'100'},{token:b,status:'refused',reason:'unavailable'}]);
 await record(directory,undefined);await record(directory,[{token:b,status:'observed',balanceAtomic:'100'}],{address:b});await record(directory,[{token:b,status:'observed',balanceAtomic:'0'}]);
 const result=await discoverObservedBaseTokens({directory,address,maxTokens:128});assert.deepEqual(result.tokens,[a]);assert.deepEqual(result.sourceFleetRecords,[source]);
 const second=await record(directory,[{token:b,status:'observed',balanceAtomic:'900719925474099300000'}]);const next=await discoverObservedBaseTokens({directory,address,maxTokens:128});assert.deepEqual(next.tokens,[a,b]);assert.ok(next.sourceFleetRecords.includes(second));
 await assert.rejects(discoverObservedBaseTokens({directory,address,maxTokens:1}),/capacity|token-set/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('content mutation and malformed observed balances refuse before influencing automatic monitoring',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'base-observed-'));try{const id=await record(directory,[{token:a,status:'observed',balanceAtomic:'1'}]);await writeFile(join(directory,id+'.json'),'{}\n');await assert.rejects(discoverObservedBaseTokens({directory,address,maxTokens:128}),/identity-mismatch/);await rm(join(directory,id+'.json'));await record(directory,[{token:a,status:'observed',balanceAtomic:'1.5'}]);await assert.rejects(discoverObservedBaseTokens({directory,address,maxTokens:128}),/exact-observed/);}finally{await rm(directory,{recursive:true,force:true});}
});
