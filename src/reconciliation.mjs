// The books against the chain: the second witness the daily financial readout lacked ("ledger
// reconciliation has not been independently observed"). farolfi's chain-balance derivation reads
// what the Group's custody wallets hold on Hive, Hive-Engine and Base at a cutoff and proposes the
// balance assertions that would say so; this module reads, for each, what the books say the same
// account held at the same date, and states the difference as movement the books have not booked.
// The node records each day's reading; the book of chain movements is their projection, rewritten
// whole from those records and the other books, and never appended to.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { balance, balanceAt, isTransaction, open, posting, transaction } from "@red-cup-engineering/organizing/accounting/ledger";
import { printEntries } from "@red-cup-engineering/organizing/accounting/report";
import { DECREASE_ACCOUNT, INCREASE_ACCOUNT, deriveSetOfCandidateTransactions } from "@red-cup-engineering/farolfi/ledger/maintenance/candidate-transactions";
import { classesByMovement } from "./chain-classification.mjs";
import { gradedNegate, gradedOfDecimal, gradedSign, gradedSubtract, gradedToDecimalString, gradedIsZero } from "@red-cup-engineering/exact-number-data-service/graded";

const BALANCE = /^(\d{4}-\d{2}-\d{2}) balance (\S+)\s+(-?[\d.]+)\s+(\S+)/u;
const META = /^\s+([a-z_]+):\s+"([^"]*)"/u;

/**
 * The balance assertions a chain-balance proposal's text makes, as `{date, account, amount,
 * commodity, cutoff?, sourceId?}`, each with the chain reading it rests on.
 */
export function readingsOfProposalText(text) {
  const readings = [];
  let current;
  for (const line of String(text).split("\n")) {
    const head = BALANCE.exec(line);
    if (head !== null) {
      current = { date: head[1], account: head[2], amount: head[3], commodity: head[4] };
      readings.push(current);
      continue;
    }
    const meta = META.exec(line);
    if (meta === null) { current = undefined; continue; }
    if (current === undefined) continue;
    if (meta[1] === "cutoff") current.cutoff = meta[2];
    if (meta[1] === "source_id") current.sourceId = meta[2];
  }
  return Object.freeze(readings.map((reading) => Object.freeze(reading)));
}

/** The balance assertions a chain-balance proposal (farolfi `deriveChainBalanceAssertions`) makes. */
export const proposedBalancesOf = (proposal) => readingsOfProposalText((proposal?.directives ?? []).join("\n\n"));

/**
 * For each balance the chain shows, what the books held in the same account and commodity on the
 * same date (start of day, as a balance assertion reads), and the difference: `agrees` when none,
 * else `differs`, the difference being movement on the chain the books have not booked.
 * @param {ReadonlyArray<{date: string, account: string, amount: string, commodity: string}>} observed
 * @param {ReadonlyArray<object>} entries parsed entries of the entity's books (farolfi parseJournalFile)
 */
export function reconciliationOf(observed, entries) {
  const transactions = entries.filter(isTransaction);
  return Object.freeze(observed.map((row) => {
    let booked;
    try { booked = balanceAt(transactions, null, row.account, row.commodity, row.date); }
    catch { booked = undefined; }
    if (booked === undefined) return Object.freeze({ ...row, booked: null, difference: null, state: "unreadable" });
    const difference = gradedSubtract(gradedOfDecimal(row.amount, row.commodity), booked);
    return Object.freeze({ ...row, booked: gradedToDecimalString(booked), difference: gradedToDecimalString(difference), state: gradedIsZero(difference) ? "agrees" : "differs" });
  }));
}

/**
 * The movements the chain shows that the books do not, as a projection of every recorded reading.
 * Readings are taken in date order, each against the other books plus the movements booked from
 * the readings before it; each difference becomes one transaction by farolfi's candidate rule
 * (dated the day before the balance date, so that day's assertion sees it, counter-posted to the
 * unrealized gain or loss account, carrying the chain reading's source id), and each reading the
 * books can read is asserted, so the book certifies itself. Where the accounts' histories over a
 * reading's window explain a movement (`classes`, by balance date, from `movementClassesOf`), each
 * explained part is counter-posted to the account that explains it (curation, author rewards,
 * staking, transfers) and only the rest to the unrealized gain or loss. The same records give the
 * same book.
 * @param {ReadonlyArray<{date: string, account: string, amount: string, commodity: string, cutoff?: string, sourceId?: string}>} readings
 * @param {ReadonlyArray<object>} entries parsed entries of the entity's other books
 * @param {{classes?: Map<string, ReadonlyArray<{account: string, commodity: string, counter: string, amount: string}>>}} [options]
 * @returns {{entries: ReadonlyArray<object>, readings: ReadonlyArray<{date: string, rows: ReadonlyArray<object>}>}}
 */
export function chainMovementsOf(readings, entries, { classes = new Map() } = {}) {
  const byDate = new Map();
  for (const reading of readings) byDate.set(reading.date, [...(byDate.get(reading.date) ?? []), reading]);
  const opened = new Set(entries.filter((entry) => entry.directive === "open").map((entry) => entry.account));
  const booked = [];
  const read = [];
  for (const date of [...byDate.keys()].sort()) {
    const rows = reconciliationOf(byDate.get(date), [...entries, ...booked]);
    const { transactions, accountsToOpen } = deriveSetOfCandidateTransactions({
      openAccounts: [...opened],
      mismatches: rows.filter((row) => row.state === "differs").map((row) => ({
        account: row.account, commodity: row.commodity, postedBalance: row.booked, assertedBalance: row.amount,
        assertionDate: row.date, sourceId: row.sourceId ?? `CHAIN-${row.cutoff ?? row.date}`,
      })),
    });
    for (const { account, date: openedOn } of accountsToOpen) {
      booked.push(open({ date: openedOn, account }));
      opened.add(account);
    }
    const explained = classesByMovement(classes.get(date));
    for (const moved of transactions) {
      const delta = gradedOfDecimal(moved.delta, moved.commodity);
      const parts = explained.get(`${moved.account}|${moved.commodity}`) ?? [];
      let rest = delta;
      for (const { amount } of parts) rest = gradedSubtract(rest, amount);
      const counters = [
        ...parts.map(({ counter, amount }) => ({ account: counter, amount: gradedNegate(amount) })),
        ...(gradedIsZero(rest) ? [] : [{ account: gradedSign(rest) < 0 ? DECREASE_ACCOUNT : INCREASE_ACCOUNT, amount: gradedNegate(rest) }]),
      ];
      for (const { account } of counters) {
        if (opened.has(account)) continue;
        booked.push(open({ date: moved.date, account }));
        opened.add(account);
      }
      booked.push(transaction({
        date: moved.date, flag: "*", narration: parts.length === 0 ? moved.narration : `${moved.narration}, explained by the accounts' histories`,
        meta: { source_id: moved.sourceId },
        postings: [posting({ account: moved.account, amount: delta }), ...counters.map((counter) => posting(counter))],
      }));
    }
    for (const row of rows) {
      if (row.state === "unreadable") continue;
      booked.push(balance({ date: row.date, account: row.account, amount: gradedOfDecimal(row.amount, row.commodity), meta: { ...(row.cutoff ? { cutoff: row.cutoff } : {}), ...(row.sourceId ? { source_id: row.sourceId } : {}) } }));
    }
    read.push(Object.freeze({ date, rows }));
  }
  return Object.freeze({ entries: Object.freeze(booked), readings: Object.freeze(read) });
}

/** The book of chain movements' text: a header naming it a projection of the node's chain readings, then its source observations and entries. */
export function chainMovementBookText(movements, { title = "the Group's book of chain movements", sourceRecords = [] } = {}) {
  return `; ${title}, projected from the node's recorded chain readings (group-operations reconciliation).\n; A projection: do not edit; it is rewritten whole from the readings and the other books.\n${sourceRecords.map((record) => `; chain-movement-evidence ${JSON.stringify(record)}\n`).join("")}\n${movements.entries.length === 0 ? "" : `${printEntries(movements.entries)}\n`}`;
}

const RECONCILIATION = "-chain-reconciliation.json";

/**
 * The daily act of reconciling the books with the chain, as a node job (never on a request path:
 * the accounts' histories over a window are large). It records the chain reading at `cutoff`, and
 * once per reading what the Group's Hive accounts' histories over the window since the reading
 * before it say moved; rewrites the book of chain movements whole from every recorded reading;
 * and records the reconciliation the financial readout reads (`latestChainReconciliation`).
 * @param {{ledgerPath: string, readingsDirectory: string, movementBook: string, cutoff: string, otherBooks?: ReadonlyArray<string>}} input
 * @param {{deriveChainBalanceAssertions: Function, deriveLedgerForAccount: Function, parseJournalFile: Function, hiveCustodyWallets: Function, hiveAccounts: ReadonlyArray<string>, movementClassesOverWindow: Function}} deps
 */
export async function reconcileBooksWithChain({ ledgerPath, readingsDirectory, movementBook, cutoff, otherBooks = [] }, deps) {
  await mkdir(readingsDirectory, { recursive: true });
  const proposalPath = join(readingsDirectory, `${cutoff}-chain-balance-proposal.beancount`);
  const proposal = await deps.deriveChainBalanceAssertions({ ledger: ledgerPath, date: cutoff, out: proposalPath });
  const entries = [ledgerPath, ...otherBooks].filter((path) => existsSync(path)).flatMap((path) => deps.parseJournalFile(path).entries);
  const names = await readdir(readingsDirectory);
  const recorded = names.filter((name) => name.endsWith("-chain-balance-proposal.beancount")).sort();
  const readings = (await Promise.all(recorded.map((name) => readFile(join(readingsDirectory, name), "utf8")))).flatMap(readingsOfProposalText);
  const today = proposedBalancesOf(proposal)[0]?.date;
  const classesPath = join(readingsDirectory, `${cutoff}-chain-movement-classes.json`);
  if (today !== undefined && !existsSync(classesPath)) {
    const before = [...readings.map((reading) => reading.date), ...entries.filter((entry) => entry.directive === "balance" && deps.hiveAccounts.includes(entry.account)).map((entry) => entry.date)]
      .filter((date) => date < today).sort().at(-1);
    if (before !== undefined) {
      const wallets = deps.hiveCustodyWallets(readFileSync(ledgerPath, "utf8"));
      const record = await deps.movementClassesOverWindow({ wallets, from: before, to: today }, { deriveLedgerForAccount: deps.deriveLedgerForAccount });
      await writeFile(classesPath, `${JSON.stringify(record, null, 2)}\n`);
    }
  }
  const classes = new Map();
  const sourceRecords = [];
  for (const name of (await readdir(readingsDirectory)).filter((file) => file.endsWith("-chain-movement-classes.json")).sort()) {
    const record = JSON.parse(await readFile(join(readingsDirectory, name), "utf8"));
    classes.set(record.window.to, record.classes);
    sourceRecords.push({ ...record, coverage: record.coverage ?? { status: "not-established", unresolved: [] } });
  }
  const movements = chainMovementsOf(readings, entries, { classes });
  await mkdir(dirname(movementBook), { recursive: true });
  await writeFile(`${movementBook}.next`, chainMovementBookText(movements, { sourceRecords }));
  await rename(`${movementBook}.next`, movementBook);
  const day = today === undefined ? undefined : new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const reconciliation = {
    kind: "chain-reconciliation", version: 1, cutoff, observedAt: new Date().toISOString(), proposalPath, movementBook, readingCount: recorded.length,
    rows: movements.readings.find((reading) => reading.date === today)?.rows ?? [],
    explained: movements.entries.filter((entry) => entry.postings !== undefined && entry.date === day && entry.narration.endsWith("explained by the accounts' histories")).length,
    failed: [...(proposal.hive?.walletsFailed ?? []), ...(proposal.hiveEngine?.walletsFailed ?? []), ...(proposal.base?.walletsFailed ?? [])].length,
    sourceCoverage: sourceRecords.find((record) => record.window.to === today)?.coverage ?? { status: "not-established", unresolved: [] },
    sourceEvidencePath: today === undefined ? null : classesPath,
    // What the recognized histories report over this window; coverage remains separate.
    earned: (classes.get(today) ?? []).filter((row) => row.counter.startsWith("Income:"))
      .map(({ counter, commodity, amount }) => ({ account: counter, commodity, amount })),
  };
  await writeFile(join(readingsDirectory, `${cutoff}${RECONCILIATION}`), `${JSON.stringify(reconciliation, null, 2)}\n`);
  return Object.freeze(reconciliation);
}

/** The latest recorded reconciliation of the books with the chain, or undefined when none is recorded. */
export async function latestChainReconciliation(readingsDirectory) {
  let names;
  try { names = await readdir(readingsDirectory); } catch { return undefined; }
  const latest = names.filter((name) => name.endsWith(RECONCILIATION)).sort().at(-1);
  return latest === undefined ? undefined : JSON.parse(await readFile(join(readingsDirectory, latest), "utf8"));
}
