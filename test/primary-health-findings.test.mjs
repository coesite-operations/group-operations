import test from "node:test";
import assert from "node:assert/strict";
import { agendaOf, reconcileDerivedOpenings, responseOf, takingOrderOf, territoriesOf, workBoard } from "@red-cup-engineering/organizing/enterprise/work-arena";
import { notePeerHealth, observePeerHealth } from "@red-cup-engineering/feltos-enterprise-host/peer-liveness";
// Genuine Group source fixture, blob 5ede8f7821d050df256547c06f73484f49d84d4d,
// 561-group/561-group-services-section@8bc02cea18a48cf47b3104204976761a938e3963.
import enterprise from "./fixtures/group-operations-enterprise.json" with { type: "json" };
import { primaryHealthFindingsOf } from "../src/primary-health-findings.mjs";

const peer = "https://cold-red-gate.561.group/actors/metroplat";
const poster = "group-operations";
const at = minutes => new Date(Date.UTC(2026, 9, 10, 0, minutes)).toISOString();
// This record is seated at the Group section it also declares as its data root.
const territories = territoriesOf([{ ...enterprise, sectionPath: enterprise.dataRoot }]);
const boardOf = (moves, minute) => workBoard(moves, at(minute), { territories });
const readiness = { state: "ready", ok: true, serviceState: "ready", nativeActorOk: true };
const primary = (charge, minute, id = "health-witness") => ({ id, recordedAt: at(minute),
  record: { system: "cold-red-gate", kind: "machine", charge, ...(charge === "held" ? { readiness } : {}), url: "https://cold-red-gate.561.group/healthz" },
  told: { for: charge === "held" || charge === "contested", against: charge === "denied" || charge === "contested" } });

test("genuine peer observer evidence becomes one real arena finding in the CEO's existing house agenda", () => {
  const records = [];
  const journal = { query: () => records, record: row => { records.push({ ...row, id: `peer-witness-${records.length}` }); } };
  for (const minute of [0, 65]) notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(minute),
    health: { ready: false, reason: "health-unreachable" } });
  const fault = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(65) });
  const first = reconcileDerivedOpenings(boardOf([], 65), { ...fault, openings: fault.openings.map(entry => entry.opening) });
  assert.equal(first.open.length, 1);
  const board = boardOf(first.open, 65);
  assert.equal(board.refused.length, 0);
  assert.ok(enterprise.offices.includes("chief-executive-officer"));
  assert.equal(enterprise.host, "bare-cedar-fog");
  assert.equal(board.threads[0].home, enterprise.id);
  assert.equal(takingOrderOf(enterprise, board, { territories, at: at(65) }).candidates[0].id, first.open[0].id);
  const agenda = agendaOf(board, poster);
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].id, first.open[0].id);
  assert.ok(agenda[0].moves.includes("resolve"));
  const again = reconcileDerivedOpenings(board, { ...fault, openings: fault.openings.map(entry => entry.opening) });
  assert.equal(again.open.length, 0);
  assert.equal(again.settle.length, 0, "same observation is not repeated as another incident");

  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(70), health: { ready: true, reason: "health-ready" } });
  const recovery = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(70) });
  const healed = reconcileDerivedOpenings(board, { ...recovery, openings: recovery.openings.map(entry => entry.opening) });
  assert.equal(healed.settle.length, 1);
  assert.equal(healed.settle[0].move, "resolve");
  const moves = [...first.open, responseOf({ ...healed.settle[0], at: at(70) })];
  assert.equal(boardOf(moves, 70).threads[0].standing, "resolved");
  assert.equal(agendaOf(boardOf(moves, 70), poster).length, 0);

  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(140), health: { ready: false, reason: "health-unreachable" } });
  const recurrence = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(140) });
  assert.equal(recurrence.openings[0].opening.id, first.open[0].id, "same law and peer retain one condition identity");
  const recurred = reconcileDerivedOpenings(boardOf(moves, 140), { ...recurrence, openings: recurrence.openings.map(entry => entry.opening) });
  assert.equal(recurred.open.length, 0);
  assert.equal(recurred.settle[0].move, "corroborate");
});

test("local primary fault and fresh witnessed recovery use the real report reconciliation contract", () => {
  const denied = primary("denied", 0, "fault-evidence");
  const fault = primaryHealthFindingsOf({ poster, primaryRecords: [denied], at: at(1) });
  const opening = fault.openings[0].opening;
  const board = boardOf([opening], 1);
  assert.equal(agendaOf(board, poster).length, 1);
  const held = primary("held", 5, "recovery-evidence");
  const recovery = primaryHealthFindingsOf({ poster, primaryRecords: [denied, held],
    primaryStatus: { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness }] }, at: at(6) });
  const plan = reconcileDerivedOpenings(board, { ...recovery, openings: [] });
  assert.equal(plan.settle[0].move, "resolve");
  assert.match(plan.settle[0].evidence[0], /recovery-evidence/);
});

test("missing, stale, future or unmeasured recovery cannot settle a previous report", () => {
  const held = primary("held", 5);
  for (const primaryStatus of [undefined,
    { at: at(0), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness }] },
    { at: at(50), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness }] },
    { at: at(40), systems: [{ id: "cold-red-gate", charge: "unknown" }] }]) {
    assert.throws(() => primaryHealthFindingsOf({ poster, primaryRecords: [held], primaryStatus, at: at(40) }), /no measured domain/);
  }
  assert.throws(() => primaryHealthFindingsOf({ poster, at: at(40) }), /no measured domain/);
  assert.throws(() => primaryHealthFindingsOf({ poster, primaryRecords: [{ ...held, told: { for: false, against: true } }],
    primaryStatus: { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness }] }, at: at(6) }), /no measured domain/);
});

test("same-time contradictory primary witnesses remain a fault rather than a recovery", () => {
  const result = primaryHealthFindingsOf({ poster, primaryRecords: [primary("held", 5), primary("denied", 5, "other")],
    primaryStatus: { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness }] }, at: at(6) });
  assert.equal(result.openings.length, 1);
  assert.match(result.openings[0].opening.observation, /contested/);
});

test("one measured system cannot resolve another system or another owner's report", () => {
  const fault = primaryHealthFindingsOf({ poster, primaryRecords: [primary("denied", 0)], at: at(1) });
  const foreign = primaryHealthFindingsOf({ poster: "someone-else", primaryRecords: [primary("denied", 0)], at: at(1) });
  const other = primary("held", 5);
  other.record.system = "bare-cedar-fog";
  const recovery = primaryHealthFindingsOf({ poster, primaryRecords: [other],
    primaryStatus: { at: at(6), systems: [{ id: "bare-cedar-fog", charge: "held", kind: "machine", readiness }] }, at: at(6) });
  const plan = reconcileDerivedOpenings(boardOf([fault.openings[0].opening], 6), { ...recovery, openings: [] });
  assert.equal(plan.settle.length, 0);
  const otherPlan = reconcileDerivedOpenings(boardOf([foreign.openings[0].opening], 6), { ...recovery, openings: [] });
  assert.equal(otherPlan.settle.length, 0);
});

test("historical HTTP-only machine success cannot resolve faults; property HTTP recovery is preserved", () => {
  const historical = primary("held", 5);
  delete historical.record.readiness;
  const status = { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness }] };
  assert.throws(() => primaryHealthFindingsOf({ poster, primaryRecords: [historical], primaryStatus: status, at: at(6) }), /no measured domain/);
  const held = primary("held", 5);
  for (const claim of [undefined, { state: "unknown" }, { state: "failed" }, { ...readiness, nativeActorOk: false }]) {
    assert.throws(() => primaryHealthFindingsOf({ poster, primaryRecords: [held],
      primaryStatus: { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness: claim }] }, at: at(6) }), /no measured domain/);
  }
  historical.record.kind = "property";
  const recovered = primaryHealthFindingsOf({ poster, primaryRecords: [historical],
    primaryStatus: { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "property" }] }, at: at(6) });
  assert.equal(recovered.openings.length, 0);
  assert.equal(recovered.domain.tags.length, 1);
});

test("future or malformed peer evidence cannot reveal an older recovery; joined sides stay contested", () => {
  const records = [];
  const journal = { query: () => records, record: row => records.push({ ...row, id: `witness-${records.length}` }) };
  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(5), health: { ready: true, reason: "health-ready" } });
  const held = records[0];
  for (const record of [{ ...held.record, at: at(50) }, { ...held.record, window: "invalid" }]) {
    assert.throws(() => primaryHealthFindingsOf({ poster, peerRecords: [held, { ...held, id: "bad", record }], at: at(6) }), /no measured domain/);
  }
  const contested = primaryHealthFindingsOf({ poster, peerRecords: [{ ...held, told: { for: true, against: true } }], at: at(6) });
  assert.equal(contested.openings.length, 1);
  assert.match(contested.openings[0].opening.observation, /contested/);
});

test("qualified 503 readiness failure reaches the arena immediately, while silence waits for suspicion", async () => {
  const records = [];
  const journal = { query: () => records, record: row => records.push({ ...row, id: `witness-${records.length}` }) };
  const contract = { actor: peer, kind: "metroplat-supervised-health", service: "cold-red-gate.561.group" };
  const healthy = { service: contract.service, ok: true, state: "ready", nativeActor: { ok: true } };
  const failure = await observePeerHealth(peer, { contract, probe: async () => Response.json({ ...healthy, ok: false, nativeActor: { ok: false } }, { status: 503 }) });
  assert.equal(notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(0), health: failure }).reading, "unknown");
  const fault = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(0) });
  assert.equal(fault.openings.length, 1);
  assert.equal(fault.openings[0].opening.subject, `enterprise:${poster}`);
  assert.match(fault.openings[0].opening.law, /work-peer-service:/);
  const board = boardOf([fault.openings[0].opening], 0);
  const recovery = await observePeerHealth(peer, { contract, probe: async () => Response.json(healthy) });
  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(5), health: recovery });
  const finding = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(5) });
  assert.equal(reconcileDerivedOpenings(board, { ...finding, openings: [] }).settle[0].move, "resolve");
  const silent = [];
  notePeerHealth({ query: () => silent, record: row => silent.push({ ...row, id: "silent" }) },
    { observer: "bare-cedar-fog", peer, now: at(0), health: { ready: false, reason: "health-timeout" } });
  assert.throws(() => primaryHealthFindingsOf({ poster, peerRecords: silent, at: at(0) }), /no measured domain/);
});

test("contradictory ready custody or a newer unqualified health observation cannot settle service-readiness faults", () => {
  const records = [];
  const journal = { query: () => records, record: row => records.push({ ...row, id: `witness-${records.length}` }) };
  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(0), health: { ready: false, reason: "health-unready",
    readiness: { state: "failed", service: "cold-red-gate.561.group", ok: false, nativeActorOk: false } } });
  const fault = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(0) });
  const board = boardOf([fault.openings[0].opening], 0);
  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(5), health: { ready: true, reason: "health-ready",
    readiness: { state: "ready", service: "cold-red-gate.561.group", ok: true, nativeActorOk: true } } });
  const ready = records[1];
  const joined = primaryHealthFindingsOf({ poster, peerRecords: [records[0], { ...ready, told: { for: true, against: true } }], at: at(6) });
  assert.equal(reconcileDerivedOpenings(board, { ...joined, openings: joined.openings.map(entry => entry.opening) }).settle.length, 0);
  for (const reason of ["health-timeout", "health-body-invalid", "health-unready"]) {
    const later = { ...ready, id: "later-unqualified", recordedAt: at(6), told: { for: false, against: false },
      record: { ...ready.record, at: at(6), why: reason } };
    delete later.record.serviceHealth;
    const result = primaryHealthFindingsOf({ poster, peerRecords: [...records, later], at: at(6) });
    assert.equal(reconcileDerivedOpenings(board, { ...result, openings: [] }).settle.length, 0, reason);
  }
});

test("internally contradictory ready evidence cannot settle either machine or peer-service findings", () => {
  for (const claim of [{ ...readiness, ok: false }, { ...readiness, nativeActorOk: false },
    { ...readiness, serviceState: "failed" }, { state: "ready" }]) {
    const held = primary("held", 5);
    held.record.readiness = claim;
    assert.throws(() => primaryHealthFindingsOf({ poster, primaryRecords: [held],
      primaryStatus: { at: at(6), systems: [{ id: "cold-red-gate", charge: "held", kind: "machine", readiness: claim }] }, at: at(6) }), /no measured domain/);
    const row = { id: "contradictory-service", recordedAt: at(5), told: { for: true, against: false },
      record: { peer, observer: "bare-cedar-fog", at: at(5), window: at(5), why: "health-ready", serviceHealth: { ...claim, service: "cold-red-gate.561.group" } } };
    const result = primaryHealthFindingsOf({ poster, peerRecords: [row], at: at(6) });
    assert.equal(result.domain.tags.length, 1, "only the independent liveness heartbeat can be measured");
    assert.ok(result.domain.tags[0].startsWith("work-peer-health-"));
  }
});

test("latest-told liveness recovery survives below-threshold silence without becoming service readiness", () => {
  const records = [];
  const journal = { query: () => records, record: row => records.push({ ...row, id: `witness-${records.length}` }) };
  for (const minute of [0, 65]) notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(minute), health: { ready: false, reason: "health-timeout" } });
  const fault = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(65) });
  const board = boardOf(fault.openings.map(entry => entry.opening), 65);
  notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(70), health: { ready: true, reason: "health-ready" } });
  const later = notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(71), health: { ready: false, reason: "health-timeout" } });
  assert.equal(later.reading, "held", "the genuine liveness reader retains its latest told heartbeat before theta");
  const result = primaryHealthFindingsOf({ poster, peerRecords: records, at: at(71) });
  assert.equal(reconcileDerivedOpenings(board, { ...result, openings: [] }).settle[0].move, "resolve");
  assert.ok(result.domain.tags.every(tag => !tag.startsWith("work-peer-service-health-")));
});
