// Pure fixtures only: no network, filesystem pulse, installed journal, or house dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { chargeOf, readPrimaryHealth, primaryHealthChanges, renderPrimaryHealthPage, runPrimaryHealthPulse } from "../src/primary-health.mjs";

const target = { id: "cold-red-gate", kind: "machine", url: "http://machine.invalid/healthz", public: "https://machine.invalid/healthz" };
const source = (commit) => ({ repository: "coesite-operations/operations-services-section", commit, url: `https://github.com/coesite-operations/operations-services-section/commit/${commit}` });
const fixture = () => ({
  release: "running-revision",
  artifact: "/gnu/store/running-release",
  sources: [source("running-source")],
  deployment: {
    outcome: "staged", machine: "cold-red-gate", revision: "candidate-revision", repository: "emsenn/cold-red-gate",
    run: "https://github.com/emsenn/cold-red-gate/actions/runs/123", runAttempt: "2", stage: "pre-switch-check",
    at: "2026-10-10T00:00:00Z", reason: "", storePath: "/gnu/store/candidate-release", previous: "/gnu/store/running-release", retained: false,
  },
});
const read = (body, { at = "2026-10-10T01:00:00Z", status = 200, retryAfter, kind = "machine" } = {}) => readPrimaryHealth({
  targets: [{ ...target, kind }], clock: () => at,
  probe: async (url) => {
    assert.equal(url, target.url);
    return { status, headers: { get: () => retryAfter ?? null }, json: async () => structuredClone(body), body: { cancel: async () => {} } };
  },
});

test("running release identity and the exact latest staged receipt stay separate", async () => {
  const body = fixture();
  const { systems: [system] } = await read(body);
  assert.deepEqual(system, { id: target.id, kind: target.kind, url: target.public, charge: "held", status: 200, ...body });
  assert.notEqual(system.release, system.deployment.revision);
  assert.notEqual(system.artifact, system.deployment.storePath);
  assert.equal(system.sources[0].commit, "running-source");
  assert.equal(Object.hasOwn(system, "deployed"), false);
  assert.equal(Object.hasOwn(system, "accepted"), false);
  assert.match(renderPrimaryHealthPage({ at: "now", systems: [system] }), /last deployment receipt staged at pre-switch-check/u);
});

test("unknown and absent identity stays unknown and absent without inferred defaults", async () => {
  const { systems: [unknown] } = await read({ release: null, artifact: null, sources: null, deployment: null });
  assert.equal(unknown.release, null);
  assert.equal(unknown.artifact, null);
  assert.equal(unknown.sources, null);
  assert.equal(Object.hasOwn(unknown, "deployment"), false);
  const { systems: [absent] } = await read({ deployment: { outcome: "staged", run: "https://example.invalid/runs/123" } });
  for (const key of ["release", "artifact", "sources"]) assert.equal(Object.hasOwn(absent, key), false, key);
  assert.equal(Object.hasOwn(absent.deployment, "runAttempt"), false);
  const { systems: [legacy] } = await read({ deployment: { outcome: "staged", run: false, runAttempt: false } });
  assert.deepEqual(legacy.deployment, { outcome: "staged", run: false, runAttempt: false });
});

test("receipt scalar types are preserved and unsupported or structured fields are not projected", async () => {
  const { systems: [system] } = await read({ deployment: {
    outcome: "staged", machine: null, revision: false, repository: "", run: 0, runAttempt: "02", stage: false,
    at: "", reason: null, storePath: "", previous: false, retained: false, credentials: "do-not-project", nested: { ignored: true },
  } });
  assert.deepEqual(system.deployment, {
    outcome: "staged", machine: null, revision: false, repository: "", run: 0, runAttempt: "02", stage: false,
    at: "", reason: null, storePath: "", previous: false, retained: false,
  });
  const { systems: [structured] } = await read({ deployment: { outcome: "staged", run: { id: 123 }, runAttempt: [2], retained: true } });
  assert.deepEqual(structured.deployment, { outcome: "staged", retained: true });
});

test("only the public running-source fields are projected and malformed identity stays unknown", async () => {
  const body = fixture();
  body.sources[0].private = { credentials: "do-not-project" };
  body.sources[0].nested = [{ token: "do-not-project" }];
  const { systems: [system] } = await read(body);
  assert.deepEqual(system.sources, [source("running-source")]);
  for (const malformed of [false, 1, { secret: "do-not-project" }, ["do-not-project"]]) {
    const { systems: [unknown] } = await read({ release: malformed, artifact: malformed });
    assert.equal(Object.hasOwn(unknown, "release"), false);
    assert.equal(Object.hasOwn(unknown, "artifact"), false);
  }
  for (const malformed of [
    "not-an-array", { repositories: [source("running-source")] }, [null], ["not-a-source"], [[]],
    [{ repository: "repo", commit: { secret: "do-not-project" }, url: "https://example.invalid" }],
    [{ repository: "repo", commit: "sha" }],
    [source("running-source"), { repository: "repo", commit: false, url: "https://example.invalid" }],
  ]) {
    const { systems: [unknown] } = await read({ sources: malformed });
    assert.equal(Object.hasOwn(unknown, "sources"), false, "a malformed list cannot claim an empty or smaller source set");
  }
  assert.deepEqual((await read({ sources: [] })).systems[0].sources, []);
});

test("same-charge same-outcome release, source, and receipt identity changes are recorded", async (t) => {
  const previous = await read(fixture());
  const cases = [
    ["running release", (body) => { body.release = "another-running-revision"; }],
    ["running artifact", (body) => { body.artifact = "/gnu/store/another-running-release"; }],
    ["running source", (body) => { body.sources = [source("another-running-source")]; }],
    ["candidate revision", (body) => { body.deployment.revision = "another-candidate"; }],
    ["candidate repository", (body) => { body.deployment.repository = "emsenn/bare-cedar-fog"; }],
    ["receipt machine", (body) => { body.deployment.machine = "bare-cedar-fog"; }],
    ["run", (body) => { body.deployment.run += "4"; }],
    ["attempt", (body) => { body.deployment.runAttempt = "3"; }],
    ["attempt type", (body) => { body.deployment.runAttempt = 2; }],
    ["candidate store", (body) => { body.deployment.storePath = "/gnu/store/another-candidate"; }],
    ["previous store", (body) => { body.deployment.previous = "/gnu/store/another-previous"; }],
    ["retained", (body) => { body.deployment.retained = true; }],
    ["stage", (body) => { body.deployment.stage = "live-check"; }],
    ["reason", (body) => { body.deployment.reason = "candidate rejected"; }],
    ["missing source evidence", (body) => { body.sources = null; }],
    ["missing receipt evidence", (body) => { body.deployment = null; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const body = fixture();
    change(body);
    const current = await read(body);
    const changes = primaryHealthChanges(previous, current);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].was, "held");
    assert.equal(changes[0].charge, "held");
    assert.deepEqual(changes[0], { ...current.systems[0], was: "held" });
  });
});

test("timestamp-only pulses and JSON object key order do not create release changes", async () => {
  const body = fixture();
  const previous = await read(body);
  body.deployment.at = "2026-10-10T02:00:00Z";
  body.deployment = Object.fromEntries(Object.entries(body.deployment).reverse());
  body.sources = body.sources.map((value) => Object.fromEntries(Object.entries(value).reverse()));
  const current = await read(body, { at: "2026-10-10T02:01:00Z" });
  assert.deepEqual(primaryHealthChanges(previous, current), []);
  assert.equal(current.systems[0].deployment.at, "2026-10-10T02:00:00Z", "receipt timestamp is still carried");
});

test("legacy receipts gain an exact attempt only when the producer supplies it", async () => {
  const body = fixture();
  delete body.deployment.runAttempt;
  const previous = await read(body);
  body.deployment.runAttempt = "2";
  assert.equal(primaryHealthChanges(previous, await read(body)).length, 1);
  body.deployment.runAttempt = false;
  const legacy = await read(body);
  body.deployment.at = "later";
  assert.deepEqual(primaryHealthChanges(legacy, await read(body)), []);
});

test("charge changes, new targets, and changed deployment outcomes retain their existing behavior", async () => {
  const body = fixture();
  const previous = await read(body);
  assert.equal(primaryHealthChanges(undefined, previous).length, 1);
  assert.deepEqual(primaryHealthChanges(previous, await read(body)), []);
  body.deployment.outcome = "failure";
  const changed = primaryHealthChanges(previous, await read(body));
  assert.equal(changed.length, 1);
  assert.equal(changed[0].deployment.outcome, "failure");
  assert.equal(changed[0].release, "running-revision");
  assert.equal(changed[0].charge, "held", "held means answering, not acceptance of the candidate");
  const unavailable = await read(body, { status: 503, retryAfter: "120" });
  assert.equal(primaryHealthChanges(previous, unavailable)[0].charge, "contested");
  assert.equal(chargeOf({ status: 502 }), "denied");
  assert.equal(chargeOf(undefined), "unknown");
});

test("non-machine and failed HTTP answers do not claim running release evidence", async () => {
  for (const options of [{ kind: "property" }, { status: 502 }]) {
    const { systems: [system] } = await read(fixture(), options);
    for (const key of ["release", "artifact", "sources", "deployment"]) assert.equal(Object.hasOwn(system, key), false, key);
  }
  const brokenJson = await readPrimaryHealth({
    targets: [target], clock: () => "now",
    probe: async () => ({ status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("not JSON"); } }),
  });
  assert.equal(brokenJson.systems[0].charge, "held");
  assert.equal(Object.hasOwn(brokenJson.systems[0], "release"), false);
});

test("the pulse journal payload carries running identity and changed attempt evidence using in-memory ports", async () => {
  // Evaluate the exact exported function body with memory-only file/journal ports. This does
  // not invoke its filesystem-bound closure or the existing installed-journal integration test.
  const files = new Map();
  const records = [];
  const pulse = new Function("ports", `
    const { mkdir, readJson, readPrimaryHealth, primaryHealthChanges, join, writeAtomically, renderPrimaryHealthPage, TOLD } = ports;
    return (${runPrimaryHealthPulse.toString()});
  `)({
    mkdir: async () => {}, readJson: async (path) => files.has(path) ? JSON.parse(files.get(path)) : undefined,
    readPrimaryHealth, primaryHealthChanges, join, renderPrimaryHealthPage,
    writeAtomically: async (path, text) => { files.set(path, text); },
    TOLD: { held: { for: true, against: false } },
  });
  const body = fixture();
  let at = "2026-10-10T01:00:00Z";
  const options = {
    statusDirectory: "memory-only", targets: [target], clock: () => at,
    probe: async () => ({ status: 200, headers: { get: () => null }, json: async () => structuredClone(body) }),
    journal: { record: (record) => { records.push(record); return { id: `record-${records.length}` }; } },
  };
  const first = await pulse(options);
  assert.deepEqual(records[0].record, {
    system: target.id, kind: target.kind, url: target.public, charge: "held", was: "unknown", status: 200, ...body,
  });
  assert.deepEqual(first.changes, [{ system: target.id, charge: "held", was: "unknown", evidence: "record-1" }]);
  body.deployment.at = "2026-10-10T02:00:00Z";
  at = "2026-10-10T02:01:00Z";
  const unchanged = await pulse(options);
  assert.equal(records.length, 1);
  assert.equal(unchanged.changes.length, 0);
  assert.equal(unchanged.status.systems[0].since, "2026-10-10T01:00:00Z");
  body.deployment.runAttempt = "3";
  at = "2026-10-10T03:00:00Z";
  const changed = await pulse(options);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1].record, {
    system: target.id, kind: target.kind, url: target.public, charge: "held", was: "held", status: 200, ...body,
  });
  assert.equal(changed.status.systems[0].since, at);
  const status = JSON.parse(files.get(join("memory-only", "status.json")));
  assert.equal(status.systems[0].deployment.runAttempt, "3");
  assert.equal(status.systems[0].release, "running-revision");
  assert.match(files.get(join("memory-only", "index.html")), /last deployment receipt staged/u);
});
