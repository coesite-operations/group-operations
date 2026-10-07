#!/usr/bin/env node
// The books against the chain, as a node job: record what the Group's custody wallets hold at
// yesterday's close, what the Hive accounts' histories say moved since the reading before, and
// rewrite the book of chain movements from every recorded reading. The daily financial readout
// reads the reconciliation this records (group-operations reconciliation).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entityChainMovementBookOf } from "@red-cup-engineering/organizing/enterprise";
import { deriveChainBalanceAssertions } from "@red-cup-engineering/farolfi/ledger/maintenance/chain-balance-assertions";
import { hiveCustodyWallets } from "@red-cup-engineering/farolfi/ledger/maintenance/ledger-metadata";
import { parseJournalFile } from "@red-cup-engineering/farolfi/journal";
import { deriveLedgerForAccount } from "@red-cup-engineering/hive-auto-ledger-cli";
import { GROUP_ENTITY, outcomeBookPathOf } from "../src/acceptance.mjs";
import { HIVE_ENGINE_ACCOUNT, HIVE_LIQUID_ACCOUNT, HIVE_STAKED_ACCOUNT, movementClassesOverWindow } from "../src/chain-classification.mjs";
import { reconcileBooksWithChain } from "../src/reconciliation.mjs";

function repositoryRoot(from) {
  for (let directory = from; directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
  }
  throw new Error("reconcile-books-with-chain: repository root not found");
}

const LEDGER = ["lib", "emsenn", "services", "561-group", "services", "561-group-services-section", "data", "logs", "ledgers", "561-group-main-ledger.beancount"];

/** Reconcile the Group's books with the chain at the close of the day before `now`. */
export async function reconcileGroupBooksWithChain({ environment = process.env, now = () => new Date() } = {}) {
  const webData = environment.METROPLAT_WEB_DATA_DIR;
  if (typeof webData !== "string" || webData.trim() === "") throw new TypeError("METROPLAT_WEB_DATA_DIR is required");
  const ledgerPath = resolve(environment.METROPLAT_LEDGER_JOURNAL ?? join(repositoryRoot(dirname(fileURLToPath(import.meta.url))), ...LEDGER));
  const cutoff = new Date(now().getTime() - 86_400_000).toISOString().slice(0, 10);
  return reconcileBooksWithChain({
    ledgerPath, cutoff,
    readingsDirectory: join(webData, "records", "reconciliation"),
    movementBook: entityChainMovementBookOf(GROUP_ENTITY, { environment: { METROPLAT_WEB_DATA_DIR: webData } }),
    otherBooks: [outcomeBookPathOf(webData)],
  }, {
    deriveChainBalanceAssertions, deriveLedgerForAccount, parseJournalFile, hiveCustodyWallets, movementClassesOverWindow,
    hiveAccounts: [HIVE_LIQUID_ACCOUNT, HIVE_STAKED_ACCOUNT, HIVE_ENGINE_ACCOUNT],
  });
}

if (import.meta.main) {
  try {
    const { rows, ...reconciliation } = await reconcileGroupBooksWithChain();
    const states = {};
    for (const row of rows) states[row.state] = (states[row.state] ?? 0) + 1;
    process.stdout.write(`${JSON.stringify({ ...reconciliation, states })}\n`);
  } catch (error) {
    process.stderr.write(`reconcile-books-with-chain: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
