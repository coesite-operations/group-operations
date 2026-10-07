import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { personasRootOf, readReachRecords, reachReadoutOf } from "../src/reach-readout.mjs";

const at = (day, hour = 12) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const reading = (site, day, views, hits) => ({ site, at: at(day), views, hits, updatedAt: null });
const window = { from: at(1, 0), to: at(8, 0) };

test("each face's latest reading and its change over the window, from the readings alone", () => {
  const { faces } = reachReadoutOf([
    reading("sigridsong", 5, 30, 90), reading("sigridsong", 2, 10, 20), reading("sigridsong", 7, 45, 120), reading("sigridsong", 9, 99, 99),
    reading("other", 3, 5, 5), reading("other", 6, 8, 11),
  ], window);
  assert.deepEqual(faces.map((face) => ({ ...face, delta: face.delta && { ...face.delta } })), [
    { site: "other", at: at(6), views: 8, hits: 11, delta: { views: 3, hits: 6, since: at(3) } },
    { site: "sigridsong", at: at(7), views: 45, hits: 120, delta: { views: 35, hits: 100, since: at(2) } },
  ]);
});

test("the change is measured from the last reading before the window, and a lone reading tells no change", () => {
  const { faces } = reachReadoutOf([reading("a", 1, 4, 4), { ...reading("a", 2, 10, 12), at: "2026-09-30T12:00:00.000Z" }, reading("a", 4, 15, 20), reading("lone", 4, 7, 7)], window);
  const [a, lone] = faces;
  assert.deepEqual({ ...a.delta }, { views: 5, hits: 8, since: "2026-09-30T12:00:00.000Z" });
  assert.equal(lone.delta, null);
  assert.equal(lone.views, 7);
  assert.deepEqual(reachReadoutOf([reading("late", 9, 1, 1), { site: "bad" }], window).faces, []);
});

test("the readings are read from each persona's reach records, damaged lines skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "reach-readout-"));
  try {
    const directory = join(root, "services", "sigrid-song-services-section", "data", "records", "reach");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "sigridsong.jsonl"), `${JSON.stringify(reading("sigridsong", 2, 1, 2))}\n{torn\n${JSON.stringify(reading("sigridsong", 3, 4, 8))}\n`);
    const readings = readReachRecords(join(root, "services"));
    assert.deepEqual(readings.map((row) => row.views), [1, 4]);
    assert.equal(readings[0].persona, "sigrid-song-services-section");
    assert.deepEqual(readReachRecords(join(root, "nowhere")), []);
    assert.match(personasRootOf({ METROPLAT_DATA_ROOT: "/x/561-group-services-section" }), /\/x\/public-services-section\/.*public-personality-services-section\/services$/u);
    assert.equal(personasRootOf({}), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
