import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDecimalStrings } from "@red-cup-engineering/exact-number-data-service/decimal-string";
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
 * `{sourceId, date, payer, amount, currency, account, selfPaid, payerClass}`. A payer
 * listed as founder/org in the configured internal-wallet registry is `registered-internal`.
 * Absence from that registry is `unresolved`, NOT evidence of an external customer;
 * the original payment/commerce witness alone can qualify outside-party status.
 */
export function x402SalesOf(ledgerText, registry) {
  const own = new Set((registry?.wallets ?? []).filter((wallet) => wallet.owner === "org" || wallet.owner === "founder").map((wallet) => String(wallet.address).toLowerCase()));
  return ledgerText.split(/\n(?=\d{4}-\d\d-\d\d )/u).filter((block) =>
    /^\d{4}-\d\d-\d\d \* /u.test(block) &&
    /^[ \t]+Income:Sales:X402(?::\S+)?(?:\s|$)/mu.test(block) &&
    !/^[ \t]+reverses: /mu.test(block)).map((block) => {
    const payer = /payer: "([^"]+)"/u.exec(block)?.[1]?.toLowerCase();
    const sourceId = /source_id: "([^"]+)"/u.exec(block)?.[1];
    // An omitted or unreadable original posting is UNKNOWN, never a zero sale.
    // Require exactly one unambiguous historical X402 income leg per sale.
    const postings = block.split("\n").map((line) => line.trim())
      .filter((line) => /^Income:Sales:X402(?::\S+)?(?:\s|$)/u.test(line));
    const income = postings.length === 1
      ? /^(Income:Sales:X402:\S+)[ \t]+(-[0-9]+(?:\.[0-9]+)?)[ \t]+([A-Z][A-Z0-9._-]*)$/u.exec(postings[0])
      : null;
    if (!payer || !sourceId || !income || !/[1-9]/u.test(income[2]))
      throw new Error("Incomplete or ambiguous x402 sale posting: source ID, payer, one nonzero negative income leg and denomination required.");
    const registeredInternal = own.has(payer);
    return Object.freeze({ sourceId, date: block.slice(0, 10), payer, amount: income[2].slice(1),
      currency: income[3], account: income[1], selfPaid: registeredInternal,
      payerClass: registeredInternal ? "registered-internal" : "unresolved" });
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

/** Edition of the exact original book and registry bytes reviewed by the custodian. */
export function booksSourcesEditionOf(ledgerText, registryText) {
  if (typeof ledgerText !== "string" || typeof registryText !== "string")
    throw new TypeError("Reversal receiving requires original ledger and registry source bytes.");
  return createHash("sha256").update(JSON.stringify([ledgerText, registryText])).digest("hex");
}

/** Stable source-qualified sale projection; detect duplicate or malformed original records. */
function reviewedSaleDigestOf(sales) {
  if (!Array.isArray(sales)) throw new TypeError("Reviewed sales must be an array.");
  const columns = ["sourceId", "date", "payer", "amount", "currency", "account", "payerClass"];
  const rows = sales.map((sale) => columns.map((column) => {
    const value = sale?.[column];
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError(`Reviewed x402 sale lacks ${column}.`);
    return value;
  }));
  if (new Set(rows.map((row) => row[0])).size !== rows.length)
    throw new Error("Duplicate x402 source IDs require source-book reconciliation.");
  if (rows.some((row) => !/^[0-9]+(?:[.][0-9]+)?$/u.test(row[3])))
    throw new TypeError("Reviewed x402 sale has a malformed decimal amount.");
  rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** A custodian-approved reclassification of legacy payment-derived income.
 * Retain the authored cash asset and transfer identity; hold the consideration
 * as pending receipts. Paying from outside the Group cannot establish acceptance.
 * No original authored entry is modified and no ruling is inferred from cash. */
export function reversalEntriesOf(sales, ruling, { ledgerText, registryText } = {}) {
  if (ruling?.kind !== "561-group.books-ruling" || ruling.decision !== "approve") return [];
  // Keep historical unfenced rulings as evidence, but never reinterpret their
  // approvals as authority to reclassify an arbitrary later book edition.
  if (typeof ruling.sourceEdition !== "string" || typeof ruling.reviewedSalesDigest !== "string")
    throw new Error("Unfenced historical books ruling: manual source-qualified receiving required.");
  if (booksSourcesEditionOf(ledgerText, registryText) !== ruling.sourceEdition)
    throw new Error("The source book or wallet registry edition changed after the approved ruling.");
  const observed = x402SalesOf(ledgerText, JSON.parse(registryText));
  if (reviewedSaleDigestOf(observed) !== reviewedSaleDigestOf(sales))
    throw new Error("Reversal sales differ from the original source reading.");
  const reversed = new Set(ruling.entries ?? []);
  const handed = new Set(ruling.handed ?? []);
  if (reversed.size !== (ruling.entries ?? []).length ||
      handed.size !== (ruling.handed ?? []).length ||
      [...reversed].some((id) => handed.has(id)))
    throw new Error("Approved ruling has duplicate or overlapping source identities.");
  const selected = sales.filter((sale) => reversed.has(sale.sourceId) || handed.has(sale.sourceId));
  if (selected.length !== reversed.size + handed.size ||
      reviewedSaleDigestOf(selected) !== ruling.reviewedSalesDigest)
    throw new Error("Approved ruling no longer matches the exact reviewed sales.");
  const date = String(ruling.at).slice(0, 10);
  return selected.map((sale) => [
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
    const ledgerText = readFileSync(ledgerPath, "utf8");
    const registryText = readFileSync(registryPath, "utf8");
    const sales = x402SalesOf(ledgerText, JSON.parse(registryText));
    const id = `x402-sales-${createHash("sha256").update(sales.map((sale) => sale.sourceId).sort().join("\n")).digest("hex").slice(0, 16)}`;
    // The identity-based Work/ruling key remains stable for historical custody.
    // Separately fence approval to BOTH source editions: unchanged source IDs
    // do not imply unchanged amounts, denomination, or registry evidence.
    reviewedSaleDigestOf(sales); // refuse ambiguous or malformed source before the bookkeeper review
    const edition = booksSourcesEditionOf(ledgerText, registryText);
    return { id, sales, edition };
  };
  const ruled = (id) => rulings !== undefined && existsSync(join(rulings, `${id}.json`));
  return {
    id: "books",
    title: "The Group's books",
    obligations() {
      const { id, sales } = pending();
      const own = sales.filter((sale) => sale.selfPaid);
      const unresolved = sales.filter((sale) => sale.payerClass === "unresolved");
      // A payment is dimensioned by its source denomination. Use the existing
      // exact-number primitive, never Number or a guessed exchange conversion.
      const totalsByUnit = (list) => {
        const amountsByUnit = new Map();
        for (const { amount, currency } of list) {
          const amounts = amountsByUnit.get(currency) ?? [];
          amounts.push(amount);
          amountsByUnit.set(currency, amounts);
        }
        return [...amountsByUnit].sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, amounts]) => `${addDecimalStrings(amounts)} ${currency}`).join("; ");
      };
      return [
        ...(sales.length === 0 || ruled(id) ? [] : [{ id, to: [accountHolder], title: `Decide whether to defer ${sales.length} payment-derived income entries`,
          why: `The main ledger books ${sales.length} x402 payments as sales, written there by a route the house has retired. ${own.length === 0 ? "" : `${own.length} of them (${totalsByUnit(own)}) were paid by an emsenn/swarm wallet buying its own Bazaar listings; these are internal payments, not new outside sales. `}${unresolved.length === 0 ? "" : `${unresolved.length} payer wallets (${totalsByUnit(unresolved)}) are not in the configured internal-wallet registry; their external/related-party status is unverified and delivery judgment is also missing. `}Correcting the ledger is the book's custodian's decision; it takes one minute.` }]),
      ];
    },
    start(id) {
      const current = pending();
      if (current.id !== id) throw new Error("The ledger changed since this was listed. Go back and open it again.");
      const own = current.sales.filter((sale) => sale.selfPaid);
      const unresolved = current.sales.filter((sale) => sale.payerClass === "unresolved");
      return {
        // `handed` is retained as a historical ruling field; it does not
        // certify that a payer outside the known internal registry is external.
        memo: { id, sales: own.map((sale) => sale.sourceId), handed: unresolved.map((sale) => sale.sourceId), sourceEdition: current.edition },
        steps: [
          ...(own.length === 0 ? [] : [`${own.length} of the main ledger's x402 sales were paid by the Group's wallet ${own[0].payer}, which the house registry attributes to emsenn or the swarm, to buy its own listings so the x402 Bazaar would catalog them (receipts: x402-services-section/data/market-561-group/records/*bazaar-seeding-receipt.json). Approving reclassifies their income as pending receipts without changing the cash asset.`]),
          ...(unresolved.length === 0 ? [] : [`${unresolved.length} payments have payer wallets (${[...new Set(unresolved.map((sale) => sale.payer))].join(", ")}) absent from the configured internal registry. Their outside-versus-internal origin is UNRESOLVED, not a verified external buyer. Approving reclassifies their income as pending receipts. Cash remains in the authored asset account; delivery and customer acceptance are unobserved.`]),
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
      const unresolved = current.sales.filter(sale => sale.payerClass === "unresolved").map(sale => sale.sourceId).sort();
      const proposedOwn = [...(memo?.sales ?? [])].sort();
      const proposedUnresolved = [...(memo?.handed ?? [])].sort();
      if (JSON.stringify(own) !== JSON.stringify(proposedOwn) ||
          JSON.stringify(unresolved) !== JSON.stringify(proposedUnresolved)) {
        throw new Error("The source payment identities no longer match the received request.");
      }
      if (memo?.sourceEdition !== current.edition) {
        throw new Error("The source book or wallet registry edition changed after this review was prepared.");
      }
      if (rulings === undefined) throw new Error("This node keeps no web data, so it cannot record the ruling.");
      mkdirSync(rulings, { recursive: true });
      const path = join(rulings, `${id}.json`);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({
        kind: "561-group.books-ruling", id, decision, at: new Date().toISOString(),
        // Legacy `handed` denotes unresolved non-internal-registry entries,
        // not evidence that their payer was external.
        by: accountHolder, entries: own, handed: unresolved,
        sourceEdition: current.edition, reviewedSalesDigest: reviewedSaleDigestOf(current.sales),
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
