/**
 * The data types the requirement management section's records are typed marks of
 * (signcell typed-mark over the data section's schema types). A record's body is admitted by its
 * type before it is signed, so a body the type refuses is never recorded.
 *
 * The plain-JSON form these succeed is requirement.schema.json (2026-07), migrated into the
 * requirement management section as the legacy form a converter reads.
 */
import { defineSchemaType } from "@red-cup-engineering/computer-data-engineering-services-section/type-system/schema-type";

const BASE = "https://561.group/schema/requirement-management";
const text = { type: "string", minLength: 1 };
const slug = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" };
const names = { type: "array", items: text };
const source = { type: "object", required: ["words"], properties: { words: text, session: text, at: text, locator: text, kind: text, relayed: { type: "boolean" } } };
const check = { type: "object", required: ["cell", "command", "expectedExit", "exercises"],
  properties: { cell: text, says: text, command: text, expectedExit: { type: "integer" }, exercises: { enum: ["behavior", "existence"] } } };

/** The classes of the requirements-to-specification topic, each with its accountable authority. */
export const REQUIREMENT_CLASSES = Object.freeze(["goal", "requirement", "machine-guarantee", "expectation", "decision"]);

const schemas = {
  "561-group.requirement.v1": {
    title: "Requirement", description: "What a raiser asked for, in their own words, with its sources, its class and authority, its owning section, and the checks that say when it is met.",
    required: ["kind", "id", "name", "section", "raisedBy", "asks", "sources", "metWhen", "class", "authority"],
    properties: { kind: { const: "561-group.requirement.v1" }, id: slug, name: text, section: text, raisedBy: slug, asks: text, sources: { type: "array", minItems: 1, items: source },
      metWhen: { type: "array", items: check }, class: { enum: REQUIREMENT_CLASSES }, authority: text, tier: text, changes: text, carriedFrom: text, note: text,
      serves: names, after: names, realizedBy: names, opening: { type: "object" }, breakClass: slug },
  },
  "561-group.ruling.v1": {
    title: "Ruling", description: "A standing ruling of the Founder or the Board, in their words, with the checks a machine can run against it.",
    required: ["kind", "id", "section", "raisedBy", "ruling", "sources", "checks"],
    properties: { kind: { const: "561-group.ruling.v1" }, id: slug, name: text, section: text, raisedBy: slug, ruling: text, sources: { type: "array", minItems: 1, items: source },
      checks: { type: "array", items: check }, scope: text, supersedes: text },
  },
  "561-group.requirement-reading.v1": {
    title: "Requirement reading", description: "One measurement of a requirement: each check's exit and charge, the requirement's FOUR charge, and the merged work that served it.",
    required: ["kind", "id", "requirement", "at", "charge", "conditions"],
    properties: { kind: { const: "561-group.requirement-reading.v1" }, id: text, requirement: slug, requirementAddress: text, requirementCharge: text, at: text,
      charge: { enum: ["held", "denied", "contested", "unknown"] }, conditions: { type: "array" }, contributions: { type: "array" } },
  },
  "561-group.requirement-intake.v1": {
    title: "Requirement intake", description: "An index carrying a set of the Leader's prompts into requirement records.",
    required: ["kind", "id"], properties: { kind: { const: "561-group.requirement-intake.v1" }, id: text, prompts: { type: "array" } },
  },
  "561-group.seat-key.v1": {
    title: "Seat key", description: "The Ed25519 public key a seat signs its records with.",
    required: ["kind", "id", "seat", "keyId", "publicKey"], properties: { kind: { const: "561-group.seat-key.v1" }, id: text, seat: text, keyId: text, publicKey: text },
  },
  "561-group.assembly-break.v1": {
    title: "Assembly break", description: "One break met where the line assembles (routing, rule check, tape-out): its class, evidence and repair.",
    required: ["kind", "id", "breakClass", "at", "evidence"],
    properties: { kind: { const: "561-group.assembly-break.v1" }, id: slug, breakClass: slug, at: text, evidence: { type: "array", minItems: 1, items: text }, repair: text, metBy: text },
  },
  "561-group.rule-baseline.v1": {
    title: "Design-rule baseline", description: "A design rule's violations recorded at its adoption, charged contested: known, recorded and owed. A change may remove one, never add one.",
    required: ["kind", "id", "rule", "at", "violations"],
    properties: { kind: { const: "561-group.rule-baseline.v1" }, id: slug, rule: text, at: text, violations: { type: "array", items: text } },
  },
};

/** The data type of each record kind. */
export const TYPES = Object.freeze(Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind,
  defineSchemaType({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: `${BASE}/${kind}`, type: "object", additionalProperties: true, ...schema })])));
