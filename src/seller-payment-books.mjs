import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { open, posting, transaction } from "@red-cup-engineering/organizing/accounting/ledger";
import { printEntries } from "@red-cup-engineering/organizing/accounting/report";
import { gradedOfDecimal, gradedNegate } from "@red-cup-engineering/exact-number-data-service/graded";

// Exact cash and ownership coordinates; response preparation is a separate observation.
const cashCoordinates = row => JSON.stringify([row.sourceId, row.transactionHash, row.logIndex, row.network,
  row.asset, row.payer, row.receiver, row.amount, row.amountUsdc, row.blockTime, row.sku,
  row.seller?.enterprise, row.seller?.entity, row.seller?.record?.path, row.seller?.record?.sha256,
  row.book?.enterprise, row.book?.account, row.attribution, row.attributionReason, row.evidenceId, row.witnessId]);

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
 * erase previous evidence; no authoritative enterprise ledger or authored entry is changed. */
export async function writeSellerPaymentBooks(privateData, corroboration, { booked } = {}) {
  if (!privateData || typeof privateData !== "string") throw new TypeError("cash projection requires the receiving node's private data directory");
  if (!["current", "current-empty"].includes(corroboration.state) || corroboration.refusedCount > 0) {
    return Object.freeze({ state: "held", reason: "incomplete-payment-observation", rewritten: false, revenueRecognized: false });
  }
  const projected = sellerPaymentBooksOf(corroboration.settlements, { booked });
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
