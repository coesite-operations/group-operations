import {isDeepStrictEqual} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {replayPredictionMarketStudy} from '@red-cup-engineering/mandate-portfolio-allocation-service/prediction-market-research';
import {createSemanticRecordJournal} from '@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record';

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
