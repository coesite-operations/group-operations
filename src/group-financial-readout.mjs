// The dated financial reading consumed by OPS.  It intentionally reports an
// unavailable or stale earning surface as unknown; a missing settlement is
// not evidence of a zero balance or zero income.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const moneyText = (value) => Object.entries(object(value) ?? {}).map(([currency, amount]) => `${amount} ${currency}`).join(", ") || "no value";

function ageState(observedAt, asOf, maximumAgeMs) {
  const observed = Date.parse(observedAt ?? ""), now = Date.parse(asOf);
  if (!Number.isFinite(observed) || !Number.isFinite(now) || observed > now) return "unknown";
  return now - observed > maximumAgeMs ? "stale" : "current";
}

/**
 * Compose the CEO/board financial reading from current ledger reports and
 * observations of the earning surfaces.  All source payloads stay named in
 * the record so a receiver can distinguish settled money from a configured
 * but unobserved routine.
 */
export function composeGroupFinancialReadout({ asOf, ledgerObservation, walletRegistry, x402Settlement, hiveCuration, chainReconciliation, books, economy } = {}) {
  if (!iso(asOf) || !object(ledgerObservation) || !object(walletRegistry)) throw new TypeError("group-financial-readout-sources-required");
  const wallets = Array.isArray(walletRegistry.wallets) ? walletRegistry.wallets : [];
  const ledgerObservedAt = iso(ledgerObservation.observedAt);
  const ledgerState = ageState(ledgerObservedAt, asOf, 24 * 60 * 60 * 1000);
  const walletObservedAt = iso(walletRegistry.derivedAt);
  const walletState = ageState(walletObservedAt, asOf, 24 * 60 * 60 * 1000);
  const x402Record = object(x402Settlement?.value);
  const x402ObservedAt = iso(x402Record?.observedAt);
  const isSellerBooking = ["X402SellerPaymentObservation", "X402SellerOutcomeObservation"].includes(x402Record?.type);
  const x402Freshness = ageState(x402ObservedAt, asOf, 24 * 60 * 60 * 1000);
  const x402SourceState = isSellerBooking && typeof x402Record.state === "string" ? x402Record.state : null;
  // A producer's corroboration state is evidence about that observation, not
  // permission to keep calling it current after its observation date ages out.
  const x402State = x402Record === null ? "unknown"
    : x402SourceState === "unavailable" ? "unavailable"
      : x402Freshness !== "current" ? x402Freshness
        : isSellerBooking ? x402SourceState ?? "unknown" : "current";
  // Curation is observed when the chain's movements are explained by curation income (the
  // chain-reconciliation job's reading of the Hive accounts' histories).
  const curationEarned = (chainReconciliation?.earned ?? []).filter((row) => row.account === "Income:Hive:Curation");
  const hiveState = curationEarned.length > 0 ? "observed" : hiveCuration?.configured === true ? "configured-unobserved" : "unknown";
  const committed = economy?.crossings?.committed?.count ?? 0;
  const settled = economy?.crossings?.settled?.count ?? 0;
  const x402ObservationCurrent = x402State === "current" || x402State === "current-empty";
  const unresolved = [
    ...(ledgerState === "unknown" ? [ledgerObservedAt === null ? "ledger economic observation date unavailable" : `ledger economic observation date is after the readout: ${ledgerObservedAt}`] : ledgerState === "stale" ? [`ledger economic evidence is stale since ${ledgerObservedAt}`] : []),
    ...(chainReconciliation === undefined || chainReconciliation.error !== undefined
      ? [`ledger reconciliation has not been independently observed${chainReconciliation?.error ? `: ${chainReconciliation.error}` : ""}`]
      : (() => {
        const rows = chainReconciliation.rows ?? [];
        const moved = rows.filter((row) => row.state === "differs");
        const unreadable = rows.filter((row) => row.state === "unreadable");
        const named = moved.slice(0, 6).map((row) => `${row.commodity} ${row.difference.startsWith("-") ? "" : "+"}${row.difference}`).join(", ");
        return [
          ...(moved.length === 0 ? [] : [`${moved.length} of ${rows.length} chain balances at ${chainReconciliation.cutoff} moved with no other book recording it (${named}${moved.length > 6 ? ", …" : ""}): booked in ${chainReconciliation.movementBook ?? "the book of chain movements"}, ${Number.isInteger(chainReconciliation.explained) && chainReconciliation.explained > 0 ? `${chainReconciliation.explained} of them explained by the accounts' histories (curation, staking, transfers), the rest as unclassified gain or loss` : "as unclassified gain or loss, the accounts' histories not read"}`]),
          ...(unreadable.length === 0 ? [] : [`${unreadable.length} chain balance(s) at ${chainReconciliation.cutoff} name accounts the books cannot read`]),
        ];
      })()),
    ...(economy === undefined ? ["the economy the board carries has not been read: no acceptance readout is recorded"]
      : settled === 0 && committed > 0 ? [`${committed} crossings between members are committed and none has settled, so no member's work has cleared on a credit line`] : []),
    ...(books === undefined || books.error !== undefined ? [`the entity's consolidated books were not read${books?.error ? `: ${books.error}` : ""}`] : []),
    ...(chainReconciliation?.failed > 0 ? [`${chainReconciliation.failed} custody wallet reading(s) failed, so the balances they share were not asserted`] : []),
    ...(walletState === "unknown" ? [walletObservedAt === null ? "wallet registry observation date unavailable" : `wallet registry observation date is after the readout: ${walletObservedAt}`] : walletState === "stale" ? [`wallet registry is stale since ${walletObservedAt}`] : []),
    ...(x402Freshness === "unknown" ? [x402ObservedAt === null ? "x402 settlement evidence unavailable" : `x402 settlement observation date is after the readout: ${x402ObservedAt}`]
      : x402Freshness === "stale" ? [`x402 settlement evidence is stale since ${x402ObservedAt}`]
        : x402State === "unknown" ? ["x402 settlement evidence unavailable"] : []),
    ...(isSellerBooking && x402State === "unavailable" ? ["seller settlement storage or chain corroboration was unavailable; previous cash evidence is held"] : []),
    ...(isSellerBooking && typeof x402Record.error === "string" ? [`seller settlement corroboration failed: ${x402Record.error}`] : []),
    ...(isSellerBooking && x402Record.attributionRefusedCount > 0 ? [`${x402Record.attributionRefusedCount} seller transfer(s) were corroborated on-chain but lack qualified transaction-time seller or tariff attribution, so cash remains unattributed and is never assigned from today's catalogue`] : []),
    ...(isSellerBooking && x402Record.refusedCount > 0 && !(x402Record.attributionRefusedCount > 0) ? [`${x402Record.refusedCount} seller settlement record(s) were refused; only independently corroborated cash is available for book projection`] : []),
    ...(isSellerBooking && x402Record.border?.self?.count > 0 ? [`${x402Record.border.self.count} corroborated payment(s) came from the Group's own wallets (${moneyText(x402Record.border.self.value)}): the Group paying itself, never a sale`] : []),
    ...(isSellerBooking && x402Record.border?.related?.count > 0 ? [`${x402Record.border.related.count} payment(s) came from related parties (${moneyText(x402Record.border.related.value)}), relationship evidence alone does not recognize a sale`] : []),
    ...(isSellerBooking && x402Record.state === "current-empty" ? ["no private seller settlement witnesses were present in this observation; this does not prove no payments occurred"] : []),
    ...(hiveCuration?.configured !== true ? ["Hive curation schedule is unavailable"]
      : hiveState === "configured-unobserved" ? ["Hive curation is scheduled but its latest reward settlement has not been observed here"] : []),
    ...(wallets.length === 0 ? ["wallet registry has no wallets"] : [`${wallets.length} registered wallets have no current balance observation in this readout`]),
  ];
  return Object.freeze({
    type: "GroupFinancialReadout",
    version: 2,
    title: "561 Group daily financial readout",
    asOf,
    recognitionBasis: "The authored ledger and judged-delivery book retain their own recognition bases; legacy entries are not requalified by this readout. Corroborated x402 transfers remain cash claims pending performance and qualified receiving; a payment does not establish delivery, customer acceptance or a sale. Configured earning mechanisms remain opportunities until independently observed.",
    ledger: Object.freeze({
      kind: ledgerObservation.kind,
      state: ledgerState,
      observedAt: ledgerObservedAt,
      source: ledgerObservation.path ?? null,
      balanceAssertionCount: Number.isInteger(ledgerObservation.balanceAssertionCount) ? ledgerObservation.balanceAssertionCount : null,
      transactionCount: Number.isInteger(ledgerObservation.transactionCount) ? ledgerObservation.transactionCount : null,
      reconciliation: "unobserved",
    }),
    observations: Object.freeze([
      Object.freeze({ kind: "wallet-registry", state: walletState, observedAt: walletObservedAt, source: "key-management wallet registry", registeredWallets: wallets.length }),
      Object.freeze({ kind: "x402-settlements", state: x402State, observedAt: x402ObservedAt, source: x402Settlement?.path ?? null,
        sourceState: x402SourceState, freshness: x402Freshness,
        settlementCount: isSellerBooking ? x402Record.witnessCount : Number.isInteger(x402Record?.settlementCount) ? x402Record.settlementCount : null,
        receiptVerifiedCount: isSellerBooking ? Number.isInteger(x402Record.receiptVerifiedCount) ? x402Record.receiptVerifiedCount : null : null,
        confirmedCount: isSellerBooking ? x402Record.confirmedCount : null,
        attributionRefusedCount: isSellerBooking ? Number.isInteger(x402Record.attributionRefusedCount) ? x402Record.attributionRefusedCount : null : null,
        toldCount: null,
        alreadyToldCount: null,
        refusedCount: isSellerBooking ? x402Record.refusedCount : null,
        outcomeCount: isSellerBooking ? 0 : null,
        // Historical payment-derived acceptance remains a claim, never current demand.
        border: null, legacyPaymentClaims: x402Record?.type === "X402SellerOutcomeObservation" ? { border: x402Record.border ?? null, toldCount: x402Record.toldCount ?? null, outcomeCount: x402Record.outcomeCount ?? null } : null,
        paymentBooks: x402Record?.books ?? null, keptInLog: isSellerBooking ? x402Record.kept ?? null : null, customerAcceptance: "unobserved",
        revenueRecognized: x402Record?.type === "X402SellerPaymentObservation" ? false : null,
        transactionCount: Number.isInteger(x402Record?.transactionCount) ? x402Record.transactionCount : null }),
      Object.freeze({ kind: "hive-curation", state: hiveState, source: hiveCuration?.unitPath ?? null,
        scheduleConfigured: typeof hiveCuration?.configured === "boolean" ? hiveCuration.configured : null, earned: Object.freeze(curationEarned) }),
      Object.freeze({ kind: "entity-books", state: books === undefined ? "unobserved" : books.error !== undefined ? "unavailable" : "observed", ...(books ?? {}) }),
      Object.freeze({ kind: "economy", state: economy === undefined ? "unobserved" : "observed", ...(economy ?? {}) }),
      Object.freeze({ kind: "chain-reconciliation", state: chainReconciliation === undefined ? "unobserved" : chainReconciliation.error !== undefined ? "unavailable" : (chainReconciliation.rows ?? []).every((row) => row.state === "agrees") ? "agrees" : "differs",
        cutoff: chainReconciliation?.cutoff ?? null, proposal: chainReconciliation?.proposalPath ?? null, movementBook: chainReconciliation?.movementBook ?? null, rows: chainReconciliation?.rows ?? [], ...(chainReconciliation?.error ? { error: chainReconciliation.error } : {}) }),
    ]),
    earningActions: Object.freeze([
      Object.freeze({ action: "observe-x402-settlements", state: x402ObservationCurrent ? "continue" : "run", reason: x402ObservationCurrent ? "settlement evidence is current" : "settlement evidence needs a current observation" }),
      Object.freeze({ action: "run-hive-curation-cycle", state: hiveState === "observed" ? "continue" : hiveState === "configured-unobserved" ? "reconcile" : "configure", reason: hiveState === "observed" ? "the accounts' histories witness curation income" : hiveState === "configured-unobserved" ? "the earning loop is scheduled but needs a witnessed reward outcome" : "no curation schedule is available" }),
      Object.freeze({ action: "observe-wallet-balances", state: "run", reason: "the wallet registry names custody but does not itself establish current balances" }),
    ]),
    evidenceCoverage: Object.freeze({ ledger: ledgerState, walletRegistry: wallets.length > 0 ? walletState : "unknown", x402Settlements: x402State, hiveCuration: hiveState,
      chainReconciliation: chainReconciliation === undefined ? "unobserved" : chainReconciliation.error !== undefined ? "unavailable" : "observed" }),
    unresolved: Object.freeze(unresolved),
  });
}

export async function writeGroupFinancialReadout(outputRoot, readout) {
  if (typeof outputRoot !== "string" || outputRoot.trim() === "") throw new TypeError("group-financial-readout-output-root-required");
  const directory = join(outputRoot, "records", "group-financial");
  await mkdir(directory, { recursive: true });
  const filename = `${readout.asOf.replace(/[:.]/gu, "-")}-group-financial-readout.json`;
  const destination = join(directory, filename);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(readout, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
  return destination;
}
