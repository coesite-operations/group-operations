import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRetainedReleaseOutcomes, retainedReleaseObservation, releaseOutcomeBinding, separateReleaseOutcomeCustody } from "../src/retained-release-outcomes.mjs";
import { bindingAt, entryOf, envelope } from "./retained-release-fixtures.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "primary-retained-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binding = bindingAt(root);
  const put = async (value) => {
    const entry = entryOf(value);
    await mkdir(join(root, entry.directory), { recursive: true });
    await writeFile(join(root, entry.directory, "release-outcome.json"), entry.bytes);
    return entry;
  };
  return { root, binding, put };
}

test("custody binding never supplies a default machine, repository or root", () => {
  for (const value of [undefined, {}, bindingAt("/"), bindingAt("relative"), bindingAt("/tmp/../other"), { ...bindingAt("/tmp/fixture"), machine: "" }]) {
    assert.throws(() => releaseOutcomeBinding(value), /explicit/u);
  }
});

test("optional custody cannot be explicitly bound inside the public status tree", () => {
  for (const options of [
    { binding: bindingAt("/public/runner"), journal: { root: "/private/journal" } },
    { binding: bindingAt("/private/runner"), journal: { root: "/public" } },
    { binding: bindingAt("/private/runner"), journal: { root: "/public/knowledge" } },
    { binding: bindingAt("/private/runner"), journal: { root: "/" } },
  ]) assert.throws(() => separateReleaseOutcomeCustody({ statusDirectory: "/public", ...options }), /outside public/u);
  separateReleaseOutcomeCustody({ statusDirectory: "/public", binding: bindingAt("/private/runner"), journal: { root: "/private/journal" } });
  assert.throws(() => separateReleaseOutcomeCustody({ statusDirectory: "/private/data/journals", binding: bindingAt("/runner"), journal: { root: "/private" } }), /outside public/u);
});

test("all retained attempts between pulses are read, including failed pre-invocation and old runs", async (t) => {
  const f = await fixture(t);
  const expected = [await f.put(envelope()), await f.put(envelope({ attempt: "3", absent: true })), await f.put(envelope({ id: "700", attempt: "1" }))];
  const reading = await readRetainedReleaseOutcomes({ binding: f.binding });
  assert.equal(reading.state, "read");
  assert.deepEqual(reading.entries.map((entry) => entry.directory).sort(), expected.map((entry) => entry.directory).sort());
  for (const entry of reading.entries) assert.deepEqual(entry.bytes, expected.find((other) => other.directory === entry.directory).bytes);
});

test("staging and promotion remain producer observations independent of job failure and current health", () => {
  for (const options of [{}, { mode: "deploy", outcome: "success", stage: "live-check" }, { mode: "rollback", outcome: "failure", stage: "switch" }, { absent: true }]) {
    const entry = entryOf(envelope(options)), read = retainedReleaseObservation(bindingAt("/private/fixture"), entry);
    assert.equal(read.reading, "bound-envelope");
    assert.deepEqual(Buffer.from(read.evidence.bytesBase64, "base64"), entry.bytes);
    const retained = JSON.parse(Buffer.from(read.evidence.bytesBase64, "base64"));
    assert.equal(retained.jobOutcome, "failure");
    assert.equal("healthy" in read, false);
    assert.equal("deployed" in read, false);
    assert.equal("accepted" in read, false);
    assert.deepEqual(retained, envelope(options));
    assert.equal("value" in read.evidence, false, "unrestricted parsed JSON is not a journal value");
  }
});

test("mismatched run, attempt, machine, repository, inner digest and parsed value remain unknown with exact bytes", () => {
  for (const change of [
    (v) => { v.run.id = "702"; }, (v) => { v.run.attempt = "03"; }, (v) => { v.machine = "other"; },
    (v) => { v.run.repository = "other/machine"; }, (v) => { v.kind = "receipt"; }, (v) => { v.version = 2; },
    (v) => { v.receipt.sha256 = "f".repeat(64); }, (v) => { v.candidate.value.storePath = "/gnu/store/unobserved"; },
  ]) {
    const value = envelope(); change(value);
    const bytes = Buffer.from(JSON.stringify(value));
    const read = retainedReleaseObservation(bindingAt("/private/fixture"), { directory: "701-2", state: "read", bytes });
    assert.equal(read.reading, "unknown");
    assert.deepEqual(Buffer.from(read.evidence.bytesBase64, "base64"), bytes);
  }
});

test("malformed JSON, scalar JSON, invalid UTF8 and absent bytes never become an attributed receipt", () => {
  for (const bytes of [Buffer.from("{"), Buffer.from("null"), Buffer.from([0xff, 0x7b]), Buffer.alloc(0)]) {
    const read = retainedReleaseObservation(bindingAt("/private/fixture"), { directory: "701-2", state: "read", bytes });
    assert.equal(read.reading, "unknown");
    assert.equal(read.evidence.state, "invalid");
    assert.deepEqual(Buffer.from(read.evidence.bytesBase64, "base64"), bytes);
  }
  const absent = retainedReleaseObservation(bindingAt("/private/fixture"), { directory: "701-2", state: "unknown", reason: "absent-outcome" });
  assert.equal(absent.reading, "unknown");
  assert.equal("evidence" in absent, false);
});

test("absent or empty root, absent outcome, and bounded overflow stay unknown", async (t) => {
  const f = await fixture(t);
  assert.equal((await readRetainedReleaseOutcomes({ binding: bindingAt(join(f.root, "absent")) })).reason, "absent-root");
  assert.equal((await readRetainedReleaseOutcomes({ binding: f.binding })).reason, "no-retained-outcomes");
  await mkdir(join(f.root, "701-2"));
  assert.equal((await readRetainedReleaseOutcomes({ binding: f.binding })).entries[0].reason, "absent-outcome");
  await f.put(envelope());
  assert.equal((await readRetainedReleaseOutcomes({ binding: f.binding, maxBytes: 1 })).entries[0].reason, "oversize-outcome");
  await f.put(envelope({ attempt: "3" }));
  const overflow = await readRetainedReleaseOutcomes({ binding: f.binding, maxEntries: 1 });
  assert.equal(overflow.state, "unknown");
  assert.equal(overflow.reason, "entry-limit");
});

test("symlink root, symlink attempt, symlink outcome and nonregular outcome are refused", async (t) => {
  const f = await fixture(t), outer = join(f.root, "outside");
  await mkdir(outer);
  await writeFile(join(outer, "private.json"), "do-not-read-outside");
  await symlink(outer, join(f.root, "alias"));
  assert.equal((await readRetainedReleaseOutcomes({ binding: bindingAt(join(f.root, "alias")) })).reason, "unreadable-root");
  await symlink(outer, join(f.root, "701-2"));
  await mkdir(join(f.root, "701-3"));
  await symlink(join(outer, "private.json"), join(f.root, "701-3", "release-outcome.json"));
  await mkdir(join(f.root, "701-4", "release-outcome.json"), { recursive: true });
  const reading = await readRetainedReleaseOutcomes({ binding: f.binding });
  assert.equal(reading.entries.length, 3);
  for (const entry of reading.entries) { assert.equal(entry.state, "unknown"); assert.equal("bytes" in entry, false); }
  assert.equal(JSON.stringify(reading).includes("do-not-read-outside"), false);
});
