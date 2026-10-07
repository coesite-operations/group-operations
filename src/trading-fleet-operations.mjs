import {join,isAbsolute} from 'node:path';
import {runNodeJob} from '@red-cup-engineering/node-job-service';
import {operation} from '@red-cup-engineering/computer-system-engine/rpc/operation';
import {tradingFleetNetworkSources} from './trading-fleet-network.mjs';
import {weatherNetworkSources,weatherTools} from './weather-network.mjs';
import {readFinancialFleetEvidence} from '../scripts/run-financial-fleet-pulse.mjs';

// Office commands and the network entrance consume the same venue custody
// and admission path. Office standing grants access, never trading capital.
export function tradingFleetOperations(){
 const specs=[
  ['base-fleet-observe','base_fleet_observe',false],
  ['base-fleet-read-record','base_fleet_read_record',false],
  ['base-fleet-reconcile','base_fleet_reconcile',false],
  ['base-fleet-quote-native-usdc','base_fleet_quote_native_usdc',false],
  ['base-fleet-prepare-native-usdc','base_fleet_prepare_native_usdc',false],
  ['kalshi-fleet-reconcile','kalshi_fleet_reconcile',false],
  ['kalshi-fleet-observe','kalshi_fleet_observe',false],
  ['alpaca-live-observe','alpaca_live_observe',false],
  ['alpaca-live-run-fleet-cycle','alpaca_live_run_fleet_cycle',true],
  ['alpaca-live-execution-readiness','alpaca_live_execution_readiness',false],
  ['alpaca-live-execute-intent','alpaca_live_execute_intent',true],
  ['alpaca-live-execute-market-decision','alpaca_live_execute_market_decision',true],
 ];
 return Object.freeze([operation({verb:'financial-fleet-evidence',inputFormat:'json',outputFormat:'json',summary:'Read up to fifty content-addressed financial evidence records. To check one historical study against retained responses, use category market-study, limit 1, replay true; this does not confer independent acceptance or trade authority.',reads:['financial-fleet/evidence'],run:input=>{const args=input??{};if(Object.keys(args).some(key=>!['category','id','limit','replay'].includes(key)))throw new TypeError('exact-financial-evidence-query-required');return readFinancialFleetEvidence(args);}}),...weatherTools.map(tool=>operation({verb:tool.name.replaceAll('_','-'),inputFormat:'json',outputFormat:'json',summary:tool.description,reads:['financial-fleet/weather-evidence'],writes:['financial-fleet/weather-research'],run:async input=>{const [source]=weatherNetworkSources({environment:process.env,config:{instance:{name:'561-financial-office'}}});try{return await source.client.call(tool.name,input??{});}finally{await source.client.close();}}})),...specs.map(([verb,tool,write])=>operation({
  verb,inputFormat:'json',outputFormat:'json',summary:'Use the custody-bound financial fleet tool '+tool+'. Current venue authority remains required.',
  reads:['financial-fleet/custody-bound-observations'],writes:[write?'financial-fleet/admitted-order-effects':'financial-fleet/evidence'],
  effects:{class:write?'external':verb==='base-fleet-reconcile'?'journal-write':'host-read',replay:write||verb==='base-fleet-reconcile'?'coordinated':'safe',coordination:write||verb==='base-fleet-reconcile'?'coordination-required':'coordination-free',deterministic:'unmeasured',totality:'partial'},
  run:async input=>{
   const [source]=tradingFleetNetworkSources({environment:process.env,config:{instance:{name:'561-financial-office'}}});
   try{return await source.client.call(tool,input??{});}finally{await source.client.close();}
  },
 })),operation({verb:'financial-fleet-pulse',inputFormat:'json',outputFormat:'json',summary:'Start or reuse the bounded financial fleet pulse from the running release. It observes venues, records research and runs the custody-bound Alpaca cycle. Existing venue mandates and validated decisions govern order effects; read outcomes through financial-fleet-evidence.',reads:['financial-fleet/observations'],writes:['financial-fleet/evidence'],effects:{class:'external',replay:'coordinated',coordination:'coordination-required',deterministic:'unmeasured',totality:'partial'},run:()=>{const artifact=process.env.GUIX_MACHINE_ARTIFACT;if(typeof artifact!=='string'||!isAbsolute(artifact))throw new TypeError('installed-machine-artifact-required');return runNodeJob({deploymentRoot:join(artifact,'deployments/cold-red-gate-host'),job:'financial-fleet-pulse'});}})]);
}
