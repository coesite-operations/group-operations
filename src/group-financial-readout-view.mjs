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
 * registry names the payer as emsenn's founder wallet or an org wallet. Both are within the
 * 561 Group agent swarm's economic perimeter: moving money between them is no outside sale.
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

/** Retired seller route's supposed sales paid by wallets within the same emsenn/swarm economic perimeter. */
export const selfPaidSalesOf = (ledgerText, registry) => x402SalesOf(ledgerText, registry).filter((sale) => sale.selfPaid);

/**
 * Wallets the books and the registry disagree about: an address the authored ledger holds in the
 * Group's custody (an `Assets:…:Custody:` account's note naming it) that the key-management registry
 * says is the founder's. Each is `{address, ledgerAccount, registryOwner}`.
 */
export function custodyDisagreementsOf(ledgerText, registry) {
  const owners = new Map((registry?.wallets ?? []).map((wallet) => [String(wallet.address).toLowerCase(), wallet.owner]));
  const held = [...ledgerText.matchAll(/^\d{4}-\d\d-\d\d note (Assets:[^\s]*Custody[^\s]*) "EVM address (0x[0-9a-fA-F]{40})"/gmu)];
  return held.flatMap(([, ledgerAccount, address]) => owners.get(address.toLowerCase()) === "founder"
    ? [Object.freeze({ address, ledgerAccount, registryOwner: "founder" })] : []);
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
  const registryPath = join(repositoryRoot ?? process.cwd(), ...WALLET_REGISTRY);
  const rulings = env.METROPLAT_WEB_DATA_DIR ? join(env.METROPLAT_WEB_DATA_DIR, "records", "rulings") : undefined;
  const pending = () => {
    const sales = x402SalesOf(readFileSync(ledgerPath, "utf8"), JSON.parse(readFileSync(registryPath, "utf8")));
    const id = `x402-sales-${createHash("sha256").update(sales.map((sale) => sale.sourceId).sort().join("\n")).digest("hex").slice(0, 16)}`;
    return { id, sales };
  };
  const ruled = (id) => rulings !== undefined && existsSync(join(rulings, `${id}.json`));
  // One seed has one holder: the question names each custody credential once, and is asked once for
  // all of them, since the registry marked them by one rule.
  const credentialOf = (ledgerAccount) => /:Custody:([^:]+)/u.exec(ledgerAccount)?.[1] ?? ledgerAccount;
  const custodyOwed = () => {
    const byCredential = new Map();
    for (const wallet of custodyDisagreementsOf(readFileSync(ledgerPath, "utf8"), JSON.parse(readFileSync(registryPath, "utf8")))) {
      // Founder-held wallets belong to the same swarm economic perimeter.
      // A group operating-book entry does not prove a distinct legal owner.
      // Do not force a binary "group versus founder" ownership rewrite.
      if (wallet.registryOwner === "founder") continue;
      const credential = credentialOf(wallet.ledgerAccount);
      (byCredential.get(credential) ?? byCredential.set(credential, []).get(credential)).push(wallet);
    }
    if (byCredential.size === 0) return [];
    const credentials = [...byCredential.keys()].sort();
    const id = `custody-${createHash("sha256").update(credentials.join("\n")).digest("hex").slice(0, 16)}`;
    return ruled(id) ? [] : [{ id, credentials, byCredential }];
  };
  return {
    id: "books",
    title: "The Group's books",
    obligations() {
      const { id, sales } = pending();
      const own = sales.filter((sale) => sale.selfPaid);
      const outside = sales.filter((sale) => !sale.selfPaid);
      const total = (list) => list.reduce((sum, sale) => sum + Number(sale.amount), 0).toFixed(3);
      const custody = custodyOwed();
      return [
        ...(sales.length === 0 || ruled(id) ? [] : [{ id, to: [accountHolder], title: `Decide whether to defer ${sales.length} payment-derived income entries`,
          why: `The main ledger books ${sales.length} x402 payments as sales, written there by a route the house has retired. ${own.length === 0 ? "" : `${own.length} of them (${total(own)} ${own[0].currency}) were paid by an emsenn/swarm-controlled wallet buying its own listings for the x402 Bazaar, and a new outside sale needs a payer outside that economic perimeter. `}${outside.length === 0 ? "" : `The ${outside.length} paid by other wallets (${total(outside)} ${outside[0].currency}) also lack a qualified delivery judgment. `}Correcting the ledger is the book's custodian's decision; it takes one minute.` }]),
        ...custody.map((entry) => ({ id: entry.id, to: [accountHolder], title: `Say whose wallets ${entry.credentials.length} keys hold`,
          why: `The main ledger holds the wallets of ${entry.credentials.length} keys (${entry.credentials.join(", ")}) in the Group's custody, but the wallet registry marks them as the founder's own. One of them receives the x402 market's sales. Only their holder can say which is true, and the books are wrong until the records agree.` })),
      ];
    },
    start(id) {
      if (id.startsWith("custody-")) {
        const entry = custodyOwed().find((candidate) => candidate.id === id);
        if (entry === undefined) throw new Error("This was already answered. Go back to the list.");
        return {
          memo: { id, credentials: entry.credentials },
          steps: [
            `The main ledger holds, in the Group's custody, wallets of these keys: ${entry.credentials.map((credential) => `${credential} (${entry.byCredential.get(credential).map((wallet) => wallet.address).join(", ")})`).join("; ")}.`,
            "The key-management wallet registry marks all of them as the founder's own. 0x32886F6F… is the payout address of the 561 Group's x402 market.",
            "Type group if every one is the Group's, founder if every one is yours, or the names of the keys that are yours, separated by commas. The records that are wrong are then corrected to match, citing your answer.",
          ],
          input: { label: "group, founder, or your keys", placeholder: "group", description: "group, founder, or e.g. XYO-WALLET, MOONSHOT-WALLET" },
        };
      }
      const current = pending();
      if (current.id !== id) throw new Error("The ledger changed since this was listed. Go back and open it again.");
      const own = current.sales.filter((sale) => sale.selfPaid);
      const outside = current.sales.filter((sale) => !sale.selfPaid);
      return {
        memo: { id, sales: own.map((sale) => sale.sourceId), handed: outside.map((sale) => sale.sourceId) },
        steps: [
          ...(own.length === 0 ? [] : [`${own.length} of the main ledger's x402 sales were paid by the Group's wallet ${own[0].payer}, which the registry holds within emsenn's and the swarm's economic perimeter, to buy listings so the x402 Bazaar would catalog them (receipts: x402-services-section/data/market-561-group/records/*bazaar-seeding-receipt.json). Approving reclassifies their income as pending receipts without changing the cash asset.`]),
          ...(outside.length === 0 ? [] : [`${outside.length} were paid by an outside buyer (${[...new Set(outside.map((sale) => sale.payer))].join(", ")}). Approving reclassifies their income as pending receipts. Cash remains in the authored asset account; delivery and customer acceptance are unobserved.`]),
          "Each reversal is dated today and cites your ruling. Nothing already booked is edited.",
          "Type approve, or decline to keep them as they are, and press the button.",
        ],
        input: { label: "approve or decline", placeholder: "approve", description: "One word: approve or decline." },
      };
    },
    finish(id, memo, value) {
      const decision = String(value ?? "").trim().toLowerCase();
      const custody = id.startsWith("custody-");
      const named = custody ? String(value ?? "").split(",").map((name) => name.trim().toUpperCase()).filter(Boolean) : [];
      const founders = !custody ? [] : decision === "founder" ? memo?.credentials ?? [] : decision === "group" ? [] : named;
      if (custody && decision !== "group" && decision !== "founder" && (named.length === 0 || named.some((name) => !(memo?.credentials ?? []).includes(name)))) throw new Error(`Type group, founder, or names from: ${(memo?.credentials ?? []).join(", ")}.`);
      if (!custody && decision !== "approve" && decision !== "decline") throw new Error("Type approve or decline.");
      if (rulings === undefined) throw new Error("This node keeps no web data, so it cannot record the ruling.");
      mkdirSync(rulings, { recursive: true });
      const path = join(rulings, `${id}.json`);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ kind: "561-group.books-ruling", id, decision, at: new Date().toISOString(), by: accountHolder, entries: memo?.sales ?? [], ...(custody ? {} : { handed: memo?.handed ?? [] }), ...(custody ? { credentials: memo?.credentials ?? [], founders, group: (memo?.credentials ?? []).filter((name) => !founders.includes(name)) } : {}) }, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
      if (custody) return { title: founders.length === 0 ? "All the Group's" : `${founders.length} yours`, content: "Recorded. The records that disagree will be corrected to match, citing this answer." };
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
