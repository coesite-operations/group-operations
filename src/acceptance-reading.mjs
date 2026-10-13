// Read the existing acceptance receiver's retained projection. This module never
// receives judgments, rebuilds a book or treats a financial readout as receiving.
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const bookSha256Of = (body) => createHash("sha256").update(body).digest("hex");

export async function latestRecordedAcceptance(webData) {
  const directory = join(webData, "records", "acceptance");
  let names;
  try { names = await readdir(directory); } catch { return undefined; }
  const receipts = [];
  // Both completed and current-week receiving rewrite the same derived book.
  for (const name of names.filter((entry) => entry.endsWith("-acceptance-readout.json"))) {
    const path = join(directory, name);
    const readout = JSON.parse(await readFile(path, "utf8"));
    if (typeof readout.asOf !== "string" || !Number.isFinite(Date.parse(readout.asOf))) throw new Error("acceptance receiver cutoff is invalid");
    receipts.push({ path, readout });
  }
  receipts.sort((a, b) => Date.parse(a.readout.asOf) - Date.parse(b.readout.asOf) || a.path.localeCompare(b.path));
  return receipts.length === 0 ? undefined : Object.freeze(receipts.at(-1));
}

function qualifyAcceptanceReceiving(received, asOf) {
  const readout = received?.readout;
  if (readout?.type !== "GroupAcceptanceReadout" || readout.version !== 1
    || !Array.isArray(readout.journal?.excluded) || !readout.journal.excluded.includes("x402-settlement")) {
    throw new Error("no x402-excluding acceptance receiver receipt");
  }
  const observed = Date.parse(readout.asOf), cutoff = Date.parse(asOf);
  if (typeof readout.asOf !== "string" || typeof asOf !== "string" || !Number.isFinite(observed) || !Number.isFinite(cutoff) || observed > cutoff) {
    throw new Error("acceptance receiver cutoff is missing, invalid or after the financial readout");
  }
  return Object.freeze({ source: received.path, observedAt: readout.asOf,
    state: cutoff - observed > 86_400_000 ? "stale" : "current" });
}

/** Bind the actual derived book bytes to the existing receiver's receipt/cutoff. */
export async function judgmentBookReceivingOf({ webData, bookPath, asOf }) {
  const received = await latestRecordedAcceptance(webData);
  const receiving = qualifyAcceptanceReceiving(received, asOf);
  const readout = received.readout;
  if (typeof readout.book !== "string" || resolve(readout.book) !== resolve(bookPath)
    || typeof readout.bookSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(readout.bookSha256)) {
    throw new Error("judgment book receiver receipt does not bind this book's bytes");
  }
  if (bookSha256Of(await readFile(bookPath)) !== readout.bookSha256) {
    throw new Error("judgment book changed after its acceptance receiver receipt");
  }
  return Object.freeze({ ...receiving, book: readout.book, bookSha256: readout.bookSha256 });
}

/** Refuse a consolidated reading if its receiver-bound book changes during it. */
export async function readReceivedEntityBooks({ webData, bookPath, asOf, read }) {
  const input = { webData, bookPath, asOf };
  const fileState = async () => {
    const value = await stat(bookPath, { bigint: true });
    return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
  };
  const before = await fileState();
  const received = await judgmentBookReceivingOf(input);
  if (await fileState() !== before) throw new Error("judgment book changed during receiving validation");
  const reading = await read();
  const after = await judgmentBookReceivingOf(input);
  if (JSON.stringify(after) !== JSON.stringify(received) || await fileState() !== before) throw new Error("judgment book receiving changed during consolidated reading");
  return Object.freeze({ ...reading, judgmentBookReceiving: received });
}

/** The economy the existing acceptance receiver recorded, at its actual cutoff. */
export async function latestRecordedEconomy(webData, { asOf = new Date().toISOString() } = {}) {
  const received = await latestRecordedAcceptance(webData);
  if (received === undefined) return undefined;
  const receiving = qualifyAcceptanceReceiving(received, asOf);
  const readout = received.readout;
  return readout.economy === undefined ? undefined : Object.freeze({ ...readout.economy, week: readout.week,
    recordedAt: readout.asOf, receiving });
}
