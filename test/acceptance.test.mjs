import assert from "node:assert/strict";
import test from "node:test";
import { marketJudgmentsIndexOf, outcomeOf, seamOfOutcome, standingOf } from "@red-cup-engineering/organizing/enterprise";
import { KOIOS_EDITOR, KOIOS_SECTION, groupPartyOf, inferenceMarketOutcomesOf, koiosEditorOutcomesOf, resourcesOfMeasured, walletAccountsOf, x402SettlementOutcomes } from "../src/acceptance.mjs";

const registry = { wallets: [
  { address: "0x42F72C0a340A4A55C082Fe42483e87691D2bff64", owner: "org" },
  { address: "0x32886F6F361C1d570255c2762967A2e41D0E9B1a", owner: "founder" },
] };
const enterprises = [{ id: "engineering", sectionPath: "services/engineering-services-section", entity: "561-group-llc" }, { id: "causeway-publishing", sectionPath: "services/public-services-section", entity: "561-group-llc" }];

const settlement = (payer, tx) => ({
  transactionHash: tx, logIndex: "1", network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payer, receiver: "0x32886f6f361c1d570255c2762967a2e41d0e9b1a",
  amount: "10000", amountUsdc: "0.01", blockTime: "2026-09-28T15:49:41.000Z", gateway: "translation", operation: "mandarin-english", sku: "ni:///sha-256;sku",
  section: "lib/emsenn/services/561-group/services/engineering-services-section/services/x", ledgerAccount: "Income:Sales:X402:Translation", attribution: "catalog",
  witnessId: "ni:///sha-256;w", evidenceId: `evm:eip155:8453:tx:${tx}`, sourceId: `evm:eip155:8453:asset:receiver:${tx}:1`,
});

test("an x402 payment is a sale only when no wallet the Group holds paid it", () => {
  const partyOf = groupPartyOf({ enterprises, walletRegistry: registry });
  const [own, stranger] = x402SettlementOutcomes([settlement("0x42f72c0a340a4a55c082fe42483e87691d2bff64", "0xa"), settlement("0xec2abd3eda89bed90124736e317e847d5fb6d034", "0xb")]);
  assert.equal(seamOfOutcome(own, partyOf), "intra-group");
  assert.equal(seamOfOutcome(stranger, partyOf), "external");
  assert.ok(stranger.evidence.includes("x402-attribution:catalog"));
  assert.equal(walletAccountsOf(registry).get("0x32886f6f361c1d570255c2762967a2e41d0e9b1a").entity, "founder");
});

test("a judge the house minted is a member of the Group, never a buyer", () => {
  const partyOf = groupPartyOf({ enterprises, walletRegistry: registry });
  const judged = (provider, judge) => outcomeOf({ source: "editor", lot: "l", delivery: "d", provider, judge, verdict: "accepted", at: "2026-10-03T12:00:00.000Z", evidence: ["e"], value: { amount: "1", currency: "USD", basis: "offer" } });
  assert.equal(seamOfOutcome(judged(KOIOS_SECTION, KOIOS_EDITOR), partyOf), "intra-group");
  assert.equal(seamOfOutcome(judged("urn:ame:groq-inference-team", "actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4"), partyOf), "intra-group");
  assert.equal(seamOfOutcome(judged("urn:ame:groq-inference-team", "eip155:8453:0xec2abd3eda89bed90124736e317e847d5fb6d034"), partyOf), "external");
});

test("the inference market's receiver judgments become outcomes keyed by the carrying model, voids withdrawing them", () => {
  const delivery = { kind: "inference-delivery", id: "d1", configuration: { model: "qwen/qwen3.8-27b" }, resources: [{ resource: "output-tokens", unit: "token", amount: { numerator: "208", denominator: "1" } }] };
  const row = { kind: "receiver-outcome", id: "o1", observedAt: "2026-10-03T13:15:39.487Z", delivery: "d1", workLot: "lot", provider: "urn:ame:groq-inference-team", taskClass: "inquiry", selectedOffer: "offer", receipt: "r1", receiver: "actor:x", outcome: "accepted", evidence: "e" };
  const { outcomes } = inferenceMarketOutcomesOf({ observations: [row], deliveries: [delivery] });
  assert.equal(outcomes[0].carrier, "qwen/qwen3.8-27b");
  assert.deepEqual(outcomes[0].resources, [{ resource: "output-tokens", unit: "token", amount: "208", carrier: "qwen/qwen3.8-27b" }]);
  assert.deepEqual([...standingOf(outcomes)], [["qwen/qwen3.8-27b", { accepted: 1, attempts: 1 }]]);
  const voided = inferenceMarketOutcomesOf({ observations: [row, { kind: "receiver-outcome-void", id: "v1", originalOutcome: "o1", observedAt: "2026-10-03T14:00:00.000Z", evidence: "mistaken" }], deliveries: [delivery] });
  assert.deepEqual([...standingOf(voided.outcomes)], []);
  assert.deepEqual(resourcesOfMeasured([{ resource: "duration", unit: "ms", amount: { numerator: "3", denominator: "2" } }]), []);
});

test("each accept, return and refusal in a Koios edition's history is the editor's judgment of its manuscript", () => {
  const edition = { candidateId: "c1", storyId: "s1", model: "meta/llama-3.2-11b-vision-instruct", failureLayer: "sources",
    history: [{ state: "drafted", at: "2026-10-03T11:06:53.702Z" }, { state: "returned", at: "2026-10-03T11:21:13.660Z", reason: "submit_revision_request" }, { state: "accepted", at: "2026-10-03T12:00:00.000Z" }] };
  const { outcomes } = koiosEditorOutcomesOf([edition]);
  assert.deepEqual(outcomes.map((outcome) => outcome.verdict), ["rejected", "accepted"]);
  assert.equal(outcomes[0].reason, "submit_revision_request: sources");
  assert.deepEqual([...standingOf(outcomes)], [["meta/llama-3.2-11b-vision-instruct", { accepted: 1, attempts: 1 }]]);
});

test("routing reads the journal's judgments of inference deliveries from one index: only standing outcomes that name their delivery", async () => {
  const { tellKoiosEditorOutcomes } = await import("../src/acceptance.mjs");
  const market = { provider: "urn:ame:groq-inference-team", offer: "offer", taskClass: "content-mill/manuscript/v2", receipt: "r1" };
  const edition = { candidateId: "c1", storyId: "s1", model: "m", market,
    history: [{ state: "returned", at: "2026-10-03T11:21:13.660Z", reason: "submit_revision_request" }] };
  const { outcomes } = koiosEditorOutcomesOf([edition, { ...edition, candidateId: "c2", storyId: "s2", market: undefined }]);
  assert.deepEqual(marketJudgmentsIndexOf(outcomes).judgments.map(({ verdict, market: coordinate }) => [verdict, coordinate.receipt]), [["rejected", "r1"]]);
  // A verdict the line already told at the source is not told again by the backfill.
  const journal = { read: () => outcomes, record: (told) => told.length };
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const lineRoot = mkdtempSync(join(tmpdir(), "koios-line-"));
  try {
    mkdirSync(join(lineRoot, "editions"));
    writeFileSync(join(lineRoot, "editions", "a.json"), JSON.stringify(edition));
    assert.equal((await tellKoiosEditorOutcomes(journal, lineRoot)).told, 0);
  } finally { rmSync(lineRoot, { recursive: true, force: true }); }
});
