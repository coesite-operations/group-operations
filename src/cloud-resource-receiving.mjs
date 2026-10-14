/**
 * Native SEAVT resource receiving, over the existing SCA store.
 * The content-addressed record is an observation. Its subject (NI) names
 * the persistent resource; a native store head with that name selects the
 * most recent, non-superseded observations. No new cloud registry or scheduler.
 */
import {get,put,readHead,writeHead,HeadConflict} from '@red-cup-engineering/semiotic-eavt-services-section/store';
import {seavtRow,compareAbsoluteSeavtClocks,isAbsoluteSeavtClock} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {termToJson} from '@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/json-codec';

const NI=/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const fail=(reason)=>{throw new TypeError('cloud SEAVT receiving: '+reason);};
const subjectOf=(row)=>{
  if(!row||typeof row!=='object')fail('SEAVT observation record required');
  seavtRow({e:row.e,a:row.a,v:row.v,t:row.t});
  if(!isAbsoluteSeavtClock(row.t))fail('absolute observation instant required');
  const subject=termToJson(row.e),attribute=termToJson(row.a);
  if(typeof subject!=='string'||!NI.test(subject))fail('SCA NI resource subject required');
  if(attribute?.event!=='cloud-resource-observed')fail('typed cloud observation attribute required');
  if(!Array.isArray(row.causes)||row.causes.length!==1
     ||row.causes[0]?.type!=='cloud-observation'||!NI.test(row.causes[0]?.id??''))
    fail('exact native observation cause required');
  return subject;
};

function readFrontier(root,subject){
  const head=readHead(root,'cloud-resource',subject);
  if(head===undefined)return null;
  if(!Array.isArray(head.frontier)||head.frontier.length<1||head.frontier.length>32)
    fail('native resource frontier unavailable or unbounded');
  const rows=head.frontier.map(id=>{
    if(typeof id!=='string'||!NI.test(id))fail('native resource record address invalid');
    const row=get(root,'cloud-resource',id);
    if(!row||subjectOf(row)!==subject)fail('native resource record missing or belongs to another subject');
    if(!get(root,'cloud-observation',row.causes[0].id))
      fail('native resource SignCell witness is unavailable');
    return {id,row};
  });
  const t=rows[0].row.t;
  if(rows.some(x=>compareAbsoluteSeavtClocks(x.row.t,t)!==0))
    fail('native resource frontier contains distinct observation times');
  return {head,records:rows,at:t};
}

/** Receive one already-witnessed SEAVT observation with a native CAS head.
 * An older observation is stored but cannot overwrite the present resource.
 * Contradictory observations with the same source instant coexist in a bounded
 * frontier. Races retry against the native store lock instead of losing data.
 */
export function receiveCloudResourceRow(root,row){
  const subject=subjectOf(row);
  if(!get(root,'cloud-observation',row.causes[0].id))
    fail('native SCA witness must be committed before resource admission');
  const record=put(root,'cloud-resource',row);
  for(let retry=0;retry<5;retry++){
    const prior=readFrontier(root,subject);
    const order=prior===null?1:compareAbsoluteSeavtClocks(row.t,prior.at);
    if(order<0)return Object.freeze({subject,record,asOf:prior.at,status:'historical-observation-retained'});
    const old=prior?.head.frontier??[];
    const frontier=order>0?[record]:[...new Set([...old,record])].sort();
    if(frontier.length>32)fail('simultaneous resource frontier exceeds observation bound');
    if(prior!==null&&frontier.length===old.length&&frontier.every((id,i)=>id===old[i]))
      return Object.freeze({subject,record,asOf:prior.at,status:'already-received'});
    try{
      writeHead(root,'cloud-resource',subject,{frontier,at:row.t},{expect:prior===null?null:old});
      return Object.freeze({subject,record,asOf:row.t,
        status:frontier.length>1?'contested-at-source-time':'received'});
    }catch(error){if(!(error instanceof HeadConflict))throw error;}
  }
  fail('native resource head could not be advanced under concurrent writes');
}

/** Read one first-class resource from its SCA subject, not an invented
 * provider-specific key. This reads the actual SEAVT records and their
 * SCA witness before making a current-state claim.
 */
export function readCloudResource(root,subject){
  if(typeof subject!=='string'||!NI.test(subject))fail('canonical NI subject required');
  const reading=readFrontier(root,subject);
  if(reading===null)return null;
  return Object.freeze({kind:'561-group.cloud-resource-current',
    subject,asOf:reading.at,
    state:reading.records.length===1?'one-observation':'multiple-simultaneous-observations',
    recordIds:reading.records.map(x=>x.id),
    observations:reading.records.map(x=>x.row)});
}
