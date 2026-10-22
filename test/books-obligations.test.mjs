import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { bookedSourcesOf } from "../src/acceptance.mjs";
import { booksObligations, reversalEntriesOf, x402SalesOf } from "../src/group-financial-readout-view.mjs";

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

test("emsenn founder-held wallets count as swarm-internal, not external x402 earnings", () => {
  const emsennRegistry = { wallets: [{ address: OWN, owner: "founder" }] };
  assert.deepEqual(x402SalesOf(ledger, emsennRegistry).map(row => [row.sourceId, row.selfPaid]), [
    ["evm:own", true], ["evm:stranger", false],
  ]);
});

test("founder legal title does not force an invented separate-Group wallet correction", () => {
  const root = mkdtempSync(join(tmpdir(), "swarm-wallet-"));
  const ledgerPath = join(root, "lib/emsenn/services/561-group/services/561-group-services-section/data/logs/ledgers/561-group-main-ledger.beancount");
  const registryPath = join(root, "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-blockchain-system-services-section/services/key-management-services-section/data/records/2026-09-05-wallet-registry.json");
  const sourceLedger = ledger + '\n2026-10-22 note Assets:Digital-Assets:EVM:Base:Custody:EM-SWARM "EVM address ' + OWN + '"\n';
  const emsennRegistry = { wallets: [{ address: OWN, owner: "founder" }] };
  for (const [path, body] of [[ledgerPath, sourceLedger], [registryPath, JSON.stringify(emsennRegistry)]]) {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body);
  }
  const book = booksObligations({ accountHolder: "emsenn", repositoryRoot: root,
    env: { METROPLAT_WEB_DATA_DIR: join(root, "web") } });
  assert.deepEqual(book.obligations().filter(row => row.id.startsWith("custody-")), []);
  assert.deepEqual(x402SalesOf(sourceLedger, emsennRegistry).map(row => row.selfPaid), [true, false]);
  assert.equal(JSON.parse(readFileSync(registryPath, "utf8")).wallets[0].owner, "founder");
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
