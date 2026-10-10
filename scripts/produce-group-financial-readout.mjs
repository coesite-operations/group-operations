#!/usr/bin/env node
import { writeSellerPaymentBooks } from "../src/seller-payment-books.mjs";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corroborateMarketSellerSettlements, heldSellerSettlements, recordSellerSettlements } from "@red-cup-engineering/x402-services-section/seller-settlements";
import { composeGroupFinancialReadout, writeGroupFinancialReadout } from "@561-group/group-operations/group-financial-readout";
import { entityBooks } from "@red-cup-engineering/organizing/enterprise";
import { outcomeJournal } from "@red-cup-engineering/organizing/enterprise";
import { readLedgerReport } from "@red-cup-engineering/farolfi/ledger/reports";
import { agencyAt } from "@red-cup-engineering/organizing/agency/held";
import { GROUP_ENTITY, bookedSourcesOf, groupPartyOf, writeOutcomeBook } from "../src/acceptance.mjs";
import { entityBooksReadingOf, latestRecordedEconomy } from "../src/books-reading.mjs";
import { latestChainReconciliation } from "../src/reconciliation.mjs";


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
  // Independently corroborated cash is read separately from the work-outcome journal.
  // A payment cannot impersonate a buyer judgment or become customer demand.
  let sellerBooking = null;
  try {
    const corroboration = await corroborateMarketSellerSettlements({ environment, now: () => new Date(asOf) });
    // Each corroborated transfer is kept in the node's one log first; the cash books project
    // what the log holds, so a partial provider read neither loses nor erases a transfer.
    const dataRoot = requiredEnvironment("METROPLAT_DATA_ROOT", environment);
    const kept = recordSellerSettlements(dataRoot, corroboration.settlements);
    const books = await writeSellerPaymentBooks(dataRoot, corroboration, { booked: await bookedSourcesOf(ledgerPath), held: heldSellerSettlements(dataRoot) });
    const { settlements, ...observed } = corroboration;
    sellerBooking = { ...observed, type: "X402SellerPaymentObservation", kept: { corroborated: kept.kept, appended: kept.appended }, books, outcomeCount: 0,
      customerAcceptance: "unobserved", revenueRecognized: false };

  } catch (error) {
    // Financial readout generation remains available when R2/chain infrastructure is down;
    // the unresolved failure is surfaced and nothing is told.
    sellerBooking = { type: "X402SellerPaymentObservation", state: "unavailable", observedAt: asOf, witnessCount: null, receiptVerifiedCount: null, confirmedCount: null, attributionRefusedCount: null, toldCount: null, alreadyToldCount: null, refusedCount: null, error: error instanceof Error ? error.message : String(error) };
  }
  // The books against the chain: the latest reconciliation the chain-reconciliation job recorded
  // (reconcile-books-with-chain); reading the chain and the accounts' histories is that job's, never
  // this readout's.
  const chainReconciliation = await latestChainReconciliation(join(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment), "records", "reconciliation"));
  // Refresh the existing derived judgment book, including withdrawal of historical
  // payment-as-acceptance projections. Keep the original journal and authored ledger.
  // This reads actual judgments; it never records cash as a judgment.
  let outcomeProjectionError;
  if (environment.METROPLAT_DATA_ROOT) {
    try {
      const agency = agencyAt(requiredEnvironment("METROPLAT_AGENCY_ROOT", { METROPLAT_AGENCY_ROOT: agencyRoot }));
      const partyOf = groupPartyOf({ enterprises: [...agency.enterprises.values()], walletRegistry });
      await writeOutcomeBook(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment),
        outcomeJournal(requiredEnvironment("METROPLAT_DATA_ROOT", environment)).read(), partyOf, { ledgerPath });
    } catch (error) { outcomeProjectionError = error instanceof Error ? error.message : String(error); }
  }
  // The CFO reads the books and the economy side by side: the entity's books consolidated (its
  // authored ledger and the books the node keeps for it), and the economy the latest acceptance
  // readout recorded from the board.
  let books;
  try {
    const agency = agencyAt(requiredEnvironment("METROPLAT_AGENCY_ROOT", { METROPLAT_AGENCY_ROOT: agencyRoot }));
    const { members } = entityBooks(agency, GROUP_ENTITY, { environment, ...(environment.METROPLAT_REPOSITORY_ROOT ? { repositoryRoot: environment.METROPLAT_REPOSITORY_ROOT } : {}) });
    books = outcomeProjectionError ? { error: `judgment book refresh failed: ${outcomeProjectionError}` }
      : await entityBooksReadingOf({ books: [{ book: GROUP_ENTITY, path: ledgerPath }, ...members], readLedgerReport });
  } catch (error) {
    books = { error: error instanceof Error ? error.message : String(error) };
  }
  const economy = await latestRecordedEconomy(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment));
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
  const path = await writeGroupFinancialReadout(requiredEnvironment("METROPLAT_WEB_DATA_DIR", environment), readout);
  return Object.freeze({ path, readout });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${JSON.stringify(await produceGroupFinancialReadout())}\n`); }
  catch (error) { process.stderr.write(`produce-group-financial-readout: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
