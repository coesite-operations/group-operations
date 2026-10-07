import {verifyBaseSpotRecord} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
import {readdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

/** Discover previously witnessed token holdings from immutable account observations.
 * No maintained registry, valuation, asset-completeness or trade authority is inferred. */
export async function discoverObservedBaseTokens({directory,address,maxTokens}) {
 if(!/^0x[0-9a-fA-F]{40}$/.test(address)||!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>128)throw new TypeError('bounded-base-observation-scope-required');
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {tokens:[],sourceFleetRecords:[]};throw error;}
 const files=entries.filter(entry=>entry.isFile()&&/^[a-f0-9]{64}\.json$/.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name));
 if(files.length>20000)throw new TypeError('bounded-base-observation-history-required');
 const witnessed=new Map();
 for(const file of files){
  const path=join(directory,file.name);if((await stat(path)).size>2*1048576)throw new TypeError('bounded-base-observation-record-required');
  const serialized=await readFile(path,'utf8');if(Buffer.byteLength(serialized)>2*1048576)throw new TypeError('bounded-base-observation-record-required');
  const body=JSON.parse(serialized),content=JSON.stringify(body),id=file.name.slice(0,-5);
  if(serialized!==content+'\n'||(createHash('sha256').update(content).digest('hex')!==id&&createHash('sha256').update(body.id??'').digest('hex')!==id))throw new TypeError('base-observation-content-identity-mismatch');
  if(body.type!=='BaseSpotAccountObservation'||body.venue!=='evm'||body.chainId!==8453||body.address?.toLowerCase()!==address.toLowerCase())continue;
  const {venue,...native}=body;
  try{verifyBaseSpotRecord(native);}catch(error){
   if(createHash('sha256').update(content).digest('hex')!==id||!Object.hasOwn(native,'tokenSelection'))throw error;
   const {tokenSelection,...original}=native;verifyBaseSpotRecord(original);
  }
  if(!Number.isFinite(Date.parse(body.observedAt)))throw new TypeError('dated-base-account-observation-required');
  if(!Array.isArray(body.tokenBalances))continue; // Earlier observations only cover the core assets.
  if(body.tokenBalances.length>maxTokens)throw new TypeError('bounded-base-observed-token-set-required');
  for(const row of body.tokenBalances){
   if(row.status!=='observed')continue;
   if(typeof row.token!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(row.token)||typeof row.balanceAtomic!=='string'||!/^\d+$/.test(row.balanceAtomic))throw new TypeError('exact-observed-base-token-balance-required');
   if(BigInt(row.balanceAtomic)===0n)continue;
   const token=row.token.toLowerCase();if(!witnessed.has(token))witnessed.set(token,id);
   if(witnessed.size>maxTokens)throw new TypeError('base-observed-token-capacity-exceeded');
  }
 }
 return {tokens:[...witnessed.keys()].sort(),sourceFleetRecords:[...new Set(witnessed.values())].sort()};
}
