import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { bookedSourcesOf } from "../src/acceptance.mjs";
import { booksObligations, custodyDisagreementsOf, reversalEntriesOf, x402SalesOf } from "../src/group-financial-readout-view.mjs";

const OWN = "0x42f72c0a340a4a55c082fe42483e87691d2bff64";
const STRANGER = "0xec2abd3eda89bed90124736e317e847d5fb6d034";
const sale = (date, payer, id) => `${date} * "x402 revenue via translation"
  source_id: "${id}"
  payer: "${payer}"
  Assets:Digital-Assets:EVM:Base:Tokens  0.01 USDC
  Income:Sales:X402:Translation  -0.01 USDC
`;
const ledger = [sale("2026-09-27", OWN, "evm:own"), sale("2026-09-28", STRANGER, "evm:stranger")].join("\n");
const registry = { wallets: [{ address: OWN, owner: "org" }] };

test("the authored ledger's x402 sales are told apart: the Group paying itself is no sale", () => {
  assert.deepEqual(x402SalesOf(ledger, registry).map((item) => [item.sourceId, item.selfPaid]), [["evm:own", true], ["evm:stranger", false]]);
});

test("emsenn founder and org wallets both count as internal to the swarm, but an outside payer does not", () => {
  for (const owner of ["founder", "org"]) {
    const attribution = x402SalesOf(ledger, { wallets: [{ owner, address: OWN.toUpperCase() }] });
    assert.deepEqual(attribution.map(({ sourceId, selfPaid }) => [sourceId, selfPaid]), [
      ["evm:own", true], ["evm:stranger", false],
    ]);
  }
});

test("unknown x402 payer provenance never becomes an asserted external buyer", () => {
  const known = x402SalesOf(ledger, registry);
  assert.deepEqual(known.map(x => [x.sourceId, x.selfPaid, x.payerClass]), [
    ["evm:own", true, "registered-internal"],
    ["evm:stranger", false, "unresolved"],
  ], "known internal registration is positive-only, not an exhaustive external party census");

  for (const incomplete of [undefined, { wallets: [] }, {
    wallets: [{ address: STRANGER, owner: "external" }],
  }]) {
    assert.deepEqual(x402SalesOf(ledger, incomplete).map(x => x.payerClass),
      ["unresolved", "unresolved"],
      "missing registry and unsupported outside-owner labels cannot authenticate a third party");
  }

  const root = mkdtempSync(join(tmpdir(), "swarm-payer-unknown-"));
  const ledgerPath = join(root, "original-ledger.beancount");
  const registryPath = join(root, "incomplete-wallet-registry.json");
  writeFileSync(ledgerPath, ledger);
  writeFileSync(registryPath, JSON.stringify(registry));
  const books = booksObligations({ accountHolder: "emsenn",
    env: { METROPLAT_LEDGER_JOURNAL: ledgerPath,
      GROUP_WALLET_REGISTRY: registryPath, METROPLAT_WEB_DATA_DIR: join(root, "web") } });
  const [due] = books.obligations();
  assert.ok(due, "the existing original bookkeeper review remains due");
  assert.match(due.why, /external\/related-party status is unverified/u);
  assert.doesNotMatch(due.why, /verified external buyer|paid by an outside buyer/iu);
  const started = books.start(due.id);
  assert.match(started.steps.join("\n"), /origin is UNRESOLVED/u);
  assert.doesNotMatch(started.steps.join("\n"), /paid by an outside buyer/iu);
  assert.deepEqual(started.memo, {
    id: due.id, sales: ["evm:own"], handed: ["evm:stranger"],
  }, "old ruling field identities stay stable; 'handed' does not verify outsider status");

  // A wallet-registry visibility change cannot reuse the old consent packet:
  // the Work id is source-payment-stable, but the original pending class split
  // must be re-assayed before a competent bookkeeper signs any new ruling.
  writeFileSync(registryPath, JSON.stringify({ wallets: [] }));
  const [emptyDue] = books.obligations();
  assert.ok(emptyDue, "no data in the registry is not a zero-income determination");
  const nowUnresolved = books.start(emptyDue.id);
  assert.deepEqual(nowUnresolved.memo, {
    id: due.id, sales: [], handed: ["evm:own", "evm:stranger"],
  });
  assert.match(nowUnresolved.steps.join("\n"), /origin is UNRESOLVED/u);
  assert.throws(() => books.finish(due.id, started.memo, "approve"),
    /source payment identities no longer match/u,
    "stale positive-internal classification must not authorize a changed ruling");
  assert.equal(readFileSync(ledgerPath, "utf8"), ledger,
    "classification must not mutate the original book or create a financial posting");
});

test("bookkeeper readout retains source denominations and exact fractional amounts", () => {
  const root = mkdtempSync(join(tmpdir(), "books-exact-units-"));
  const ledgerPath = join(root, "source-ledger.beancount");
  const registryPath = join(root, "source-wallets.json");
  const priced = (date, payer, id, amount, currency) =>
    sale(date, payer, id).replaceAll("0.01 USDC", `${amount} ${currency}`);
  const source = [
    priced("2026-10-20", OWN, "evm:own-exact", "1.250", "USDC"),
    priced("2026-10-21", STRANGER, "evm:usd", "1.00", "USD"),
    priced("2026-10-22", STRANGER, "evm:usdc", "2.00", "USDC"),
    priced("2026-10-23", STRANGER, "evm:submill", "0.0004", "USDC"),
  ].join("\n");
  writeFileSync(ledgerPath, source);
  writeFileSync(registryPath, JSON.stringify(registry));
  const books = booksObligations({ accountHolder: "bookkeeper",
    env: { METROPLAT_LEDGER_JOURNAL: ledgerPath, GROUP_WALLET_REGISTRY: registryPath } });
  const [due] = books.obligations();
  assert.match(due.why, /1 of them \(1\.25 USDC\) were paid/u);
  assert.match(due.why, /3 payer wallets \(1 USD; 2\.0004 USDC\)/u,
    "distinct units cannot be conflated, and sub-mill source amounts stay nonzero");
  assert.doesNotMatch(due.why, /3\.000 USD|0\.000 USDC/u);
  assert.deepEqual(books.start(due.id).memo, {
    id: due.id, sales: ["evm:own-exact"], handed: ["evm:usd", "evm:usdc", "evm:submill"],
  }, "decision evidence must not mutate original source identities or payer classifications");
  assert.equal(readFileSync(ledgerPath, "utf8"), source);
});

test("bookkeeper readout does not lose high-precision totals or admit malformed numbers", () => {
  const root = mkdtempSync(join(tmpdir(), "books-exact-large-"));
  const ledgerPath = join(root, "source-ledger.beancount");
  const registryPath = join(root, "source-wallets.json");
  const priced = (id, amount) =>
    sale("2026-10-23", STRANGER, id).replaceAll("0.01 USDC", `${amount} USD`);
  const source = [
    priced("evm:large", "9007199254740993.125"),
    priced("evm:remainder", "0.875"),
  ].join("\n");
  writeFileSync(ledgerPath, source);
  writeFileSync(registryPath, JSON.stringify({ wallets: [] }));
  const books = booksObligations({ accountHolder: "bookkeeper",
    env: { METROPLAT_LEDGER_JOURNAL: ledgerPath, GROUP_WALLET_REGISTRY: registryPath } });
  assert.match(books.obligations()[0].why, /9007199254740994 USD/u,
    "the source-owned exact decimal arithmetic must not pass through IEEE-754 Number");
  writeFileSync(ledgerPath, priced("evm:malformed", "1..0"));
  assert.throws(() => books.obligations(), /decimal: not a plain decimal string/u,
    "a malformed source amount is an explicit failure, not a fabricated zero or rounded sum");
});

test("emsenn ownership needs no fictional custody ruling, and a forged books answer is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "swarm-books-"));
  const ledgerPath = join(root, "lib/emsenn/services/561-group/services/561-group-services-section/data/logs/ledgers/561-group-main-ledger.beancount");
  const registryPath = join(root, "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-blockchain-system-services-section/services/key-management-services-section/data/records/2026-09-05-wallet-registry.json");
  const sourceLedger = ledger + '\n2026-10-22 note Assets:Digital-Assets:EVM:Base:Custody:EM-SWARM "EVM address ' + OWN + '"\n';
  const registry = { wallets: [{ address: OWN, owner: "founder" }] };
  for (const [path, body] of [[ledgerPath, sourceLedger], [registryPath, JSON.stringify(registry)]]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  assert.deepEqual(custodyDisagreementsOf(sourceLedger, registry), []);
  const books = booksObligations({
    accountHolder: "emsenn", repositoryRoot: root,
    env: { METROPLAT_WEB_DATA_DIR: join(root, "web") },
  });
  const due = books.obligations();
  assert.equal(due.length, 1);
  assert.match(due[0].title, /payment-derived income/);
  const { memo } = books.start(due[0].id);
  assert.deepEqual(memo, { id: due[0].id, sales: ["evm:own"], handed: ["evm:stranger"] });
  assert.throws(() => books.finish(due[0].id, { ...memo, sales: ["evm:stranger"] }, "approve"), /source payment identities/);
  const done = books.finish(due[0].id, memo, "approve");
  assert.equal(done.title, "Reversal approved");
  assert.throws(() => books.finish(due[0].id, memo, "approve"), /already answered/);
  assert.deepEqual(books.obligations(), []);
  assert.equal(JSON.parse(readFileSync(registryPath, "utf8")).wallets[0].owner, "founder");
});

test("native books honor GROUP_WALLET_REGISTRY instead of silently reading another checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "wallet-registry-source-"));
  const ledgerPath = join(root, "original-ledger.beancount");
  const registryPath = join(root, "original-wallet-registry.json");
  writeFileSync(ledgerPath, ledger);
  writeFileSync(registryPath, JSON.stringify({ wallets: [{ address: OWN, owner: "founder" }] }));
  const books = booksObligations({
    accountHolder: "emsenn",
    env: {
      METROPLAT_LEDGER_JOURNAL: ledgerPath,
      GROUP_WALLET_REGISTRY: registryPath,
      METROPLAT_WEB_DATA_DIR: join(root, "web"),
    },
  });
  const due = books.obligations();
  assert.equal(due.length, 1);
  const { memo } = books.start(due[0].id);
  assert.deepEqual(memo.sales, ["evm:own"]);
  assert.deepEqual(memo.handed, ["evm:stranger"]);
  assert.throws(() => booksObligations({
    accountHolder: "emsenn", env: { GROUP_WALLET_REGISTRY: "   " },
  }), /nonempty path/);
});

test("custodian approval defers payment-derived income while preserving cash and transfer identities", async () => {
  const root = mkdtempSync(join(tmpdir(), "books-"));
  const ledgerPath = join(root, "lib/emsenn/services/561-group/services/561-group-services-section/data/logs/ledgers/561-group-main-ledger.beancount");
  const registryPath = join(root, "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-blockchain-system-services-section/services/key-management-services-section/data/records/2026-09-05-wallet-registry.json");
  for (const [path, body] of [[ledgerPath, ledger], [registryPath, JSON.stringify(registry)]]) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
  const books = booksObligations({ accountHolder: "emsenn", repositoryRoot: root, env: { METROPLAT_WEB_DATA_DIR: join(root, "web") } });
  const [owed] = books.obligations();
  assert.equal(owed.title, "Decide whether to defer 2 payment-derived income entries");
  const { memo } = books.start(owed.id);
  assert.deepEqual([memo.sales, memo.handed], [["evm:own"], ["evm:stranger"]]);
  books.finish(owed.id, memo, "approve");
  assert.deepEqual(books.obligations(), []);
  const ruling = JSON.parse(readFileSync(join(root, "web/records/rulings", `${owed.id}.json`), "utf8"));
  const entries = reversalEntriesOf(x402SalesOf(ledger, registry), ruling);
  assert.equal(entries.length, 2);
  assert.match(entries[1], /Liabilities:Pending:X402-Receipts  -0.01 USDC/u);
  assert.doesNotMatch(entries.join("\n"), /handed_to:|Assets:Digital-Assets/);
  assert.deepEqual([...await bookedSourcesOf(ledgerPath)].sort(), ["evm:own", "evm:stranger"]);
  appendFileSync(ledgerPath, `\n${entries.join("\n\n")}\n`);
  assert.deepEqual([...await bookedSourcesOf(ledgerPath)].sort(), ["evm:own", "evm:stranger"]);
  assert.deepEqual(x402SalesOf(readFileSync(ledgerPath, "utf8"), registry).length, 2);
});
