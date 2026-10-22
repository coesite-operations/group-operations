import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// In the owning Coesite CI the original Engineering source is checked out at
// one exact revision. In its native installed workspace the package export
// remains the original module; neither path is a copied planning engine.
const originalReader = process.env.AOE_ORIGINAL_READER_FILE
  ? pathToFileURL(process.env.AOE_ORIGINAL_READER_FILE).href
  : "@red-cup-engineering/organizing/enterprise";
const { planOperatingCell } = await import(originalReader);

const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const cellsText = read("content/pulse-operating-cells.v1.json");
const campaignsText = read("content/operations-campaign-library.v1.json");
const source = (role,text) => ({
  repository:"coesite-operations/operations-services-section",
  path:"apps/group-operations/content/"+(role==="cells" ? "pulse-operating-cells.v1.json" : "operations-campaign-library.v1.json"),
  // The original AOE reader checks the exact local blob. This dummy commit
  // is a clearly synthetic read test, NOT Git-tree/member authentication.
  commit:"a".repeat(40),
  gitBlobSha:createHash("sha1").update("blob "+Buffer.byteLength(text,"utf8")+"\0").update(text).digest("hex"),
});
const campaign = JSON.parse(campaignsText).campaigns.find(x=>x.id==="govern-marketing-work");
const workRef = JSON.parse(cellsText).cells[0].work_ref;
const base = {
  cellsText, campaignsText,
  cellsSource:source("cells",cellsText), campaignsSource:source("campaigns",campaignsText),
  workRef,campaignIds:["govern-marketing-work"],
};

test("governed marketing is selected by the existing original AOE Work planner",()=>{
  assert.ok(campaign, "original Coesite source includes the marketing campaign");
  assert.equal(new Set(campaign.stages.map(x=>x.id)).size,campaign.stages.length);
  assert.deepEqual(campaign.stages.map(x=>x.id),[
    "commission","qualify-claims","form-message","independent-review",
    "choose-channels","approve-effect","publish","observe-receiving",
    "evaluate","stop-or-renew","receive","reconcile"]);
  assert.ok(campaign.parameters.includes("original_qualifying_claim_ref"));
  assert.ok(campaign.parameters.includes("rights_approval_ref"));
  assert.ok(campaign.parameters.includes("measurement_definition_ref"));
  const plan=planOperatingCell(base);
  assert.equal(plan.workRef,workRef);
  assert.equal(plan.campaigns.length,1);
  assert.equal(plan.campaigns[0].campaignId,campaign.id);
  assert.equal(plan.campaigns[0].state,"unbound");
  assert.ok(plan.campaigns[0].missingParameters.includes("rights_approval_ref"));
  assert.equal(plan.retainedWork.writer,"native Work Arena work-open/work-move");
  assert.equal(plan.source.treeMembershipVerified,false);
  assert.equal(plan.workOpened,false);
  assert.equal(plan.effectsAuthorized,false);
  assert.equal(plan.dispatchable,false);
  assert.equal(plan.received,false);
});

test("typed parameter presence never manufactures issuer authority, publisher approval, independent reader or funds",()=>{
  const original = planOperatingCell(base);
  const parameters = Object.fromEntries(original.campaigns[0].missingParameters
    .map(name=>[name,"urn:unverified:"+name]));
  const plan=planOperatingCell({...base,parameters});
  const selected=plan.campaigns[0];
  assert.deepEqual(selected.missingParameters,[]);
  assert.equal(selected.state,"awaiting-native-authority");
  for(const item of selected.bindings){
    if(item.parameter in parameters){
      assert.equal(item.value,parameters[item.parameter]);
      assert.equal(item.source,"caller-unverified");
      assert.equal(item.admitted,false);
    }
  }
  assert.equal(plan.effectsAuthorized,false);
  assert.equal(plan.workOpened,false);
  assert.equal(plan.dispatchable,false);
  assert.equal(plan.received,false);
  assert.ok(plan.blockers.includes("incumbency-and-real-office-grants-unreceived"));
  assert.ok(plan.blockers.includes("independent-consumer-receiving-unreceived"));
});

test("marketing governance rejects wrong source or confused original Work, without another ledger",()=>{
  assert.throws(()=>planOperatingCell({...base,workRef:"ni:///sha-256;"+"Q".repeat(43)}),/Work reference not present/);
  assert.throws(()=>planOperatingCell({...base,campaignsText:campaignsText.replace('"govern-marketing-work"','"shadow-marketing"')}),/original Git blob/);
  assert.throws(()=>planOperatingCell({...base,parameters:{principal:"wrong-principal"}}),/cannot replace original identity/);
  assert.throws(()=>planOperatingCell({...base,parameters:{customer_phone:"not-selected"}}),/not declared by selected campaign/);
  assert.match(campaign.stages.find(s=>s.id==="independent-review").effect,/distinct reviewer/);
  assert.match(campaign.stages.find(s=>s.id==="approve-effect").effect,/actual/);
  assert.match(campaign.stages.find(s=>s.id==="observe-receiving").effect,/served placement/);
  assert.match(campaign.kill,/revokes channel authority/);
});
