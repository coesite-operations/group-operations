import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import {observation} from '@red-cup-engineering/mandate-portfolio-allocation-service/public-observations';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runFinancialFleetPulse} from '../scripts/run-financial-fleet-pulse.mjs';
function forwardFixture(market,featureAt,observedAt,price=2000,closeTime='2026-12-09T00:00:00Z'){
 const sources=[{source:`https://api.elections.kalshi.com/trade-api/v2/markets/${market}`,externalId:market,at:featureAt,value:{market:{ticker:market,status:'active',yes_bid_dollars:'.19',yes_ask_dollars:'.21',close_time:closeTime}}},{source:'https://api.exchange.coinbase.com/products/ETH-USD/ticker',externalId:'ETH-USD',at:observedAt,value:{bid:String(price),ask:String(price+1)}}].map(({source,externalId,at,value})=>{const text=JSON.stringify(value);return observation({source,externalId,availableAt:at,observedAt:at,value,retrieval:{requestedUrl:source,finalUrl:source,text,responseBytes:Buffer.byteLength(text),selector:[],responseDigest:hashPosition(text),acquiredAt:at}});});
 const body={kind:'prediction-market-prospective-observation/v1',market,asset:'ETH-USD',featureAt,observedAt,rawMidpoint:.2,signalBid:.19,signalAsk:.21,assetBid:price,assetAsk:price+1,sources,eligibleForLiveUse:false};return {id:hashPosition(body),...body};
}
function fixture(root){
 const rows=[],calls=[];const journal={query:({category})=>rows.filter(r=>r.category===category),record:input=>{const id='ni:///sha-256;'+String(rows.length).padStart(43,'a');rows.push({...input,id});return {id};}};
 const sources=()=>[{client:{call:async name=>{calls.push(name);return name==='base_fleet_reconcile'?{status:'no-pending-transaction'}:{fleetRecord:'synthetic-fixture'};},close:async()=>{}}}];
 const artifact={rows:[{id:'synthetic-fixture'}],sources:[{observation:{id:'synthetic-fixture',source:'https://fixture.invalid',observedAt:'2026-10-07T03:00:00Z'}}],study:{id:'synthetic-study',scores:{method:'fixed-binned-likelihood-and-return-temporal-holdout/v3',sampleSize:15,blockCount:1,confidenceLowerBound:null,netReturnConfidenceLowerBound:null,liveUseLimitations:['unobserved historical delivery']},model:{evidenceId:'synthetic-model'},eligibleForLiveUse:false}};
 return {rows,calls,artifact,args:{environment:{TRADING_FLEET_STATE_DIR:root},clock:()=> '2026-10-07T04:00:00Z',sources,journal,prospective:async({market})=>forwardFixture(market,'2026-10-07T03:59:58Z','2026-10-07T03:59:59Z')}};
}
test('scheduled research preserves its artifact, reuses one daily study and cannot place orders',async()=>{
 const root=await mkdtemp(join(tmpdir(),'research-pulse-'));try{const f=fixture(root);let count=0;const args={...f.args,research:async()=>{count++;return f.artifact;}};
 const first=await runFinancialFleetPulse(args),second=await runFinancialFleetPulse(args);assert.equal(count,1);assert.equal(f.rows.filter(r=>r.category==='market-prospective-protocol').length,2);assert.equal(first.prospective.protocol.id,second.prospective.protocol.id);assert.equal(first.prospective.assessment.status,'awaiting-frozen-evaluation-end');assert.equal(first.research.evidence,second.research.evidence);assert.equal(first.research.selection.status,'refused');assert.equal(first.tradeEffects,false);assert.equal(first.prospective.status,'observed');assert.equal(first.prospective.outcomes.completedIntervals,0);assert.equal(f.rows.filter(r=>r.category==='market-prospective-outcomes').length,4);assert.equal(first.prospective.additionalStudies[0].market,'KXFED-26DEC-T4.25');assert.equal((await readdir(join(root,'research/artifacts'))).length,1);assert.ok(f.calls.every(c=>!c.includes('execute')));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('public research failure records a refusal without losing venue observations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'research-pulse-'));try{const f=fixture(root);const result=await runFinancialFleetPulse({...f.args,research:async()=>{throw new Error('source unavailable');}});assert.equal(result.research.status,'refused');assert.equal(result.venues.base.status,'observed');assert.ok(f.rows.some(r=>r.category==='market-study-refusal'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('fixed prospective markets remain independent and one source refusal cannot suppress the other',async()=>{
 const root=await mkdtemp(join(tmpdir(),'research-pulse-'));try{
 const f=fixture(root);let pass=0;const observed=[];
 const prospective=async({market})=>{observed.push(market);if(pass===0&&market.includes('26OCT'))throw new Error('October unavailable');
 const featureAt=pass===0?'2026-10-07T03:59:59Z':'2026-10-08T03:59:59Z';const at=pass===0?'2026-10-07T04:00:00Z':'2026-10-08T04:00:00Z';
 return forwardFixture(market,featureAt,at,2000+pass*10);};
 const args={...f.args,research:async()=>f.artifact,prospective,clock:()=>pass===0?'2026-10-07T04:00:02Z':'2026-10-08T04:00:02Z'};
 const first=await runFinancialFleetPulse(args);assert.equal(first.prospective.status,'refused');assert.equal(first.prospective.additionalStudies[0].status,'observed');
 pass=1;const second=await runFinancialFleetPulse(args);assert.equal(second.prospective.outcomes.completedIntervals,0);assert.equal(second.prospective.additionalStudies[0].outcomes.completedIntervals,1);
 const december=f.rows.filter(r=>r.category==='market-prospective-outcomes'&&r.record.market==='KXFED-26DEC-T4.25').at(-1);assert.equal(december.record.rows.length,1);assert.equal(december.record.rows[0].evidenceIds[0],forwardFixture('KXFED-26DEC-T4.25','2026-10-07T03:59:59Z','2026-10-07T04:00:00Z').sources[0].observation.id);assert.equal(second.tradeEffects,false);assert.deepEqual(observed,['KXFED-26OCT-T4.25','KXFED-26DEC-T4.25','KXFED-26OCT-T4.25','KXFED-26DEC-T4.25']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('infeasible contract records a JSON-safe terminal assessment once and preserves observations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'research-pulse-'));try{
  const f=fixture(root);const args={...f.args,research:async()=>f.artifact,prospective:async({market})=>forwardFixture(market,'2026-10-07T03:59:58Z','2026-10-07T03:59:59Z',2000,'2026-10-28T00:00:00Z')};
  const first=await runFinancialFleetPulse(args),second=await runFinancialFleetPulse(args);
  assert.equal(first.prospective.status,'observed');assert.equal(first.prospective.protocol.feasible,false);assert.equal(first.prospective.assessment.status,'contract-lifetime-insufficient');assert.equal(first.prospective.assessment.completedIntervals,null);assert.equal(first.prospective.assessment.evidence,second.prospective.assessment.evidence);assert.equal(f.rows.filter(r=>r.category==='market-prospective-study').length,2);
  const check=value=>{assert.notEqual(value,undefined);if(value&&typeof value==='object')for(const item of Object.values(value))check(item);};check(first);assert.equal(first.tradeEffects,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
