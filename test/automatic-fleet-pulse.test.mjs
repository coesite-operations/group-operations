import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {baseSpotRecordId} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
import {persistBaseFleetRecord} from '../src/base-record-store.mjs';
import {runFinancialFleetPulse} from '../scripts/run-financial-fleet-pulse.mjs';
test('scheduled pulse consumes the live cycle and witnesses uncertainty instead of claiming no effects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'automatic-fleet-pulse-'));
 try{
  for(const tradeEffects of [false,null]){
   const calls=[],rows=[];let closed=false;
   const client={async call(tool){calls.push(tool);if(tool==='alpaca_live_run_fleet_cycle')return {status:tradeEffects===false?'not-configured':'refused',tradeEffects,executionAttempted:tradeEffects!==false};return {};},async close(){closed=true;}};
   const pulse=await runFinancialFleetPulse({environment:{TRADING_FLEET_STATE_DIR:root},sources:()=>[{client}],journal:{record(row){rows.push(row);return {id:'evidence-'+rows.length};},query(){return [];}},research:async()=>{throw Error('no-study');},prospective:async()=>{throw Error('no-prospective-data');}});
   assert.equal(calls.filter(x=>x==='alpaca_live_run_fleet_cycle').length,1);assert.equal(pulse.tradeEffects,tradeEffects);assert.equal(pulse.venues.alpaca.execution.tradeEffects,tradeEffects);
   assert.ok(rows.some(row=>row.category==='venue-execution-observation'&&row.record.venue==='alpaca'));assert.equal(closed,true);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('portfolio pulse keeps full evidence in native custody and refuses a changed compact return',async()=>{
 const root=await mkdtemp(join(tmpdir(),'base-portfolio-pulse-'));
 try{
  const body={type:'BaseTreasuryPortfolioObservation',chainId:8453,address:'0x224C08A8526751887a83e2711B167f890c6D078d',observedAt:'2026-10-08T00:00:00Z',portfolio:{syntheticFixture:true,sourcePayload:'complete retained source'},summary:{fullWallet:false,usdValuation:false,riskBooksEstablished:false,orderEffect:false}};
  const full=await persistBaseFleetRecord({directory:join(root,'evm','observations'),record:{id:baseSpotRecordId(body),...body}});
  const {portfolio,...compact}=full;
  for(const changed of [false,true]){
   const rows=[];
   const client={async call(tool){if(tool==='base_fleet_observe_portfolio')return changed?{...compact,summary:{...compact.summary,riskBooksEstablished:true}}:compact;if(tool==='alpaca_live_run_fleet_cycle')return {status:'not-configured',tradeEffects:false};return {};},async close(){}};
   const result=await runFinancialFleetPulse({environment:{TRADING_FLEET_STATE_DIR:root},sources:()=>[{client}],journal:{record(row){rows.push(row);return {id:'fixture-'+rows.length};},query(){return [];}},research:async()=>{throw Error('no-study');},prospective:async()=>{throw Error('no-prospective-data');}});
   assert.equal(result.venues.base.portfolio.status,changed?'refused':'observed');
   assert.equal(result.tradeEffects,false);assert.equal(result.forecastConfidenceEstablished,false);
   if(!changed){const witness=rows.find(row=>row.record.tool==='base_fleet_observe_portfolio');assert.equal(witness.record.observed.completeObservationReference,full.id);assert.equal(Object.hasOwn(witness.record.observed,'portfolio'),false);assert.equal(witness.record.observed.summary.riskBooksEstablished,false);}
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
