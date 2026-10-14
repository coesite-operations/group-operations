import { mkdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { put, each } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { open, posting, transaction } from "@red-cup-engineering/organizing/accounting/ledger";
import { printEntries } from "@red-cup-engineering/organizing/accounting/report";
import { gradedOfDecimal, gradedNegate } from "@red-cup-engineering/exact-number-data-service/graded";

// Exact cash and ownership coordinates; response preparation is a separate observation.
const cashCoordinates = row => JSON.stringify([row.sourceId, row.transactionHash, row.logIndex, row.network,
  row.asset, row.payer, row.receiver, row.amount, row.amountUsdc, row.blockTime, row.sku,
  row.seller?.enterprise, row.seller?.entity, row.seller?.record?.path, row.seller?.record?.sha256,
  row.book?.enterprise, row.book?.account, row.attribution, row.attributionReason, row.evidenceId, row.witnessId]);

// Reuse the existing native semantic journal rather than adding a parallel
// settlement database or inferring income from provider acknowledgments.
// The upstream SEAVT store uses one content-addressed record type under
// the receiving node's existing data/records tree. No journal sidecar,
// second ledger, or legacy createSemanticRecordJournal adapter is admitted.
const CASH_RECEIVING_KIND = "seller-payment-receiving";
function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }

/** A typed corroboration proves a transfer claim, not delivery or income.
 * The compact hash anchors the complete set of confirmed source identities
 * without placing payer addresses or an unbounded receipt list in a readout. */
function cashObservationOf(corroboration) {
  if (corroboration?.type !== "X402SellerCorroboration" || corroboration.version !== 3 ||
      !["current", "current-empty"].includes(corroboration.state) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(corroboration.observedAt ?? "") ||
      !Number.isFinite(Date.parse(corroboration.observedAt))) return null;
  const counts = ["witnessCount", "receiptVerifiedCount", "confirmedCount", "attributionRefusedCount", "refusedCount"];
  if (!counts.every((name) => validCount(corroboration[name])) || corroboration.refusedCount !== 0 ||
      corroboration.confirmedCount > corroboration.receiptVerifiedCount ||
      corroboration.receiptVerifiedCount > corroboration.witnessCount ||
      corroboration.attributionRefusedCount > corroboration.confirmedCount ||
      !Array.isArray(corroboration.settlements) ||
      corroboration.settlements.length !== corroboration.confirmedCount ||
      (corroboration.state === "current-empty" && corroboration.witnessCount !== 0)) return null;
  const sourceIds = corroboration.settlements.map((row) => row?.sourceId);
  if (sourceIds.some((id, i) => typeof id !== "string" || !/^evm:eip155:8453:/u.test(id) ||
      corroboration.settlements[i]?.paymentConfirmed !== true) ||
      new Set(sourceIds).size !== sourceIds.length) return null;
  const sourceSetDigest = "ni:///sha-256;" +
    createHash("sha256").update(JSON.stringify([...sourceIds].sort())).digest("base64url");
  return Object.freeze({
    type: "X402SellerPaymentObservation", version: 1,
    observedAt: corroboration.observedAt, state: corroboration.state,
    witnessCount: corroboration.witnessCount,
    receiptVerifiedCount: corroboration.receiptVerifiedCount,
    confirmedCount: corroboration.confirmedCount,
    attributionRefusedCount: corroboration.attributionRefusedCount,
    refusedCount: corroboration.refusedCount, sourceSetDigest,
    customerAcceptance: "unobserved", revenueRecognized: false,
  });
}

/** Record only a complete, independently corroborated seller observation.
 * The Red Cup source remains responsible for independently observing R2 and
 * Base; Coesite stores a compact, NI-addressed receipt, never raw payment
 * credentials or a customer judgment. */
export function recordQualifiedSellerPaymentObservation(privateData, corroboration) {
  if (typeof privateData !== "string" || privateData.trim() === "") {
    throw new TypeError("seller payment observation requires the receiving node's private data root");
  }
  const record = cashObservationOf(corroboration);
  if (record === null) return Object.freeze({
    state: "held", reason: "complete-independent-corroboration-required",
    revenueRecognized: false,
  });
  const address = put(privateData, CASH_RECEIVING_KIND, record);
  return Object.freeze({ state: "recorded", id: address,
    observedAt: record.observedAt, confirmedCount: record.confirmedCount,
    revenueRecognized: false });
}

/** Native read-only discovery. A record after the report's cutoff cannot be
 * backdated by refreshing the report; the source's original instant stands. */
export function latestQualifiedSellerPaymentObservation(privateData, { asOf } = {}) {
  if (typeof privateData !== "string" || privateData.trim() === "") return undefined;
  const cutoff = Date.parse(asOf ?? "");
  if (!Number.isFinite(cutoff)) throw new TypeError("cash receiver reading requires a valid asOf");
  const eligible = [...each(privateData, CASH_RECEIVING_KIND, { strict: true })]
    .filter(({ record }) => {
      const observed = Date.parse(record?.observedAt ?? "");
      return record?.type === "X402SellerPaymentObservation" &&
        record.version === 1 && record.revenueRecognized === false &&
        typeof record.sourceSetDigest === "string" &&
        /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(record.sourceSetDigest) &&
        Number.isFinite(observed) && observed <= cutoff &&
        ["current", "current-empty"].includes(record.state);
    })
    .sort((a, b) => Date.parse(a.record.observedAt) - Date.parse(b.record.observedAt));
  const latest = eligible.at(-1);
  return latest === undefined ? undefined : Object.freeze({
    path: latest.address, value: latest.record,
  });
}

/** Informational receipt projections, grouped by the transaction-time declared seller.
 * Cash corroboration does not admit an enterprise book, recognize revenue, or judge delivery.
 * Qualified enterprise receiving and clearing remain separate acts. */
export function sellerPaymentBooksOf(settlements, { booked = new Set() } = {}) {
  const seen = new Map(), groups = new Map(), alreadyRepresented = [];
  for (const settlement of settlements) {
    if (settlement?.paymentConfirmed !== true || !/^evm:eip155:8453:/u.test(settlement.sourceId ?? "") ||
        !/^[0-9]+(?:\.[0-9]{1,6})?$/u.test(settlement.amountUsdc ?? "") ||
        !/^\d{4}-\d\d-\d\dT/u.test(settlement.blockTime ?? "")) throw new TypeError("cash books require corroborated Base USDC evidence");
    const held = seen.get(settlement.sourceId);
    if (held) {
      if (cashCoordinates(held) !== cashCoordinates(settlement)) throw new TypeError("conflicting cash evidence for one transfer");
      continue;
    }
    seen.set(settlement.sourceId, settlement);
    if (booked.has(settlement.sourceId)) { alreadyRepresented.push(settlement.sourceId); continue; }
    const enterprise = settlement.seller?.enterprise ?? null;
    if (enterprise !== null && (!/^[a-z0-9][a-z0-9-]*$/u.test(enterprise) || settlement.book?.enterprise !== enterprise)) {
      throw new TypeError("cash attribution must preserve the declared seller book");
    }
    const key = enterprise ?? "unallocated";
    const group = groups.get(key) ?? { enterprise, entity: settlement.seller?.entity ?? null, settlements: [] };
    if (group.entity !== (settlement.seller?.entity ?? null)) throw new TypeError("one seller cannot be assigned conflicting legal entities");
    group.settlements.push(settlement); groups.set(key, group);
  }
  const books = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const asset = "Assets:Held-By:X402-Custodian", pending = "Liabilities:Pending:X402-Receipts";
    const rows = group.settlements.sort((a, b) => a.sourceId.localeCompare(b.sourceId)).map(settlement => {
      const amount = gradedOfDecimal(settlement.amountUsdc, "USDC");
      return transaction({ date: settlement.blockTime.slice(0, 10), flag: "!", payee: settlement.payer,
        narration: "Corroborated x402 cash; performance and receiving unobserved",
        postings: [posting({ account: asset, amount }), posting({ account: pending, amount: gradedNegate(amount) })],
        meta: { source_id: settlement.sourceId, evidence_ids: JSON.stringify([settlement.evidenceId, settlement.witnessId]),
          custodian: settlement.receiver, recognition: "deferred-cash", enterprise: group.enterprise ?? "unresolved",
          intended_income_account: settlement.ledgerAccount ?? "unresolved", requester_acceptance: "unobserved",
          attribution: settlement.attribution, attribution_reason: settlement.attributionReason ?? "none" },
      });
    });
    const firstDate = rows.map(row => row.date).sort()[0];
    const entries = [open({ date: firstDate, account: asset }), open({ date: firstDate, account: pending }), ...rows];
    return Object.freeze({ key, enterprise: group.enterprise, entity: group.entity, entries: Object.freeze(entries),
      sourceIds: Object.freeze(group.settlements.map(row => row.sourceId)), projection: true, enterpriseReceiving: "unobserved", revenueRecognized: false,
      text: "; Corroborated cash claims, not authoritative enterprise books or customer judgments.\n; Do not edit: derived from independent payment evidence.\n\n" + printEntries(entries) + "\n" });
  });
  return Object.freeze({ books: Object.freeze(books), alreadyRepresented: Object.freeze(alreadyRepresented.sort()),
    customerAcceptance: "unobserved", revenueRecognized: false });
}

/** Write a complete receipt projection. An incomplete provider read cannot
 * erase previous evidence; no authoritative enterprise ledger or authored entry is changed.
 * Given `held`, every settlement the node's journal keeps, the projection is of those: the
 * journal never loses a corroborated transfer, so a partial read projects them all. */
export async function writeSellerPaymentBooks(privateData, corroboration, { booked, held } = {}) {
  if (!privateData || typeof privateData !== "string") throw new TypeError("cash projection requires the receiving node's private data directory");
  if (held === undefined && (!["current", "current-empty"].includes(corroboration.state) || corroboration.refusedCount > 0)) {
    return Object.freeze({ state: "held", reason: "incomplete-payment-observation", rewritten: false, revenueRecognized: false });
  }
  const projected = sellerPaymentBooksOf(held ?? corroboration.settlements, { booked });
  if (projected.books.length === 0) return Object.freeze({ state: "no-new-cash", books: [],
    alreadyRepresented: projected.alreadyRepresented, rewritten: false, revenueRecognized: false });
  const directory = join(privateData, "records", "x402", "cash");
  await mkdir(directory, { recursive: true });
  const books = [];
  for (const book of projected.books) {
    const path = join(directory, `${book.key}.beancount`), temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, book.text, { mode: 0o600 }); await rename(temporary, path);
    books.push({ enterprise: book.enterprise, entity: book.entity, path, transfers: book.sourceIds.length,
      projection: true, enterpriseReceiving: "unobserved", revenueRecognized: false });
  }
  return Object.freeze({ state: "projected", books: Object.freeze(books), alreadyRepresented: projected.alreadyRepresented,
    customerAcceptance: "unobserved", enterpriseReceiving: "unobserved", authoritativeEnterpriseBooksWritten: false, revenueRecognized: false });
}
