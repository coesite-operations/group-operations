import {discoverTokenHoldings} from '@red-cup-engineering/treasury-observation-service/tokens';
import {chain} from '@red-cup-engineering/treasury-observation-service/chains';
import {verifyBaseSpotRecord} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
import {readdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

/** Discover previously witnessed token holdings from immutable account observations.
 * No maintained registry, valuation, asset-completeness or trade authority is inferred. */
export async function discoverObservedBaseTokens({directory,address,maxTokens,discover=discoverTokenHoldings,fetchImpl=fetch}) {
 if(!/^0x[0-9a-fA-F]{40}$/.test(address)||!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>256)throw new TypeError('bounded-base-observation-scope-required');
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')entries=[];else throw error;}
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
 const priorTokens=[...witnessed.keys()].sort(),sourceFleetRecords=[...new Set(witnessed.values())].sort();
 let discovery;
 try{discovery=await discover(chain('base'),address,{fetchImpl,timeoutMs:10000});}
 catch(error){discovery={checked:false,reason:error.message,attempts:[]};}
 if(discovery.checked!==true)return {tokens:priorTokens,sourceFleetRecords,discovery:{status:'unavailable',reason:discovery.reason,attempts:discovery.attempts??[]},fullWallet:false};
 if(!Array.isArray(discovery.discovered)||discovery.discovered.length>2048)throw new TypeError('bounded-current-base-token-discovery-required');
 const candidates=[];
 for(const row of discovery.discovered){
  if(typeof row.tokenAddress!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(row.tokenAddress)||typeof row.claimedRawBalance!=='string'||! /^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(row.claimedRawBalance))throw new TypeError('exact-current-base-token-claim-required');
  if(BigInt(row.claimedRawBalance)>0n)candidates.push(row.tokenAddress.toLowerCase());
 }
 const tokens=[...new Set([...priorTokens,...candidates])].sort();
 if(tokens.length>maxTokens)throw new TypeError('current-base-token-capacity-exceeded');
 return {tokens,sourceFleetRecords,discovery:{status:'discovered',via:discovery.via,observedAt:new Date().toISOString(),candidates:discovery.discovered},fullWallet:false};
}
