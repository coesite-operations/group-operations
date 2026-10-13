import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { bookSha256Of, judgmentBookReceivingOf, latestRecordedEconomy, readReceivedEntityBooks } from "../src/acceptance-reading.mjs";

async function fixture(t, changes = {}) {
  const webData = await mkdtemp(join(tmpdir(), "acceptance-reading-"));
  t.after(() => rm(webData, { recursive: true, force: true }));
  const bookPath = join(webData, "books", "561-group-llc-judged-deliveries.beancount");
  const receiptPath = join(webData, "records", "acceptance", "2026-W42-to-date-acceptance-readout.json");
  const body = '; synthetic received judgment book\n';
  await mkdir(dirname(bookPath), { recursive: true });
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(bookPath, body);
  const receipt = { type: "GroupAcceptanceReadout", version: 1, asOf: "2026-10-13T12:00:00.000Z", week: "2026-W42",
    book: bookPath, bookSha256: bookSha256Of(body), journal: { excluded: ["x402-settlement"] },
    economy: { kind: "organizing.enterprise.economy", crossings: {} }, ...changes };
  await writeFile(receiptPath, JSON.stringify(receipt));
  return { webData, bookPath, receiptPath, receipt, body, asOf: "2026-10-13T12:30:00.000Z" };
}

test("existing receiver receipt admits the exact book bytes and retains its cutoff", async (t) => {
  const f = await fixture(t);
  const result = await readReceivedEntityBooks({ ...f, read: async () => ({ body: await readFile(f.bookPath, "utf8") }) });
  assert.equal(result.body, f.body);
  assert.equal(result.judgmentBookReceiving.observedAt, f.receipt.asOf);
  assert.equal(result.judgmentBookReceiving.bookSha256, bookSha256Of(f.body));
  assert.equal(result.judgmentBookReceiving.state, "current");
  assert.equal((await latestRecordedEconomy(f.webData, { asOf: f.asOf })).recordedAt, f.receipt.asOf);
});

test("a newer completed-week receiving owns the same book and is selected by its actual date", async (t) => {
  const f = await fixture(t);
  const body = '; newer completed-week receiver projection\n';
  await writeFile(f.bookPath, body);
  const received = { ...f.receipt, asOf: "2026-10-13T12:15:00.000Z", week: "2026-W41", complete: true, bookSha256: bookSha256Of(body) };
  await writeFile(join(dirname(f.receiptPath), "2026-W41-acceptance-readout.json"), JSON.stringify(received));
  assert.equal((await judgmentBookReceivingOf(f)).observedAt, received.asOf);
});

test("missing and legacy marker-only receiving never invoke the consolidated reader", async (t) => {
  const f = await fixture(t, { bookSha256: undefined });
  let reads = 0;
  const input = { ...f, read: async () => { reads += 1; return {}; } };
  await assert.rejects(readReceivedEntityBooks(input), /does not bind this book's bytes/u);
  await rm(f.receiptPath);
  await assert.rejects(readReceivedEntityBooks(input), /no x402-excluding acceptance receiver receipt/u);
  assert.equal(reads, 0);
});

test("wrong owner path, type, version and unqualified exclusion markers are refused", async (t) => {
  const f = await fixture(t);
  for (const changes of [{ book: join(f.webData, "other.beancount") }, { type: "OtherReadout" }, { version: 2 }, { journal: { excluded: "x402-settlement" } }, { journal: { excluded: [] } }]) {
    await writeFile(f.receiptPath, JSON.stringify({ ...f.receipt, ...changes }));
    await assert.rejects(judgmentBookReceivingOf(f));
  }
});

test("legacy or replaced book bytes cannot be relabeled by a clean receiver marker", async (t) => {
  const f = await fixture(t);
  await writeFile(f.bookPath, '2026-10-13 * "legacy cash-as-delivery"\n  source: "x402-settlement"\n');
  await assert.rejects(judgmentBookReceivingOf(f), /changed after its acceptance receiver receipt/u);
});

test("concurrent book or receipt changes refuse the reading", async (t) => {
  const f = await fixture(t);
  await assert.rejects(readReceivedEntityBooks({ ...f, read: async () => {
    await writeFile(f.bookPath, '; concurrent replacement\n');
    return {};
  } }), /changed after its acceptance receiver receipt/u);
  await writeFile(f.bookPath, f.body);
  await assert.rejects(readReceivedEntityBooks({ ...f, read: async () => {
    await writeFile(f.receiptPath, JSON.stringify({ ...f.receipt, asOf: "2026-10-13T12:01:00.000Z" }));
    return {};
  } }), /receiving changed during consolidated reading/u);
});

test("old evidence stays stale at its original cutoff; missing, malformed and future cutoffs are refused", async (t) => {
  const f = await fixture(t);
  assert.equal((await judgmentBookReceivingOf({ ...f, asOf: "2026-10-14T12:00:00.000Z" })).state, "current");
  assert.equal((await judgmentBookReceivingOf({ ...f, asOf: "2026-10-14T12:00:00.001Z" })).state, "stale");
  for (const asOf of [undefined, "bad-date", "2026-10-14T12:00:00.000Z"]) {
    await writeFile(f.receiptPath, JSON.stringify({ ...f.receipt, asOf }));
    await assert.rejects(judgmentBookReceivingOf(f), /cutoff/u);
  }
});

test("a book replaced and restored during consolidation does not pass on equal final bytes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(readReceivedEntityBooks({ ...f, read: async () => {
    await writeFile(f.bookPath, '; temporary legacy projection\n');
    const body = await readFile(f.bookPath, "utf8");
    await writeFile(f.bookPath, f.body);
    return { body };
  } }), /receiving changed during consolidated reading/u);
});

test("economy uses the same qualified receiver cutoff and does not admit future or legacy receipts", async (t) => {
  const f = await fixture(t);
  const old = await latestRecordedEconomy(f.webData, { asOf: "2026-10-14T12:00:00.001Z" });
  assert.equal(old.receiving.state, "stale");
  assert.equal(old.recordedAt, f.receipt.asOf);
  for (const changes of [{ asOf: "2026-10-14T12:00:00.000Z" }, { type: "OtherReadout" }, { version: 2 }, { journal: {} }]) {
    await writeFile(f.receiptPath, JSON.stringify({ ...f.receipt, ...changes }));
    await assert.rejects(latestRecordedEconomy(f.webData, { asOf: f.asOf }));
  }
});
