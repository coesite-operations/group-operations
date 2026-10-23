/**
 * Assembly breaks and the design rules the requirement management section keeps (the fabrication
 * line's high-level design, 2026-10-10, sections 5 and 8).
 *
 * A break met at assembly is a signed cell (561-group.assembly-break, its class as category). A
 * class recorded a second time files a requirement to re-architect assembly so the class cannot
 * recur; its met-when is the class's detector over the estate, and it closes only when the detector
 * shows the class impossible by construction (the Leader, 2026-10-10: "if you encounter the same
 * type of break twice, it becomes a requirement to re-architect it").
 *
 * A design rule adopted over an estate that already breaks it records today's violations as a
 * baseline charged contested (Huidu Guanli: known, recorded, owed). Its detector fails only on a
 * violation the baseline does not hold, so a change may remove violations and never add one.
 *   DRC-2 one owner: no capability is held by two house packages of an assembled closure.
 *   DRC-4 signed cells: new record files are signed cells, not plain JSON.
 *   DRC-5 order: every merged change names the requirement it serves.
 * DRC-4 and DRC-5 are detected here. DRC-2's detector is its owner's check, run where a closure is
 * assembled; its result is the reading this section ratchets (`violationsOf`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addressHolds, julyAttestationOf, julyRequirementOf, julySchemaDirectoryAt, julyTypes, requirementSectionAt } from "./requirement-july.mjs";
import { readPools, writeJuly } from "./requirement-pools.mjs";
import { createHash } from "node:crypto";
import { cell } from "@red-cup-engineering/signcell/cell";
import { chargeOfTold } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { ASSEMBLY_BREAK, BASELINE, REQUIREMENT, REQUIREMENT_SECTION, admitSigned, readGoverning, recordGoverning, recordRootOf, registerSeatKey, seatKey, signed } from "./requirement-cells.mjs";
import { ordersNamed } from "./requirement-orders.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

/* ---------------------------------------------------------------- assembly breaks */

/** The requirement a repeated break class is owed. */
export const reArchitectureIdOf = (breakClass) => `assembly-cannot-break-by-${breakClass}`;

/**
 * Record one assembly break as `seat`; when its class now has two or more records and no
 * re-architecture requirement, file it. `detector` is the class's check over the estate, when one
 * exists; without it the requirement reads contested (no check yet) and its first work is the detector.
 */
export function recordAssemblyBreak({ repositoryRoot, input, seat, at = new Date().toISOString(), keyDirectory, scratch }) {
  if (typeof input?.breakClass !== "string" || !SLUG.test(input.breakClass)) throw new TypeError("breakClass is a lowercase slug");
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new TypeError("evidence names the run, commit or error the break was met in");
  const body = { kind: ASSEMBLY_BREAK, breakClass: input.breakClass, at: input.at ?? at, evidence: input.evidence.map(String),
    ...(input.repair ? { repair: String(input.repair) } : {}), ...(input.metBy ? { metBy: String(input.metBy) } : {}) };
  body.id = input.id ?? `${body.at.slice(0, 10)}-${createHash("sha256").update(JSON.stringify(body.evidence)).digest("hex").slice(0, 12)}`;
  const key = seatKey(seat, { directory: keyDirectory });
  const root = recordRootOf({ repositoryRoot, kind: ASSEMBLY_BREAK, within: body.breakClass, id: body.id });
  registerSeatKey({ root, key, at });
  const record = signed({ body, cell: cell(`class:${body.breakClass}`, "broke-at", `break:${body.id}`, { for: body.evidence.map((item) => `evidence:${item}`) }), key, at });
  admitSigned({ root, record, at });
  const breaks = readGoverning({ repositoryRoot, kind: ASSEMBLY_BREAK, scratch }).records.filter((read) => read.body.breakClass === body.breakClass);
  const requirementId = reArchitectureIdOf(body.breakClass);
  const filed = readGoverning({ repositoryRoot, kind: REQUIREMENT, scratch }).records.some((read) => read.body.id === requirementId);
  let requirement;
  if (breaks.length >= 2 && !filed) {
    requirement = recordGoverning({ kind: REQUIREMENT, repositoryRoot, seat, at, keyDirectory, input: {
      id: requirementId, name: `Assembly cannot break by ${body.breakClass}`, section: input.section ?? "lib/emsenn/services/561-group/services/engineering-services-section",
      raisedBy: "emsenn", class: "requirement", breakClass: body.breakClass, tier: "strategic",
      asks: "if you encounter the same type of break twice, it becomes a requirement to re-architect it, cause like we should be doing ... much better packaging and deployment, much more aligned with our theory.",
      sources: [{ words: "if you encounter the same type of break twice, it becomes a requirement to re-architect it", at: "2026-10-10", kind: "leader-ruling", relayed: true,
        locator: "lib/emsenn/services/561-group/services/engineering-services-section/services/fabrication-services-section/content/text/documents/articles/specifications/2026-10-10-fabrication-line-high-level-design.md#8" }],
      metWhen: input.detector ? [{ cell: `${body.breakClass}:impossible-by-construction`, says: `The ${body.breakClass} detector finds no instance over the estate.`, command: input.detector }] : [],
      allowUnchecked: true, objections: input.detector ? [] : [`no-detector: the ${body.breakClass} class has no detector over the estate yet; writing it is this requirement's first work`],
      opening: { need: `Assembly reads what it assembles from records, so a ${body.breakClass} break cannot occur by construction.`.slice(0, 400) },
    } });
  }
  return Object.freeze({ id: body.id, breakClass: body.breakClass, occurrences: breaks.length, requirement: requirement ?? (filed ? { id: requirementId, filed: "already" } : undefined) });
}

/* ---------------------------------------------------------------- design-rule baselines */

/** A violation as the baseline keeps it: the content digest of its name, so a baseline of thousands stays one record. */
export const violationDigest = (item) => `sha256:${createHash("sha256").update(String(item)).digest("hex").slice(0, 20)}`;

/** Record a rule's violations at adoption as a signed baseline, charged contested (told for and against). */
export function recordBaseline({ repositoryRoot, rule, violations, seat, at = new Date().toISOString(), keyDirectory }) {
  const body = { kind: BASELINE, id: rule, rule, at, violations: [...new Set(violations.map(violationDigest))].sort() };
  const key = seatKey(seat, { directory: keyDirectory });
  const root = recordRootOf({ repositoryRoot, kind: BASELINE, id: `${rule}-${at.slice(0, 10)}` });
  registerSeatKey({ root, key, at });
  const record = signed({ body, cell: cell(`rule:${rule}`, "baseline", `rule:${rule}`, { for: [`recorded:${body.violations.length}`], against: body.violations.length > 0 ? [`owed:${body.violations.length}`] : [] }), key, at });
  admitSigned({ root, record, at });
  return Object.freeze({ rule, violations: body.violations.length, charge: chargeOfTold({ for: true, against: body.violations.length > 0 }) });
}

/** The latest baseline of a rule. */
export function baselineOf({ repositoryRoot, rule, scratch }) {
  return readGoverning({ repositoryRoot, kind: BASELINE, scratch }).records.filter((read) => read.body.rule === rule)
    .sort((left, right) => String(left.body.at).localeCompare(String(right.body.at))).at(-1)?.body;
}

/** DRC-4: record files that are plain JSON, not a SignCell typed mark of their July schema (requirement records and data/records). */
export function plainRecordFiles(repositoryRoot, { schemaDirectory = julySchemaDirectoryAt(repositoryRoot) } = {}) {
  const types = existsSync(schemaDirectory) ? julyTypes(schemaDirectory) : undefined;
  const addressedRecord = (path) => {
    if (types === undefined) return false;
    try { return addressHolds(types, JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"))); } catch { return false; }
  };
  return git(repositoryRoot, "ls-files", "-z", "--", ":(glob)lib/**/content/requirements/*.json", ":(glob)lib/**/data/records/**/*.json",
    ":(glob)content/requirements/*.json", ":(glob)services/**/content/requirements/*.json", ":(glob)services/**/data/records/**/*.json")
    .split("\0").filter(Boolean).filter((path) => !/\/(legacy|_archive|node_modules)\//u.test(path) && !/\/schema\//u.test(path) && !addressedRecord(path));
}

/** When DRC-5 was adopted: merges from then on are read; the baseline holds those that named no order before it was enforced. */
export const DRC5_ADOPTED = "2026-10-10T00:00:00Z";

/** DRC-5: merges on the current branch since `since` whose changes name no order they serve. */
export function unorderedMerges(repositoryRoot, { since }) {
  const merges = git(repositoryRoot, "log", "--merges", "--first-parent", `--since=${since}`, "--format=%H").split("\n").filter(Boolean);
  return merges.filter((merge) => {
    const said = git(repositoryRoot, "log", "--format=%B", `${merge}^1..${merge}`);
    return ordersNamed(said).length === 0;
  });
}

/** The rules whose detector is another owner's check: the command that reads it, and its violations in that reading. */
export const CHECKED_ELSEWHERE = Object.freeze({
  "drc-2-one-owner": Object.freeze({
    check: "check-closure-divergent-copies '{\"closure\":\"<assembled node_modules>\"}' (@red-cup-engineering/computer-systems-fabrication-engineering-services-section)",
    violations: (reading) => {
      if (reading?.kind !== "check-closure-divergent-copies" || !Array.isArray(reading.copies)) throw new TypeError("drc-2-one-owner reads a check-closure-divergent-copies result");
      return reading.copies.map((copy) => copy.violation);
    },
  }),
});

/** A rule's current violations: detected here, or read from its owner's check result (`reading`). */
export function violationsOf({ repositoryRoot, rule, reading }) {
  if (rule === "drc-4-signed-cells") return plainRecordFiles(repositoryRoot);
  if (rule === "drc-5-order") return unorderedMerges(repositoryRoot, { since: DRC5_ADOPTED });
  const elsewhere = CHECKED_ELSEWHERE[rule];
  if (elsewhere === undefined) throw new TypeError(`no detector for ${rule}`);
  if (reading === undefined) throw new TypeError(`${rule} is checked by ${elsewhere.check}; pass its result as the reading`);
  return elsewhere.violations(reading);
}

/** Run a rule's detector against its baseline: { rule, violations, added, removed, ok }. */
export function detect({ repositoryRoot, rule, scratch, reading }) {
  const baseline = baselineOf({ repositoryRoot, rule, scratch });
  const current = violationsOf({ repositoryRoot, rule, reading });
  const held = new Set(baseline?.violations ?? []);
  const added = current.filter((item) => !held.has(violationDigest(item)));
  const present = new Set(current.map(violationDigest));
  const removed = [...held].filter((digest) => !present.has(digest));
  return Object.freeze({ rule, baselineAt: baseline?.at ?? null, violations: current.length, added, removed: removed.length, ok: baseline !== undefined && added.length === 0 });
}

/**
 * Record an assembly break as the team's quality attestation (emsenn/schema/quality-attestation);
 * when its class now has two or more attestations and no re-architecture requirement is held, write
 * that requirement in the July form.
 */
export function recordAssemblyBreakJuly({ repositoryRoot, input, seat, at = new Date().toISOString(), keyDirectory, schemaDirectory }) {
  if (typeof input?.breakClass !== "string" || !SLUG.test(input.breakClass)) throw new TypeError("breakClass is a lowercase slug");
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new TypeError("evidence names the run, commit or error the break was met in");
  const body = { breakClass: input.breakClass, at: input.at ?? at, evidence: input.evidence.map(String), ...(input.repair ? { repair: String(input.repair) } : {}), ...(input.metBy ? { metBy: String(input.metBy) } : {}) };
  body.id = input.id ?? `${body.at.slice(0, 10)}-${createHash("sha256").update(JSON.stringify(body.evidence)).digest("hex").slice(0, 12)}`;
  const options = { repositoryRoot, seat, keyDirectory, at, ...(schemaDirectory ? { schemaDirectory } : {}) };
  const attestation = julyAttestationOf({ body, recordedAt: at, signature: { seat } });
  writeJuly({ ...options, kind: "quality-attestation", record: attestation, path: `${requirementSectionAt(repositoryRoot)}/content/quality-attestations/${attestation.id}.json` });
  const pools = readPools({ repositoryRoot, ...(schemaDirectory ? { schemaDirectory } : {}) });
  const occurrences = pools.attestations.filter(({ record }) => record["x-provenance"]?.["break-class"] === body.breakClass).length;
  const requirementId = reArchitectureIdOf(body.breakClass);
  const held = pools.requirements.some((read) => read.body.id === requirementId);
  let requirement;
  if (occurrences >= 2 && !held) {
    const section = input.section ?? "lib/emsenn/services/561-group/services/engineering-services-section";
    const record = julyRequirementOf({ recordedAt: at, signature: { seat }, body: {
      id: requirementId, name: `Assembly cannot break by ${body.breakClass}`, section, raisedBy: "emsenn", class: "requirement", authority: "party:emsenn", breakClass: body.breakClass, tier: "strategic",
      asks: "if you encounter the same type of break twice, it becomes a requirement to re-architect it, cause like we should be doing ... much better packaging and deployment, much more aligned with our theory.",
      sources: [{ words: "if you encounter the same type of break twice, it becomes a requirement to re-architect it", at: "2026-10-10", kind: "leader-ruling", relayed: true }],
      metWhen: input.detector ? [{ cell: `${body.breakClass}:impossible-by-construction`, command: input.detector, expectedExit: 0 }] : [],
    } }, { seat });
    requirement = writeJuly({ ...options, kind: "requirement", record, path: `${section}/content/requirements/${requirementId}.json` });
  }
  return Object.freeze({ id: attestation.id, breakClass: body.breakClass, occurrences, requirement: requirement ?? (held ? { id: requirementId, filed: "already" } : undefined) });
}
