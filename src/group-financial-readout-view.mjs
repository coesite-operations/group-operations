import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { htmlRepr } from "@red-cup-engineering/http-services-section/representation";
import { readingHtml } from "@red-cup-engineering/metroplat-operations-console/control-plane";
import { guardOperators } from "@red-cup-engineering/metroplat-operations-console/people";
import { currentPeerEvidence } from "./peer-evidence.mjs";

const OBJECT_KIND = "561-group.financial-readout.v1";

function validReadout(value) {
  return value?.type === "GroupFinancialReadout" && value.version === 2 && typeof value.asOf === "string"
    && Number.isFinite(Date.parse(value.asOf)) && Array.isArray(value.observations);
}

function localReadout(dataDir) {
  if (dataDir === undefined) return null;
  const directory = join(dataDir, "records", "group-financial");
  let names;
  try { names = readdirSync(directory); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  for (const name of names.filter((item) => /^\d{4}-\d{2}-\d{2}.*-group-financial-readout\.json$/u.test(item)).sort().reverse()) {
    try {
      const value = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (validReadout(value)) return value;
    } catch { /* A broken readout does not hide an earlier admitted one. */ }
  }
  return null;
}

const validAcceptance = (value) => value?.type === "GroupAcceptanceReadout" && typeof value.week === "string" && typeof value.asOf === "string" && value.journal?.excluded?.includes("x402-settlement");

/**
 * The node's acceptance readouts (group-operations acceptance-readout job): the last complete week
 * and the week to date, read from records alone; null when neither has been produced.
 */
export function currentGroupAcceptanceReadout(dataDir) {
  if (dataDir === undefined) return null;
  const directory = join(dataDir, "records", "acceptance");
  let names;
  try { names = readdirSync(directory).sort().reverse(); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  const newest = (pattern) => {
    for (const name of names.filter((item) => pattern.test(item))) {
      try { const value = JSON.parse(readFileSync(join(directory, name), "utf8")); if (validAcceptance(value)) return value; }
      catch { /* A broken readout does not hide an earlier one. */ }
    }
    return null;
  };
  const complete = newest(/^\d{4}-W\d{2}-acceptance-readout\.json$/u);
  const toDate = newest(/^\d{4}-W\d{2}-to-date-acceptance-readout\.json$/u);
  if (complete === null && toDate === null) return null;
  return Object.freeze({
    title: "561 Group acceptance readout",
    recognition: (toDate ?? complete).recognition,
    ...(complete === null ? {} : { lastCompleteWeek: complete }),
    ...(toDate === null ? {} : { weekToDate: toDate }),
  });
}

const LEDGER = ["lib", "emsenn", "services", "561-group", "services", "561-group-services-section", "data", "logs", "ledgers", "561-group-main-ledger.beancount"];
const WALLET_REGISTRY = ["lib", "emsenn", "services", "561-group", "services", "engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-systems-engineering-services-section", "services", "computer-blockchain-system-services-section", "services", "key-management-services-section", "data", "records", "2026-09-05-wallet-registry.json"];

/**
 * The x402 sales the authored ledger books (the retired seller-booking route wrote them there), each
 * `{sourceId, date, payer, amount, currency, account, selfPaid}`: `selfPaid` when the wallet
 * registry identifies the payer as either founder (emsenn) or org (the agent swarm).\n * Both are within the 561 Group swarm economic perimeter, not external sales.
 */
export function x402SalesOf(ledgerText, registry) {
  const own = new Set((registry?.wallets ?? []).filter((wallet) => wallet.owner === "org" || wallet.owner === "founder").map((wallet) => String(wallet.address).toLowerCase()));
  return ledgerText.split(/\n(?=\d{4}-\d\d-\d\d )/u).filter((block) => /^\d{4}-\d\d-\d\d \* /u.test(block) && /Income:Sales:X402/u.test(block) && !/^\s+reverses: /mu.test(block)).flatMap((block) => {
    const payer = /payer: "([^"]+)"/u.exec(block)?.[1]?.toLowerCase();
    const sourceId = /source_id: "([^"]+)"/u.exec(block)?.[1];
    const income = /^\s+(Income:Sales:X402:\S+)\s+(-?[\d.]+) (\S+)/mu.exec(block);
    return payer && sourceId && income ? [Object.freeze({ sourceId, date: block.slice(0, 10), payer, amount: income[2].replace(/^-/u, ""), currency: income[3], account: income[1], selfPaid: own.has(payer) })] : [];
  });
}

/** Legacy booked sales paid by a wallet inside the emsenn/561 Group economic perimeter. */
export const selfPaidSalesOf = (ledgerText, registry) => x402SalesOf(ledgerText, registry).filter((sale) => sale.selfPaid);

/**
 * Compatibility query for historical legal-owner disputes. An accounting
 * posting to Assets:...:Custody is an operational record, not evidence that
 * someone other than emsenn legally owns the wallet. The "founder" and "org"
 * labels both belong to emsenn's 561 Group agent-swarm economic perimeter.
 * Without independent, explicit conflicting title evidence there is no
 * reportable legal-owner disagreement. Preserve original wallet registry
 * labels; do not demand a false binary ownership correction.
 */
export function custodyDisagreementsOf(_ledgerText, _registry) {
  return [];
}

/** A custodian-approved reclassification of legacy payment-derived income.
 * Retain the authored cash asset and transfer identity; hold the consideration
 * as pending receipts. Paying from outside the Group cannot establish acceptance.
 * No original authored entry is modified and no ruling is inferred from cash. */
export function reversalEntriesOf(sales, ruling) {
  if (ruling?.kind !== "561-group.books-ruling" || ruling.decision !== "approve") return [];
  const reversed = new Set(ruling.entries ?? []);
  const handed = new Set(ruling.handed ?? []);
  const date = String(ruling.at).slice(0, 10);
  return sales.filter((sale) => reversed.has(sale.sourceId) || handed.has(sale.sourceId)).map((sale) => [
    `${date} * "reclassify payment-derived x402 income as pending cash"`,
    `  ruling: "${ruling.id}"`,
    `  reverses: "${sale.sourceId}"`,
    `  payer: "${sale.payer}"`,
    `  ${sale.account}  ${sale.amount} ${sale.currency}`,
    `  Liabilities:Pending:X402-Receipts  -${sale.amount} ${sale.currency}`,
  ].join("\n"));
}

/**
 * What the Group's books need a person to decide: the authored ledger books sales the Group's own
 * wallets paid (x402 listings bought to seed the Bazaar), which no book should count as income.
 * Correcting the authored ledger is its custodian's act, never a projection's, so the decision is
 * one move on the obligations page: approve or decline reversing them. The ruling is recorded on the
 * node (`<webData>/records/rulings/`); the reversing entries are then landed citing it, dated the
 * day of the ruling, and nothing already booked is edited.
 * @param {{ accountHolder: string, repositoryRoot?: string, env?: NodeJS.ProcessEnv }} options
 */
export function booksObligations({ accountHolder, repositoryRoot, env = process.env }) {
  if (typeof accountHolder !== "string" || accountHolder === "") throw new TypeError("books obligations need the character who keeps the books");
  const ledgerPath = env.METROPLAT_LEDGER_JOURNAL ?? join(repositoryRoot ?? process.cwd(), ...LEDGER);
  const registryPath = env.GROUP_WALLET_REGISTRY ?? join(repositoryRoot ?? process.cwd(), ...WALLET_REGISTRY);
  if (typeof registryPath !== "string" || registryPath.trim() === "") throw new TypeError("GROUP_WALLET_REGISTRY must be a nonempty path");
  const rulings = env.METROPLAT_WEB_DATA_DIR ? join(env.METROPLAT_WEB_DATA_DIR, "records", "rulings") : undefined;
  const pending = () => {
    const sales = x402SalesOf(readFileSync(ledgerPath, "utf8"), JSON.parse(readFileSync(registryPath, "utf8")));
    const id = `x402-sales-${createHash("sha256").update(sales.map((sale) => sale.sourceId).sort().join("\n")).digest("hex").slice(0, 16)}`;
    return { id, sales };
  };
  const ruled = (id) => rulings !== undefined && existsSync(join(rulings, `${id}.json`));
  return {
    id: "books",
    title: "The Group's books",
    obligations() {
      const { id, sales } = pending();
      const own = sales.filter((sale) => sale.selfPaid);
      const outside = sales.filter((sale) => !sale.selfPaid);
      const total = (list) => list.reduce((sum, sale) => sum + Number(sale.amount), 0).toFixed(3);
      return [
        ...(sales.length === 0 || ruled(id) ? [] : [{ id, to: [accountHolder], title: `Decide whether to defer ${sales.length} payment-derived income entries`,
          why: `The main ledger books ${sales.length} x402 payments as sales, written there by a route the house has retired. ${own.length === 0 ? "" : `${own.length} of them (${total(own)} ${own[0].currency}) were paid by an emsenn/swarm wallet buying its own Bazaar listings; these are internal payments, not new outside sales. `}${outside.length === 0 ? "" : `The ${outside.length} paid by other wallets (${total(outside)} ${outside[0].currency}) also lack a qualified delivery judgment. `}Correcting the ledger is the book's custodian's decision; it takes one minute.` }]),
      ];
    },
    start(id) {
      const current = pending();
      if (current.id !== id) throw new Error("The ledger changed since this was listed. Go back and open it again.");
      const own = current.sales.filter((sale) => sale.selfPaid);
      const outside = current.sales.filter((sale) => !sale.selfPaid);
      return {
        memo: { id, sales: own.map((sale) => sale.sourceId), handed: outside.map((sale) => sale.sourceId) },
        steps: [
          ...(own.length === 0 ? [] : [`${own.length} of the main ledger's x402 sales were paid by the Group's wallet ${own[0].payer}, which the house registry attributes to emsenn or the swarm, to buy its own listings so the x402 Bazaar would catalog them (receipts: x402-services-section/data/market-561-group/records/*bazaar-seeding-receipt.json). Approving reclassifies their income as pending receipts without changing the cash asset.`]),
          ...(outside.length === 0 ? [] : [`${outside.length} were paid by an outside buyer (${[...new Set(outside.map((sale) => sale.payer))].join(", ")}). Approving reclassifies their income as pending receipts. Cash remains in the authored asset account; delivery and customer acceptance are unobserved.`]),
          "Each reversal is dated today and cites your ruling. Nothing already booked is edited.",
          "Type approve, or decline to keep them as they are, and press the button.",
        ],
        input: { label: "approve or decline", placeholder: "approve", description: "One word: approve or decline." },
      };
    },
    finish(id, memo, value) {
      const decision = String(value ?? "").trim().toLowerCase();
      if (decision !== "approve" && decision !== "decline") throw new Error("Type approve or decline.");
      const current = pending();
      if (current.id !== id) throw new Error("The ledger changed since this was listed. Go back and open it again.");
      if (ruled(id)) throw new Error("This was already answered. Go back to the list.");
      const own = current.sales.filter(sale => sale.selfPaid).map(sale => sale.sourceId).sort();
      const outside = current.sales.filter(sale => !sale.selfPaid).map(sale => sale.sourceId).sort();
      const proposedOwn = [...(memo?.sales ?? [])].sort();
      const proposedOutside = [...(memo?.handed ?? [])].sort();
      if (JSON.stringify(own) !== JSON.stringify(proposedOwn) ||
          JSON.stringify(outside) !== JSON.stringify(proposedOutside)) {
        throw new Error("The source payment identities no longer match the received request.");
      }
      if (rulings === undefined) throw new Error("This node keeps no web data, so it cannot record the ruling.");
      mkdirSync(rulings, { recursive: true });
      const path = join(rulings, `${id}.json`);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({
        kind: "561-group.books-ruling", id, decision, at: new Date().toISOString(),
        by: accountHolder, entries: own, handed: outside,
      }, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
      return { title: decision === "approve" ? "Reversal approved" : "Kept as they are",
        content: decision === "approve" ? "Recorded. The reversing entries will be landed in the main ledger citing this ruling." : "Recorded. The entries stay as booked, and this will not be asked again for these entries." };
    },
  };
}

/** Read the author node's local result or an admitted, addressed Semioverse observation. */
export function currentGroupFinancialReadout({ config, authorActor }) {
  const author = new URL(authorActor);
  const localOrigin = new URL(config.publicBaseUrl).origin;
  if (author.origin === localOrigin) return localReadout(config.dataDir);
  return currentPeerEvidence({ config, authorActor, objectKind: OBJECT_KIND, validValue: validReadout });
}

export function groupFinancialReadoutView({ config, configuration = {} }) {
  const authorActor = configuration.authorActor;
  if (typeof authorActor !== "string" || new URL(authorActor).protocol !== "https:") throw new TypeError("Group readout requires its author actor");
  const navigation = Object.assign([
    { href: "/play", label: "Play" },
    { href: "/tasks/view", label: "Work" },
    { href: "/books/view", label: "Books" },
    { href: "/books/group-readout", label: "Daily readout" },
    { href: "/books/acceptance", label: "Acceptance" },
  ], { title: config.instance.title });
  const resources = [{
    id: "ops-control-plane.group-financial-readout", match: "/books/group-readout",
    methods: ["GET"], produces: ["text/html"],
    handler: () => {
      const record = currentGroupFinancialReadout({ config, authorActor });
      if (record === null) return htmlRepr(readingHtml(navigation, { error: "group_financial_readout_unavailable" }, "Daily readout unavailable", "/books/group-readout"), { status: 503, cacheControl: { noStore: true } });
      return htmlRepr(readingHtml(navigation, record, typeof record.title === "string" ? record.title : "Daily readout", "/books/group-readout"), { cacheControl: { noStore: true } });
    },
  }, {
    id: "ops-control-plane.group-acceptance-readout", match: "/books/acceptance",
    methods: ["GET"], produces: ["text/html"],
    handler: () => {
      const record = currentGroupAcceptanceReadout(config.dataDir);
      if (record === null) return htmlRepr(readingHtml(navigation, { error: "group_acceptance_readout_unavailable" }, "Acceptance readout unavailable", "/books/acceptance"), { status: 503, cacheControl: { noStore: true } });
      return htmlRepr(readingHtml(navigation, record, record.title, "/books/acceptance"), { cacheControl: { noStore: true } });
    },
  }];
  return { applications: [guardOperators({ resources }, () => true, {
    stateDir: config.stateDir, allowedEmail: config.allowedEmail, navigation, navigationTitle: navigation.title,
  })] };
}
