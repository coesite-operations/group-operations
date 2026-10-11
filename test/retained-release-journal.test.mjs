// Distinct private-receiving regressions against the genuine journal provider.
// No original primary-health integration test, network, host or deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { runPrimaryHealthPulse } from "../src/primary-health.mjs";
import { receiveRetainedReleaseOutcomes, readRetainedReleaseOutcomes, retainedReleaseObservation, RELEASE_OUTCOME_CATEGORY, RELEASE_OUTCOME_OBJECT_KIND, MAX_RETAINED_OUTCOME_BYTES } from "../src/retained-release-outcomes.mjs";
import { bindingAt, entryOf, envelope } from "./retained-release-fixtures.mjs";

const query = { objectKind: RELEASE_OUTCOME_OBJECT_KIND, category: RELEASE_OUTCOME_CATEGORY };
const firstAt = "2026-10-10T04:01:00.000Z", nextAt = "2026-10-10T04:06:00.000Z";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "primary-retained-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outcomeRoot = join(root, "runner-custody"), journalRoot = join(root, "knowledge"), statusDirectory = join(root, "public");
  await mkdir(outcomeRoot); await mkdir(journalRoot, { mode: 0o700 });
  const journal = createSemanticRecordJournal({ root: journalRoot, objectKind: "561-group.primary-system-health" });
  const binding = bindingAt(outcomeRoot);
  const put = async (value) => {
    const entry = entryOf(value);
    await mkdir(join(outcomeRoot, entry.directory), { recursive: true });
    await writeFile(join(outcomeRoot, entry.directory, "release-outcome.json"), entry.bytes);
    return entry;
  };
  return { root, binding, journalRoot, journal, statusDirectory, put,
    retainedReleaseOutcomes: { binding, read: readRetainedReleaseOutcomes } };
}

test("real journal receives every retained attempt and replays unchanged content with the same event and timestamp", async (t) => {
  const f = await fixture(t);
  await f.put(envelope()); await f.put(envelope({ attempt: "3", absent: true })); await f.put(envelope({ id: "702", attempt: "1", mode: "deploy", outcome: "success", stage: "live-check" }));
  const first = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: firstAt });
  assert.equal(first.recorded, 3);
  const before = f.journal.query(query);
  assert.equal(before.length, 3);
  const restart = createSemanticRecordJournal({ root: f.journalRoot, objectKind: "561-group.primary-system-health" });
  const second = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: restart, at: nextAt });
  assert.equal(second.recorded, 0); assert.equal(second.replayed, 3);
  assert.deepEqual(restart.query(query), before);
  for (const row of before) assert.equal(row.recordedAt, firstAt);
});

test("journal-ahead/public-status-behind interruption replays the actual pulse without creating another outcome witness", async (t) => {
  const f = await fixture(t); await f.put(envelope());
  // A private evidence admission succeeds; the subsequent existing public file
  // write fails at a new isolated fixture directory. No journal provider stub.
  await mkdir(join(f.statusDirectory, "status.json.tmp"), { recursive: true });
  const options = { statusDirectory: f.statusDirectory, journal: f.journal, targets: [], probe: () => { throw new Error("network must not be called"); }, retainedReleaseOutcomes: f.retainedReleaseOutcomes };
  await assert.rejects(runPrimaryHealthPulse({ ...options, clock: () => firstAt }), { code: "EISDIR" });
  const before = f.journal.query(query); assert.equal(before.length, 1);
  await rm(join(f.statusDirectory, "status.json.tmp"), { recursive: true });
  const result = await runPrimaryHealthPulse({ ...options, clock: () => nextAt });
  assert.equal(result.releaseOutcomes.replayed, 1);
  assert.deepEqual(f.journal.query(query), before);
  assert.deepEqual(JSON.parse(await readFile(join(f.statusDirectory, "status.json"), "utf8")), { at: nextAt, systems: [] });
  for (const file of ["status.json", "index.html"]) {
    const bytes = await readFile(join(f.statusDirectory, file), "utf8");
    for (const privateValue of ["private-evidence-sentinel", "private-candidate", "bytesBase64", f.binding.root, "retained-machine-release-outcome"]) assert.equal(bytes.includes(privateValue), false, `${file} discloses ${privateValue}`);
  }
});

test("interruption after genuine record but before its caller receives acknowledgement recovers exact event", async (t) => {
  const f = await fixture(t); await f.put(envelope());
  const interrupted = { ...f.journal, record: (request) => { f.journal.record(request); throw new Error("fixture interruption after journal return"); } };
  await assert.rejects(receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: interrupted, at: firstAt }), /fixture interruption/u);
  const before = f.journal.query(query); assert.equal(before.length, 1);
  const retry = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: nextAt });
  assert.equal(retry.replayed, 1); assert.deepEqual(f.journal.query(query), before);
});

test("equal existing content replays nondefault origin and genuine causal witness without a new event", async (t) => {
  const f = await fixture(t), entry = await f.put(envelope());
  const cause = f.journal.record({ ...query, category: "fixture-cause", record: { fixture: "real admitted cause" }, recordedAt: firstAt, told: { for: true, against: false } });
  f.journal.record({ ...query, record: retainedReleaseObservation(f.binding, entry), recordedAt: firstAt,
    told: { for: true, against: false }, origin: "fixture-independent-observer", causes: cause.events });
  const before = f.journal.query(query); assert.equal(before.length, 1);
  assert.equal(before[0].origin, "fixture-independent-observer"); assert.deepEqual(before[0].causes, cause.events);
  const result = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: nextAt });
  assert.equal(result.replayed, 1); assert.deepEqual(f.journal.query(query), before);
});

test("an equal legacy-shaped record without witness provenance cannot earn a replay acknowledgement", async (t) => {
  const f = await fixture(t), entry = entryOf(); let wrote = false;
  const record = retainedReleaseObservation(f.binding, entry);
  // Explicit response-contract fixture; no claim that this is real admission.
  const legacyView = { query: () => [{ record, recordedAt: firstAt, id: "legacy-content-id" }], record: () => { wrote = true; } };
  await assert.rejects(receiveRetainedReleaseOutcomes({ binding: f.binding, journal: legacyView, at: nextAt,
    read: async () => ({ state: "read", entries: [entry] }) }), /no replayable witness provenance/u);
  assert.equal(wrote, false);
});

test("conflicting bytes stay beside the first record without replacing or reinterpreting its charge", async (t) => {
  const f = await fixture(t); const first = await f.put(envelope());
  await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: firstAt });
  const original = f.journal.query(query)[0];
  await f.put(envelope({ mode: "deploy", outcome: "success", stage: "live-check" }));
  const conflict = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: nextAt });
  assert.equal(conflict.state, "unknown"); assert.equal(conflict.conflicts, 1);
  const rows = f.journal.query(query); assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], original); assert.deepEqual(rows[1].told, { for: true, against: true });
  assert.deepEqual(Buffer.from(rows[0].record.evidence.bytesBase64, "base64"), first.bytes);
  await f.put(envelope());
  const reread = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: "2026-10-10T04:11:00.000Z" });
  assert.equal(reread.conflicts, 1); assert.equal(reread.replayed, 1); assert.deepEqual(f.journal.query(query), rows);
});

test("readable malformed bytes are private unknown evidence and later valid evidence remains separately recoverable", async (t) => {
  const f = await fixture(t); const entry = await f.put(envelope());
  const file = join(f.binding.root, entry.directory, "release-outcome.json");
  await writeFile(file, Buffer.from([0xff, 0x7b]));
  const malformed = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: firstAt });
  assert.equal(malformed.unknown, 1);
  const before = f.journal.query(query)[0]; assert.deepEqual(before.told, { for: false, against: false });
  assert.deepEqual(Buffer.from(before.record.evidence.bytesBase64, "base64"), Buffer.from([0xff, 0x7b]));
  await f.put(envelope());
  const later = await receiveRetainedReleaseOutcomes({ ...f.retainedReleaseOutcomes, journal: f.journal, at: nextAt });
  assert.equal(later.conflicts, 1); assert.equal(f.journal.query(query).length, 2);
  assert.deepEqual(f.journal.query(query)[0], before);
});

test("pathological parsed JSON stays bounded raw evidence in the actual journal without storing its parsed value", async (t) => {
  const f = await fixture(t);
  const sources = ['{"x":1e400}', '{"x":-0}', '{"x":"\\ud800"}', '{"x":' + '['.repeat(150) + '0' + ']'.repeat(150) + '}'];
  const entries = sources.map((text, index) => ({ directory: `710-${index + 1}`, state: "read", bytes: Buffer.from(text) }));
  const result = await receiveRetainedReleaseOutcomes({ binding: f.binding, journal: f.journal, at: firstAt, read: async () => ({ state: "read", entries }) });
  assert.equal(result.recorded, 4); assert.equal(result.unknown, 4);
  const rows = f.journal.query(query); assert.equal(rows.length, 4);
  for (const entry of entries) {
    const row = rows.find((row) => row.record.locator.file.startsWith(entry.directory + "/"));
    assert.equal("value" in row.record.evidence, false);
    assert.deepEqual(Buffer.from(row.record.evidence.bytesBase64, "base64"), entry.bytes);
  }
});

test("journal-compatible maximum bytes remain exact; oversize original stays unknown without blocking later attempts", async (t) => {
  const f = await fixture(t), entry = await f.put(envelope());
  const exact = Buffer.alloc(MAX_RETAINED_OUTCOME_BYTES, 0x20); exact[0] = 0x7b;
  await writeFile(join(f.binding.root, entry.directory, "release-outcome.json"), exact);
  const oversized = Buffer.alloc(MAX_RETAINED_OUTCOME_BYTES + 1, 0x78);
  const second = await f.put(envelope({ attempt: "3" }));
  await writeFile(join(f.binding.root, second.directory, "release-outcome.json"), oversized);
  await f.put(envelope({ attempt: "4" }));
  const result = await runPrimaryHealthPulse({ statusDirectory: f.statusDirectory, journal: f.journal,
    retainedReleaseOutcomes: f.retainedReleaseOutcomes, targets: [], clock: () => firstAt });
  assert.equal(result.releaseOutcomes.recorded, 3); assert.equal(result.releaseOutcomes.unknown, 2);
  const rows = f.journal.query(query), first = rows.find((row) => row.record.locator.attempt === "2");
  assert.deepEqual(Buffer.from(first.record.evidence.bytesBase64, "base64"), exact);
  const over = rows.find((row) => row.record.locator.attempt === "3");
  assert.equal(over.record.reason, "oversize-outcome"); assert.equal("evidence" in over.record, false);
  assert.deepEqual(await readFile(join(f.binding.root, second.directory, "release-outcome.json")), oversized);
  assert.equal(rows.find((row) => row.record.locator.attempt === "4").record.reading, "bound-envelope");
  assert.deepEqual(JSON.parse(await readFile(join(f.statusDirectory, "status.json"), "utf8")), { at: firstAt, systems: [] });
});

test("default pulse never reads the private custody or creates outcome records", async (t) => {
  const f = await fixture(t); await f.put(envelope());
  const result = await runPrimaryHealthPulse({ statusDirectory: f.statusDirectory, journal: f.journal, targets: [], clock: () => firstAt });
  assert.equal("releaseOutcomes" in result, false); assert.deepEqual(f.journal.query(query), []);
});

test("unknown reader failures retain no fabricated attempt and journal failures are not acknowledged", async (t) => {
  const f = await fixture(t);
  const failure = await receiveRetainedReleaseOutcomes({ binding: f.binding, journal: f.journal, at: firstAt, read: async () => { throw new Error("private-path diagnostic"); } });
  assert.equal(failure.state, "unknown"); assert.equal(failure.reason, "reader-unavailable"); assert.equal(failure.observed, 0);
  assert.equal(JSON.stringify(failure).includes("private-path"), false);
  const supplied = await receiveRetainedReleaseOutcomes({ binding: f.binding, journal: f.journal, at: firstAt,
    read: async () => ({ state: "unknown", reason: "/private/runner/diagnostic", entries: [] }) });
  assert.equal(supplied.reason, "reader-unavailable"); assert.equal(JSON.stringify(supplied).includes("/private"), false);
  const entry = entryOf();
  await assert.rejects(receiveRetainedReleaseOutcomes({ binding: f.binding, at: firstAt, read: async () => ({ state: "read", entries: [entry] }), journal: { query: f.journal.query, record: () => { throw new Error("fixture journal unavailable"); } } }), /fixture journal unavailable/u);
  assert.deepEqual(f.journal.query(query), []);
});
