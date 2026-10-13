#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { composeGroupFinancialReadout, writeGroupFinancialReadout } from "../src/group-financial-readout.mjs";
import { readReceivedEntityBooks, latestRecordedEconomy } from "../src/acceptance-reading.mjs";


// Source defaults are available only through an explicitly configured source root.
// Released execution uses the admitted ledger, registry and agency state paths.
function sourceDefaults(environment) {
  const root = environment.METROPLAT_REPOSITORY_ROOT;
  if (typeof root !== "string" || root.trim() === "") return {};
  const source = (...segments) => join(resolve(root), "lib", "emsenn", "services", "561-group", "services", ...segments);
  return {
    ledger: source("561-group-services-section", "data", "logs", "ledgers", "561-group-main-ledger.beancount"),
    walletRegistry: source("engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-systems-engineering-services-section", "services", "computer-blockchain-system-services-section", "services", "key-management-services-section", "data", "records", "2026-09-05-wallet-registry.json"),
    hiveTimer: source("engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-systems-engineering-services-section", "services", "computer-blockchain-system-services-section", "services", "hive-engineering-services-section", "services", "curation-services-section", "content", "deployment", "systemd-user", "hive-curation-cycle.timer"),
    agencyRoot: join(resolve(root), "lib"),
  };
}

function requiredEnvironment(name, environment) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return resolve(value);
}

function observeLedger(path) {
  const journal = readFileSync(path, "utf8");
  const observedAt = [...journal.matchAll(/^\s*observed_at:\s*"([^"]+)"\s*$/gmu)]
    .map((match) => match[1])
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
  return Object.freeze({
    kind: "beancount-journal",
    path,
    observedAt,
    balanceAssertionCount: (journal.match(/^\d{4}-\d{2}-\d{2}\s+balance\s+/gmu) ?? []).length,
    transactionCount: (journal.match(/^\d{4}-\d{2}-\d{2}\s+[*!]\s+/gmu) ?? []).length,
  });
}

export async function produceGroupFinancialReadout({ environment = process.env, now = () => new Date().toISOString() } = {}) {
  const asOf = now();
  const defaults = sourceDefaults(environment);
  const ledgerPath = requiredEnvironment("METROPLAT_LEDGER_JOURNAL", { METROPLAT_LEDGER_JOURNAL: environment.METROPLAT_LEDGER_JOURNAL ?? defaults.ledger });
  const walletRegistryPath = requiredEnvironment("GROUP_WALLET_REGISTRY", { GROUP_WALLET_REGISTRY: environment.GROUP_WALLET_REGISTRY ?? defaults.walletRegistry });
  const hiveTimer = environment.HIVE_CURATION_TIMER_UNIT ?? defaults.hiveTimer;
  const agencyRoot = environment.METROPLAT_AGENCY_ROOT ?? defaults.agencyRoot;
  const walletRegistry = JSON.parse(await readFile(walletRegistryPath, "utf8"));
  // Qualified cash receiving has no retained observation binding in this producer.
  // The market's facilitator witnesses are not independently verified transfers,
  // and the removed heldSellerSettlements/recordSellerSettlements exports cannot
  // be replaced by treating a readout request as a financial receiving job.
  // Keep this unresolved until the actual cash receiver supplies its persisted
  // observation and original cutoff through its owning contract. Do not invent
  // a receipt file, refresh a prior report, or timestamp missing evidence now.
  const sellerBooking = {
    type: "X402SellerPaymentObservation", state: "unavailable", observedAt: null,
    witnessCount: null, receiptVerifiedCount: null, confirmedCount: null,
    attributionRefusedCount: null, refusedCount: null, outcomeCount: 0,
    customerAcceptance: "unobserved", revenueRecognized: false,
    error: "qualified seller-payment receiver observation is not bound to the financial readout",
  };
  // The books against the chain: the latest reconciliation the chain-reconciliation job recorded
  // (reconcile-books-with-chain); reading the chain and the accounts' histories is that job's, never
  // this readout's.
  const webData = requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment);
  let chainReconciliation;
  try {
    const { latestChainReconciliation } = await import("../src/reconciliation.mjs");
    chainReconciliation = await latestChainReconciliation(join(webData, "records", "reconciliation"));
  } catch (error) {
    chainReconciliation = { error: error instanceof Error ? error.message : String(error) };
  }
  // produceAcceptanceReadout owns judgment receiving and the derived judgment
  // book. This request reads its existing projection; it never refreshes it.
  // The CFO reads the books and the economy side by side: the entity's books consolidated (its
  // authored ledger and the books the node keeps for it), and the economy the latest acceptance
  // readout recorded from the board.
  let books;
  try {
    const [{ entityBooks }, { readLedgerReport }, { agencyAt }, { GROUP_ENTITY, outcomeBookPathOf }, { entityBooksReadingOf }] = await Promise.all([
      import("@red-cup-engineering/organizing/enterprise"),
      import("@red-cup-engineering/farolfi/ledger/reports"),
      import("@red-cup-engineering/organizing/agency/held"),
      import("../src/acceptance.mjs"),
      import("../src/books-reading.mjs"),
    ]);
    const agency = agencyAt(requiredEnvironment("METROPLAT_AGENCY_ROOT", { METROPLAT_AGENCY_ROOT: agencyRoot }));
    const { members } = entityBooks(agency, GROUP_ENTITY, { environment, ...(environment.METROPLAT_REPOSITORY_ROOT ? { repositoryRoot: environment.METROPLAT_REPOSITORY_ROOT } : {}) });
    books = await readReceivedEntityBooks({ webData, bookPath: outcomeBookPathOf(webData), asOf,
      read: () => entityBooksReadingOf({ books: [{ book: GROUP_ENTITY, path: ledgerPath }, ...members], readLedgerReport }) });
  } catch (error) {
    books = { error: error instanceof Error ? error.message : String(error) };
  }
  let economy;
  try {
    economy = await latestRecordedEconomy(webData, { asOf });
  } catch (error) {
    economy = { error: error instanceof Error ? error.message : String(error) };
  }
  const readout = composeGroupFinancialReadout({
    asOf,
    ledgerObservation: observeLedger(ledgerPath),
    walletRegistry,
    x402Settlement: { path: null, value: sellerBooking },
    hiveCuration: { configured: typeof hiveTimer === "string" && existsSync(hiveTimer), unitPath: hiveTimer ?? null },
    chainReconciliation,
    books,
    economy,
  });
  const path = await writeGroupFinancialReadout(webData, readout);
  return Object.freeze({ path, readout });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${JSON.stringify(await produceGroupFinancialReadout())}\n`); }
  catch (error) { process.stderr.write(`produce-group-financial-readout: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
