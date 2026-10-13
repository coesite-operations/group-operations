// The entity's books as the CFO reads them beside the economy: the authored ledger, the book of
// judged deliveries and the book of chain movements consolidated (organizing `entityBooks`, farolfi
// `readLedgerReport`), summarized per top-level account in the money the Group counts in, with the
// number of other commodities each holds. The economy itself is read from the acceptance readout's
// record, never folded from the board on a request path.
import { existsSync } from "node:fs";
import { gradedIsZero, gradedToDecimalString } from "@red-cup-engineering/exact-number-data-service/graded";
export { latestRecordedEconomy } from "./acceptance-reading.mjs";

/** The commodities the Group counts money in. */
export const MONEY = Object.freeze(["USD", "USDC"]);

/** Per top-level account of a farolfi report tree: its nonzero money totals and how many other commodities it holds. */
export function booksSummaryOf(report) {
  const children = report?.tree?.children ?? [];
  return Object.freeze(Object.fromEntries((Array.isArray(children) ? children : Object.values(children)).map((account) => {
    const held = Object.entries(account.total ?? {}).filter(([, amount]) => !gradedIsZero(amount));
    return [account.name, Object.freeze({
      money: Object.freeze(Object.fromEntries(held.filter(([commodity]) => MONEY.includes(commodity)).map(([commodity, amount]) => [commodity, gradedToDecimalString(amount)]))),
      otherCommodities: held.filter(([commodity]) => !MONEY.includes(commodity)).length,
    })];
  })));
}

/**
 * The entity's books consolidated, as `{members, accounts, generatedAt}`; a member book the node has
 * not written yet is named in `missing` and left out.
 * @param {{books: ReadonlyArray<{book: string, path: string}>, readLedgerReport: Function}} input
 */
export async function entityBooksReadingOf({ books, readLedgerReport }) {
  const present = books.filter((member) => existsSync(member.path));
  const report = await readLedgerReport({ journal: { books: present }, report: "balance-sheet", depth: 1 });
  return Object.freeze({
    members: Object.freeze(present.map((member) => member.book)),
    missing: Object.freeze(books.filter((member) => !present.includes(member)).map((member) => member.book)),
    accounts: booksSummaryOf(report),
    generatedAt: report.generatedAt ?? null,
  });
}
