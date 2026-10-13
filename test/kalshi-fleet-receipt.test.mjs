import test from 'node:test';
import assert from 'node:assert/strict';
import {kalshiFleetReceiptOf} from '../src/kalshi-fleet-receipt.mjs';

const source = () => ({
  type: 'KalshiFleetAccountObservation',
  fleetRecord: '9'.repeat(64),
  collectionStartedAt: '2026-10-13T19:00:00.000Z',
  observedAt: '2026-10-13T19:00:10.000Z',
  balance: { balance: 2500, balance_dollars: '25.0000', providerSecret: 'NEVER-PROJECT-THIS' },
  positions: [{ ticker: 'KXTEST', position: '1.00' }],
  orders: [{ id: 'resting-order' }],
  fills: [{ id: 'fill', sourceBytes: 'raw receipt retained in custody' }],
  settlements: [{ id: 'settlement' }],
  settlementAccounting: { records: [{ settled: true }], refusals: [], accountCashReconciled: false },
  mandatePolicyReadiness: { allowed: false, reason: 'venue-not-armed' },
  orderEffect: false,
});

test('full signed source stays untouched while the RPC receipt names its durable identity and honest scopes', () => {
  const full = source(), original = JSON.stringify(full);
  const reading = kalshiFleetReceiptOf(full);
  assert.equal(JSON.stringify(full), original);
  assert.equal(reading.fleetRecord, full.fleetRecord);
  assert.deepEqual(reading.balance, { balance: 2500, balance_dollars: '25.0000' });
  assert.deepEqual(reading.counts, { positions: 1, restingOrders: 1, recentFills: 1, recentSettlements: 1 });
  assert.equal(reading.reconciliation.settlementsEvaluated, 1);
  assert.equal(reading.reconciliation.accountCashReconciled, false);
  assert.equal(reading.reconciliation.realizedProfitVerified, false);
  assert.equal(reading.policy.deskArmingObserved, false);
  assert.equal(reading.policy.allowed, false);
  assert.equal(reading.orderEffect, false);
  assert.equal(JSON.stringify(reading).includes('NEVER-PROJECT-THIS'), false);
  assert.equal(JSON.stringify(reading).includes('raw receipt retained'), false);
});

test('large valid source history has bounded original-reference receipt, never a giant ActivityPub payload', () => {
  const full = source();
  full.positions = Array.from({ length: 8_000 }, (_, id) => ({ id, note: 'long full exchange position record' }));
  full.fills = Array.from({ length: 20_000 }, (_, id) => ({ id, originalExchangeResponse: 'original exchange source bytes remain in persisted custody' }));
  full.settlementAccounting.records = Array.from({ length: 5_000 }, (_, id) => ({ id }));
  full.settlementAccounting.refusals = Array.from({ length: 1_500 }, (_, id) => ({ id }));
  assert.ok(Buffer.byteLength(JSON.stringify(full)) > 1_048_576, "fixture must exceed MetroPlat's transport ceiling");
  const receipt = kalshiFleetReceiptOf(full);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < 4_096);
  assert.equal(receipt.counts.fills, undefined);
  assert.equal(receipt.counts.recentFills, 20_000);
  assert.equal(receipt.reconciliation.settlementsEvaluated, 5_000);
  assert.equal(receipt.reconciliation.settlementRefusals, 1_500);
  assert.equal(receipt.retainedFullRecord, true);
  assert.equal(full.fills.length, 20_000, 'source must not be reduced by the projection');
});

test('missing original custody, signed balance, provider response or cash reconciliation is refused', () => {
  const baseline = source();
  for (const change of [
    r => { delete r.fleetRecord; },
    r => { r.observedAt = 'not-a-time'; },
    r => { r.balance = null; },
    r => { r.fills = undefined; },
    r => { r.orders = {}; },
    r => { r.settlementAccounting.accountCashReconciled = true; },
    r => { delete r.mandatePolicyReadiness; },
  ]) {
    const r = structuredClone(baseline);
    change(r);
    assert.throws(() => kalshiFleetReceiptOf(r), TypeError);
  }
});

test('untrusted policy text and unknown balance fields never escape the bounded private boundary', () => {
  const s = source();
  s.mandatePolicyReadiness.reason = 'x'.repeat(10_000);
  s.balance.extra = { account: 'secret' };
  const receipt = kalshiFleetReceiptOf(s);
  assert.equal(receipt.policy.reason.length, 160);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 4_096);
  assert.equal(JSON.stringify(receipt).includes('secret'), false);
});
