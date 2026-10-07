#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeGroupFinancialReadout, writeGroupFinancialReadout } from "@561-group/group-operations/group-financial-readout";
import { acceptanceReadoutOf, entityBooks, outcomeJournal } from "@red-cup-engineering/organizing/enterprise";
import { readLedgerReport } from "@red-cup-engineering/farolfi/ledger/reports";
import { agencyAt, agencyRootOf } from "@red-cup-engineering/metroplat/offices";
import { GROUP_ENTITY, groupPartyOf, writeOutcomeBook, x402SettlementOutcomes } from "../src/acceptance.mjs";
import { entityBooksReadingOf, latestRecordedEconomy } from "../src/books-reading.mjs";
import { latestChainReconciliation } from "../src/reconciliation.mjs";


function repositoryRoot(from) {
  for (let directory = from; directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
  }
  throw new Error("produce-group-financial-readout: repository root not found");
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const root = repositoryRoot(moduleDirectory);
const source = (...segments) => join(root, "lib", "emsenn", "services", "561-group", "services", ...segments);
const defaults = Object.freeze({
  ledger: source("561-group-services-section", "data", "logs", "ledgers", "561-group-main-ledger.beancount"),
  walletRegistry: source("engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-systems-engineering-services-section", "services", "computer-blockchain-system-services-section", "services", "key-management-services-section", "data", "records", "2026-09-05-wallet-registry.json"),
  hiveTimer: source("engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-systems-engineering-services-section", "services", "computer-blockchain-system-services-section", "services", "hive-engineering-services-section", "services", "curation-services-section", "content", "deployment", "systemd-user", "hive-curation-cycle.timer"),
});

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
  const ledgerPath = resolve(environment.METROPLAT_LEDGER_JOURNAL ?? defaults.ledger);
  const walletRegistryPath = resolve(environment.GROUP_WALLET_REGISTRY ?? defaults.walletRegistry);
  const hiveTimer = resolve(environment.HIVE_CURATION_TIMER_UNIT ?? defaults.hiveTimer);
  const walletRegistry = JSON.parse(await readFile(walletRegistryPath, "utf8"));
  // Seller-specific edge witnesses are the attribution carrier. Each settlement two independent Base
  // reads corroborate is a buyer's judgment of a delivery, told once as an outcome; the Group's book
  // of judged deliveries is rewritten from the outcome journal, and the authored ledger is never
  // appended to. Whether a payment is a sale is read from who paid (the wallet registry), never assumed.
  let sellerBooking = null;
  try {
    const corroboratorPath = join(root, "lib", "emsenn", "services", "561-group", "services", "engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-networking-engineering-services-section", "services", "x402-services-section", "src", "settlement-derivation", "book-market-seller-settlements.mjs");
    const { corroborateMarketSellerSettlements } = await import(pathToFileURL(corroboratorPath).href);
    const corroboration = await corroborateMarketSellerSettlements({ environment, now: () => new Date(asOf) });
    const journal = outcomeJournal(requiredEnvironment("METROPLAT_DATA_ROOT", environment));
    const told = journal.record(x402SettlementOutcomes(corroboration.settlements));
    const outcomes = journal.read();
    // A release is no repository: the agency is the one this script was released with.
    const agency = agencyAt(agencyRootOf({ agencyRoot: environment.METROPLAT_AGENCY_ROOT ?? join(root, "lib") }));
    const partyOf = groupPartyOf({ enterprises: [...agency.enterprises.values()], walletRegistry });
    await writeOutcomeBook(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment), outcomes, partyOf, { ledgerPath });
    const x402 = outcomes.filter((outcome) => outcome.source === "x402-settlement");
    const { border } = acceptanceReadoutOf(x402, { from: "2000-01-01T00:00:00.000Z", to: asOf, partyOf });
    const { settlements, ...observed } = corroboration;
    sellerBooking = { ...observed, type: "X402SellerOutcomeObservation", toldCount: told, alreadyToldCount: settlements.length - told, outcomeCount: x402.length, border };
  } catch (error) {
    // Financial readout generation remains available when R2/chain infrastructure is down;
    // the unresolved failure is surfaced and nothing is told.
    sellerBooking = { type: "X402SellerOutcomeObservation", state: "unavailable", observedAt: asOf, witnessCount: null, receiptVerifiedCount: null, confirmedCount: null, attributionRefusedCount: null, toldCount: null, alreadyToldCount: null, refusedCount: null, error: error instanceof Error ? error.message : String(error) };
  }
  // The books against the chain: the latest reconciliation the chain-reconciliation job recorded
  // (reconcile-books-with-chain); reading the chain and the accounts' histories is that job's, never
  // this readout's.
  const chainReconciliation = await latestChainReconciliation(join(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment), "records", "reconciliation"));
  // The CFO reads the books and the economy side by side: the entity's books consolidated (its
  // authored ledger and the books the node keeps for it), and the economy the latest acceptance
  // readout recorded from the board.
  let books;
  try {
    const agency = agencyAt(agencyRootOf({ agencyRoot: environment.METROPLAT_AGENCY_ROOT ?? join(root, "lib") }));
    const { members } = entityBooks(agency, GROUP_ENTITY, { environment, repositoryRoot: root });
    books = await entityBooksReadingOf({ books: [{ book: GROUP_ENTITY, path: ledgerPath }, ...members], readLedgerReport });
  } catch (error) {
    books = { error: error instanceof Error ? error.message : String(error) };
  }
  const economy = await latestRecordedEconomy(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment));
  const readout = composeGroupFinancialReadout({
    asOf,
    ledgerObservation: observeLedger(ledgerPath),
    walletRegistry,
    x402Settlement: { path: null, value: sellerBooking },
    hiveCuration: { configured: existsSync(hiveTimer), unitPath: hiveTimer },
    chainReconciliation,
    books,
    economy,
  });
  const path = await writeGroupFinancialReadout(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment), readout);
  return Object.freeze({ path, readout });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${JSON.stringify(await produceGroupFinancialReadout())}\n`); }
  catch (error) { process.stderr.write(`produce-group-financial-readout: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
