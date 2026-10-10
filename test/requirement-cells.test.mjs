import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { REQUIREMENT, RULING, existenceOnly, readGoverning, recordGoverning } from "../src/requirement-cells.mjs";
import { exercise, maintainRequirements, readingsOf } from "../src/requirement-maintenance.mjs";
import { convertRequirements } from "../src/requirement-conversion.mjs";
import { ordersNamed, pullRequestOrder } from "../src/requirement-orders.mjs";

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
    assert.match(recorded.root, /561-group-services-section\/data\/requirements\/the-board-holds-the-order$/u);
    const { records, refused } = readGoverning({ repositoryRoot: root, kind: REQUIREMENT, scratch: mkdtempSync(join(tmpdir(), "scratch-")) });
    assert.equal(refused.length, 0);
    assert.equal(records.length, 1);
    assert.equal(records[0].body.asks, "everything should be signed cell typed data");
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
    const result = maintainRequirements({ repositoryRoot: root, journalRoot: journal, seat: SEAT, poster: "requirement-maintenance", keyDirectory: keys, at: "2026-10-10T02:00:00.000Z" });
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
