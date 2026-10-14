import assert from "node:assert/strict";
import test from "node:test";
import { composeGroupFinancialReadout } from "../src/group-financial-readout.mjs";

const asOf = "2026-10-10T12:00:00.000Z";
const current = "2026-10-10T11:00:00.000Z";
const boundary = "2026-10-09T12:00:00.000Z";
const stale = "2026-10-09T11:59:59.999Z";
const future = "2026-10-10T12:00:00.001Z";
const compose = (overrides = {}) => composeGroupFinancialReadout({
  asOf,
  ledgerObservation: { kind: "fixture", observedAt: current },
  walletRegistry: { derivedAt: current, wallets: [] },
  ...overrides,
});
const observation = (readout, kind) => readout.observations.find((item) => item.kind === kind);
const settlement = (type, state, observedAt) => ({ path: "fixture", value: {
  type, state, observedAt, witnessCount: 2, receiptVerifiedCount: 1,
  confirmedCount: 1, refusedCount: 1, attributionRefusedCount: 0,
} });

test("ledger and wallet freshness reject future dates and retain the inclusive 24-hour boundary", () => {
  for (const [observedAt, expected] of [[current, "current"], [asOf, "current"], [boundary, "current"], [stale, "stale"], [future, "unknown"], [undefined, "unknown"], ["invalid", "unknown"]]) {
    const readout = compose({ ledgerObservation: { observedAt }, walletRegistry: { derivedAt: observedAt, wallets: [{}] } });
    assert.equal(readout.ledger.state, expected, `ledger ${observedAt}`);
    assert.equal(observation(readout, "wallet-registry").state, expected, `wallet ${observedAt}`);
    assert.equal(readout.evidenceCoverage.walletRegistry, expected);
    if (observedAt === future) {
      assert.ok(readout.unresolved.some((item) => item.includes("ledger economic observation date is after the readout")));
      assert.ok(readout.unresolved.some((item) => item.includes("wallet registry observation date is after the readout")));
    }
  }
});

for (const type of ["X402SellerPaymentObservation", "X402SellerOutcomeObservation"]) {
  test(`${type} cannot declare stale, future, missing or malformed dates current`, () => {
    for (const state of ["current", "current-empty", "partially-corroborated"]) {
      for (const [observedAt, expected] of [[stale, "stale"], [future, "unknown"], [undefined, "unknown"], ["invalid", "unknown"]]) {
        const input = settlement(type, state, observedAt);
        const before = structuredClone(input);
        const readout = compose({ x402Settlement: input });
        const x402 = observation(readout, "x402-settlements");
        assert.equal(x402.state, expected, `${state} ${observedAt}`);
        assert.equal(x402.freshness, expected);
        assert.equal(x402.sourceState, state);
        assert.equal(x402.settlementCount, 2);
        assert.equal(x402.receiptVerifiedCount, 1);
        assert.equal(x402.refusedCount, 1);
        assert.equal(x402.customerAcceptance, "unobserved");
        assert.equal(x402.revenueRecognized, type === "X402SellerPaymentObservation" ? false : null);
        assert.equal(readout.evidenceCoverage.x402Settlements, expected);
        assert.equal(readout.earningActions.find((item) => item.action === "observe-x402-settlements").state, "run");
        assert.ok(readout.unresolved.some((item) => item.includes("seller settlement record(s) were refused")));
        if (observedAt === future) assert.ok(readout.unresolved.some((item) => item.includes("x402 settlement observation date is after the readout")));
        if (observedAt === stale) assert.ok(readout.unresolved.some((item) => item.includes("x402 settlement evidence is stale")));
        assert.deepEqual(input, before);
      }
    }
  });

  test(`${type} retains current and partial corroboration states only with a current date`, () => {
    for (const observedAt of [current, asOf, boundary, "2026-10-10T14:00:00+02:00"]) {
      for (const state of ["current", "current-empty", "partially-corroborated"]) {
        const readout = compose({ x402Settlement: settlement(type, state, observedAt) });
        const x402 = observation(readout, "x402-settlements");
        assert.equal(x402.state, state);
        assert.equal(x402.freshness, "current");
        assert.equal(x402.sourceState, state);
        assert.equal(readout.earningActions.find((item) => item.action === "observe-x402-settlements").state,
          type === "X402SellerPaymentObservation" && state !== "partially-corroborated" ? "continue" : "run");
      }
    }
  });

  test(`${type} keeps an unavailable producer distinct from the age of retained evidence`, () => {
    for (const [observedAt, freshness] of [[current, "current"], [stale, "stale"], [future, "unknown"], [undefined, "unknown"]]) {
      const readout = compose({ x402Settlement: settlement(type, "unavailable", observedAt) });
      const x402 = observation(readout, "x402-settlements");
      assert.equal(x402.state, "unavailable");
      assert.equal(x402.sourceState, "unavailable");
      assert.equal(x402.freshness, freshness);
      assert.ok(readout.unresolved.some((item) => item.includes("qualified seller settlement evidence is unavailable")));
      assert.equal(readout.earningActions.find((item) => item.action === "observe-x402-settlements").state, "run");
      if (observedAt === stale) assert.ok(readout.unresolved.some((item) => item.includes("x402 settlement evidence is stale")));
    }
  });
}

test("legacy settlement observations use the same date boundary without acquiring a seller claim", () => {
  for (const [observedAt, expected] of [[boundary, "current"], [stale, "stale"], [future, "unknown"], [undefined, "unknown"]]) {
    const readout = compose({ x402Settlement: { value: { observedAt, settlementCount: 3 } } });
    const x402 = observation(readout, "x402-settlements");
    assert.equal(readout.earningActions.find((item) => item.action === "observe-x402-settlements").state, "run");
    assert.equal(x402.state, expected);
    assert.equal(x402.freshness, expected);
    assert.equal(x402.sourceState, null);
    assert.equal(x402.settlementCount, 3);
    assert.equal(x402.revenueRecognized, null);
  }
});

test("a missing seller state or absent settlement remains unknown", () => {
  for (const x402Settlement of [undefined, { value: null }, settlement("X402SellerPaymentObservation", undefined, current)]) {
    const readout = compose({ x402Settlement });
    assert.equal(observation(readout, "x402-settlements").state, "unknown");
    assert.ok(readout.unresolved.includes("x402 settlement evidence unavailable"));
  }
});

test("Hive reward observations and schedule availability stay separate", () => {
  const reward = { account: "Income:Hive:Curation", amount: "0.01", commodity: "HIVE" };
  for (const configured of [true, false, undefined]) {
    for (const earned of [[], [reward]]) {
      const readout = compose({ hiveCuration: { configured }, chainReconciliation: { earned, rows: [] } });
      const hive = observation(readout, "hive-curation");
      assert.equal(hive.state, earned.length ? "observed" : configured === true ? "configured-unobserved" : "unknown");
      assert.deepEqual(hive.earned, earned);
      assert.equal(readout.unresolved.includes("Hive curation schedule is unavailable"), configured !== true);
      assert.equal(readout.unresolved.includes("Hive curation is scheduled but its latest reward settlement has not been observed here"), configured === true && earned.length === 0);
      assert.equal(hive.scheduleConfigured, typeof configured === "boolean" ? configured : null);
    }
  }
});

test("current qualified cash receiving is visible as cash evidence without booking a sale", () => {
  const input = settlement("X402SellerPaymentObservation", "current", current);
  const before = structuredClone(input);
  const readout = compose({ x402Settlement: {
    ...input, path: "ni:///sha-256;qualified-cash-observation",
  } });
  const cash = observation(readout, "x402-settlements");
  assert.equal(cash.state, "current");
  assert.equal(cash.receiptVerifiedCount, 1);
  assert.equal(cash.confirmedCount, 1);
  assert.equal(cash.customerAcceptance, "unobserved");
  assert.equal(cash.revenueRecognized, false);
  assert.equal(cash.outcomeCount, 0);
  assert.equal(readout.earningActions.find((item) => item.action === "observe-x402-settlements").state, "continue");
  assert.deepEqual(input, before);
});
