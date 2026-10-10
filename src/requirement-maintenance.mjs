/**
 * The requirement maintenance team's loop (MAPE-K over the founder's requirements and rulings).
 *
 *   Monitor  — run every recorded requirement's met-when checks, and every ruling's checks, in the
 *              repository the requirements are about.
 *   Analyse  — fold each check into a FOUR charge: passed (for), failed (against), a pass that only
 *              finds a file (for and against: existence is not behaviour), and a check that could
 *              not be run (neither: unknown). A requirement's charge is the join of its checks', so a
 *              partly met requirement reads contested rather than being forced to pass or fail.
 *   Plan     — every requirement not held becomes a request on the work board, carrying its raiser
 *              as the user it is for (Rendanheyi's 单), its checks as its conditions and its charge
 *              in its context; every ruling a check finds broken becomes a report.
 *   Execute  — the enterprise loop reconciles these openings on the board (organizing
 *              reconcileDerivedOpenings): what is missing is opened, what is no longer derived is
 *              settled, so a requirement that comes to be held closes its own work.
 *   Knowledge — each reading is a signed cell in the team's journal, so what was measured, when, by
 *              which seat, is evidence rather than a report.
 *
 * Huidu Guanli (灰度管理): a contested requirement does not stop the work that comes after it. Only a
 * denied or unknown prerequisite holds a dependent request back; a contested one lets it proceed and
 * says so, with the contest recorded in the reading the request cites.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cell } from "@red-cup-engineering/signcell/cell";
import { chargeOfTold, createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { openingOf } from "@red-cup-engineering/organizing/enterprise";
import { contributionsOf } from "./requirement-orders.mjs";
import { readPools } from "./requirement-pools.mjs";
import { CATEGORY, READING, REQUIREMENT, RULING, admitSigned, readGoverning, registerSeatKey, seatKey, signed } from "./requirement-cells.mjs";

export const MAINTENANCE_TAG = "requirement-maintenance";
export const RULING_TAG = "ruling-violation";
export const REQUIREMENT_LAW = "Every requirement the founder raised is held by checks that exercise what was asked for.";
const CHECK_TIMEOUT_MS = 60_000;
/** Exit codes that mean the check could not be run at all (not found, not executable), which tell nothing. */
const UNRUNNABLE = new Set([126, 127]);

/** The command a check may call to exercise the requirements machinery itself. */
export const REQUIREMENTS_BIN = fileURLToPath(new URL("../scripts/requirements.mjs", import.meta.url));

/** Run one check in `cwd` and read it as evidence. */
export function exercise(check, { cwd, timeoutMs = CHECK_TIMEOUT_MS, env = { ...process.env, GROUP_REQUIREMENTS_BIN: REQUIREMENTS_BIN } } = {}) {
  // A condition no command settles tells nothing either way: it reads unknown until one is stated.
  if (typeof check.command !== "string" || check.command === "") {
    return Object.freeze({ cell: check.cell, exit: null, exercises: check.exercises, charge: "unknown", told: Object.freeze({ for: [], against: [] }) });
  }
  const run = spawnSync("/bin/sh", ["-c", check.command], { cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  const exit = run.error ? null : run.status;
  const tail = `${run.stderr ?? ""}${run.stdout ?? ""}`.trim().slice(-300);
  const witness = `check:${check.cell}:exit=${exit ?? (run.error?.code ?? "error")}`;
  let told;
  if (exit === null || UNRUNNABLE.has(exit)) told = { for: [], against: [] };
  else if (exit !== check.expectedExit) told = { for: [], against: [witness] };
  else if (check.exercises === "existence") told = { for: [witness], against: [`existence-only:${check.cell}`] };
  else told = { for: [witness], against: [] };
  return Object.freeze({ cell: check.cell, exit, exercises: check.exercises, charge: chargeOfTold({ for: told.for.length > 0, against: told.against.length > 0 }),
    told: Object.freeze(told), ...(tail === "" || exit === check.expectedExit ? {} : { output: tail }) });
}

/** The join of check readings: told for if any check was, against if any check was. */
export function joined(readings) {
  const told = { for: readings.flatMap((reading) => reading.told.for), against: readings.flatMap((reading) => reading.told.against) };
  return Object.freeze({ told, charge: chargeOfTold({ for: told.for.length > 0, against: told.against.length > 0 }) });
}

/** Read one requirement: run its checks and record the reading as a signed cell. */
export function readRequirement(requirement, { cwd, key, journalRoot, at, timeoutMs }) {
  const conditions = requirement.body.metWhen.map((check) => exercise(check, { cwd, timeoutMs }));
  const { told, charge } = joined(conditions);
  // Rendanheyi: the merged work that names this requirement, and the worker who did each.
  const contributions = contributionsOf(cwd, requirement.body.id);
  const body = { kind: READING, id: `${requirement.body.id}@${at}`, requirement: requirement.body.id, requirementAddress: requirement.address,
    requirementCharge: requirement.charge, at, charge, conditions, contributions };
  const record = signed({ body, cell: cell(`requirement:${requirement.body.id}`, "met", `requirement:${requirement.body.id}`, told), key, at });
  const admitted = admitSigned({ root: journalRoot, record, at });
  return Object.freeze({ requirement, conditions, charge, contributions, event: admitted.events[0] });
}

/** Read one ruling's mechanical checks (rulings with none are carried, not checked). */
export function readRuling(ruling, { cwd, timeoutMs }) {
  const checks = ruling.body.checks.map((check) => exercise(check, { cwd, timeoutMs }));
  return Object.freeze({ ruling, checks, broken: checks.filter((check) => check.told.against.length > 0 && check.exercises === "behavior") });
}

/* ---------------------------------------------------------------- planning openings */

const PRIORITY = { must: "must", should: "should", could: "could", wont: "wont", "won't": "wont" };
const sectionScope = (section) => `section:${section.replace(/^lib\//u, "").replace(/^emsenn\/services\/561-group\//u, "")}`;
const describe = (reading) => reading.conditions.map((condition) => `${condition.cell}=${condition.charge}${condition.exercises === "existence" ? " (existence only)" : ""}`).join(", ");

/** The context a request carries: its charge, what each check read, the contest, and the reading it cites. */
function contextOf(reading, gate) {
  const lines = [
    `Requirement ${reading.requirement.body.id} (${reading.requirement.address}), raised by ${reading.requirement.body.raisedBy}, reads ${reading.charge}: ${describe(reading)}.`,
    reading.requirement.charge === "contested" ? `The requirement itself is contested (${reading.requirement.cell.against.join("; ")}): the raiser corroborates or withdraws it; work proceeds under the contest.` : undefined,
    reading.charge === "contested" ? "Huidu: the charge is contested, not failed. Work proceeds under the contest, which is recorded in the reading this request cites." : undefined,
    reading.conditions.some((condition) => condition.exercises === "existence") ? "Checks that only find a file are evidence that something was written, never that the capability works: replace each with a check that exercises it." : undefined,
    gate.length > 0 ? `Held back after: ${gate.join(", ")} (denied or unknown).` : undefined,
    `Asked, in the raiser's words: ${reading.requirement.body.asks}`,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 4000);
}

/**
 * The request a requirement that is not held opens: its need and EARS requirements from its board
 * opening when it carries one, its checks as conditions (method test), its raiser as the user it is
 * for. A requirement whose own wording the arena refuses is reported instead, so nothing is lost.
 */
export function openingOfReading(reading, { poster, at, gateOf = () => [] }) {
  const requirement = reading.requirement.body;
  const opening = requirement.opening ?? {};
  const gate = gateOf(requirement);
  const tags = [MAINTENANCE_TAG, `requirement-${requirement.id}`, `charge-${reading.charge}`];
  const sources = [{ kind: "record", locator: `${reading.requirement.source}#${reading.requirement.address}` }];
  const common = { by: poster, tags, at, scope: [...new Set([sectionScope(requirement.section), ...(opening.scope ?? [])])], sources };
  const slugOf = (value, fallback) => String(value ?? fallback).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || fallback;
  const statements = (opening.requirements ?? []).map((statement, index) => ({ id: slugOf(statement.id, `r${index + 1}`), says: statement.says, class: statement.class,
    priority: PRIORITY[String(statement.moscow ?? statement.priority ?? "must").toLowerCase()] ?? "must",
    ...(statement.rationale ? { rationale: String(statement.rationale).slice(0, 800) } : {}) }));
  const conditions = requirement.metWhen.map((check) => {
    const verifies = (opening.conditions ?? []).find((condition) => condition.id === check.cell)?.verifies;
    return { id: slugOf(check.cell, "condition"), says: (check.says ?? `${check.cell} holds: \`${check.command}\` exits ${check.expectedExit}`).slice(0, 400), method: "test",
      ...(verifies ? { verifies: verifies.map((id) => slugOf(id, id)) } : {}) };
  });
  const request = (fields) => openingOf({ ...common, move: "request", user: `party:${requirement.raisedBy}`, ...fields });
  const admits = (fields) => { try { request(fields); return true; } catch { return false; } };
  // The need as recorded, else the end every requirement shares: that it is held.
  const need = [opening.need, requirement.name, `The requirement ${requirement.id} is held by checks that exercise what was asked for.`]
    .filter(Boolean).map((text) => text.slice(0, 400)).find((text) => admits({ need: text })) ?? `The requirement ${requirement.id} is held.`;
  // Each EARS statement the arena admits is kept; one it refuses is carried in the context to be restated, never dropped.
  const kept = statements.filter((statement) => admits({ need, requirements: [statement] }));
  const restated = statements.filter((statement) => !kept.includes(statement));
  const known = new Set(kept.map((statement) => statement.id));
  const checked = conditions.map(({ verifies, ...condition }) => ({ ...condition, ...(verifies?.some((id) => known.has(id)) ? { verifies: verifies.filter((id) => known.has(id)) } : {}) }));
  const context = [contextOf(reading, gate), ...restated.map((statement) => `Restate as one conforming shall statement: ${statement.id}: ${statement.says}`)].join("\n").slice(0, 4000);
  try {
    return request({ need, requirements: kept, conditions: checked, context });
  } catch (refusal) {
    return openingOf({
      ...common, move: "report", law: REQUIREMENT_LAW, subject: `requirement:${requirement.id}`,
      observation: `Requirement ${requirement.id} reads ${reading.charge}: ${describe(reading)}. Its request was refused by the arena (${refusal.message}); the requirement's wording needs restating as an end the arena admits.`.slice(0, 800),
      evidence: [`reading:${reading.event}`],
    });
  }
}

/** The report a broken ruling opens. */
export function openingOfRuling(read, { poster, at }) {
  const ruling = read.ruling.body;
  return openingOf({
    move: "report", by: poster, at, law: ruling.ruling.slice(0, 800), subject: `ruling:${ruling.id}`,
    observation: `The ruling ${ruling.id} (${ruling.raisedBy}) is broken: ${read.broken.map((check) => `${check.cell} exit ${check.exit}${check.output ? `: ${check.output}` : ""}`).join("; ")}`.slice(0, 800),
    evidence: read.broken.map((check) => `check:${check.cell}`), scope: [sectionScope(ruling.section)], tags: [RULING_TAG, `ruling-${ruling.id}`],
    sources: [{ kind: "record", locator: `${read.ruling.source}#${read.ruling.address}` }],
  });
}

/**
 * One turn of the loop: read every requirement and ruling under `repositoryRoot`, record each reading
 * as `seat` into `journalRoot`, and derive the openings the board should hold.
 */
export function maintainRequirements({ repositoryRoot, journalRoot, seat, poster, at = new Date().toISOString(), keyDirectory, timeoutMs, only, schemaDirectory }) {
  const scratch = mkdtempSync(join(tmpdir(), "requirement-maintenance-"));
  try {
    mkdirSync(journalRoot, { recursive: true });
    const key = seatKey(seat, { directory: keyDirectory });
    registerSeatKey({ root: journalRoot, key, at });
    // The July requirement management system's pools are the one place requirements and rulings are read.
    const pools = readPools({ repositoryRoot, ...(schemaDirectory ? { schemaDirectory } : {}) });
    const requirements = { records: pools.requirements, refused: pools.refused.map((refusal) => ({ body: { id: refusal.path }, source: refusal.path, signature: { reason: refusal.reason } })) };
    const rulings = { records: pools.rulings, refused: [] };
    const selected = requirements.records.filter((record) => only === undefined || only.includes(record.body.id));
    const readings = selected.map((requirement) => readRequirement(requirement, { cwd: repositoryRoot, key, journalRoot, at, timeoutMs }));
    const chargeOf = new Map(readings.map((reading) => [reading.requirement.body.id, reading.charge]));
    // Huidu: contested prerequisites let dependents proceed; only denied or unknown ones hold them back.
    const gateOf = (requirement) => (requirement.after ?? []).filter((id) => ["denied", "unknown"].includes(chargeOf.get(id)));
    const rulingReads = rulings.records.map((ruling) => readRuling(ruling, { cwd: repositoryRoot, timeoutMs }));
    const openings = [
      ...readings.filter((reading) => reading.charge !== "held").map((reading) => ({ opening: openingOfReading(reading, { poster, at, gateOf }) })),
      ...rulingReads.filter((read) => read.broken.length > 0).map((read) => ({ opening: openingOfRuling(read, { poster, at }) })),
      ...requirements.refused.map((record) => ({ opening: openingOf({ move: "report", by: poster, at, law: "Every requirement and ruling is a signed cell whose signature holds.",
        subject: `requirement:${record.body?.id ?? "unknown"}`, observation: `A recorded requirement at ${record.source} fails its signature: ${record.signature.reason}.`, tags: [MAINTENANCE_TAG] }) })),
    ];
    const tally = (charge) => readings.filter((reading) => reading.charge === charge).length;
    return Object.freeze({
      kind: "requirement-maintenance-findings.v1", poster,
      domain: Object.freeze({ tags: Object.freeze([MAINTENANCE_TAG, RULING_TAG]) }),
      evidence: `requirements=${readings.length} held=${tally("held")} contested=${tally("contested")} denied=${tally("denied")} unknown=${tally("unknown")}; rulings=${rulingReads.length} broken=${rulingReads.filter((read) => read.broken.length > 0).length}; refused=${requirements.refused.length + rulings.refused.length}`,
      openings: Object.freeze(openings),
      readings: Object.freeze(readings.map((reading) => Object.freeze({ requirement: reading.requirement.body.id, charge: reading.charge, requirementCharge: reading.requirement.charge,
        conditions: reading.conditions, contributions: reading.contributions, event: reading.event }))),
      rulings: Object.freeze(rulingReads.map((read) => Object.freeze({ ruling: read.ruling.body.id, charge: read.ruling.charge, checks: read.checks }))),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The team's recorded readings of one requirement, latest last. */
export function readingsOf({ journalRoot, requirement }) {
  return createSemanticRecordJournal({ root: journalRoot, objectKind: READING }).query({ category: CATEGORY[READING] })
    .filter(({ record }) => requirement === undefined || record.mark.content.requirement === requirement)
    .map(({ record, recordedAt, told }) => Object.freeze({ ...record.mark.content, recordedAt, seat: record.claim.issuer, charge: chargeOfTold(told) }));
}

export { REQUIREMENT, RULING };
