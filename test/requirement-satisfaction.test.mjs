import test from "node:test";
import assert from "node:assert/strict";
import { metWhenSatisfied } from "../src/requirement-satisfaction.mjs";

const reading = (charge, exercises = "behavior") => ({
  charge, exercises,
  told: {
    for: ["held", "contested"].includes(charge) ? ["provider-observation"] : [],
    against: ["denied", "contested"].includes(charge) ? ["contrary-observation"] : [],
  },
});

test("acceptance is a nonempty conjunction of corroborated behavioral observations", () => {
  assert.equal(metWhenSatisfied([reading("held"), reading("held")], "held"), true);
  assert.equal(metWhenSatisfied([], "held"), false);
  assert.equal(metWhenSatisfied([reading("held"), reading("unknown")], "held"), false);
  assert.equal(metWhenSatisfied([reading("held"), reading("denied")], "held"), false);
  assert.equal(metWhenSatisfied([reading("held"), reading("contested")], "held"), false);
});

test("FOUR testimony is not a completed result or a corroborated order", () => {
  assert.equal(metWhenSatisfied([reading("held", "existence")], "held"), false);
  assert.equal(metWhenSatisfied([reading("held")], "contested"), false);
  assert.equal(metWhenSatisfied([reading("held")], "unknown"), false);
  assert.equal(metWhenSatisfied([reading("held")], "denied"), false);
  assert.equal(metWhenSatisfied([{ charge: "held", exercises: "behavior" }], "held"), false);
  assert.equal(metWhenSatisfied([{ ...reading("held"), told: { for: ["yes"], against: ["no"] } }], "held"), false);
});

test("malformed or unavailable observation sets cannot close work", () => {
  assert.throws(() => metWhenSatisfied(null, "held"), /conditions must be a list/u);
  assert.throws(() => metWhenSatisfied({}, "held"), /conditions must be a list/u);
  assert.equal(metWhenSatisfied([null], "held"), false);
  assert.equal(metWhenSatisfied([reading("held"), null], "held"), false);
});
