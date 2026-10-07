import assert from "node:assert/strict";
import test from "node:test";
import { open, posting, transaction } from "@red-cup-engineering/organizing/accounting/ledger";
import { gradedOfDecimal, gradedToDecimalString } from "@red-cup-engineering/computer-data-engineering-services-section/number/graded";
import { movementClassesOf } from "../src/chain-classification.mjs";
import { composeGroupFinancialReadout } from "../src/group-financial-readout.mjs";
import { parseJournalText } from "@red-cup-engineering/farolfi/journal";
import { chainMovementBookText, chainMovementsOf, proposedBalancesOf, readingsOfProposalText, reconciliationOf } from "../src/reconciliation.mjs";

const entries = [
  open({ date: "2026-08-27", account: "Assets:Digital-Assets:Hive:Liquid" }),
  transaction({ date: "2026-09-04", narration: "opening", postings: [
    posting({ account: "Assets:Digital-Assets:Hive:Liquid", amount: gradedOfDecimal("142.913", "HIVE") }),
    posting({ account: "Equity:Opening-Balances", amount: gradedOfDecimal("-142.913", "HIVE") })] }),
];

test("a chain balance is read against what the books held that day, the difference stated as unbooked movement", () => {
  const observed = proposedBalancesOf({ directives: ["2026-10-03 balance Assets:Digital-Assets:Hive:Liquid 143.615 HIVE\n  cutoff: \"2026-10-02\"", "2026-10-03 balance Assets:Digital-Assets:Hive:Liquid 0 HBD"] });
  const rows = reconciliationOf(observed, entries);
  assert.deepEqual(rows.map((row) => [row.commodity, row.booked, row.difference, row.state]), [["HIVE", "142.913", "0.702", "differs"], ["HBD", "0", "0", "agrees"]]);
  const readout = composeGroupFinancialReadout({
    asOf: "2026-10-03T12:00:00.000Z", ledgerObservation: { kind: "fixture", observedAt: "2026-10-03T12:00:00.000Z" }, walletRegistry: { derivedAt: "2026-10-03T12:00:00.000Z", wallets: [] },
    hiveCuration: { configured: false }, chainReconciliation: { cutoff: "2026-10-02", proposalPath: "p.beancount", rows, failed: 0 },
  });
  assert.ok(readout.unresolved.some((line) => line.startsWith("1 of 2 chain balances at 2026-10-02 moved with no other book recording it (HIVE +0.702)")));
  assert.ok(!readout.unresolved.includes("ledger reconciliation has not been independently observed"));
  assert.equal(readout.observations.find((item) => item.kind === "chain-reconciliation").state, "differs");
});

const reading = (date, cutoff, amount) => `; Proposed by Metroplat book maintenance from observed chain state. Review before accepting.

${date} balance Assets:Digital-Assets:Hive:Liquid ${amount} HIVE
  reconciliation_id: "REC-${cutoff.replaceAll("-", "")}-HIVE-HIVE"
  cutoff: "${cutoff}"
  source_id: "CHAIN-HIVE-${cutoff.replaceAll("-", "")}"
  source_balance: "${amount}"
`;

test("each recorded reading books once what the chain moved since the last, and asserts it", () => {
  const readings = [reading("2026-10-04", "2026-10-03", "143.9"), reading("2026-10-03", "2026-10-02", "143.615")].flatMap(readingsOfProposalText);
  assert.deepEqual(readings.map((row) => [row.date, row.cutoff, row.sourceId]), [["2026-10-04", "2026-10-03", "CHAIN-HIVE-20261003"], ["2026-10-03", "2026-10-02", "CHAIN-HIVE-20261002"]]);
  const movements = chainMovementsOf(readings, entries);
  assert.deepEqual(movements.readings.map(({ date, rows }) => [date, rows[0].booked, rows[0].difference]), [["2026-10-03", "142.913", "0.702"], ["2026-10-04", "143.615", "0.285"]]);
  const book = chainMovementBookText(movements);
  assert.equal(book, chainMovementBookText(chainMovementsOf([...readings].reverse(), entries)));
  const parsed = parseJournalText(book).entries;
  const moved = parsed.filter((entry) => entry.postings !== undefined);
  assert.deepEqual(moved.map((entry) => [entry.date, entry.meta.source_id]), [["2026-10-02", "CHAIN-HIVE-20261002"], ["2026-10-03", "CHAIN-HIVE-20261003"]]);
  assert.equal(parsed.filter((entry) => entry.directive === "balance").length, 2);
  assert.deepEqual(reconciliationOf(readings, [...entries, ...parsed]).map((row) => row.state), ["agrees", "agrees"]);
});

test("a reading that agrees with the books books nothing and still asserts", () => {
  const movements = chainMovementsOf(readingsOfProposalText(reading("2026-09-06", "2026-09-05", "142.913")), entries);
  assert.equal(movements.entries.filter((entry) => entry.postings !== undefined).length, 0);
  assert.equal(movements.entries.filter((entry) => entry.directive === "balance").length, 1);
});

const derived = `2026-09-01 open Assets:Digital-Assets:Hive:Custody:Michael561
2026-09-01 open Assets:Digital-Assets:HiveEngine:Custody:Michael561:Staked
2026-09-01 open Equity:Opening-Balances
2026-09-01 open Income:Hive:Curation
2026-09-01 open Income:Hive:Author
2026-09-01 open Expenses:Hive:Other

2026-09-05 * "Opening balances"
  Assets:Digital-Assets:Hive:Custody:Michael561  2.0 HIVE
  Equity:Opening-Balances  -2.0 HIVE

2026-09-10 * "Claim reward balance"
  Assets:Digital-Assets:Hive:Custody:Michael561  0.5 HIVE
  Income:Hive:Curation  -0.3 HIVE
  Income:Hive:Author  -0.2 HIVE

2026-09-11 * "Hive transfer to help-fund"
  Assets:Digital-Assets:Hive:Custody:Michael561  -1.0 HIVE
  Expenses:Hive:Other  1.0 HIVE

2026-09-12 * "Hive-Engine tribe reward (staked)"
  Assets:Digital-Assets:HiveEngine:Custody:Michael561:Staked  4.0 SIM
  Income:Hive:Curation  -4.0 SIM
`;

test("the accounts' histories explain a movement by what earned it, leaving out the Group paying itself", () => {
  const classes = movementClassesOf([derived], { internal: new Set(["michael561", "help-fund"]) });
  assert.deepEqual(classes.map(({ account, commodity, counter, amount }) => [account.split(":").at(-1), commodity, counter, amount]), [
    ["Liquid", "HIVE", "Income:Hive:Author", "0.2"], ["Liquid", "HIVE", "Income:Hive:Curation", "0.3"], ["Unclassified", "SIM", "Income:Hive:Curation", "4"],
  ]);
  const movements = chainMovementsOf(readingsOfProposalText(reading("2026-10-03", "2026-10-02", "143.615")), entries, { classes: new Map([["2026-10-03", classes]]) });
  const [moved] = movements.entries.filter((entry) => entry.postings !== undefined);
  assert.deepEqual(moved.postings.map((item) => [item.account, gradedToDecimalString(item.amount)]), [
    ["Assets:Digital-Assets:Hive:Liquid", "0.702"], ["Income:Hive:Author", "-0.2"], ["Income:Hive:Curation", "-0.3"], ["Income:Investment:Unrealized-Gains", "-0.202"],
  ]);
  assert.ok(movements.entries.some((entry) => entry.directive === "open" && entry.account === "Income:Hive:Curation"));
});

test("moving into savings stays the Group's, and a power-up is a conversion, never a gain or loss", () => {
  const ledger = `2026-09-01 open Assets:Digital-Assets:Hive:Custody:Michael561
2026-09-01 open Assets:Digital-Assets:Hive:Custody:Michael561:Savings

2026-09-10 * "Transfer to savings"
  Assets:Digital-Assets:Hive:Custody:Michael561  -1.617 HBD
  Assets:Digital-Assets:Hive:Custody:Michael561:Savings  1.617 HBD

2026-09-11 * "Power up (HIVE to VESTS)"
  Assets:Digital-Assets:Hive:Custody:Michael561  -50.000 HIVE @ 1696.6 VESTS
  Assets:Digital-Assets:Hive:Custody:Michael561  84830 VESTS
`;
  assert.deepEqual(movementClassesOf([ledger]).map(({ account, commodity, counter, amount }) => [account.split(":").at(-1), commodity, counter, amount]), [
    ["Liquid", "HBD", "Assets:Digital-Assets:Hive:Savings", "-1.617"], ["Liquid", "HIVE", "Equity:Conversions", "-50"], ["Staked", "VESTS", "Equity:Conversions", "84830"],
  ]);
});
