import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { composeGroupFinancialReadout } from "../src/group-financial-readout.mjs";
import { groupFinancialReadoutOperation } from "../src/group-financial-readout-operation.mjs";

test("group-financial-readout-produce writes a readout through the Group Operations operation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "metroplat-group-financial-readout-"));
  const records = path.join(root, "x402-records");
  await mkdir(records);
  const ledger = path.join(root, "ledger.beancount");
  const wallets = path.join(root, "wallets.json");
  const secrets = path.join(root, "x402-secrets.env");
  await writeFile(ledger, 'observed_at: "2026-09-27T12:00:00.000Z"\n2026-09-27 * "fixture"\n', "utf8");
  await writeFile(wallets, JSON.stringify({ derivedAt: "2026-09-27T12:00:00.000Z", wallets: [{ address: "fixture" }] }), "utf8");
  await writeFile(secrets, "", "utf8");
  const environment = {
    METROPLAT_WEB_DATA_DIR: root,
    METROPLAT_DATA_ROOT: path.join(root, "private"),
    METROPLAT_LEDGER_JOURNAL: ledger,
    X402_SETTLEMENT_RECORDS: records,
    X402_SECRETS_FILE: secrets,
    GROUP_WALLET_REGISTRY: wallets,
    HIVE_CURATION_TIMER_UNIT: path.join(root, "missing.timer"),
  };
  const operation = groupFinancialReadoutOperation({ environment, clock: () => "2026-09-27T12:00:00.000Z" });
  const result = await operation.execute({});

  assert.equal(result.readout.type, "GroupFinancialReadout");
  assert.equal(result.readout.asOf, "2026-09-27T12:00:00.000Z");
  assert.equal(await readFile(result.path, "utf8").then(JSON.parse).then((readout) => readout.title), "561 Group daily financial readout");
});

test("daily readout tells corroborated transfers apart from sales, and the Group paying itself from strangers paying it", () => {
  const asOf = "2026-10-02T12:00:00.000Z";
  const readout = composeGroupFinancialReadout({
    asOf,
    ledgerObservation: { kind: "fixture", observedAt: asOf, balanceAssertionCount: 0, transactionCount: 0 },
    walletRegistry: { derivedAt: asOf, wallets: [] },
    x402Settlement: { path: null, value: {
      type: "X402SellerOutcomeObservation", version: 3, state: "partially-corroborated", observedAt: asOf,
      witnessCount: 4, receiptVerifiedCount: 4, confirmedCount: 3, attributionRefusedCount: 1,
      toldCount: 3, alreadyToldCount: 0, refusedCount: 1, outcomeCount: 3,
      border: { external: { count: 1, value: { USDC: "0.01" }, payers: ["eip155:8453:0xabc"] }, related: { count: 0, value: {} }, self: { count: 2, value: { USDC: "0.05" } } },
    } },
    hiveCuration: { configured: false },
  });

  const x402 = readout.observations.find((item) => item.kind === "x402-settlements");
  assert.equal(x402.receiptVerifiedCount, 4);
  assert.equal(x402.toldCount, null);
  assert.equal(x402.legacyPaymentClaims.toldCount, 3);
  assert.equal(x402.border, null);
  assert.equal(x402.legacyPaymentClaims.border.external.count, 1);
  assert.ok(readout.unresolved.includes("1 seller transfer(s) were corroborated on-chain but lack qualified transaction-time seller or tariff attribution, so cash remains unattributed and is never assigned from today's catalogue"));
  assert.ok(readout.unresolved.includes("2 corroborated payment(s) came from the Group's own wallets (0.05 USDC): the Group paying itself, never a sale"));
});
