// What the chain's movements were. A reading says only that a custody account's balance moved; the
// accounts' own histories say why: curation and author rewards, staking distributions, transfers
// in and out. The Hive ledger section derives one Hive account's ledger over a window
// (hive-auto-ledger `deriveLedgerForAccount`, booking each reward once at its chain-confirmed
// claim); this module reads those ledgers onto the Group's books, whose Hive holdings are
// aggregates (Hive:Liquid, Hive:Staked, HiveEngine:Unclassified) across every custody account,
// and totals, per aggregate account and commodity, the movement each counter account explains.
// Transfers between two of the Group's own accounts move nothing in the aggregate and explain
// nothing; a movement the histories do not explain stays unclassified in the book.
import { parseJournalText } from "@red-cup-engineering/farolfi/journal";
import { isTransaction } from "@red-cup-engineering/organizing/accounting/ledger";
import { gradeOf, gradedAdd, gradedIsZero, gradedNegate, gradedOfDecimal, gradedToDecimalString } from "@red-cup-engineering/computer-data-engineering-services-section/number/graded";

export const HIVE_LIQUID_ACCOUNT = "Assets:Digital-Assets:Hive:Liquid";
export const HIVE_STAKED_ACCOUNT = "Assets:Digital-Assets:Hive:Staked";
export const HIVE_ENGINE_ACCOUNT = "Assets:Digital-Assets:HiveEngine:Unclassified";

const HIVE_CUSTODY = /^Assets:Digital-Assets:Hive:Custody:[^:]+$/u;
const HIVE_ENGINE_CUSTODY = /^Assets:Digital-Assets:HiveEngine:Custody:[^:]+(?::Staked)?$/u;
const COUNTER = /^(?:Income|Expenses|Equity):/u;
const OPENING = "Equity:Opening-Balances";
const TRANSFER = /transfer (?:from|to) ([a-z0-9.-]+)$/u;

/**
 * The aggregate account of the Group's books a derived custody posting is part of, as the chain
 * reading reads it (liquid HIVE and HBD; owned VESTS; Hive-Engine balance plus stake); undefined
 * for a sub-account the reading does not count (savings, pending unstake, delegated out).
 */
export function aggregateAccountOf(account, commodity) {
  if (HIVE_CUSTODY.test(account)) return commodity === "VESTS" ? HIVE_STAKED_ACCOUNT : HIVE_LIQUID_ACCOUNT;
  if (HIVE_ENGINE_CUSTODY.test(account)) return HIVE_ENGINE_ACCOUNT;
  return undefined;
}

/** Where the books hold what a custody sub-account the chain reading does not count holds. */
export const HELD_ACCOUNTS = Object.freeze([
  [/^Assets:Digital-Assets:Hive:Custody:[^:]+:Savings$/u, "Assets:Digital-Assets:Hive:Savings"],
  [/^Assets:Digital-Assets:HiveEngine:Custody:[^:]+:Pending-Unstake$/u, "Assets:Digital-Assets:HiveEngine:Pending-Unstake"],
  [/^Assets:Digital-Assets:HiveEngine:Custody:[^:]+:Delegated-Out$/u, "Assets:Digital-Assets:HiveEngine:Delegated-Out"],
]);

/** The account the books hold a custody sub-account's holding in, or undefined for any other account. */
export const heldAccountOf = (account) => HELD_ACCOUNTS.find(([pattern]) => pattern.test(account))?.[1];

/** Where a conversion between two commodities inside the Group's custody (a power-up, a market fill) is counter-posted. */
export const CONVERSIONS_ACCOUNT = "Equity:Conversions";

/**
 * The movement each counter account explains, from derived Hive account ledgers over one window:
 * `[{account, commodity, counter, amount}]`, `amount` the custody side's change (decimal text),
 * summed across accounts, sorted. What moves into a sub-account the reading does not count
 * (savings, pending unstake, delegated out) is explained by the account the books hold it in, still
 * the Group's; what one commodity becomes another inside custody is explained by conversions. A
 * transaction's opening block, and a transfer whose other party is one of the Group's own accounts
 * (`internal`, public account names), are left out.
 * @param {ReadonlyArray<string>} ledgerTexts derived ledgers' Beancount text
 * @param {{internal?: ReadonlySet<string>}} [options]
 */
export function movementClassesOf(ledgerTexts, { internal = new Set() } = {}) {
  const totals = new Map();
  for (const text of ledgerTexts) {
    for (const entry of parseJournalText(text).entries) {
      if (!isTransaction(entry) || entry.postings.some((posting) => posting.account === OPENING)) continue;
      const party = TRANSFER.exec(entry.narration ?? "")?.[1];
      if (party !== undefined && internal.has(party)) continue;
      const commodities = new Set(entry.postings.filter((posting) => posting.amount).map((posting) => gradeOf(posting.amount)));
      for (const commodity of commodities) {
        const inCommodity = entry.postings.filter((posting) => posting.amount && gradeOf(posting.amount) === commodity);
        const aggregates = new Set(inCommodity.map((posting) => aggregateAccountOf(posting.account, commodity)).filter(Boolean));
        if (aggregates.size !== 1) continue;
        const [account] = aggregates;
        const add = (counter, explained) => {
          const key = `${account}\u0000${commodity}\u0000${counter}`;
          totals.set(key, totals.has(key) ? gradedAdd(totals.get(key), explained) : explained);
        };
        const counters = inCommodity.filter((posting) => COUNTER.test(posting.account) || heldAccountOf(posting.account) !== undefined);
        for (const counter of counters) add(heldAccountOf(counter.account) ?? counter.account, gradedNegate(counter.amount));
        const custodyOnly = entry.postings.every((posting) => aggregateAccountOf(posting.account, gradeOf(posting.amount ?? { grade: commodity })) !== undefined || heldAccountOf(posting.account) !== undefined);
        if (counters.length === 0 && commodities.size > 1 && custodyOnly) {
          let moved;
          for (const posting of inCommodity) moved = moved === undefined ? posting.amount : gradedAdd(moved, posting.amount);
          if (moved !== undefined && !gradedIsZero(moved)) add(CONVERSIONS_ACCOUNT, moved);
        }
      }
    }
  }
  return Object.freeze([...totals].filter(([, amount]) => !gradedIsZero(amount)).sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => {
    const [account, commodity, counter] = key.split("\u0000");
    return Object.freeze({ account, commodity, counter, amount: gradedToDecimalString(amount) });
  }));
}

/** The classes recorded for one window, indexed `account|commodity` → `[{counter, amount}]`, as graded amounts. */
export function classesByMovement(classes = []) {
  const indexed = new Map();
  for (const { account, commodity, counter, amount } of classes) {
    const key = `${account}|${commodity}`;
    indexed.set(key, [...(indexed.get(key) ?? []), Object.freeze({ counter, amount: gradedOfDecimal(amount, commodity) })]);
  }
  return indexed;
}

/**
 * Derive every Group Hive account's ledger over one reading's window (`from`, `to`: the balance
 * dates of the reading before it and of it) and total what explains its movements. An account
 * whose history cannot be read is named in `failed` and explains nothing; its movement stays
 * unclassified rather than guessed.
 * @param {{wallets: ReadonlyArray<{account: string, publicAccount: string}>, from: string, to: string}} window
 * @param {{deriveLedgerForAccount: (options: object) => Promise<{ledgerResult: {ledgerText: string}}>}} deps
 */
export async function movementClassesOverWindow({ wallets, from, to }, { deriveLedgerForAccount }) {
  const internal = new Set(wallets.map((wallet) => wallet.publicAccount));
  const derived = await Promise.all(wallets.map(async ({ publicAccount }) => {
    try {
      const result = await deriveLedgerForAccount({ account: publicAccount, rangeStart: from, rangeEnd: to });
      return { account: publicAccount, ledgerText: result.ledgerResult.ledgerText,
        coverage: result.coverage ?? { status: "not-established", unresolved: [] }, evidence: result.evidence ?? null };
    }
    catch (error) { return { account: publicAccount, error: error instanceof Error ? error.message : String(error) }; }
  }));
  return Object.freeze({
    kind: "chain-movement-classes", version: 1, window: Object.freeze({ from, to }),
    accounts: Object.freeze(derived.filter((row) => row.ledgerText !== undefined).map((row) => row.account)),
    failed: Object.freeze(derived.filter((row) => row.error !== undefined).map(({ account, error }) => Object.freeze({ account, error }))),
    observations: Object.freeze(derived.map((row) => Object.freeze(row))),
    coverage: Object.freeze({ status: derived.some((row) => row.error !== undefined || row.coverage?.status === "unresolved") ? "unresolved" : "not-established",
      unresolved: Object.freeze(derived.flatMap((row) => row.error !== undefined
        ? [{ account: row.account, source: "account-derivation", detail: row.error }]
        : (row.coverage?.unresolved ?? []).map((item) => ({ ...item, account: row.account })))) }),
    classes: movementClassesOf(derived.filter((row) => row.ledgerText !== undefined).map((row) => row.ledgerText), { internal }),
  });
}
