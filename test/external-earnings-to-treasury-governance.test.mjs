import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Exercise the original Red Cup AOE reader; this is not a new Work, ledger,
// settlement verifier, custody adapter or trading engine.
const originalReader = process.env.AOE_ORIGINAL_READER_FILE
  ? pathToFileURL(process.env.AOE_ORIGINAL_READER_FILE).href
  : "@red-cup-engineering/organizing/enterprise";
const { planOperatingCell } = await import(originalReader);
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const cellsText = read("content/pulse-operating-cells.v1.json");
const campaignsText = read("content/operations-campaign-library.v1.json");
const source = (role, body) => ({
  repository: "coesite-operations/operations-services-section",
  path: "apps/group-operations/content/" +
    (role === "cells" ? "pulse-operating-cells.v1.json" : "operations-campaign-library.v1.json"),
  // This is synthetic test provenance, not authenticated repository membership.
  commit: "a".repeat(40),
  gitBlobSha: createHash("sha1")
    .update("blob " + Buffer.byteLength(body, "utf8") + "\0")
    .update(body).digest("hex"),
});
const catalog = JSON.parse(campaignsText);
const campaign = catalog.campaigns.find(row => row.id === "reconcile-external-earnings-to-treasury");
const treasuryCell = JSON.parse(cellsText).cells.find(cell => cell.service_id === "external-earnings-treasury");
const workRef = treasuryCell?.work_ref;
const base = {
  cellsText, campaignsText, cellsSource: source("cells", cellsText),
  campaignsSource: source("campaigns", campaignsText), workRef,
  campaignIds: ["reconcile-external-earnings-to-treasury"],
};
const stages = [
  "identify-external-inflow", "qualify-source-and-attribution",
  "receive-service-performance", "qualify-processor-payment",
  "receive-bank-settlement", "reconcile-authored-books",
  "reserve-and-restrict-capital", "assay-investable-surplus",
  "compare-capital-uses", "propose-bounded-allocation",
  "obtain-competent-authorization", "observe-authorized-execution",
  "receive-and-reconcile",
];

test("authored source selects exact original Work and a nonexecuting treasury campaign", () => {
  assert.ok(campaign, "original Coesite campaign library includes treasury receiving");
  assert.equal(catalog.campaigns.filter(x => x.id === campaign.id).length, 1);
  assert.deepEqual(campaign.stages.map(x => x.id), stages);
  assert.equal(new Set(campaign.parameters).size, campaign.parameters.length);
  assert.deepEqual(campaign.parameters, ["work_ref", "principal", "consumer", "service_id",
    "office_bundle", "acceptance_test", "inflow_basis_ref", "source_account_holder_ref",
    "original_payment_ref"]);
  assert.ok(!campaign.parameters.includes("bank_credit_ref"), "bank settlement is a later stage observation, not an intake prerequisite");
  assert.ok(!campaign.parameters.includes("investment_mandate_ref"), "investment authorization is later Work, not a payment recognition precondition");
  const plan = planOperatingCell(base);
  assert.equal(workRef, "ni:///sha-256;Vy9F7fxrJ9iybtgOaTmMCBCEKhGS45JVLBqy54XOr2A");
  assert.equal(plan.workRef, workRef);
  assert.equal(plan.serviceId, "external-earnings-treasury");
  assert.equal(plan.consumer, "561 Group Financial Services and Coesite Group Operations");
  assert.ok(plan.officeBundle.includes("chief-financial-officer"));
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].campaignId, campaign.id);
  assert.equal(plan.campaigns[0].state, "unbound");
  assert.equal(plan.campaigns[0].stages.length, stages.length);
  assert.deepEqual(plan.campaigns[0].missingParameters,
    ["inflow_basis_ref", "source_account_holder_ref", "original_payment_ref"]);
  assert.equal(plan.retainedWork.writer, "native Work Arena work-open/work-move");
  assert.equal(plan.source.treeMembershipVerified, false);
  assert.equal(plan.effectsAuthorized, false);
  assert.equal(plan.workOpened, false);
  assert.equal(plan.dispatchable, false);
  assert.equal(plan.received, false);
});

test("even an apparently complete evidence packet cannot manufacture funds or trading authority", () => {
  const original = planOperatingCell(base);
  const parameters = Object.fromEntries(original.campaigns[0].missingParameters
    .map(parameter => [parameter, "urn:unverified:" + parameter]));
  const readout = planOperatingCell({ ...base, parameters });
  assert.deepEqual(readout.campaigns[0].missingParameters, []);
  assert.equal(readout.campaigns[0].state, "awaiting-native-authority");
  assert.ok(readout.campaigns[0].bindings.every(binding => binding.admitted === false));
  assert.ok(readout.campaigns[0].stages.every(stage =>
    stage.executed === false && stage.received === false));
  for (const key of ["effectsAuthorized", "workOpened", "dispatchable", "received"]) {
    assert.equal(readout[key], false, key + " must require original native receiving");
  }
  for (const blocked of [
    "source-Git-tree-membership-requires-authenticated-host",
    "incumbency-and-real-office-grants-unreceived",
    "independent-consumer-receiving-unreceived",
  ]) assert.ok(readout.blockers.includes(blocked));
});

test("the staged economic contract differentiates payment, settlement, investable cash and return", () => {
  const effect = id => campaign.stages.find(s => s.id === id).effect;
  assert.match(effect("qualify-source-and-attribution"), /self-purchases/);
  assert.match(effect("receive-service-performance"), /independently receive/i);
  assert.match(effect("qualify-processor-payment"), /duplicate/);
  assert.match(effect("receive-bank-settlement"), /bank\/custodian-settled money/);
  assert.match(effect("reconcile-authored-books"), /Farolfi/);
  assert.match(effect("reserve-and-restrict-capital"), /runway/);
  assert.match(effect("assay-investable-surplus"), /demonstrably available emsenn-owned funds/);
  assert.match(effect("obtain-competent-authorization"), /never grants external asset-moving authority/);
  assert.match(effect("observe-authorized-execution"), /attribution alone performs no external move/);
  assert.match(effect("receive-and-reconcile"), /investment P&L/);
  assert.match(campaign.kill, /revoked/);
});

test("wrong source, false work, or caller identity replacement cannot bind treasury authority", () => {
  assert.throws(() => planOperatingCell({
    ...base, workRef: "ni:///sha-256;" + "Q".repeat(43),
  }), /Work reference not present/);
  assert.throws(() => planOperatingCell({
    ...base, campaignsText: campaignsText.replace(
      '"reconcile-external-earnings-to-treasury"', '"unauthorized-treasury"'),
  }), /original Git blob/);
  assert.throws(() => planOperatingCell({
    ...base, parameters: { principal: "some-other-legal-owner" },
  }), /cannot replace original identity/);
  assert.throws(() => planOperatingCell({
    ...base, parameters: { invented_bank_credit: "urn:bogus" },
  }), /not declared by selected campaign/);
  assert.throws(() => planOperatingCell({
    ...base, parameters: { inflow_basis_ref: "malformed\nsecret" },
  }), /extra parameters must be bounded/);
});

test("emsenn is the economic receiving principal for the agent swarm, not a disqualifying personal merchant", () => {
  const effect = id => campaign.stages.find(s => s.id === id).effect;
  for (const parameter of [
    "inflow_basis_ref", "source_account_holder_ref", "original_payment_ref"
  ]) assert.ok(campaign.parameters.includes(parameter), parameter);
  assert.match(effect("qualify-source-and-attribution"), /money paid to emsenn/);
  assert.match(effect("qualify-source-and-attribution"), /agent swarm/);
  assert.match(effect("qualify-source-and-attribution"), /no double-count/);
  assert.match(effect("qualify-processor-payment"), /Stripe, PayPal, x402/);
  assert.match(effect("qualify-processor-payment"), /not rejected merely for lacking a separate/);
  assert.match(effect("receive-service-performance"), /tips, gifts, donations/);
  assert.match(effect("receive-bank-settlement"), /provisional external inflow/);
  assert.match(effect("reconcile-authored-books"), /same original receipt once/);
  assert.match(effect("reserve-and-restrict-capital"), /not categorically excluded as 'personal'/);
  assert.match(effect("assay-investable-surplus"), /no distinct Group incorporation or merchant is required/);
  assert.match(effect("obtain-competent-authorization"), /do not invent a separate 561 Group company approval requirement/);
  assert.match(effect("receive-and-reconcile"), /one receipt cannot become two earnings/);
  assert.match(campaign.completion, /may be a sale, tip, donation, gift, royalty/);
  assert.match(campaign.completion, /does not wait for a formal proof/);
  assert.match(campaign.completion, /separate later Work stages receive bank settlement/i);
});
