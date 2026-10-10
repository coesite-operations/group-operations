/**
 * Carry the requirement journal into the July requirement management system's own record forms
 * (the requirements management team's schemas, 2026-07: emsenn/schema/requirement, ruling,
 * decision-record, quality-attestation), so the July team is the one owner and its pools the one
 * place a requirement, a ruling or an attestation is read.
 *
 * Every carried record is a SignCell typed mark of its July schema: its content is admitted by the
 * schema (so a record the July form refuses is never written) and its address is the typed mark's
 * content address, kept in the record's own x-provenance["sign-cell"] beside the cell address the
 * journal recorded. The address is computed over the record without that one provenance field, so
 * a reader re-derives it from the file alone.
 *
 *   requirement        -> <owning section>/content/requirements/<id>.json  (emsenn/schema/requirement)
 *   ruling             -> a decided decision record (emsenn/schema/decision-record) and the ruling
 *                         evidence that backs it (emsenn/schema/ruling), in the team's pools
 *   assembly break     -> a quality attestation of the assembly (emsenn/schema/quality-attestation)
 *
 * A requirement already held in the July form (the plain-JSON record it was carried from, or one a
 * node recorded straight into a pool) keeps its content; only its sign-cell address is added. A
 * carry that would lose any leaf of a held record is refused, not written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defineSchemaType } from "@red-cup-engineering/computer-data-services-section/type-system/schema-type";
import { createTypedMark } from "@red-cup-engineering/signcell/typed-mark";
import { ASSEMBLY_BREAK, REQUIREMENT, REQUIREMENT_SECTION, RULING, readGoverning } from "./requirement-cells.mjs";
import { julyPoolFiles } from "./requirement-pools.mjs";

/**
 * Where the team keeps the July schemas: emsenn/schema/requirement beside the ruling, decision-record
 * and quality-attestation schemas materialized byte for byte from the 2026-08-03 executive office.
 */
export const JULY_SCHEMA_DIRECTORY = `${REQUIREMENT_SECTION}/data/records/schema`;
/** The team's office: the July requirements management team. */
export const TEAM_OFFICE = "requirements-management-team";
const KINDS = Object.freeze(["requirement", "ruling", "decision-record", "quality-attestation"]);
const SIGN_CELL = "sign-cell";

/** The July schemas as SignCell data types (a schema with no description is described by its comment). */
export function julyTypes(schemaDirectory) {
  return Object.freeze(Object.fromEntries(KINDS.map((kind) => {
    const schema = JSON.parse(readFileSync(join(schemaDirectory, `${kind}.schema.json`), "utf8"));
    return [kind, defineSchemaType({ ...schema, description: schema.description ?? schema.$comment ?? schema.title })];
  })));
}

const withoutSignCell = (record) => {
  const { "x-provenance": provenance = {}, ...rest } = record;
  // The address covers the record without itself and without the seat's attestation over it.
  const { [SIGN_CELL]: _signCell, attestation: _attestation, ...kept } = provenance;
  return { ...rest, "x-provenance": kept };
};

/** The typed mark a July record is, or the refusal of its schema. */
export function julyMark(type, record) {
  const made = createTypedMark(type, withoutSignCell(record));
  if (!made.ok) throw new TypeError(`${type.id} refuses ${record.id ?? record.name}: ${made.refusal.message}`);
  return made.value;
}

/** A July record carrying its own typed-mark address (and the journal cell it was carried from). */
export function addressed(type, record, cellAddress) {
  const mark = julyMark(type, record);
  return { ...withoutSignCell(record), "x-provenance": { ...withoutSignCell(record)["x-provenance"],
    [SIGN_CELL]: { type: type.id, mark: mark.id, ...(cellAddress ? { cell: cellAddress } : {}) } } };
}

/** Whether a July record's sign-cell address is the typed mark its content is under its schema. */
export function addressHolds(types, record) {
  const signCell = record?.["x-provenance"]?.[SIGN_CELL];
  const kind = KINDS.find((candidate) => types[candidate].id === signCell?.type);
  if (kind === undefined) return false;
  try { return julyMark(types[kind], record).id === signCell.mark; } catch { return false; }
}

const day = (at) => String(at ?? new Date().toISOString()).slice(0, 10);
const write = (path, record) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`); };

/** The July requirement a journal requirement is. */
export function julyRequirementOf(read, { seat }) {
  const body = read.body;
  const checks = body.metWhen.length > 0
    ? body.metWhen.map((check) => ({ cell: check.cell, target: "held", ...(check.command ? { command: check.command } : {}), "expected-exit": check.expectedExit }))
    // A requirement no check can fail yet keeps its condition, unsettled: the loop reads it unknown.
    : [{ cell: body.breakClass ? `${body.breakClass}:impossible-by-construction` : `${body.id}:conditions-stated`, target: "held" }];
  return {
    id: body.id, name: body.name, kind: "requirement", "raised-by": body.raisedBy, asks: body.asks, "met-when": checks,
    ...(body.tier ? { tier: body.tier } : {}), ...(body.realizedBy ? { "realized-by": body.realizedBy } : {}),
    "x-provenance": { "recorded-by": read.signature?.seat ?? seat, "recorded-on": day(read.recordedAt), section: body.section, class: body.class, authority: body.authority,
      sources: body.sources, ...(body.opening ? { "board-opening": body.opening } : {}), ...(body.breakClass ? { "break-class": body.breakClass } : {}),
      ...(body.metWhen.length === 0 ? { "pending-conditions": "No met-when was stated; this condition stands unsettled (read unknown) until a check that exercises the requirement replaces it." } : {}) },
  };
}

/** The decided decision record and the ruling evidence a journal ruling is. */
export function julyRulingOf(read) {
  const body = read.body;
  const quoted = body.sources.find((source) => !source.relayed) ?? body.sources[0];
  const decision = {
    id: `${body.id}-decision`, name: body.name ?? body.id, decider: "emsenn, the Founder", status: "decided",
    context: `A standing ruling of the Founder, recorded so every session and the requirement maintenance loop act on it without the Founder repeating it.${quoted.relayed ? " The words were relayed, not quoted from the Founder's own session; the ruling reads contested until the Founder's sentence is attached." : ""}`,
    options: [
      { label: "hold the ruling", description: body.ruling },
      { label: "leave practice as it was", description: "Practice continues as before the ruling; the Founder repeats the correction." },
    ],
    decision: body.ruling,
    consequences: body.checks.length > 0 ? `The requirement maintenance loop runs ${body.checks.map((check) => check.cell).join(", ")} on every turn and reports a break on the work board.` : "No machine check carries it yet; sessions are briefed on it.",
    "x-provenance": { "recorded-by": read.signature?.seat ?? TEAM_OFFICE, "recorded-on": day(read.recordedAt), section: body.section,
      ...(body.checks.length > 0 ? { checks: body.checks } : {}) },
  };
  const ruling = {
    id: body.id, name: body.name ?? body.id, backs: decision.id, decider: decision.decider, "carried-by": TEAM_OFFICE,
    quote: quoted.words, channel: [quoted.session, quoted.locator].filter(Boolean).join(" ") || "relayed by the orchestrating session",
    "ruled-on": day(quoted.at ?? read.recordedAt),
    "x-provenance": { "recorded-by": read.signature?.seat ?? TEAM_OFFICE, "recorded-on": day(read.recordedAt), relayed: Boolean(quoted.relayed), sources: body.sources },
  };
  return { decision, ruling };
}

/** The quality attestation an assembly break is. */
export function julyAttestationOf(read) {
  const body = read.body;
  return {
    id: `assembly-break-${body.breakClass}-${body.id}`, name: `Assembly break: ${body.breakClass}`,
    subject: `Assembly of the machine closure (${body.breakClass})`, verdict: body.repair && !/^open/u.test(body.repair) ? "ACHIEVED" : "NOT ACHIEVED",
    body: [`# Assembly break: ${body.breakClass}`, "", `Met at ${body.at}${body.metBy ? ` by ${body.metBy}` : ""}.`, "", "## Evidence", "", ...body.evidence.map((item) => `- ${item}`),
      "", "## Repair", "", body.repair ?? "open"].join("\n"),
    "x-provenance": { "recorded-by": read.signature?.seat ?? TEAM_OFFICE, "recorded-on": day(read.recordedAt), "break-class": body.breakClass },
  };
}

const JULY_REQUIREMENT_FIELDS = new Set(["id", "name", "kind", "raised-by", "asks", "met-when", "tier", "realized-by", "changes", "from-idea", "x-provenance"]);

/**
 * A held requirement file brought into the July form without losing anything: fields the schema
 * does not name move, unchanged, under x-provenance["carried-fields"]; a missing asks or met-when
 * is filled from the journal's reading of the same requirement.
 */
export function conformRequirement(record, read, { seat }) {
  // A pool record no journal holds is conformed from itself: its own words, an unsettled condition.
  const july = read ? julyRequirementOf(read, { seat }) : julyRequirementOf({ body: { id: record.id, name: record.name, raisedBy: record["raised-by"], asks: record.asks,
    metWhen: [], sources: [] }, signature: { seat: record["x-provenance"]?.["recorded-by"] }, recordedAt: record["x-provenance"]?.["recorded-on"] }, { seat });
  // A field the July form names but whose value it does not admit (a tier outside routine, major and
  // strategic) is carried too, rather than coerced into a value its raiser did not give.
  const admitted = (key, value) => JULY_REQUIREMENT_FIELDS.has(key) && (key !== "tier" || ["routine", "major", "strategic"].includes(value));
  const carriedFields = Object.fromEntries(Object.entries(record).filter(([key, value]) => !admitted(key, value)));
  const conformed = Object.fromEntries(Object.entries(record).filter(([key, value]) => admitted(key, value)));
  return {
    ...conformed, kind: "requirement", asks: conformed.asks ?? july.asks,
    "met-when": Array.isArray(conformed["met-when"]) && conformed["met-when"].length > 0 ? conformed["met-when"] : july["met-when"],
    "x-provenance": { ...(read ? july["x-provenance"] : { "recorded-by": july["x-provenance"]["recorded-by"], "recorded-on": july["x-provenance"]["recorded-on"],
      ...(!(conformed["met-when"]?.length > 0) ? { "pending-conditions": july["x-provenance"]["pending-conditions"] } : {}) }), ...(conformed["x-provenance"] ?? {}), ...(Object.keys(carriedFields).length > 0 ? { "carried-fields": carriedFields } : {}) },
  };
}

const leaves = (value, path = []) => (value !== null && typeof value === "object" && Object.keys(value).length > 0
  ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, [...path, key])) : [[path, value]]);
const at = (value, path) => path.reduce((inner, key) => (inner == null ? undefined : inner[key]), value);

const sameKind = (a, b) => a !== null && b !== null && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b);
const keeps = (carried, path, value) => isDeepStrictEqual(at(carried, path), value)
  // An empty list or map is kept by the same kind of container there (an empty met-when filled by an unsettled condition).
  || (sameKind(value, at(carried, path)) && Object.keys(value).length === 0);

/**
 * Every leaf of `original` the carried record does not keep, at its own path or under
 * x-provenance["carried-fields"].
 */
export function lostFrom(original, carried) {
  return leaves(original).filter(([path, value]) => !keeps(carried, path, value) && !keeps(carried, ["x-provenance", "carried-fields", ...path], value))
    .map(([path]) => path.join("."));
}

/**
 * Carry every journal requirement, ruling and assembly break into the July pools as addressed
 * typed marks. Returns what was written and every record that could not be carried.
 */
export function carryToJuly({ repositoryRoot, schemaDirectory = join(repositoryRoot, JULY_SCHEMA_DIRECTORY), seat, scratch }) {
  const root = resolve(repositoryRoot);
  const types = julyTypes(schemaDirectory);
  const pool = (name) => join(root, REQUIREMENT_SECTION, "content", name);
  const carried = { requirements: [], rulings: [], decisions: [], attestations: [] };
  const refused = [];
  const attempt = (what, run) => { try { run(); } catch (error) { refused.push({ record: what, reason: error.message }); } };
  // A record already in the July form keeps its content; a journal-only one is written in it. A held
  // file the July form refuses (a later capture's shape) is conformed, and the carry is refused
  // outright if conforming would lose any of its leaves.
  // A record already carried (its address holds) is the team's now: it is never rewritten, so a
  // corrected reading or a seat's attestation on it survives every later carry.
  const heldAt = (path) => {
    if (!existsSync(path)) return false;
    try { return addressHolds(types, JSON.parse(readFileSync(path, "utf8"))); } catch { return false; }
  };
  const carryRequirement = (path, read) => {
    if (heldAt(path)) { carried.requirements.push(path.slice(root.length + 1)); return; }
    const original = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    let record = original ?? julyRequirementOf(read, { seat });
    if (!createTypedMark(types.requirement, withoutSignCell(record)).ok) record = conformRequirement(record, read, { seat });
    const next = addressed(types.requirement, record, read?.address ?? original?.["x-provenance"]?.[SIGN_CELL]?.cell);
    const lost = original ? lostFrom(withoutSignCell(original), next) : [];
    if (lost.length > 0) throw new TypeError(`carrying ${path.slice(root.length + 1)} would lose ${lost.join(", ")}`);
    write(path, next);
    carried.requirements.push(path.slice(root.length + 1));
  };
  for (const read of readGoverning({ repositoryRoot: root, kind: REQUIREMENT, scratch }).records) {
    attempt(`requirement:${read.body.id}`, () => {
      const held = read.body.carriedFrom ? join(root, read.body.carriedFrom) : undefined;
      const path = held && existsSync(held) ? held : join(root, read.body.section, "content", "requirements", `${read.body.id}.json`);
      // A record already in the July form keeps its content; a journal-only one is written in it.
      carryRequirement(path, read);
    });
  }
  // Every other requirement already in a July pool (recorded there by a node, no journal behind it) is addressed in place.
  const journaled = new Set(carried.requirements);
  for (const path of julyPoolFiles(root).requirements ?? []) {
    if (journaled.has(path)) continue;
    attempt(`requirement:${path}`, () => carryRequirement(join(root, path), undefined));
  }
  for (const read of readGoverning({ repositoryRoot: root, kind: RULING, scratch }).records) {
    attempt(`ruling:${read.body.id}`, () => {
      const { decision, ruling } = julyRulingOf(read);
      const decisionPath = join(pool("decision-records"), `${decision.id}.json`);
      const rulingPath = join(pool("rulings"), `${ruling.id}.json`);
      if (!heldAt(decisionPath)) write(decisionPath, addressed(types["decision-record"], decision));
      if (!heldAt(rulingPath)) write(rulingPath, addressed(types.ruling, ruling, read.address));
      carried.decisions.push(decision.id); carried.rulings.push(ruling.id);
    });
  }
  for (const read of readGoverning({ repositoryRoot: root, kind: ASSEMBLY_BREAK, scratch }).records) {
    attempt(`assembly-break:${read.body.id}`, () => {
      const attestation = julyAttestationOf(read);
      const attestationPath = join(pool("quality-attestations"), `${attestation.id}.json`);
      if (!heldAt(attestationPath)) write(attestationPath, addressed(types["quality-attestation"], attestation, read.address));
      carried.attestations.push(attestation.id);
    });
  }
  return Object.freeze({ ...carried, refused });
}

/**
 * Every journal requirement, ruling and assembly break that no July record carries: none in the
 * pools whose address holds and whose sign-cell names the journal cell it was carried from. Empty
 * is the proof the journals may be retired; until then nothing is removed.
 */
export function uncarried({ repositoryRoot, schemaDirectory = join(repositoryRoot, JULY_SCHEMA_DIRECTORY), scratch }) {
  const root = resolve(repositoryRoot);
  const types = julyTypes(schemaDirectory);
  const carriedCells = new Set(Object.values(julyPoolFiles(root)).flat().flatMap((path) => {
    try {
      const record = JSON.parse(readFileSync(join(root, path), "utf8"));
      return addressHolds(types, record) && record["x-provenance"][SIGN_CELL].cell ? [record["x-provenance"][SIGN_CELL].cell] : [];
    } catch { return []; }
  }));
  return Object.freeze([REQUIREMENT, RULING, ASSEMBLY_BREAK].flatMap((kind) => {
    const read = readGoverning({ repositoryRoot: root, kind, scratch });
    return [...read.records.filter((record) => !carriedCells.has(record.address)).map((record) => ({ kind, id: record.body.id, source: record.source })),
      ...read.refused.map((refusal) => ({ kind, refused: refusal }))];
  }));
}

/** Every July record in the team's pools and the requirement pools, with whether its address holds. */
export function readJuly({ repositoryRoot, schemaDirectory = join(repositoryRoot, JULY_SCHEMA_DIRECTORY), files }) {
  const types = julyTypes(schemaDirectory);
  return files.map((path) => {
    const record = JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
    return Object.freeze({ path, record, holds: addressHolds(types, record) });
  });
}
