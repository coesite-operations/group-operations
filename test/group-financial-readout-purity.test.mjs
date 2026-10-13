import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { produceGroupFinancialReadout } from "../scripts/produce-group-financial-readout.mjs";

async function filesBelow(root, directory = root) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await filesBelow(root, path));
    else {
      const info = await stat(path);
      files[relative(root, path)] = {
        sha256: createHash("sha256").update(await readFile(path)).digest("hex"),
        mode: info.mode & 0o777,
        mtimeMs: info.mtimeMs,
      };
    }
  }
  return files;
}

// This invokes the actual producer with only temporary synthetic inputs. It does
// not invoke the external operation, receiving jobs, ledger tools or any network.
// In a partial source closure, optional readers remain explicitly unavailable;
// this test does not substitute accounting implementations or qualify them.
test("financial readout writes only its own artifact and never freshens missing cash receiving", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "group-financial-purity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prior = "2026-10-10T12:00:00.000Z";
  const inputs = {
    "ledger.beancount": `; authored ledger fixture\n  observed_at: "${prior}"\n2026-10-10 * "preserve authored transaction"\n  source_id: "fixture:original"\n`,
    "wallets.json": JSON.stringify({ derivedAt: prior, wallets: [] }),
    "private/records/outcomes.jsonl": '{"source":"x402-settlement","id":"legacy-fixture"}\n',
    "private/records/x402/cash/pending.beancount": '; held cash fixture, never revenue\n',
    "web/books/561-group-llc-judged-deliveries.beancount": '; existing derived book fixture\n',
    "web/records/acceptance/2026-W41-to-date-acceptance-readout.json": JSON.stringify({ type: "GroupAcceptanceReadout", version: 1, asOf: prior, week: "2026-W41", journal: { excluded: ["x402-settlement"] }, economy: { kind: "organizing.enterprise.economy", crossings: {} } }),
    "x402-witnesses/unreceived.json": JSON.stringify({ type: "X402SettlementWitness", independentlyVerifiedTransfer: false, requesterAccepted: null }),
  };
  for (const [name, body] of Object.entries(inputs)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o600 });
  }
  const environment = {
    METROPLAT_WEB_DATA_DIR: join(root, "web"),
    METROPLAT_DATA_ROOT: join(root, "private"),
    METROPLAT_LEDGER_JOURNAL: join(root, "ledger.beancount"),
    GROUP_WALLET_REGISTRY: join(root, "wallets.json"),
    X402_SETTLEMENT_RECORDS: join(root, "x402-witnesses"),
  };
  const before = await filesBelow(root);
  const fetchBefore = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("readout must not call network"); };
  t.after(() => { globalThis.fetch = fetchBefore; });

  const artifacts = [];
  for (const asOf of ["2026-10-13T12:00:00.000Z", "2026-10-13T12:01:00.000Z"]) {
    const result = await produceGroupFinancialReadout({ environment, now: () => asOf });
    artifacts.push(relative(root, result.path));
    assert.deepEqual(JSON.parse(await readFile(result.path, "utf8")), result.readout);
    assert.equal(result.readout.asOf, asOf);
    assert.equal(result.readout.ledger.observedAt, prior);
    assert.equal(result.readout.ledger.state, "stale");
    const economy = result.readout.observations.find((item) => item.kind === "economy");
    assert.equal(economy.state, "stale");
    assert.equal(economy.sourceKind, "organizing.enterprise.economy");
    assert.equal(economy.recordedAt, prior);
    const cash = result.readout.observations.find((item) => item.kind === "x402-settlements");
    assert.equal(cash.state, "unavailable");
    assert.equal(cash.observedAt, null);
    assert.equal(cash.source, null);
    assert.equal(cash.settlementCount, null);
    assert.equal(cash.confirmedCount, null);
    assert.equal(cash.paymentBooks, null);
    assert.equal(cash.keptInLog, null);
    assert.equal(cash.customerAcceptance, "unobserved");
    assert.equal(cash.revenueRecognized, false);
    assert.equal(cash.toldCount, null);
    assert.equal(cash.outcomeCount, 0);
  }
  assert.equal(networkCalls, 0);
  const after = await filesBelow(root);
  assert.deepEqual(Object.keys(after).filter((name) => !(name in before)).sort(), artifacts.sort());
  for (const [name, snapshot] of Object.entries(before)) assert.deepEqual(after[name], snapshot, `input changed: ${name}`);
  for (const name of artifacts) assert.equal(after[name].mode, 0o600);

  // A future acceptance source cannot leak through the parallel economy path.
  const acceptancePath = join(root, "web", "records", "acceptance", "2026-W41-to-date-acceptance-readout.json");
  await writeFile(acceptancePath, JSON.stringify({ type: "GroupAcceptanceReadout", version: 1,
    asOf: "2026-10-14T00:00:00.000Z", journal: { excluded: ["x402-settlement"] }, economy: { crossings: {} } }));
  const future = await produceGroupFinancialReadout({ environment, now: () => "2026-10-13T12:02:00.000Z" });
  const refused = future.readout.observations.find((item) => item.kind === "economy");
  assert.equal(refused.state, "unavailable");
  assert.equal(refused.recordedAt, undefined);
  assert.match(refused.error, /cutoff/u);
  assert.equal(networkCalls, 0);
});
