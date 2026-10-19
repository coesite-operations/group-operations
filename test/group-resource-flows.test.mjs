import test from 'node:test';
import assert from 'node:assert/strict';
import {readGroupResourceFlows} from '../src/group-resource-flows.mjs';
const env={METROPLAT_LEDGER_JOURNAL:'/books/main.beancount',METROPLAT_DATA_ROOT:'/data/metroplat'};
const financial={report:'resource-flow',status:'booked-postings',coverage:{books:1},
 readings:[{resolution:'day',account:'Assets:Cash',commodity:'USD',net:{numerator:'5',denominator:'4'}}]};
const token={kind:'metroplat.holography.agent-session-token-usage-flow',status:'observed-events',
 coverage:{admittedTurnEvents:1},readings:[{resolution:'day',resource:'inference-input',unit:'{token}',amount:{numerator:'9',denominator:'1'}}]};
test('one actual Group operation composes separate original books and token events without new ledger',async()=>{
 const calls=[];
 const data=await readGroupResourceFlows({date:'2026-10-19',environment:env,readMoney:async args=>{
  calls.push(args);return financial;
 },readTokens:(_binding,args)=>{calls.push(args);return token;}});
 assert.equal(data.kind,'561-group.resource-flows');
 assert.equal(data.money.readings[0].net.numerator,'5');
 assert.equal(data.tokenUsage.readings[0].amount.numerator,'9');
 assert.equal(data.physical.status,'unavailable');
 assert.equal(data.utcWindow.endAt,'2026-10-20T00:00:00.000Z');
 assert.equal(calls[0].report,'resource-flow');
 assert.equal(calls[0].begin,'2026-10-19');
 assert.equal(calls[0].end,'2026-10-20');
 assert.equal(calls[1].resolution,'day');
});
test('unknown provider origin remains unknown, never zero throughput',async()=>{
 const result=await readGroupResourceFlows({date:'2026-10-19',environment:{}});
 assert.equal(result.money.status,'unavailable');
 assert.equal(result.tokenUsage.status,'unavailable');
 assert.equal(result.money.readings,undefined);
});
test('time fraud, broken native results and inconsistent resource requests refuse',async()=>{
 await assert.rejects(readGroupResourceFlows({date:'2026-02-30',environment:{}}));
 await assert.rejects(readGroupResourceFlows({date:'2026-10-19',resolution:'week',environment:{}}));
 const data=await readGroupResourceFlows({date:'2026-10-19',environment:env,
  readMoney:async()=>({kind:'wrong'}),readTokens:()=>null});
 assert.equal(data.money.status,'unavailable');
 assert.equal(data.tokenUsage.status,'unavailable');
});
