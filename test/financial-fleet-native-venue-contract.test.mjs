import assert from "node:assert/strict";
import test from "node:test";
import { alpacaLiveTools } from "@red-cup-engineering/alpaca-principal-actuation-service/mcp";
import { tradingFleetOperations } from "../src/trading-fleet-operations.mjs";

// This is the owning native consumer test. It deliberately consumes the
// supplier's actual versioned tool contracts rather than copying a second
// finance/mandate schema into Group Operations.
test("MetroPlat's original Alpaca verbs expose every exact provider-required authority reference", () => {
  const operations = tradingFleetOperations({}, { configuration: {} });
  for (const supplier of alpacaLiveTools) {
    const verb = supplier.name.replaceAll("_", "-");
    const admitted = operations.filter(item => item.verb === verb);
    assert.equal(admitted.length, 1, verb + " is installed exactly once");
    const [operation] = admitted;
    assert.equal(operation.summary, supplier.description);
    assert.equal(operation.domain?.kind, "schema-contract");
    assert.equal(operation.domain.id, "group-operations/financial-fleet/" + supplier.name + "/input");
    const { $id, ...schema } = operation.domain.schema;
    assert.equal($id, operation.domain.id);
    assert.deepEqual(schema, supplier.inputSchema);
    const valid = Object.fromEntries(supplier.inputSchema.required.map(
      reference => [reference, "urn:source:admitted-" + reference]));
    assert.equal(operation.domain.validate(valid), true, verb + ": admitted source references");
    assert.equal(operation.domain.validate({}), supplier.inputSchema.required.length === 0,
      verb + ": rejects absent mandate references unless genuinely empty");
    assert.equal(operation.domain.validate({ ...valid, forgedSender: "personal-mailbox" }), false,
      verb + ": refuses unrecognized caller-owned identity/authority");
    for (const key of supplier.inputSchema.required) {
      const incomplete = { ...valid };
      delete incomplete[key];
      assert.equal(operation.domain.validate(incomplete), false,
        verb + ": refuses omitted original requirement " + key);
    }
  }
});

test("non-Alpaca fleet, original treasury Work pulse and evidence routes remain distinct", () => {
  const operations = tradingFleetOperations({}, { configuration: {} });
  for (const verb of [
    "financial-fleet-pulse", "financial-fleet-evidence",
    "base-fleet-observe", "kalshi-fleet-reconcile", "kalshi-fleet-observe",
  ]) assert.equal(operations.filter(row => row.verb === verb).length, 1);
  for (const item of alpacaLiveTools) {
    const name = item.name.replaceAll("_", "-");
    assert.equal(operations.find(row => row.verb === name)?.effects?.class,
      ["alpaca_live_execute_market_decision", "alpaca_live_execute_intent",
        "alpaca_live_run_fleet_cycle"].includes(item.name) ? "external" : "journal-write");
  }
});
