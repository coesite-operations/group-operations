#!/usr/bin/env node
// Print the entries an approved books ruling adds to the authored main ledger, for review and
// landing through the integration queue; writes nothing.
//
//   books-ruling-entries <ruling.json> [--ledger <path>] [--registry <path>]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { reversalEntriesOf, x402SalesOf } from "../src/group-financial-readout-view.mjs";

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { ledger: { type: "string" }, registry: { type: "string" } } });
  if (positionals.length !== 1 || !values.ledger || !values.registry) {
    process.stderr.write("usage: books-ruling-entries <ruling.json> --ledger <main ledger> --registry <wallet registry>\n");
    process.exit(2);
  }
  const ruling = JSON.parse(readFileSync(positionals[0], "utf8"));
  const sales = x402SalesOf(readFileSync(values.ledger, "utf8"), JSON.parse(readFileSync(values.registry, "utf8")));
  const entries = reversalEntriesOf(sales, ruling);
  process.stdout.write(entries.length === 0 ? `; ruling ${ruling.id} (${ruling.decision}) adds no entries\n` : `\n; Reversals and hand-overs of the authored ledger's x402 sales, under ruling ${ruling.id} (${ruling.at}).\n\n${entries.join("\n\n")}\n`);
}
