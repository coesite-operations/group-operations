import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assessOfficeCapacityIntervention } from "../src/capacity-flow-operation.mjs";

const NI="ni:///sha-256;"+"A".repeat(43);
const at="2026-10-14T05:00:00Z";
const req=()=>({
  workRef:NI,principal:"561 Group",
  operatingActor:"urn:ame:coesite-operations",
  receivingActor:"urn:ame:independent-receiving",
  mathematics:"Obsmetrologia/Language/Positing/Gauge.lean",
  sourceEvidence:NI,
  scenario:{
    asOf:at,horizonTicks:10,work:{kind:"activitypub-delivery",portable:true,requiredRights:["federated-public"]},
    nodes:[
      {id:"cold-red-gate",backlog:200,arrivalsPerTick:0,servicePerTick:5,entitlement:"verified",observedAt:at,
        capacityEvidence:NI,allowedKinds:["activitypub-delivery"],rights:["federated-public"]},
      {id:"oracle-a1",backlog:0,arrivalsPerTick:0,servicePerTick:8,entitlement:"verified",observedAt:at,
        capacityEvidence:NI,allowedKinds:["activitypub-delivery"],rights:["federated-public"]},
    ],
    links:[{from:"cold-red-gate",to:"oracle-a1",gauge:"id",maxTransfersPerTick:20,
      latencyMilliseconds:10,authorityEvidence:NI,durableTransfer:true,costCeilingKnown:true}],
  },
});
test("Coesite retains office boundary and modeled extra goodput without claiming a transfer",()=>{
  const x=assessOfficeCapacityIntervention(req());
  assert.equal(x.kind,"GroupOfficeCapacityInterventionForecast");
  assert.equal(x.forecast.goodputGainUnits,80);
  assert.equal(x.transferCandidates[0].forecastWorkUnits,80);
  assert.equal(x.transferCandidates[0].executionAllowed,false);
  assert.equal(x.executionAllowed,false);
  assert.equal(x.sourceCustodyMutated,false);
  assert.equal(x.cloudEntitlementEstablished,false);
  assert.equal(x.accountingPosted,false);
  assert.equal(x.acceptance,"UNRECEIVED_FORECAST");
});
test("office self-receiving and mismatched math authority cannot become installed permissions",()=>{
  assert.throws(()=>assessOfficeCapacityIntervention({...req(),
    receivingActor:"urn:ame:coesite-operations"}),/independent receiver/);
  assert.throws(()=>assessOfficeCapacityIntervention({...req(),
    mathematics:"some-unknown-math"}),/K4 law/);
  assert.throws(()=>assessOfficeCapacityIntervention({...req(),
    sourceEvidence:"unverified"}),/existing work/);
});
test("unknown receiving entitlement holds all planned transfer actions",()=>{
  const p=req();p.scenario.nodes[1].entitlement="unknown";
  const r=assessOfficeCapacityIntervention(p);
  assert.equal(r.forecast.goodputGainUnits,0);
  assert.equal(r.transferCandidates.length,0);
  assert.equal(r.forecast.refusedLinks[0].reason,"destination-capacity-or-rights-unverified");
});
test("bounded native command returns one source-safe forecast or a typed refusal",()=>{
  const cli=new URL("../scripts/forecast-capacity-flow.mjs",import.meta.url).pathname;
  const run=(input)=>spawnSync(process.execPath,[cli],{
    input,encoding:"utf8",timeout:10000,
  });
  const ok=run(JSON.stringify(req()));
  assert.equal(ok.status,0,ok.stderr);
  const success=JSON.parse(ok.stdout);
  assert.equal(success.ok,true);
  assert.equal(success.providerMutation,false);
  assert.equal(success.workTransfer,false);
  assert.equal(success.result.forecast.goodputGainUnits,80);
  const refused=run('{"secret":"PRIVATE_WORK_CUSTODY",');
  assert.equal(refused.status,2);
  assert.doesNotMatch(refused.stdout,/PRIVATE_WORK_CUSTODY/);
  assert.equal(JSON.parse(refused.stdout).refusal.kind,"CapacityFlowAdmissionRefusal");
  const oversized=run(" ".repeat(1_048_577));
  assert.equal(oversized.status,2);
  assert.match(JSON.parse(oversized.stdout).refusal.reason,/1 MiB/);
});
