/**
 * One bounded live read over original Group resource-accounting sources.
 * Farolfi owns monetary books. FeltOS owns inference-token event custody.
 * The host meter belongs to Computer Systems and must be bound to actual
 * historical host observations before interval use can be asserted.
 *
 * Never copies transactions or writes a shadow ledger. No provider mutation.
 */
import {utcWindowsAt} from "@red-cup-engineering/exact-number-data-service/utc-windows";

const RESOLUTIONS=new Set(['second','minute','hour','day']);
const fail=message=>{throw new TypeError('Group resource flows: '+message)};
const hasPath=s=>typeof s==='string'&&s.trim().length>0;
const sourceError=err=>err?.code==='ENOENT'?'source-missing':
 err?.code==='ERR_MODULE_NOT_FOUND'?'supplier-package-not-installed':
 'original-source-read-refused';
const sourceUnavailable=(why)=>Object.freeze({status:'unavailable',reason:why});
const dayOf=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))
  fail('date requires YYYY-MM-DD UTC');
 const at=value+'T00:00:00.000Z';
 // Exactly the same clock vocabulary used by native Computer Data meters.
 const [window]=utcWindowsAt(at,{finest:'day'});
 return {date:value,nextDate:window.endAt.slice(0,10)};
};
/**
 * Source-bound, authorized on-demand reading. Callers select a day and an
 * actually meaningful resolution; absent source telemetry remains unknown.
 * Optional provider parameters are native function dependencies, allowing
 * the existing run to be exercised without external writes.
 */
export async function readGroupResourceFlows({
 date,resolution='day',account,environment=process.env,
 readMoney,readTokens
}={}){
 const {nextDate}=dayOf(date);
 if(!RESOLUTIONS.has(resolution))fail('unsupported resolution');
 if(account!==undefined&&(typeof account!=='string'||account.length>180))
  fail('account pattern must be bounded');
 const query={date,resolution};
 const moneyPath=environment.METROPLAT_LEDGER_JOURNAL;
 const tokensRoot=environment.METROPLAT_DATA_ROOT;
 const monetary=hasPath(moneyPath)?(async()=>{
  try{
   const reader=readMoney??(await import('@red-cup-engineering/farolfi/ledger/reports')).readLedgerReport;
   const result=await reader({
    journal:{path:moneyPath},report:'resource-flow',
    resolution,begin:date,end:nextDate,
    ...(account===undefined?{}:{account})
   });
   if(!Array.isArray(result?.readings)||result.report!=='resource-flow')
    throw new TypeError('original book reader returned a different report');
   if(result.readings.length>5000)
    throw new RangeError('original book resource reading exceeds bounded response');
   return Object.freeze({status:result.status??'booked-postings',
    original:'Farolfi book of record',source:moneyPath,
    coverage:result.coverage,readings:result.readings});
  }catch(error){return sourceUnavailable(sourceError(error))}
 })():Promise.resolve(sourceUnavailable('METROPLAT_LEDGER_JOURNAL-unconfigured'));
 const tokens=hasPath(tokensRoot)?(async()=>{
  try{
   const reader=readTokens??(await import('@red-cup-engineering/feltos/agents/sessions/token-usage/service'))
    .readAgentSessionTokenUsageFlowReadout;
   const result=reader({dataRoot:tokensRoot,now:()=>date+'T00:00:00.000Z'},{date,resolution});
   if(!Array.isArray(result?.readings)||result.kind!=='metroplat.holography.agent-session-token-usage-flow')
    throw new TypeError('FeltOS source did not return a token-usage flow');
   if(result.readings.length>5000)
    throw new RangeError('original token resource reading exceeds bounded response');
   return Object.freeze({status:result.status,original:'FeltOS source-addressed token events',
    coverage:result.coverage,temporalBasis:result.temporalBasis,
    unitSemantics:result.unitSemantics,readings:result.readings});
  }catch(error){return sourceUnavailable(sourceError(error))}
 })():Promise.resolve(sourceUnavailable('METROPLAT_DATA_ROOT-unconfigured'));
 const [money,tokenUsage]=await Promise.all([monetary,tokens]);
 return Object.freeze({
  kind:'561-group.resource-flows',
  ...query,utcWindow:Object.freeze({startAt:date+'T00:00:00.000Z',
   endAt:nextDate+'T00:00:00.000Z'}),
  money,tokenUsage,
  physical:sourceUnavailable('no-admitted-per-interval-native-host-meter-source-bound'),
  metrology:'Original quantities, distinct currencies/commodities and physical units, with unknown coverage not zero. Monetary journal postings are not bank settlement; tokens are not cash; unobserved seconds are not rates.',
 });
}
