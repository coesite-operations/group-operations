import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCapacityCensusProcedure, executeCapacityCensusProcedure } from '../src/capacity-census-operation.mjs';

const template = Object.freeze({
  id: 'coesite-capacity-census', version: '1', duty: 'observe-allocation-capacity',
  scienceBasis: 'dated-observation-assay', engineeringBasis: 'allocation-readiness',
  providerKind: 'metroplat', receivingOffice: '561 Group',
});
const binding = Object.freeze({
  workRef: 'group-capacity:2026-10-11', principal: '561 Group', office: 'Coesite Operations',
  actorId: 'coo-actor', scope: 'group', expectedDate: '2026-10-11',
  provider: 'metroplat', receiverActorId: 'independent-group-assayer',
  sourceRevision: 'source-fixture-v1',
});
const bind = (options = {}) => bindCapacityCensusProcedure(template, { ...binding, ...options });
const pages = [{
  cursor: 0,
  result: {
    kind: 'metroplat.work.allocation-candidates', date: '2026-10-11', remaining: 0,
    items: [{ scope: 'group-service', state: 'allocatable', reasons: [], candidates: [{}] }],
  },
}];
const readCensus = async () => ({
  origin: 'native-provider', provenance: { providerReceipt: 'fixture-native-1' },
  pages, runtimeRevision: 'fixture-revision-1',
});
const deliverToGroup = async () => ({
  receiptId: 'group-receipt-1', receiverActorId: binding.receiverActorId, verdict: 'ACCEPTED',
});

test('capacity procedure binds explicit principals, separate receiver and observation-only effects', () => {
  const instance = bind();
  assert.equal(instance.kind, 'coesite.operating-procedure.binding.v1');
  assert.equal(instance.binding.principal, binding.principal);
  assert.deepEqual(instance.binding.permittedEffects, ['observe', 'report']);
  assert.ok(Object.isFrozen(instance.binding));
  assert.throws(() => bind({ receiverActorId: binding.actorId }), /own independent receiver/);
  assert.throws(() => bind({ permittedEffects: ['execute'] }), /cannot grant provider mutations/);
  assert.throws(() => bind({ expectedDate: '2026-02-30' }), /expectedDate calendar/);
});

test('authenticated native observation and independently accepted Group receipt are separate gates', async () => {
  const result = await executeCapacityCensusProcedure(bind(), {
    readCensus, verifyProvider: async () => true, deliverToGroup,
    verifyGroupReceipt: async () => true,
  });
  assert.equal(result.providerEvidence, 'NATIVE_VERIFIED');
  assert.equal(result.capacityState, 'SOME_ALLOCATABLE');
  assert.equal(result.delivery, 'RECEIVED');
  assert.equal(result.groupAcceptance, 'INDEPENDENTLY_VERIFIED');
  assert.equal(result.runtimeRevision, 'fixture-revision-1');
});

test('receiver verifier exception after acknowledged delivery retains delivery custody without false acceptance', async () => {
  let deliveryCalls = 0;
  const result = await executeCapacityCensusProcedure(bind(), {
    readCensus, verifyProvider: async () => true,
    deliverToGroup: async () => { deliveryCalls += 1; return deliverToGroup(); },
    verifyGroupReceipt: async () => {
      throw Object.assign(new Error('assayer connection unavailable'), { layer: 'RECEIVER_READBACK' });
    },
  });
  assert.equal(deliveryCalls, 1);
  assert.equal(result.providerEvidence, 'NATIVE_VERIFIED');
  assert.equal(result.delivery, 'REPORTED_UNVERIFIED');
  assert.equal(result.deliveryReceiptId, 'group-receipt-1');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
  assert.equal(result.receivingVerificationFailureLayer, 'RECEIVER_READBACK');
});

test('self-reported receipt and independent rejection cannot be silently accepted', async () => {
  let verifierCalls = 0;
  const spoofed = await executeCapacityCensusProcedure(bind(), {
    readCensus, verifyProvider: async () => true,
    deliverToGroup: async () => ({
      receiptId: 'local-report', receiverActorId: binding.actorId, verdict: 'ACCEPTED',
    }),
    verifyGroupReceipt: async () => { verifierCalls += 1; return true; },
  });
  assert.equal(verifierCalls, 0);
  assert.equal(spoofed.delivery, 'REPORTED_UNVERIFIED');
  assert.equal(spoofed.groupAcceptance, 'NOT_VERIFIED');
  const rejected = await executeCapacityCensusProcedure(bind(), {
    readCensus, verifyProvider: async () => true,
    deliverToGroup: async () => ({
      receiptId: 'verified-rejection', receiverActorId: binding.receiverActorId, verdict: 'REJECTED',
    }),
    verifyGroupReceipt: async () => true,
  });
  assert.equal(rejected.delivery, 'RECEIVED');
  assert.equal(rejected.groupAcceptance, 'NOT_ACCEPTED');
});

test('claimed provider data without independent native witness remains unknown', async () => {
  const result = await executeCapacityCensusProcedure(bind(), {
    readCensus, verifyProvider: async () => false, deliverToGroup,
  });
  assert.equal(result.providerEvidence, 'UNVERIFIED');
  assert.equal(result.capacityState, 'UNKNOWN');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
  assert.equal(result.delivery, 'REPORTED_UNVERIFIED');
});

test('missing provider adapter delivers UNKNOWN finding, not a fabricated census', async () => {
  const result = await executeCapacityCensusProcedure(bind(), { deliverToGroup });
  assert.equal(result.exception, 'native-census-adapter-unavailable');
  assert.equal(result.capacityState, 'UNKNOWN');
  assert.equal(result.delivery, 'REPORTED_UNVERIFIED');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});

test('invalid page does not produce allocatable capacity', async () => {
  const result = await executeCapacityCensusProcedure(bind(), {
    readCensus: async () => ({ origin: 'native-provider', pages: [{ cursor: 1, result: {} }] }),
    verifyProvider: async () => true, deliverToGroup,
  });
  assert.equal(result.analyticalResult.state, 'UNKNOWN');
  assert.equal(result.capacityState, 'UNKNOWN');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});


test('negative receiver judgement cannot certify Group acceptance', async () => {
  const result = await executeCapacityCensusProcedure(bind(), {
    readCensus, verifyProvider: async () => true, deliverToGroup,
    verifyGroupReceipt: async () => false,
  });
  assert.equal(result.delivery, 'REPORTED_UNVERIFIED');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});

test('transport failure is separate from unavailable provider evidence', async () => {
  const result = await executeCapacityCensusProcedure(bind(), {
    deliverToGroup: async () => { throw Object.assign(new Error('delivery unreachable'), {layer:'TRANSPORT'}); },
  });
  assert.equal(result.delivery, 'FAILED');
  assert.equal(result.deliveryFailureLayer, 'TRANSPORT');
});

test('no delivery acknowledgment cannot be silently promoted to received', async () => {
  const result = await executeCapacityCensusProcedure(bind(), { deliverToGroup: async () => null });
  assert.equal(result.delivery, 'NOT_CONFIRMED');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});

test('explicit observe-only authority is preserved and cannot report', async () => {
  let deliveryCalls = 0;
  const instance = bind({ permittedEffects: ['observe'] });
  assert.deepEqual(instance.binding.permittedEffects, ['observe']);
  const result = await executeCapacityCensusProcedure(instance, {
    readCensus, verifyProvider: async () => true,
    deliverToGroup: async () => { deliveryCalls += 1; return deliverToGroup(); },
  });
  assert.equal(result.providerEvidence, 'NATIVE_VERIFIED');
  assert.equal(deliveryCalls, 0);
  assert.equal(result.delivery, 'NOT_ATTEMPTED');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});

test('explicit report-only authority cannot observe provider state', async () => {
  let readCalls = 0;
  let deliveryCalls = 0;
  const instance = bind({ permittedEffects: ['report'] });
  assert.deepEqual(instance.binding.permittedEffects, ['report']);
  const result = await executeCapacityCensusProcedure(instance, {
    readCensus: async () => { readCalls += 1; return readCensus(); },
    deliverToGroup: async evidence => {
      deliveryCalls += 1;
      assert.equal(evidence.providerEvidence, 'UNKNOWN');
      assert.equal(evidence.capacityState, 'UNKNOWN');
      return deliverToGroup();
    },
  });
  assert.equal(readCalls, 0);
  assert.equal(deliveryCalls, 1);
  assert.equal(result.exception, 'observation-effect-not-permitted');
  assert.equal(result.delivery, 'REPORTED_UNVERIFIED');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});

test('explicit empty authority performs neither observation nor reporting', async () => {
  let readCalls = 0;
  let deliveryCalls = 0;
  const instance = bind({ permittedEffects: [] });
  assert.deepEqual(instance.binding.permittedEffects, []);
  const result = await executeCapacityCensusProcedure(instance, {
    readCensus: async () => { readCalls += 1; return readCensus(); },
    deliverToGroup: async () => { deliveryCalls += 1; return deliverToGroup(); },
  });
  assert.equal(readCalls, 0);
  assert.equal(deliveryCalls, 0);
  assert.equal(result.exception, 'observation-effect-not-permitted');
  assert.equal(result.delivery, 'NOT_ATTEMPTED');
  assert.equal(result.groupAcceptance, 'NOT_VERIFIED');
});


test('authenticated census matching increases feasible simultaneous office coverage through augmenting paths',async()=>{
  const eligible=(scope,ids)=>({scope,state:'allocatable',reasons:[],candidates:ids.map(id=>({
    office:'office:market',duty:'duty:science-to-engineering',character:{id},
    evidence:['provider:source-admitted'],load:[],reasons:[]
  }))});
  const observed={origin:'native-provider',provenance:{providerReceipt:'native-allocations-v1'},
    runtimeRevision:'source-worktree-1',
    pages:[{cursor:0,result:{kind:'metroplat.work.allocation-candidates',
      date:binding.expectedDate,remaining:0,
      items:[eligible('A',['shared','spare']),eligible('B',['shared'])]}}]};
  let reported;
  const result=await executeCapacityCensusProcedure(bind(),{
    readCensus:async()=>observed,
    verifyProvider:async (received,ctx)=>{
      assert.equal(received,observed.provenance);
      assert.equal(ctx.expectedDate,binding.expectedDate);return true;
    },
    deliverToGroup:async evidence=>{reported=evidence;return deliverToGroup();},
    verifyGroupReceipt:async()=>true,
  });
  assert.equal(result.providerEvidence,'NATIVE_VERIFIED');
  assert.equal(result.matchingPressure.state,'MAXIMAL_MATCHING');
  assert.equal(result.matchingPressure.matchedCount,2);
  assert.equal(result.matchingPressure.executionAuthorized,false);
  assert.equal(result.matchingPressure.independentReceivingClaimAllowed,false);
  assert.deepEqual(result.matchingPressure.assignments.map(x=>[x.scope,x.characterId]),[
    ['A','spare'],['B','shared']]);
  assert.equal(reported.matchingPressure.matchedCount,2,'real Coesite reporting carries matched source reading');
  assert.equal(result.groupAcceptance,'INDEPENDENTLY_VERIFIED');
});
test('unverified provider census never generates placement advice or self-authorized effects',async()=>{
  const provider=await readCensus();
  const r=await executeCapacityCensusProcedure(bind(),{
    readCensus:async()=>provider,verifyProvider:async()=>false,deliverToGroup
  });
  assert.equal(r.providerEvidence,'UNVERIFIED');
  assert.equal(r.capacityState,'UNKNOWN');
  assert.equal(Object.hasOwn(r,'matchingPressure'),false);
});
test('source states allocatable without actual character IDs: preserve deficit, not fictional workers',async()=>{
  const r=await executeCapacityCensusProcedure(bind(),{
    readCensus,verifyProvider:async()=>true,deliverToGroup
  });
  assert.equal(r.capacityState,'SOME_ALLOCATABLE');
  assert.equal(r.matchingPressure.state,'CAPACITY_GAP');
  assert.deepEqual(r.matchingPressure.unidentifiedCandidateScopes,['group-service']);
  assert.deepEqual(r.matchingPressure.assignments,[]);
});
