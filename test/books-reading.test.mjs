import assert from "node:assert/strict";
import test from "node:test";
import { gradedOfDecimal } from "@red-cup-engineering/exact-number-data-service/graded";
import { booksSummaryOf } from "../src/books-reading.mjs";
import { composeGroupFinancialReadout } from "../src/group-financial-readout.mjs";

test("the books read per top-level account in the money the Group counts, other commodities counted", () => {
  const report = { tree: { children: [
    { name: "Income", total: { USDC: gradedOfDecimal("-0.03", "USDC"), HIVE: gradedOfDecimal("-0.49", "HIVE"), USD: gradedOfDecimal("0", "USD") } },
    { name: "Assets", total: { USDC: gradedOfDecimal("12.5", "USDC") } },
  ] } };
  assert.deepEqual(JSON.parse(JSON.stringify(booksSummaryOf(report))), { Income: { money: { USDC: "-0.03" }, otherCommodities: 1 }, Assets: { money: { USDC: "12.5" }, otherCommodities: 0 } });
});

test("the CFO reads the economy beside the books: committed crossings none of which settled is unresolved", () => {
  const readout = composeGroupFinancialReadout({
    asOf: "2026-10-03T12:00:00.000Z", ledgerObservation: { observedAt: "2026-10-03T12:00:00.000Z" }, walletRegistry: { derivedAt: "2026-10-03T12:00:00.000Z", wallets: [] },
    hiveCuration: { configured: true }, chainReconciliation: { cutoff: "2026-10-02", rows: [], failed: 0, earned: [{ account: "Income:Hive:Curation", commodity: "VESTS", amount: "290" }] },
    books: { members: ["561-group-llc"], missing: [], accounts: {} }, economy: { crossings: { committed: { count: 18 }, settled: { count: 0 } } },
  });
  assert.ok(readout.unresolved.includes("18 crossings between members are committed and none has settled, so no member's work has cleared on a credit line"));
  assert.equal(readout.observations.find((item) => item.kind === "hive-curation").state, "observed");
  assert.equal(readout.observations.find((item) => item.kind === "entity-books").state, "observed");
  assert.equal(readout.earningActions.find((item) => item.action === "run-hive-curation-cycle").state, "continue");
});
