import test from "node:test";
import assert from "node:assert/strict";
import { admit } from "@red-cup-engineering/computer-data-engineering-services-section/type-system";
import { REQUIREMENT_CLASSES, TYPES } from "../src/requirement-types.mjs";

// Exercise the owning declarations through the real Data admission boundary.
// No record signing, journals, processes, or operational probes are involved.
const check = { cell: "check-1", command: "example-check", expectedExit: 0, exercises: "behavior" };
const cases = [
  {
    kind: "561-group.requirement.v1",
    body: { id: "requirement-1", name: "Requirement", section: "operations", raisedBy: "leader",
      asks: "Admit well-formed requirement records", sources: [{ words: "Keep the request" }],
      metWhen: [check], class: "requirement", authority: "Leader" },
    invalid: [
      ["invalid slug", { id: "Not a slug" }, "pattern"],
      ["empty request", { asks: "" }, "minLength"],
      ["empty sources", { sources: [] }, "minItems"],
      ["source without words", { sources: [{}] }, "required"],
      ["non-boolean relay", { sources: [{ words: "Request", relayed: "yes" }] }, "type"],
      ["unknown class", { class: "wish" }, "enum"],
      ["fractional expected exit", { metWhen: [{ ...check, expectedExit: 0.5 }] }, "type"],
      ["unknown exercise", { metWhen: [{ ...check, exercises: "unknown" }] }, "enum"],
    ],
  },
  {
    kind: "561-group.ruling.v1",
    body: { id: "ruling-1", section: "operations", raisedBy: "board", ruling: "Keep source evidence",
      sources: [{ words: "Keep source evidence" }], checks: [check] },
    invalid: [
      ["invalid raiser slug", { raisedBy: "Board Member" }, "pattern"],
      ["empty ruling", { ruling: "" }, "minLength"],
      ["empty sources", { sources: [] }, "minItems"],
      ["check without command", { checks: [{ cell: "check-1", expectedExit: 0, exercises: "behavior" }] }, "required"],
    ],
  },
  {
    kind: "561-group.requirement-reading.v1",
    body: { id: "reading-1", requirement: "requirement-1", at: "2026-10-10T00:00:00Z",
      charge: "held", conditions: [{ cell: "check-1", exit: 0 }], contributions: [] },
    invalid: [
      ["invalid requirement slug", { requirement: "Requirement 1" }, "pattern"],
      ["unknown charge", { charge: "passed" }, "enum"],
      ["non-array conditions", { conditions: {} }, "type"],
      ["empty observation time", { at: "" }, "minLength"],
    ],
  },
  {
    kind: "561-group.requirement-intake.v1",
    body: { id: "intake-1", prompts: ["A prompt"] },
    invalid: [
      ["empty intake id", { id: "" }, "minLength"],
      ["non-array prompts", { prompts: "A prompt" }, "type"],
    ],
  },
  {
    kind: "561-group.seat-key.v1",
    body: { id: "seat-key-1", seat: "leader", keyId: "key-1", publicKey: "public-key-text" },
    invalid: [
      ["empty seat", { seat: "" }, "minLength"],
      ["empty key id", { keyId: "" }, "minLength"],
      ["non-text public key", { publicKey: 42 }, "type"],
    ],
  },
  {
    kind: "561-group.assembly-break.v1",
    body: { id: "break-1", breakClass: "provider-identity", at: "2026-10-10T00:00:00Z",
      evidence: ["The owning import names the wrong provider"], repair: "Use the genuine provider name" },
    invalid: [
      ["invalid break class", { breakClass: "Provider Identity" }, "pattern"],
      ["empty evidence", { evidence: [] }, "minItems"],
      ["empty evidence member", { evidence: [""] }, "minLength"],
    ],
  },
  {
    kind: "561-group.rule-baseline.v1",
    body: { id: "baseline-1", rule: "Keep existing identities", at: "2026-10-10T00:00:00Z",
      violations: ["known-violation"] },
    invalid: [
      ["invalid baseline slug", { id: "Baseline 1" }, "pattern"],
      ["empty rule", { rule: "" }, "minLength"],
      ["non-array violations", { violations: {} }, "type"],
      ["empty violation member", { violations: [""] }, "minLength"],
    ],
  },
];

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const member of Object.values(value)) assertDeepFrozen(member);
}

function admitWithoutMutation(kind, value) {
  const before = structuredClone(value);
  const declarationBefore = structuredClone(TYPES[kind]);
  const result = admit(TYPES[kind], value);
  assert.deepEqual(value, before, "admission must not alter the input");
  assert.deepEqual(TYPES[kind], declarationBefore, "admission must not alter the declaration");
  if (value !== null && typeof value === "object") assert.equal(Object.isFrozen(value), false);
  return result;
}

test("all seven requirement record types load as immutable Data declarations", () => {
  assert.deepEqual(Object.keys(TYPES).sort(), cases.map(({ kind }) => kind).sort());
  assert.deepEqual(REQUIREMENT_CLASSES, ["goal", "requirement", "machine-guarantee", "expectation", "decision"]);
  assertDeepFrozen(REQUIREMENT_CLASSES);
  assertDeepFrozen(TYPES);
  for (const { kind } of cases) {
    const type = TYPES[kind];
    assert.equal(type.id, `https://561.group/schema/requirement-management/${kind}`);
    assert.equal(type.schema.properties.kind.const, kind);
    assert.equal(type.schema.additionalProperties, true);
    assert.deepEqual(type.parents, []);
    assert.deepEqual(type.references, []);
  }
});

for (const { kind, body, invalid } of cases) {
  test(`${kind} admits a representative record without copying or mutating it`, () => {
    const value = structuredClone({ kind, ...body, extension: { preserved: ["owner data"] } });
    const result = admitWithoutMutation(kind, value);
    assert.equal(result.ok, true);
    assert.strictEqual(result.value, value);
    assert.equal(Object.isFrozen(value.extension), false);
  });

  test(`${kind} refuses malformed records without mutating them`, () => {
    const value = structuredClone({ kind, ...body });
    const { id: omittedId, ...withoutId } = value;
    const { kind: omittedKind, ...withoutKind } = value;
    const malformed = [
      ["null", null, "type"],
      ["array", [], "type"],
      ["missing id", withoutId, "required"],
      ["missing kind", withoutKind, "required"],
      ["wrong record kind", { ...value, kind: "unknown-record-kind" }, "const"],
      ...invalid.map(([label, patch, keyword]) => [label, { ...value, ...patch }, keyword]),
    ];
    for (const [label, malformedValue, keyword] of malformed) {
      const result = admitWithoutMutation(kind, structuredClone(malformedValue));
      assert.equal(result.ok, false, label);
      assert.equal(result.refusal.kind, "not-admitted", label);
      assert.equal(result.refusal.typeId, TYPES[kind].id, label);
      assert.ok(result.refusal.issues.some((issue) => issue.kind === "instance" && issue.keyword === keyword), label);
    }
  });
}

test("all declared requirement classes and reading charges remain admitted", () => {
  const requirement = cases.find(({ kind }) => kind === "561-group.requirement.v1");
  for (const requirementClass of REQUIREMENT_CLASSES) {
    assert.equal(admitWithoutMutation(requirement.kind,
      structuredClone({ kind: requirement.kind, ...requirement.body, class: requirementClass })).ok, true);
  }
  const reading = cases.find(({ kind }) => kind === "561-group.requirement-reading.v1");
  for (const charge of ["held", "denied", "contested", "unknown"]) {
    assert.equal(admitWithoutMutation(reading.kind,
      structuredClone({ kind: reading.kind, ...reading.body, charge })).ok, true);
  }
});

test("admission retains the schemas' explicitly permissive array boundaries", () => {
  const allowedEmpty = [
    ["561-group.requirement.v1", { metWhen: [] }],
    ["561-group.ruling.v1", { checks: [] }],
    ["561-group.requirement-reading.v1", { conditions: [], contributions: [] }],
    ["561-group.rule-baseline.v1", { violations: [] }],
  ];
  for (const [kind, patch] of allowedEmpty) {
    const { body } = cases.find((entry) => entry.kind === kind);
    assert.equal(admitWithoutMutation(kind, structuredClone({ kind, ...body, ...patch })).ok, true);
  }
  // An intake only requires kind and id; prompt contents have no narrower schema.
  assert.equal(admitWithoutMutation("561-group.requirement-intake.v1",
    { kind: "561-group.requirement-intake.v1", id: "intake-2" }).ok, true);
});
