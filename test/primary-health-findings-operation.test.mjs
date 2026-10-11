import test from "node:test";
import assert from "node:assert/strict";
import { agendaOf, reconcileDerivedOpenings, territoriesOf, workBoard } from "@red-cup-engineering/organizing/enterprise/work-arena";
import { notePeerHealth, PEER_LIVENESS_KIND } from "@red-cup-engineering/feltos-enterprise-host/peer-liveness";
import { primaryHealthFindingsOperation } from "../src/primary-health-findings-operation.mjs";
import { primaryHealthFindingsOf, PRIMARY_HEALTH_KIND } from "../src/primary-health-findings.mjs";
import enterprise from "./fixtures/group-operations-enterprise.json" with { type: "json" };

const poster = enterprise.id;
const peer = "https://cold-red-gate.561.group/actors/metroplat";
const at = minutes => new Date(Date.UTC(2026, 9, 10, 0, minutes)).toISOString();
const readiness = { state: "ready", ok: true, serviceState: "ready", nativeActorOk: true };
const primary = (charge, minute) => ({ id: `primary-${minute}-${charge}`, recordedAt: at(minute),
  record: { system: "cold-red-gate", kind: "machine", charge, ...(charge === "held" ? { readiness } : {}) },
  told: { for: charge === "held", against: charge === "denied" } });
const status = { at: at(65), systems: [{ id: "cold-red-gate", kind: "machine", charge: "held", readiness }] };
const territories = territoriesOf([{ ...enterprise, sectionPath: enterprise.dataRoot }]);
const boardOf = openings => workBoard(openings, at(65), { territories });
const errorOf = code => Object.assign(new Error("PRIVATE_PATH_OR_CREDENTIAL_MUST_NOT_ESCAPE"), { code });
const faults = () => {
  const rows = [];
  const journal = { query: () => rows, record: row => rows.push({ ...row, id: `peer-${rows.length}` }) };
  for (const minute of [0, 65]) notePeerHealth(journal, { observer: "bare-cedar-fog", peer, now: at(minute), health: { ready: false, reason: "health-timeout" } });
  return rows;
};
const operationWith = ({ readStatus = () => status, primaryRead = () => [], peerRead = faults } = {}) => {
  const reads = [];
  const operation = primaryHealthFindingsOperation({ dataRoot: "/fixture/settlement", now: () => at(65) }, {
    home: "/fixture/home",
    readStatus: path => { reads.push({ source: "status", path }); return readStatus(); },
    readWitnesses: selection => {
      reads.push(selection);
      assert.ok([PRIMARY_HEALTH_KIND, PEER_LIVENESS_KIND].includes(selection.objectKind));
      return selection.objectKind === PRIMARY_HEALTH_KIND ? primaryRead() : peerRead();
    },
  });
  assert.equal(operation.effects.class, "host-read");
  return { operation, reads };
};
const unknown = (result, source) => result.inputReadings.find(reading => reading.source === source);
const assertPeerReachesHouse = result => {
  assert.equal(result.openings.length, 1);
  assert.match(result.openings[0].opening.law, /work-peer:/);
  assert.equal(agendaOf(boardOf(result.openings.map(entry => entry.opening)), poster).length, 1);
};

test("genuine operation preserves independent peer receiving when status read throws", async () => {
  for (const failure of [new SyntaxError("PRIVATE_PATH_OR_CREDENTIAL_MUST_NOT_ESCAPE"), errorOf("EACCES"), errorOf("ENOENT")]) {
    const { operation, reads } = operationWith({ readStatus: () => { throw failure; }, primaryRead: () => [primary("held", 60)] });
    const result = await operation.execute({ poster });
    assertPeerReachesHouse(result);
    assert.equal(reads.length, 3, "each independent input is still read");
    assert.equal(unknown(result, "primary-status").reading, "unknown");
    assert.match(result.evidence, /primary-status=unknown:/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PATH_OR_CREDENTIAL_MUST_NOT_ESCAPE/);
    const prior = primaryHealthFindingsOf({ poster, primaryRecords: [primary("denied", 0)], at: at(65) });
    const plan = reconcileDerivedOpenings(boardOf(prior.openings.map(entry => entry.opening)), { ...result, openings: result.openings.map(entry => entry.opening) });
    assert.equal(plan.settle.length, 0, "unread status cannot settle its own earlier machine finding");
  }
});

test("malformed status is explicit unknown rather than an exception hiding the peer", async () => {
  for (const malformed of [null, [], { at: "bad", systems: [] }, { at: at(65), systems: {} },
    { at: at(65), systems: [null] }, { at: at(65), systems: [{ id: "machine", kind: "machine", charge: "invented" }] }]) {
    const { operation } = operationWith({ readStatus: () => malformed });
    const result = await operation.execute({ poster });
    assertPeerReachesHouse(result);
    assert.deepEqual(unknown(result, "primary-status").failure, { type: "MalformedInput", code: "INVALID_SHAPE" });
  }
});

test("failed or malformed primary journal cannot hide peer faults or settle primary custody", async () => {
  const prior = primaryHealthFindingsOf({ poster, primaryRecords: [primary("denied", 0)], at: at(65) });
  const board = boardOf(prior.openings.map(entry => entry.opening));
  for (const primaryRead of [() => { throw errorOf("EIO"); }, () => null, () => [null],
    () => [{ id: "bad", recordedAt: at(65), record: {}, told: { for: true, against: false } }]]) {
    const { operation } = operationWith({ primaryRead });
    const result = await operation.execute({ poster });
    assertPeerReachesHouse(result);
    assert.equal(unknown(result, "primary-journal").reading, "unknown");
    assert.match(result.evidence, /primary-journal=unknown:/);
    assert.equal(reconcileDerivedOpenings(board, { ...result, openings: result.openings.map(entry => entry.opening) }).settle.length, 0);
  }
});

test("failed or malformed peer journal cannot hide a measured primary fault or settle peer custody", async () => {
  const prior = primaryHealthFindingsOf({ poster, peerRecords: faults(), at: at(65) });
  const board = boardOf(prior.openings.map(entry => entry.opening));
  for (const peerRead of [() => { throw errorOf("EACCES"); }, () => null, () => [null],
    () => [{ id: "bad", recordedAt: at(65), record: { peer }, told: { for: true, against: false } }]]) {
    const { operation } = operationWith({ primaryRead: () => [primary("denied", 60)], peerRead });
    const result = await operation.execute({ poster });
    assert.equal(result.openings.length, 1);
    assert.match(result.openings[0].opening.law, /primary-system:/);
    assert.equal(agendaOf(boardOf(result.openings.map(entry => entry.opening)), poster).length, 1);
    assert.equal(unknown(result, "peer-journal").reading, "unknown");
    assert.equal(reconcileDerivedOpenings(board, { ...result, openings: result.openings.map(entry => entry.opening) }).settle.length, 0);
  }
});

test("no measured domain preserves the exact refusal and bounded input evidence", async () => {
  const { operation, reads } = operationWith({ readStatus: () => { throw errorOf("EACCES"); },
    primaryRead: () => { throw Object.assign(errorOf("PRIVATE_CODE"), { name: "PRIVATE_ERROR_NAME" }); }, peerRead: () => null });
  assert.throws(() => operation.execute({ poster }), error => {
    assert.equal(error.name, "TypeError");
    assert.equal(error.message, "primary-health-findings has no measured domain; prior reports remain standing");
    assert.equal(error.inputReadings.length, 3);
    assert.ok(error.inputReadings.every(reading => reading.reading === "unknown"));
    assert.match(error.evidence, /primary-journal=unknown:ReadError:UNCLASSIFIED/);
    assert.match(error.evidence, /peer-journal=unknown:MalformedInput:INVALID_SHAPE/);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_/);
    return true;
  });
  assert.equal(reads.length, 3);
});

test("healthy input availability does not invent a measured domain from empty journals", async () => {
  const { operation } = operationWith({ primaryRead: () => [], peerRead: () => [] });
  assert.throws(() => operation.execute({ poster }), error => {
    assert.equal(error.message, "primary-health-findings has no measured domain; prior reports remain standing");
    assert.ok(error.inputReadings.every(reading => reading.availability === "available"));
    assert.match(error.evidence, /unknown:no-measured-domain/);
    return true;
  });
});

test("sparse and inherited journal entries are unavailable without hiding independent faults", () => {
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: primary("held", 60) }));
  for (const rows of [new Array(1), [, primary("held", 60)], inherited]) {
    const { operation } = operationWith({ primaryRead: () => rows });
    const result = operation.execute({ poster });
    assertPeerReachesHouse(result);
    assert.deepEqual(unknown(result, "primary-journal").failure, { type: "MalformedInput", code: "INVALID_SHAPE" });
  }
  for (const rows of [new Array(1), [, ...faults()]]) {
    const { operation } = operationWith({ primaryRead: () => [primary("denied", 60)], peerRead: () => rows });
    const result = operation.execute({ poster });
    assert.equal(result.openings.length, 1);
    assert.match(result.openings[0].opening.law, /primary-system:/);
    assert.deepEqual(unknown(result, "peer-journal").failure, { type: "MalformedInput", code: "INVALID_SHAPE" });
  }
});

test("unread status entries stay unavailable rather than selecting around holes or trusting an overridden every", () => {
  const good = status.systems[0];
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: good }));
  const overridden = [null];
  overridden.every = () => true;
  for (const systems of [new Array(1), [good, ,], [, good], inherited, overridden]) {
    const { operation } = operationWith({ readStatus: () => ({ ...status, systems }), primaryRead: () => [primary("held", 60)] });
    const result = operation.execute({ poster });
    assertPeerReachesHouse(result);
    assert.deepEqual(unknown(result, "primary-status").failure, { type: "MalformedInput", code: "INVALID_SHAPE" });
  }
});
