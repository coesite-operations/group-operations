#!/usr/bin/env node
import {isDeepStrictEqual} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {researchPredictionMarketStrategy,observePredictionMarketStrategy,resolveProspectiveStrategyRows,studyProspectiveStrategy,createProspectiveProtocol,replayPredictionMarketStudy} from '@red-cup-engineering/mandate-portfolio-allocation-service/prediction-market-research';
import {mkdirSync,chmodSync,readFileSync,statSync} from 'node:fs';
import {readBaseFleetRecord} from '../src/base-record-store.mjs';
import {tradingFleetNetworkSources} from '../src/trading-fleet-network.mjs';
import {createSemanticRecordJournal} from '@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record';

// One scheduled observer uses the same custody-bound venue consumers as the
// CFO entrance. Observation cannot supply trade authority or model confidence.
export async function runFinancialFleetPulse({environment=process.env,clock=()=>new Date().toISOString(),sources=tradingFleetNetworkSources,journal,research=researchPredictionMarketStrategy,prospective=observePredictionMarketStrategy}={}){
 const root=environment.TRADING_FLEET_STATE_DIR??join(homedir(),'.local/state/561-group/trading-fleet');
 const evidenceRoot=join(root,'knowledge');mkdirSync(evidenceRoot,{recursive:true,mode:0o700});chmodSync(evidenceRoot,0o700);
 const custody=journal??createSemanticRecordJournal({root:evidenceRoot,objectKind:'561-group.financial-fleet-pulse'});
 const [source]=sources({environment,config:{instance:{name:'561-financial-fleet-pulse'}}});
 const calls=[['base','base_fleet_observe',{}],['kalshi','kalshi_fleet_observe',{}]];
 const reference=environment.ALPACA_LIVE_OBSERVATION_GRANT_REFERENCE;
 if(reference)calls.push(['alpaca','alpaca_live_observe',{authorityGrantReference:reference}]);
 const results={};
 try{
  // Resolve effects already in custody before acquiring new strategy inputs.
  // Recovery is independently witnessed even when wallet observation fails.
  let baseRecovery;
  try{baseRecovery=await source.client.call('base_fleet_reconcile',{});}
  catch(error){baseRecovery={status:'refused',reason:error.message};}
  const recoveryEvidence=custody.record({category:'venue-execution-observation',record:{venue:'base',tool:'base_fleet_reconcile',observed:baseRecovery},recordedAt:clock(),told:{for:true,against:false}}).id;
  baseRecovery={...baseRecovery,evidence:recoveryEvidence};
  let kalshiRecovery;
  try{kalshiRecovery=await source.client.call('kalshi_fleet_reconcile',{});}
  catch(error){kalshiRecovery={status:'refused',reason:error.message};}
  const kalshiRecoveryEvidence=custody.record({category:'venue-execution-observation',record:{venue:'kalshi',tool:'kalshi_fleet_reconcile',observed:kalshiRecovery},recordedAt:clock(),told:{for:true,against:false}}).id;
  kalshiRecovery={...kalshiRecovery,evidence:kalshiRecoveryEvidence};
  await Promise.all(calls.map(async([venue,tool,args])=>{
   try{
    const observed=await source.client.call(tool,args);
    let journalObservation=observed;
    if(venue==='base'){
     const stored=await readBaseFleetRecord({directory:join(root,'evm','observations'),reference:observed.id});
     const {portfolio,...compact}=stored;
     const {venue:storedVenue,fleetRecord,...returned}=observed;
     if(storedVenue!=='evm'||fleetRecord!==stored.id||stored.type!=='BaseTreasuryPortfolioObservation'||!isDeepStrictEqual(compact,returned))throw new TypeError('persisted-base-portfolio-observation-mismatch');
     journalObservation={...compact,completeObservationReference:stored.id};
    }
    const receipt=custody.record({category:'venue-observation',record:{venue,tool,observed:journalObservation},recordedAt:clock(),told:{for:true,against:false}});

    results[venue]={status:'observed',evidence:receipt.id,fleetRecord:observed.fleetRecord??null};
    if(observed.settlementAccounting)results[venue].settlements={verifiedPayouts:observed.settlementAccounting.records.filter(row=>row.payoutReconciled).length,payoutMismatches:observed.settlementAccounting.records.filter(row=>!row.payoutReconciled).length,refusals:observed.settlementAccounting.refusals.length,accountCashReconciled:false};
    if(venue==='base'){results[venue].recovery=baseRecovery;results[venue].summary=journalObservation.summary;}
    if(venue==='kalshi')results[venue].recovery=kalshiRecovery;
   }catch(error){
    const receipt=custody.record({category:'venue-observation-refusal',record:{venue,tool,reason:error.message},recordedAt:clock(),told:{for:true,against:false}});
    results[venue]={status:'refused',evidence:receipt.id,reason:error.message,...(venue==='base'?{recovery:baseRecovery}:venue==='kalshi'?{recovery:kalshiRecovery}:{})};
   }
  }));
  if(!reference)results.alpaca={status:'not-configured',reason:'production-observation-grant-reference-absent'};
  let alpacaExecution;
  try{alpacaExecution=await source.client.call('alpaca_live_run_fleet_cycle',{});}
  catch(error){alpacaExecution={status:'refused',reason:error.message,executionAttempted:null,tradeEffects:null};}
  const executionEvidence=custody.record({category:'venue-execution-observation',record:{venue:'alpaca',tool:'alpaca_live_run_fleet_cycle',observed:alpacaExecution},recordedAt:clock(),told:{for:true,against:false}}).id;
  results.alpaca.execution={...alpacaExecution,evidence:executionEvidence};
  const at=clock(),request={market:'KXFED-26OCT-T4.25',roundTripCostFraction:0.005};
  let learning;
  try {
   const prior=custody.query({category:'market-study'}).findLast(row=>row.record?.scores?.method==='fixed-binned-likelihood-and-return-temporal-holdout/v3'&&row.record?.at?.slice(0,10)===at.slice(0,10)&&row.record.request?.market===request.market&&row.record.request?.roundTripCostFraction===request.roundTripCostFraction);
   let summary,evidence;
   if(prior){summary=prior.record;evidence=prior.id;}
   else {
    const artifact=await research({...request,now:Date.parse(at)});
    const serialized=JSON.stringify(artifact)+'\n';if(Buffer.byteLength(serialized)>8*1048576)throw new TypeError('bounded-public-research-artifact-required');
    const hex=createHash('sha256').update(serialized).digest('hex'),artifactId='ni:///sha-256;'+createHash('sha256').update(serialized).digest('base64url');
    const artifacts=join(root,'research','artifacts');await mkdir(artifacts,{recursive:true,mode:0o700});
    const path=join(artifacts,hex+'.json');
    try{await writeFile(path,serialized,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||await readFile(path,'utf8')!==serialized)throw error;}
    summary={at:clock(),request,artifactId,sourceRows:artifact.rows.length,sources:artifact.sources.map(row=>({id:row.observation.id,source:row.observation.source,observedAt:row.observation.observedAt})),studyId:artifact.study.id,scores:artifact.study.scores,model:artifact.study.model,eligibleForLiveUse:artifact.study.eligibleForLiveUse};
    evidence=custody.record({category:'market-study',record:summary,recordedAt:summary.at,told:{for:true,against:false}}).id;
   }
   const reasons=[...(summary.scores.liveUseLimitations??[])];
   if(!(summary.scores.confidenceLowerBound>0))reasons.push('calibration improvement has no positive measured confidence bound');
   if(!(summary.scores.netReturnConfidenceLowerBound>0))reasons.push('net returns have no positive measured confidence bound');
   learning={status:'studied',evidence,artifactId:summary.artifactId,studyId:summary.studyId,sampleSize:summary.scores.sampleSize,blockCount:summary.scores.blockCount,eligibleForLiveUse:summary.eligibleForLiveUse,selection:{scope:'prediction-market-conditioned ETH daily strategy',status:reasons.length?'refused':'requires-current-account-quotes-and-authority',reasons}};
  }catch(error){
   const evidence=custody.record({category:'market-study-refusal',record:{at,request,reason:error.message},recordedAt:at,told:{for:true,against:false}}).id;
   learning={status:'refused',evidence,reason:error.message};
  }
  const forwardStudies=[];
  // Fixed independent hypotheses; never pool markets or pick a winner by outcomes.
  for(const market of [request.market,'KXFED-26DEC-T4.25']) {
  let forward;
  try {
   const observation=await prospective({market,now:Date.parse(clock())});
   const evidence=custody.record({category:'market-prospective-observation',record:observation,recordedAt:observation.observedAt,told:{for:true,against:false}}).id;
   forward={market,status:'observed',evidence,observationId:observation.id,featureAt:observation.featureAt,observedAt:observation.observedAt,eligibleForLiveUse:false};
   let registered=custody.query({category:'market-prospective-protocol'}).find(row=>row.record.market===market);
   if(!registered){
    const protocol=createProspectiveProtocol({market,registeredAt:clock(),closeTime:observation.sources[0].observation.value.market.close_time,roundTripCostFraction:request.roundTripCostFraction});
    registered={record:protocol,id:custody.record({category:'market-prospective-protocol',record:protocol,recordedAt:protocol.registeredAt,told:{for:true,against:false}}).id};
   }
   forward.protocol={evidence:registered.id,id:registered.record.id,evaluationEnd:registered.record.evaluationEnd,feasible:registered.record.feasible};
   const history=custody.query({category:'market-prospective-observation'}).map(row=>row.record).filter(row=>row.market===market);
   const resolved=resolveProspectiveStrategyRows({observations:history,observedAt:clock()});
   const outcomeEvidence=custody.record({category:'market-prospective-outcomes',record:{at:clock(),market,...resolved,eligibleForLiveUse:false},recordedAt:clock(),told:{for:true,against:false}}).id;
   forward.outcomes={evidence:outcomeEvidence,completedIntervals:resolved.rows.length,missedEndpoints:resolved.missedEndpoints,pendingEntry:resolved.pendingEntry};
   const completed=custody.query({category:'market-prospective-study'}).find(row=>row.record.protocolId===registered.record.id&&['studied','insufficient-frozen-outcomes','contract-lifetime-insufficient'].includes(row.record.status));
   const assessment=completed?.record??studyProspectiveStrategy({observations:history,observedAt:clock(),protocol:registered.record});
   const studyEvidence=completed?.id??custody.record({category:'market-prospective-study',record:{at:clock(),market,...assessment},recordedAt:clock(),told:{for:true,against:false}}).id;
   forward.assessment={evidence:studyEvidence,status:assessment.status,completedIntervals:assessment.completedIntervals??null,studyId:assessment.study?.id??null,eligibleForLiveUse:assessment.eligibleForLiveUse};
  }catch(error){
   const at=clock(),evidence=custody.record({category:'market-prospective-refusal',record:{at,market,reason:error.message},recordedAt:at,told:{for:true,against:false}}).id;
   forward={market,status:'refused',evidence,reason:error.message};
  }
  forwardStudies.push(forward);
  }
  const forward={...forwardStudies[0],additionalStudies:forwardStudies.slice(1),selectionPolicy:'independent fixed hypotheses; no pooling or automatic winner selection'};
  const pulse={at:clock(),venues:results,research:learning,prospective:forward,tradeEffects:alpacaExecution.tradeEffects,forecastConfidenceEstablished:false};
  const receipt=custody.record({category:'pulse',record:pulse,recordedAt:pulse.at,told:{for:true,against:false}});
  return {...pulse,evidence:receipt.id};
 }finally{await source.client.close();}
}
export function readFinancialFleetEvidence({environment=process.env,category='pulse',id,limit=10,replay=false}={}){
 if(!['pulse','venue-observation','venue-observation-refusal','venue-execution-observation','market-study','market-study-refusal','market-prospective-observation','market-prospective-refusal','market-prospective-outcomes','market-prospective-study','market-prospective-protocol'].includes(category)||!Number.isInteger(limit)||limit<1||limit>50)throw new TypeError('bounded-financial-evidence-query-required');
 if(id!==undefined&&(typeof id!=='string'||!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/.test(id)))throw new TypeError('financial-semantic-evidence-address-required');
 if(typeof replay!=='boolean'||(replay&&(category!=='market-study'||limit!==1)))throw new TypeError('replay-requires-one-recorded-market-study');
 const root=environment.TRADING_FLEET_STATE_DIR??join(homedir(),'.local/state/561-group/trading-fleet');
 const journal=createSemanticRecordJournal({root:join(root,'knowledge'),objectKind:'561-group.financial-fleet-pulse'});
 const rows=journal.query({category});
 const selected=(id===undefined?rows:rows.filter(row=>row.id===id)).slice(-limit);
 let reproduced;
 if(replay){
  if(selected.length!==1)throw new TypeError('recorded-market-study-required');
  const summary=selected[0].record,artifactId=summary.artifactId;
  if(typeof artifactId!=='string'||!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/.test(artifactId))throw new TypeError('recorded-research-artifact-address-required');
  const hex=Buffer.from(artifactId.split(';')[1],'base64url').toString('hex'),path=join(root,'research','artifacts',hex+'.json');
  if(statSync(path).size>8*1048576)throw new TypeError('bounded-research-artifact-required');
  const bytes=readFileSync(path);
  if(bytes.length>8*1048576||'ni:///sha-256;'+createHash('sha256').update(bytes).digest('base64url')!==artifactId)throw new TypeError('recorded-research-artifact-digest-mismatch');
  const artifact=JSON.parse(bytes.toString('utf8'));reproduced=replayPredictionMarketStudy(artifact);
  if(summary.studyId!==reproduced.studyId||!isDeepStrictEqual(summary.scores,artifact.study.scores)||summary.eligibleForLiveUse!==artifact.study.eligibleForLiveUse)throw new TypeError('recorded-research-summary-mismatch');
 }
 return {category,records:JSON.parse(JSON.stringify(selected)),returned:selected.length,...(replay?{replay:reproduced}:{})};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 runFinancialFleetPulse().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
