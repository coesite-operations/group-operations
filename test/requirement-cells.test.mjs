import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { REQUIREMENT, REQUIREMENT_SECTION, RULING, existenceOnly, readGoverning, recordGoverning } from "../src/requirement-cells.mjs";
import { exercise, maintainRequirements, readingsOf } from "../src/requirement-maintenance.mjs";
import { convertRequirements } from "../src/requirement-conversion.mjs";
import { ordersNamed, pullRequestOrder } from "../src/requirement-orders.mjs";
import { detect, plainRecordFiles, recordAssemblyBreak, recordAssemblyBreakJuly, recordBaseline, reArchitectureIdOf } from "../src/requirement-rules.mjs";
import { addressHolds, addressed, carryToJuly, julyTypes, lostFrom, uncarried } from "../src/requirement-july.mjs";
import { readPools, writeJuly } from "../src/requirement-pools.mjs";
import { requirementOperations } from "../src/requirement-operations.mjs";
import { fileURLToPath } from "node:url";

const SCHEMAS = fileURLToPath(new URL("./fixtures/july-schemas/", import.meta.url));

const SECTION = "lib/emsenn/services/561-group/services/561-group-services-section";
const SEAT = `${SECTION}#requirement-maintainer@test`;

function repository() {
  const root = mkdtempSync(join(tmpdir(), "requirement-cells-"));
  mkdirSync(join(root, SECTION), { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  return { root, keys: mkdtempSync(join(tmpdir(), "seat-keys-")), journal: mkdtempSync(join(tmpdir(), "maintenance-")) };
}
const requirement = (overrides = {}) => ({
  id: "the-board-holds-the-order", name: "The board holds the order", section: SECTION, raisedBy: "emsenn",
  asks: "everything should be signed cell typed data",
  sources: [{ words: "everything should be signed cell typed data", session: "session-a", at: "2026-10-10T00:00:00Z" }],
  metWhen: [{ cell: "order:behaves", command: "test 1 -eq 1 && true" }],
  ...overrides,
});

test("a requirement is recorded as a signed cell in its section and reads back verified", () => {
  const { root, keys } = repository();
  try {
    const recorded = recordGoverning({ kind: REQUIREMENT, input: requirement(), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    assert.equal(recorded.charge, "held");
    assert.match(recorded.root, /requirement-management-operation-services-section\/data\/requirements\/the-board-holds-the-order$/u);
    const { records, refused } = readGoverning({ repositoryRoot: root, kind: REQUIREMENT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(refused.length, 0);
    assert.equal(records.length, 1);
    assert.equal(records[0].body.asks, "everything should be signed cell typed data");
    assert.equal(records[0].mark.kind, "sign.cell");
    assert.match(records[0].mark.id, /^ni:\/\/\/sha-256;/u);
    assert.equal(records[0].body.class, "requirement");
    assert.equal(records[0].body.authority, "party:emsenn");
    assert.deepEqual([records[0].cell.subject, records[0].cell.predicate, records[0].cell.object], ["party:emsenn", "requires", "requirement:the-board-holds-the-order"]);
    assert.equal(records[0].signature.ok, true);
    assert.equal(records[0].signature.trust, "registered");
    assert.equal(records[0].signature.seat, SEAT);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("a tampered record is refused, not read", () => {
  const { root, keys } = repository();
  try {
    const { root: recordRoot } = recordGoverning({ kind: REQUIREMENT, input: requirement(), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    const find = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? find(join(directory, entry.name)) : [join(directory, entry.name)]);
    const witnesses = find(recordRoot).find((file) => file.includes(REQUIREMENT) && file.endsWith(".witnesses"));
    writeFileSync(witnesses, readFileSync(witnesses, "utf8").replace("signed cell typed data", "signed cell typed dada"));
    rmSync(join(recordRoot, "data", "journals", "index"), { recursive: true, force: true });
    const { records, refused } = readGoverning({ repositoryRoot: root, kind: REQUIREMENT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(records.length, 0);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].body.id, "the-board-holds-the-order");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("relayed words are told for and against: the requirement reads contested until its raiser corroborates it", () => {
  const { root, keys } = repository();
  try {
    const recorded = recordGoverning({ kind: REQUIREMENT, input: requirement({ sources: [{ words: "a dispatch said so", relayed: true }] }), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    assert.equal(recorded.charge, "contested");
    assert.throws(() => recordGoverning({ kind: REQUIREMENT, input: requirement({ id: "no-checks", metWhen: [] }), repositoryRoot: root, seat: SEAT, keyDirectory: keys }), /cannot fail/u);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("a check that only finds a file is contested; a check that cannot run is unknown", () => {
  assert.equal(existenceOnly("sh -c 'ls lib/x/*.md >/dev/null 2>&1'"), true);
  assert.equal(existenceOnly("sh -c 'curl -fsS -o /dev/null https://example.org/'"), false);
  const cwd = tmpdir();
  assert.equal(exercise({ cell: "a", command: "true", expectedExit: 0, exercises: "behavior" }, { cwd }).charge, "held");
  assert.equal(exercise({ cell: "a", command: "true", expectedExit: 0, exercises: "existence" }, { cwd }).charge, "contested");
  assert.equal(exercise({ cell: "a", command: "false", expectedExit: 0, exercises: "behavior" }, { cwd }).charge, "denied");
  assert.equal(exercise({ cell: "a", command: "no-such-command-anywhere", expectedExit: 0, exercises: "behavior" }, { cwd }).charge, "unknown");
});

test("an incomplete acceptance conjunct stays active even when evidence charge reads held", () => {
  const { root, keys, journal } = repository();
  try {
    recordGoverning({ kind: REQUIREMENT, input: requirement({
      id: "partial-positive", name: "A healthy service with two receiving conditions",
      metWhen: [
        { cell: "service:local", command: "true" },
        { cell: "service:customer", command: "nonexistent-receiving-command-561" },
      ],
    }), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    recordGoverning({ kind: REQUIREMENT, input: requirement({
      id: "dependent-production", name: "A dependent service begins only after acceptance",
      after: ["partial-positive"], metWhen: [{ cell: "dependent:result", command: "false" }],
    }), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    assert.deepEqual(carryToJuly({
      repositoryRoot: root, schemaDirectory: SCHEMAS, seat: SEAT,
      scratch: mkdtempSync(join(tmpdir(), "scratch-")),
    }).refused, []);
    const result = maintainRequirements({
      repositoryRoot: root, journalRoot: journal, seat: SEAT,
      poster: "requirement-maintenance", keyDirectory: keys,
      at: "2026-10-14T05:00:00.000Z", schemaDirectory: SCHEMAS,
    });
    const partial = result.readings.find((x) => x.requirement === "partial-positive");
    assert.equal(partial.charge, "held"); // FOUR knowledge aggregation retains its original testimony.
    assert.equal(partial.satisfied, false); // Universal behavioral acceptance does not.
    assert.match(result.evidence, /FOUR-held=1 behavior-satisfied=0/u);
    const openings = result.openings.map((row) => row.opening);
    const unreceived = openings.find((row) => row.tags?.includes("requirement-partial-positive"));
    assert.equal(unreceived.move, "request");
    assert.ok(unreceived.tags.includes("completion-unreceived"));
    assert.match(unreceived.context, /NOT complete/u);
    const dependent = openings.find((row) => row.tags?.includes("requirement-dependent-production"));
    assert.match(dependent.context, /Held back after: partial-positive/u);
    const historical = readingsOf({ journalRoot: journal, requirement: "partial-positive" });
    assert.equal(historical.length, 1);
    assert.equal(historical[0].charge, "held");
    assert.equal(historical[0].satisfied, false);
  } finally {
    for (const directory of [root, keys, journal])
      rmSync(directory, { recursive: true, force: true });
  }
});

test("the loop reads every requirement, records signed readings, and opens a request carrying its user for each not held", () => {
  const { root, keys, journal } = repository();
  try {
    recordGoverning({ kind: REQUIREMENT, input: requirement(), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    recordGoverning({ kind: REQUIREMENT, input: requirement({ id: "half-done", name: "The half-done thing is done", metWhen: [
      { cell: "half:runs", command: "true" }, { cell: "half:fails", command: "false" }] }), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    recordGoverning({ kind: REQUIREMENT, input: requirement({ id: "after-half", name: "The thing after is done", after: ["half-done"], metWhen: [{ cell: "after:fails", command: "false" }] }),
      repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    recordGoverning({ kind: RULING, input: { id: "no-plain-json", section: SECTION, raisedBy: "emsenn", ruling: "Everything is signed, cell-typed data.",
      sources: [{ words: "everything should be signed cell typed data" }], checks: [{ cell: "ruling:holds", command: "false" }] }, repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    // The loop reads the July pools: carry the journal there first.
    assert.deepEqual(carryToJuly({ repositoryRoot: root, schemaDirectory: SCHEMAS, seat: SEAT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) }).refused, []);
    const result = maintainRequirements({ repositoryRoot: root, journalRoot: journal, seat: SEAT, poster: "requirement-maintenance", keyDirectory: keys, at: "2026-10-10T02:00:00.000Z", schemaDirectory: SCHEMAS });
    const charges = Object.fromEntries(result.readings.map((reading) => [reading.requirement, reading.charge]));
    assert.deepEqual(charges, { "after-half": "denied", "half-done": "contested", "the-board-holds-the-order": "held" });
    const requests = result.openings.map(({ opening }) => opening).filter((opening) => opening.move === "request");
    assert.equal(requests.length, 2);
    for (const request of requests) assert.equal(request.user, "party:emsenn");
    // Huidu: a contested prerequisite does not hold its dependent back, and the contest is said.
    const after = requests.find((request) => request.tags.includes("requirement-after-half"));
    assert.doesNotMatch(after.context, /Held back after/u);
    assert.match(requests.find((request) => request.tags.includes("requirement-half-done")).context, /Work proceeds under the contest/u);
    const reports = result.openings.map(({ opening }) => opening).filter((opening) => opening.move === "report");
    assert.equal(reports.length, 1);
    assert.equal(reports[0].subject, "ruling:no-plain-json");
    const readings = readingsOf({ journalRoot: journal });
    assert.equal(readings.length, 3);
    assert.ok(readings.every((reading) => reading.seat === SEAT));
  } finally { for (const directory of [root, keys, journal]) rmSync(directory, { recursive: true, force: true }); }
});

test("legacy JSON requirements convert into signed cells without losing their checks or words", () => {
  const { root, keys } = repository();
  try {
    mkdirSync(join(root, SECTION, "content", "requirements"), { recursive: true });
    writeFileSync(join(root, SECTION, "content", "requirements", "legacy-one.json"), JSON.stringify({
      id: "legacy-one", name: "A legacy requirement", kind: "requirement", "raised-by": "emsenn", asks: "[relayed in a dispatch] make it so",
      "met-when": [{ cell: "legacy:file", target: "held", command: "sh -c 'ls README.md >/dev/null 2>&1'", "expected-exit": 0 }],
      "x-provenance": { "relayed-not-quoted": "no Leader sentence located" },
    }));
    const { requirements, refused } = convertRequirements({ repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    assert.deepEqual(refused, []);
    assert.equal(requirements[0].charge, "contested");
    const { records } = readGoverning({ repositoryRoot: root, kind: REQUIREMENT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(records[0].body.metWhen[0].exercises, "existence");
    assert.equal(records[0].body.carriedFrom, `${SECTION}/content/requirements/legacy-one.json`);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("a pull request must name the signed requirement it serves", () => {
  const records = [{ body: { id: "the-board-holds-the-order" } }];
  assert.deepEqual(ordersNamed("Summary\n\nServes: requirement:the-board-holds-the-order, ruling:no-plain-json\n"), ["requirement:the-board-holds-the-order", "ruling:no-plain-json"]);
  assert.equal(pullRequestOrder({ body: "no order here", requirements: records }).ok, false);
  assert.equal(pullRequestOrder({ body: "Serves: requirement:unrecorded-thing", requirements: records }).ok, false);
  assert.equal(pullRequestOrder({ body: "**Serves:** requirement:the-board-holds-the-order", requirements: records }).ok, true);
});

test("a body its type refuses is never recorded", () => {
  const { root, keys } = repository();
  try {
    assert.throws(() => recordGoverning({ kind: REQUIREMENT, input: requirement({ class: "wish" }), repositoryRoot: root, seat: SEAT, keyDirectory: keys }), /class must be one of/u);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("a break class met twice files a requirement to re-architect it", () => {
  const { root, keys } = repository();
  try {
    const scratch = mkdtempSync(join(tmpdir(), "scratch-"));
    const first = recordAssemblyBreak({ repositoryRoot: root, seat: SEAT, keyDirectory: keys, scratch, input: { breakClass: "unexported-interface", evidence: ["feltos -> signcraft/file-history-store"] } });
    assert.equal(first.occurrences, 1);
    assert.equal(first.requirement, undefined);
    const second = recordAssemblyBreak({ repositoryRoot: root, seat: SEAT, keyDirectory: keys, scratch: mkdtempSync(join(tmpdir(), "scratch-")), input: { breakClass: "unexported-interface", evidence: ["signcraft -> immutable-content-custody-service/file-reference"] } });
    assert.equal(second.occurrences, 2);
    assert.equal(second.requirement.id, reArchitectureIdOf("unexported-interface"));
    const { records } = readGoverning({ repositoryRoot: root, kind: REQUIREMENT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(records[0].body.breakClass, "unexported-interface");
    assert.equal(records[0].charge, "contested");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("a design rule's baseline holds today's violations contested, and refuses only new ones", () => {
  const { root, keys } = repository();
  try {
    const records = join(root, SECTION, "data", "records");
    mkdirSync(records, { recursive: true });
    writeFileSync(join(records, "old.json"), "{}");
    execFileSync("git", ["-C", root, "add", "-A"]);
    assert.deepEqual(plainRecordFiles(root), [`${SECTION}/data/records/old.json`]);
    const baseline = recordBaseline({ repositoryRoot: root, rule: "drc-4-signed-cells", violations: plainRecordFiles(root), seat: SEAT, keyDirectory: keys });
    assert.equal(baseline.charge, "contested");
    assert.equal(detect({ repositoryRoot: root, rule: "drc-4-signed-cells", scratch: mkdtempSync(join(tmpdir(), "scratch-")) }).ok, true);
    writeFileSync(join(records, "new.json"), "{}");
    execFileSync("git", ["-C", root, "add", "-A"]);
    const verdict = detect({ repositoryRoot: root, rule: "drc-4-signed-cells", scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.added, [`${SECTION}/data/records/new.json`]);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("the codemod carries requirements, rulings and breaks into the July forms as addressed typed marks", async () => {
  const { root, keys } = repository();
  try {
    recordGoverning({ kind: REQUIREMENT, input: requirement(), repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    recordGoverning({ kind: RULING, input: { id: "everything-is-cell-typed", section: SECTION, raisedBy: "emsenn", ruling: "Everything is signed, cell-typed data.",
      sources: [{ words: "everything should be signed cell typed data", session: "s", at: "2026-10-10" }] }, repositoryRoot: root, seat: SEAT, keyDirectory: keys });
    const scratch = mkdtempSync(join(tmpdir(), "scratch-"));
    recordAssemblyBreak({ repositoryRoot: root, seat: SEAT, keyDirectory: keys, scratch, input: { breakClass: "undeclared-import", evidence: ["a"] } });
    // Before the carry every journal record is named uncarried; after it, none is.
    assert.equal(uncarried({ repositoryRoot: root, schemaDirectory: SCHEMAS, scratch: mkdtempSync(join(tmpdir(), "scratch-")) }).length, 3);
    const carried = carryToJuly({ repositoryRoot: root, schemaDirectory: SCHEMAS, seat: SEAT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.deepEqual(carried.refused, []);
    assert.equal(carried.requirements.length, 1);
    assert.deepEqual(carried.rulings, ["everything-is-cell-typed"]);
    assert.equal(carried.attestations.length, 1);
    assert.deepEqual(uncarried({ repositoryRoot: root, schemaDirectory: SCHEMAS, scratch: mkdtempSync(join(tmpdir(), "scratch-")) }), []);
    // Rewriting a carried requirement (a condition added) keeps it carried.
    const heldPath = `${SECTION}/content/requirements/the-board-holds-the-order.json`;
    const held = JSON.parse(readFileSync(join(root, heldPath), "utf8"));
    writeJuly({ repositoryRoot: root, schemaDirectory: SCHEMAS, kind: "requirement", path: heldPath, seat: SEAT, keyDirectory: keys,
      record: { ...held, "met-when": [...held["met-when"], { cell: "added:condition", target: "held", command: "true", "expected-exit": 0 }] } });
    assert.deepEqual(uncarried({ repositoryRoot: root, schemaDirectory: SCHEMAS, scratch: mkdtempSync(join(tmpdir(), "scratch-")) }), []);
    writeFileSync(join(root, heldPath), JSON.stringify(held, null, 2));
    const types = julyTypes(SCHEMAS);
    const july = JSON.parse(readFileSync(join(root, SECTION, "content", "requirements", "the-board-holds-the-order.json"), "utf8"));
    assert.equal(july.kind, "requirement");
    assert.equal(july["raised-by"], "emsenn");
    assert.equal(july.asks, "everything should be signed cell typed data");
    assert.equal(addressHolds(types, july), true);
    // Idempotent: carrying again changes nothing.
    carryToJuly({ repositoryRoot: root, schemaDirectory: SCHEMAS, seat: SEAT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.deepEqual(JSON.parse(readFileSync(join(root, SECTION, "content", "requirements", "the-board-holds-the-order.json"), "utf8")), july);
    const pools = readPools({ repositoryRoot: root, schemaDirectory: SCHEMAS });
    assert.equal(pools.requirements.length, 1);
    assert.equal(pools.rulings.length, 1);
    assert.equal(pools.rulings[0].body.ruling, "Everything is signed, cell-typed data.");
    // The node's requirements operation reads the same pools the loop reads.
    const requirements = requirementOperations({ dataRoot: mkdtempSync(join(tmpdir(), "node-")), schemaDirectory: SCHEMAS }).find((o) => o.verb === "requirements");
    assert.deepEqual((await requirements.execute({ repositoryRoot: root })).records.map((r) => r.body.id), pools.requirements.map((r) => r.body.id));
    assert.equal((await requirements.execute({ repositoryRoot: root, kind: "ruling" })).records[0].body.ruling, "Everything is signed, cell-typed data.");
    // A ruling's decision corrected by the team (re-addressed) survives a later carry.
    const decisionPath = join(root, REQUIREMENT_SECTION, "content", "decision-records", "everything-is-cell-typed-decision.json");
    const decision = JSON.parse(readFileSync(decisionPath, "utf8"));
    const corrected = addressed(types["decision-record"], { ...decision, decision: "Everything is a SignCell sign." });
    writeFileSync(decisionPath, JSON.stringify(corrected));
    carryToJuly({ repositoryRoot: root, schemaDirectory: SCHEMAS, seat: SEAT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(JSON.parse(readFileSync(decisionPath, "utf8")).decision, "Everything is a SignCell sign.");
    // An edited record no longer holds its address and is refused.
    writeFileSync(join(root, SECTION, "content", "requirements", "the-board-holds-the-order.json"), JSON.stringify({ ...july, asks: "something else" }));
    assert.equal(readPools({ repositoryRoot: root, schemaDirectory: SCHEMAS }).refused.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("the codemod keeps every leaf of a held record, addresses a pool record no journal holds, and names any leaf a carry would lose", () => {
  const { root, keys } = repository();
  try {
    const path = join(root, SECTION, "content", "requirements", "held-by-a-node.json");
    const original = { id: "held-by-a-node", name: "Held by a node", kind: "requirement", "raised-by": "emsenn", asks: "the node recorded this straight into the pool",
      "met-when": [], tier: "minor", note: "a field the July form does not name", requirements: [{ id: "R1", says: "The pool shall keep it." }], "x-provenance": {} };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(original));
    const carried = carryToJuly({ repositoryRoot: root, schemaDirectory: SCHEMAS, seat: SEAT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.deepEqual(carried.refused, []);
    assert.deepEqual(carried.requirements, [`${SECTION}/content/requirements/held-by-a-node.json`]);
    const july = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(addressHolds(julyTypes(SCHEMAS), july), true);
    assert.deepEqual(lostFrom(original, july), []);
    assert.deepEqual(july["x-provenance"]["carried-fields"], { tier: "minor", note: original.note, requirements: original.requirements });
    assert.ok(july["x-provenance"]["pending-conditions"]);
    assert.equal(readPools({ repositoryRoot: root, schemaDirectory: SCHEMAS }).requirements[0].charge, "contested");
    // A carried record missing any leaf of its original is named, leaf by leaf.
    assert.deepEqual(lostFrom(original, { ...july, "x-provenance": { ...july["x-provenance"], "carried-fields": { tier: "minor" } } }), ["note", "requirements.0.id", "requirements.0.says"]);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("requirements committed in a mounted section repository are read, and refused until addressed", () => {
  const { root, keys } = repository();
  const mounted = mkdtempSync(join(tmpdir(), "section-repository-"));
  try {
    const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "protocol.file.allow=always", ...args], { stdio: "pipe" });
    git(mounted, "init", "-q");
    const record = { id: "a-mounted-section-is-measured", name: "A mounted section is measured", kind: "requirement", "raised-by": "emsenn",
      asks: "measure the mounted section too", "met-when": [{ cell: "mounted:measured", target: "held", command: "true", "expected-exit": 0 }],
      "x-provenance": { "recorded-by": SEAT, "recorded-on": "2026-10-10" } };
    mkdirSync(join(mounted, "content", "requirements"), { recursive: true });
    writeFileSync(join(mounted, "content", "requirements", `${record.id}.json`), JSON.stringify(record));
    git(mounted, "add", "-A"); git(mounted, "commit", "-qm", "unaddressed");
    git(root, "submodule", "add", "-q", mounted, `${SECTION}/services/mounted-section`);
    const unaddressed = readPools({ repositoryRoot: root, schemaDirectory: SCHEMAS });
    assert.equal(unaddressed.requirements.length, 0);
    assert.deepEqual(unaddressed.refused.map((r) => r.path), [`${SECTION}/services/mounted-section/content/requirements/${record.id}.json`]);
    const inside = join(root, SECTION, "services", "mounted-section");
    writeJuly({ repositoryRoot: inside, schemaDirectory: SCHEMAS, kind: "requirement", record, path: `content/requirements/${record.id}.json`, seat: SEAT, keyDirectory: keys });
    git(inside, "commit", "-qam", "addressed");
    const read = readPools({ repositoryRoot: root, schemaDirectory: SCHEMAS });
    assert.deepEqual(read.refused, []);
    assert.deepEqual(read.requirements.map((r) => r.body.id), [record.id]);
    assert.equal(read.requirements[0].body.section, `${SECTION}/services/mounted-section`);
  } finally { for (const dir of [root, keys, mounted]) rmSync(dir, { recursive: true, force: true }); }
});

test("a break class attested twice in the July pools files its re-architecture requirement, attested by the seat", () => {
  const { root, keys } = repository();
  try {
    const first = recordAssemblyBreakJuly({ repositoryRoot: root, seat: SEAT, keyDirectory: keys, schemaDirectory: SCHEMAS, input: { breakClass: "divergent-copy", evidence: ["one"] } });
    assert.equal(first.requirement, undefined);
    const second = recordAssemblyBreakJuly({ repositoryRoot: root, seat: SEAT, keyDirectory: keys, schemaDirectory: SCHEMAS, input: { breakClass: "divergent-copy", evidence: ["two"] } });
    assert.equal(second.occurrences, 2);
    const pools = readPools({ repositoryRoot: root, schemaDirectory: SCHEMAS });
    assert.deepEqual(pools.refused, []);
    const filed = pools.requirements.find((read) => read.body.id === reArchitectureIdOf("divergent-copy"));
    assert.ok(filed);
    assert.equal(filed.signature.seat, SEAT);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});

test("the current Coesite source-owned JSON pools bind real reads and writes without reviving legacy paths", () => {
  const { root, keys } = repository();
  const section = "services/requirement-management-operation-services-section";
  const stamp = { "recorded-by": SEAT, "recorded-on": "2026-10-18" };
  const makeRequirement = id => ({
    id, name: id, kind: "requirement", "raised-by": "emsenn", asks: "a requirement remains measurable",
    "met-when": [{ cell: `${id}:runs`, target: "held", command: "true", "expected-exit": 0 }],
    "x-provenance": stamp,
  });
  const sourceFile = "content/requirements/owner-root.json";
  const teamFile = `${section}/content/requirements/team-owned.json`;
  try {
    mkdirSync(join(root, section, "schemas"), { recursive: true });
    for (const kind of ["requirement", "ruling", "decision-record", "quality-attestation"])
      copyFileSync(join(SCHEMAS, `${kind}.schema.json`), join(root, section, "schemas", `${kind}.schema.json`));
    writeJuly({ repositoryRoot: root, kind: "requirement", path: sourceFile, record: makeRequirement("owner-root"), seat: SEAT, keyDirectory: keys });
    writeJuly({ repositoryRoot: root, kind: "requirement", path: teamFile, record: makeRequirement("team-owned"), seat: SEAT, keyDirectory: keys });
    const decision = {
      id: "current-decision", name: "Current decision", decider: "emsenn", status: "decided",
      context: "A decision is required", options: [
        { label: "use", description: "Use the original pool" },
        { label: "ignore", description: "Ignore the original pool" }
      ], decision: "Use the original pool", consequences: "Existing source controls the reader",
      "x-provenance": stamp,
    };
    writeJuly({ repositoryRoot: root, kind: "decision-record", path: `${section}/content/decision-records/current-decision.json`, record: decision, seat: SEAT, keyDirectory: keys });
    writeJuly({ repositoryRoot: root, kind: "ruling", path: `${section}/content/rulings/current-ruling.json`,
      record: { id: "current-ruling", name: "Current ruling", backs: "current-decision", decider: "emsenn",
        "carried-by": "requirements-management-team", quote: "Use the original pool", channel: "test-source",
        "ruled-on": "2026-10-18", "x-provenance": stamp }, seat: SEAT, keyDirectory: keys });
    const pools = readPools({ repositoryRoot: root });
    assert.deepEqual(pools.refused, []);
    assert.deepEqual(pools.requirements.map(item => item.body.id), ["owner-root", "team-owned"]);
    assert.equal(pools.requirements[0].body.section, "services/operations-services-section");
    assert.equal(pools.rulings.length, 1);
    assert.equal(pools.rulings[0].body.ruling, "Use the original pool");
    assert.equal(pools.attestations.length, 0);
    assert.equal(existsSync(join(root, "lib/emsenn")), true); // historical test carrier untouched
    const forged = JSON.parse(readFileSync(join(root, sourceFile), "utf8"));
    writeFileSync(join(root, sourceFile), JSON.stringify({ ...forged, asks: "tampered after signing" }));
    const refused = readPools({ repositoryRoot: root });
    assert.deepEqual(refused.requirements.map(item => item.body.id), ["team-owned"]);
    assert.deepEqual(refused.refused.map(item => item.path), [sourceFile]);
    assert.throws(() => writeJuly({ repositoryRoot: root, kind: "requirement",
      path: "../escaped-owner-root.json", record: makeRequirement("escaped-owner-root"), seat: SEAT, keyDirectory: keys }), /path must lie inside/u);
    assert.equal(existsSync(join(root, "..", "escaped-owner-root.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(keys, { recursive: true, force: true }); }
});
