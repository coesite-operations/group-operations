import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { darkSinceOf, noteDark } from "../src/work-arena-law-operation.mjs";

test("an edition's dark note outlives releases and starts again for another edition", () => {
  const root = mkdtempSync(join(tmpdir(), "work-arena-law-dark-"));
  try {
    assert.equal(darkSinceOf(root, "edition:a"), undefined);
    noteDark(root, "edition:a", "2026-10-03T22:45:00.000Z");
    // A later pass (a newer release, the same edition) keeps the first time.
    noteDark(root, "edition:a", "2026-10-03T23:30:00.000Z");
    assert.equal(darkSinceOf(root, "edition:a"), "2026-10-03T22:45:00.000Z");
    // Another edition realized: the note is its own from now on.
    assert.equal(darkSinceOf(root, "edition:b"), undefined);
    noteDark(root, "edition:b", "2026-10-04T01:00:00.000Z");
    assert.equal(darkSinceOf(root, "edition:b"), "2026-10-04T01:00:00.000Z");
    assert.equal(darkSinceOf(root, "edition:a"), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
