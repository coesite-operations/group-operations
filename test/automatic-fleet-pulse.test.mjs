import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
