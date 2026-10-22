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
const workRef = JSON.parse(cellsText).cells[0].work_ref;
const base = {
  cellsText, campaignsText, cellsSource: source("cells", cellsText),
  campaignsSource: source("campaigns", campaignsText), workRef,
  campaignIds: ["reconcile-external-earnings-to-treasury"],
};
const stages = [
  "identify-paid-demand", "qualify-buyer-and-principal",
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
  assert.ok(campaign.parameters.includes("bank_credit_ref"));
  assert.ok(campaign.parameters.includes("independent_approval_ref"));
  assert.ok(campaign.parameters.includes("destination_custody_ref"));
  assert.ok(campaign.parameters.includes("venue_authority_ref"));
  const plan = planOperatingCell(base);
  assert.equal(plan.workRef, workRef);
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].campaignId, campaign.id);
  assert.equal(plan.campaigns[0].state, "unbound");
  assert.equal(plan.campaigns[0].stages.length, stages.length);
  assert.ok(plan.campaigns[0].missingParameters.includes("bank_credit_ref"));
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
  assert.match(effect("qualify-buyer-and-principal"), /self-payment/);
  assert.match(effect("receive-service-performance"), /independently receive/i);
  assert.match(effect("qualify-processor-payment"), /duplicate/);
  assert.match(effect("receive-bank-settlement"), /bank\/qualified-custodian arrival/);
  assert.match(effect("reconcile-authored-books"), /Farolfi/);
  assert.match(effect("reserve-and-restrict-capital"), /runway/);
  assert.match(effect("assay-investable-surplus"), /bank-settled unrestricted net cash/);
  assert.match(effect("obtain-competent-authorization"), /does not itself authorize a trade/);
  assert.match(effect("observe-authorized-execution"), /campaign itself performs no asset move/);
  assert.match(effect("receive-and-reconcile"), /investment P&L/);
  assert.match(campaign.kill, /revoked approval|revoked|authorization expires/);
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
    ...base, parameters: { bank_credit_ref: "malformed\nsecret" },
  }), /extra parameters must be bounded/);
});
