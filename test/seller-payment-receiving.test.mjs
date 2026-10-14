import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordQualifiedSellerPaymentObservation,
  latestQualifiedSellerPaymentObservation,
} from "../src/seller-payment-books.mjs";
import { receiveX402SellerPayments } from "../scripts/receive-x402-seller-payments.mjs";

const observedAt = "2026-10-13T18:00:00.000Z";
const sourceId = "evm:eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:0x" +
  "34".repeat(20) + ":0x" + "ab".repeat(32) + ":0";
const corroboration = Object.freeze({
  type: "X402SellerCorroboration", version: 3, state: "current", observedAt,
  witnessCount: 1, receiptVerifiedCount: 1, confirmedCount: 1,
  attributionRefusedCount: 0, refusedCount: 0,
  settlements: [{ sourceId, paymentConfirmed: true }],
});

test("qualified x402 receiving writes one native observation, not recognized income", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "group-seller-observation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let called = 0;
  const result = await receiveX402SellerPayments({
    environment: { METROPLAT_DATA_ROOT: root },
    corroborate: async () => { called++; return corroboration; },
  });
  assert.equal(called, 1);
  assert.equal(result.state, "recorded");
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.revenueRecognized, false);
  assert.equal(result.customerAcceptance, "unobserved");
  const retained = latestQualifiedSellerPaymentObservation(root, { asOf: observedAt });
  assert.equal(retained.value.type, "X402SellerPaymentObservation");
  assert.equal(retained.value.state, "current");
  assert.match(retained.value.sourceSetDigest, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(retained.value.revenueRecognized, false);
  assert.equal(latestQualifiedSellerPaymentObservation(root, { asOf: "2026-10-13T17:59:59.999Z" }), undefined);
  const replay = recordQualifiedSellerPaymentObservation(root, corroboration);
  assert.equal(replay.state, "recorded");
  assert.equal(latestQualifiedSellerPaymentObservation(root, { asOf: observedAt }).value.confirmedCount, 1);
});

test("incomplete, contradictory or unverified cash is held without new ledger projection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "group-seller-refusal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const invalid of [
    { ...corroboration, state: "unavailable" },
    { ...corroboration, state: "partially-corroborated", refusedCount: 1 },
    { ...corroboration, receiptVerifiedCount: 0 },
    { ...corroboration, settlements: [] },
    { ...corroboration, confirmedCount: 2 },
    { ...corroboration, settlements: [{ sourceId, paymentConfirmed: false }] },
  ]) {
    const refused = recordQualifiedSellerPaymentObservation(root, invalid);
    assert.equal(refused.state, "held");
    assert.equal(refused.revenueRecognized, false);
  }
  assert.equal(latestQualifiedSellerPaymentObservation(root, { asOf: observedAt }), undefined);
});

test("current-empty means no admitted witness in that observation, not proof of no sales", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "group-seller-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const observed = { ...corroboration, state: "current-empty",
    witnessCount: 0, receiptVerifiedCount: 0, confirmedCount: 0, settlements: [] };
  const result = recordQualifiedSellerPaymentObservation(root, observed);
  assert.equal(result.state, "recorded");
  const kept = latestQualifiedSellerPaymentObservation(root, { asOf: observedAt });
  assert.equal(kept.value.state, "current-empty");
  assert.equal(kept.value.revenueRecognized, false);
});
