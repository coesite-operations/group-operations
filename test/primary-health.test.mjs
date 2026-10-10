import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { chargeOf, primaryHealthChanges, runPrimaryHealthPulse } from "../src/primary-health.mjs";

const targets = [
  { id: "cold-red-gate", url: "http://127.0.0.1:18818/healthz", public: "https://cold-red-gate.561.group/healthz", kind: "machine" },
  { id: "bare-cedar-fog", url: "https://bare-cedar-fog.561.group/healthz", kind: "machine" },
  { id: "casino.561.group", url: "https://casino.561.group/", kind: "property" },
];
const response = (status, { body, retryAfter } = {}) => ({
  status, headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}),
  json: async () => body, body: { cancel: async () => {} },
});

test("each answer tells one of the four charges", () => {
  assert.equal(chargeOf({ status: 200 }), "held");
  assert.equal(chargeOf({ status: 308 }), "held");
  assert.equal(chargeOf({ status: 503, retryAfter: "120" }), "contested");
  assert.equal(chargeOf({ status: 503 }), "denied");
  assert.equal(chargeOf({ status: 502 }), "denied");
  assert.equal(chargeOf({ error: "ENOTFOUND" }), "denied");
  assert.equal(chargeOf(undefined), "unknown");
});

test("only a change of charge is a change", () => {
  const previous = { systems: [{ id: "a", charge: "held" }, { id: "b", charge: "denied" }] };
  const current = { at: "t", systems: [{ id: "a", charge: "held" }, { id: "b", charge: "held" }, { id: "c", charge: "denied" }] };
  assert.deepEqual(primaryHealthChanges(previous, current).map((change) => [change.id, change.was, change.charge]), [["b", "denied", "held"], ["c", "unknown", "denied"]]);
});

test("a pulse records each change as a told semantic record and writes the public status", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "primary-health-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const statusDirectory = join(root, "public");
  const journal = createSemanticRecordJournal({ root: join(root, "knowledge"), objectKind: "561-group.primary-system-health" });
  let laptop = 502;
  const probe = async (url) => {
    if (url.startsWith("http://127.0.0.1")) return response(200, { body: { ok: true, release: "abc", deployment: { outcome: "staged", stage: "pre-switch-check" } } });
    if (url.includes("bare-cedar-fog")) return response(laptop);
    return response(503, { retryAfter: "3600" });
  };
  let now = 0;
  const clock = () => `2026-10-10T02:0${now++}:00.000Z`;

  const first = await runPrimaryHealthPulse({ statusDirectory, journal, targets, probe, clock });
  assert.deepEqual(first.changes.map((change) => [change.system, change.charge]), [["cold-red-gate", "held"], ["bare-cedar-fog", "denied"], ["casino.561.group", "contested"]]);
  const written = JSON.parse(readFileSync(join(statusDirectory, "status.json"), "utf8"));
  assert.equal(written.systems[0].deployment.outcome, "staged", "a machine's last deployment outcome is carried");
  assert.equal(written.systems[0].url, "https://cold-red-gate.561.group/healthz", "the public face is shown, not the loopback probe");
  const page = readFileSync(join(statusDirectory, "index.html"), "utf8");
  assert.match(page, /bare-cedar-fog<\/a><\/td><td>not answering/u);
  assert.match(page, /2 of 3 systems are not answering normally/u);

  const second = await runPrimaryHealthPulse({ statusDirectory, journal, targets, probe, clock });
  assert.equal(second.changes.length, 0, "an unchanged pulse records nothing");
  assert.equal(second.status.systems[1].since, "2026-10-10T02:00:00.000Z", "since holds across unchanged pulses");

  laptop = 200;
  const third = await runPrimaryHealthPulse({ statusDirectory, journal, targets, probe, clock });
  assert.deepEqual(third.changes.map((change) => [change.system, change.was, change.charge]), [["bare-cedar-fog", "denied", "held"]]);

  const records = journal.query({ category: "primary-system-health" });
  assert.equal(records.length, 4, "the journal holds what changed, not every pulse");
  const laptopRecords = records.filter((row) => row.record.system === "bare-cedar-fog");
  assert.deepEqual(laptopRecords.map((row) => row.told), [{ for: false, against: true }, { for: true, against: false }]);
});
