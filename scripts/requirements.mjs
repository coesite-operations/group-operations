#!/usr/bin/env node
/**
 * The command any session calls to record what the founder asked for and ruled, as signed cells, in
 * the section that owns it; to read them back; and to run the maintenance loop once.
 *
 *   group-requirements record-requirement --seat SEAT [--repository ROOT] < requirement.json
 *   group-requirements record-ruling      --seat SEAT [--repository ROOT] < ruling.json
 *   group-requirements read [--kind requirement|ruling] [--repository ROOT]
 *   group-requirements carry-to-july --seat SEAT [--repository ROOT] [--schemas DIR]   (the codemod into the July pools)
 *   group-requirements carried [--repository ROOT] [--schemas DIR]   (exit 1 while any journal record has no addressed July record)
 *   group-requirements convert --seat SEAT [--repository ROOT]
 *   group-requirements maintain --seat SEAT --journal DIR [--repository ROOT] [--only id,id]
 *   group-requirements check-pull-request [--repository ROOT] < pull-request-body.md
 *   group-requirements brief [--repository ROOT] [--hook]
 *   group-requirements record-break --seat SEAT [--repository ROOT] < break.json   ({ breakClass, evidence[], repair?, detector? })
 *   group-requirements baseline --rule drc-4-signed-cells|drc-5-order --seat SEAT [--repository ROOT]
 *   group-requirements drc --rule drc-4-signed-cells|drc-5-order [--repository ROOT]   (exit 1 on a violation the baseline does not hold)
 *
 * A requirement's input: { id, name, section (repository-relative path of the owning section),
 * raisedBy, asks (the raiser's words, verbatim), sources: [{ words, session?, at?, locator?,
 * relayed? }], metWhen: [{ cell, command, expectedExit?, says?, exercises? }], tier?, serves?,
 * after?, opening? }. A ruling's: { id, section, raisedBy, ruling (verbatim), sources, checks? }.
 * SEAT names the office and carrier recording it, e.g.
 * emsenn/services/561-group/services/561-group-services-section#requirements-management-team@claude-session-<id>.
 * The seat's Ed25519 key is kept under GROUP_SEAT_KEY_DIR (default ~/.config/561-group/seats).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { REQUIREMENT, RULING, readGoverning, recordGoverning, requirementOf, rulingOf } from "../src/requirement-cells.mjs";
import { carryToJuly, julyRequirementOf, julyRequirementPathAt, julyRulingOf, requirementSectionAt, uncarried } from "../src/requirement-july.mjs";
import { readPools, writeJuly } from "../src/requirement-pools.mjs";
import { convertRequirements } from "../src/requirement-conversion.mjs";
import { maintainRequirements } from "../src/requirement-maintenance.mjs";
import { pullRequestOrder } from "../src/requirement-orders.mjs";
import { detect, plainRecordFiles, recordAssemblyBreakJuly, recordBaseline, unorderedMerges, DRC5_ADOPTED } from "../src/requirement-rules.mjs";

const [command, ...rest] = process.argv.slice(2);
const options = {};
for (let index = 0; index < rest.length; index += 1) {
  if (!rest[index].startsWith("--")) throw new TypeError(`unexpected argument ${rest[index]}`);
  options[rest[index].slice(2)] = rest[index + 1]?.startsWith("--") || rest[index + 1] === undefined ? true : rest[++index];
}
const repositoryRoot = () => resolve(options.repository ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const seat = () => {
  if (typeof options.seat !== "string") throw new TypeError("--seat names the office and carrier recording this");
  return options.seat;
};
const stdin = () => readFileSync(0, "utf8");
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const readAll = (kind) => {
  const scratch = mkdtempSync(join(tmpdir(), "group-requirements-"));
  try { return readGoverning({ repositoryRoot: repositoryRoot(), kind, scratch }); } finally { rmSync(scratch, { recursive: true, force: true }); }
};

try {
  switch (command) {
    case "record-requirement": {
      // Recorded in the July requirements management team's form, in the section that owns its outcome.
      const at = new Date().toISOString();
      const { body } = requirementOf(JSON.parse(stdin()));
      const record = julyRequirementOf({ body, recordedAt: at, signature: { seat: seat() } }, { seat: seat() });
      print(writeJuly({ repositoryRoot: repositoryRoot(), kind: "requirement", record, path: julyRequirementPathAt(repositoryRoot(), body.section, body.id), seat: seat(), at }));
      break;
    }
    case "record-requirement-journal":
      // The journal form, kept until every reader has moved to the July pools.
      print(recordGoverning({ kind: REQUIREMENT, input: JSON.parse(stdin()), repositoryRoot: repositoryRoot(), seat: seat() }));
      break;
    case "record-ruling": {
      const at = new Date().toISOString();
      const { body } = rulingOf(JSON.parse(stdin()));
      const { decision, ruling } = julyRulingOf({ body, recordedAt: at, signature: { seat: seat() } });
      print([writeJuly({ repositoryRoot: repositoryRoot(), kind: "decision-record", record: decision, path: `${requirementSectionAt(repositoryRoot())}/content/decision-records/${decision.id}.json`, seat: seat(), at }),
        writeJuly({ repositoryRoot: repositoryRoot(), kind: "ruling", record: ruling, path: `${requirementSectionAt(repositoryRoot())}/content/rulings/${ruling.id}.json`, seat: seat(), at })]);
      break;
    }
    case "read": {
      const pools = readPools({ repositoryRoot: repositoryRoot() });
      const records = options.kind === "ruling" ? pools.rulings : pools.requirements;
      const refused = pools.refused;
      print({ records: records.map((record) => ({ id: record.body.id, section: record.body.section, charge: record.charge, address: record.address,
        seat: record.signature.seat, trust: record.signature.trust, recordedAt: record.recordedAt, ...(options.full ? { body: record.body, cell: record.cell } : {}) })), refused });
      break;
    }
    case "carry-to-july": {
      // The codemod: every journal requirement, ruling and assembly break into the July pools.
      const scratch = mkdtempSync(join(tmpdir(), "group-requirements-"));
      try { const carried = carryToJuly({ repositoryRoot: repositoryRoot(), seat: seat(), scratch, ...(options.schemas ? { schemaDirectory: resolve(options.schemas) } : {}) });
        print({ requirements: carried.requirements.length, rulings: carried.rulings.length, decisions: carried.decisions.length, attestations: carried.attestations.length, refused: carried.refused });
        if (carried.refused.length > 0) process.exitCode = 1;
      } finally { rmSync(scratch, { recursive: true, force: true }); }
      break;
    }
    case "carried": {
      // The proof before any journal is retired: every journal record has its addressed July record.
      const scratch = mkdtempSync(join(tmpdir(), "group-requirements-"));
      try { const missing = uncarried({ repositoryRoot: repositoryRoot(), scratch, ...(options.schemas ? { schemaDirectory: resolve(options.schemas) } : {}) });
        print({ uncarried: missing });
        if (missing.length > 0) process.exitCode = 1;
      } finally { rmSync(scratch, { recursive: true, force: true }); }
      break;
    }
    case "convert":
      print(convertRequirements({ repositoryRoot: repositoryRoot(), seat: seat() }));
      break;
    case "maintain": {
      if (typeof options.journal !== "string") throw new TypeError("--journal names the directory the readings are recorded in");
      const result = maintainRequirements({ repositoryRoot: repositoryRoot(), journalRoot: resolve(options.journal), seat: seat(), poster: options.poster ?? "requirement-maintenance",
        only: typeof options.only === "string" ? options.only.split(",") : undefined });
      // Do not turn the source-owned executable Work Arena opening into a
      // label-only ticket. The next agent needs the original need, conditions,
      // dependencies, evidence and receiving party to perform the work.
      print({ evidence: result.evidence,
        readings: result.readings.map((reading) => ({ requirement: reading.requirement,
          charge: reading.charge, satisfied: reading.satisfied,
          conditions: reading.conditions.map((condition) => ({
            cell: condition.cell, charge: condition.charge, exercises: condition.exercises
          })) })),
        openings: result.openings.map(({ opening }) => opening) });
      break;
    }
    case "check-pull-request": {
      const pools = readPools({ repositoryRoot: repositoryRoot() });
      const verdict = pullRequestOrder({ body: stdin(), requirements: pools.requirements, rulings: pools.rulings });
      print(verdict);
      if (!verdict.ok) process.exitCode = 1;
      break;
    }
    case "brief": {
      // The rulings in force, verified, for a session to load at its start (--hook: as a SessionStart answer).
      const records = readPools({ repositoryRoot: repositoryRoot() }).rulings;
      const lines = [
        "The founder's standing rulings, as signed cells (group-requirements read --kind ruling):",
        ...records.map((record) => `- ${record.body.id} (${record.charge}): ${record.body.ruling}`),
        "Record every founder demand as a requirement in the section that owns its outcome (science -> engineering -> operations -> 561 Group or public):",
        "  group-requirements record-requirement --seat '<section>#<office>@<session>' < requirement.json",
        "Every pull request names the order it serves in a line `Serves: requirement:<id>`.",
      ];
      const text = lines.join("\n");
      process.stdout.write(options.hook ? `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } })}\n` : `${text}\n`);
      break;
    }
    case "record-break": {
      const scratch = mkdtempSync(join(tmpdir(), "group-requirements-"));
      try { print(recordAssemblyBreakJuly({ repositoryRoot: repositoryRoot(), input: JSON.parse(stdin()), seat: seat() })); } finally { rmSync(scratch, { recursive: true, force: true }); }
      break;
    }
    case "baseline": {
      const rule = options.rule;
      const violations = rule === "drc-4-signed-cells" ? plainRecordFiles(repositoryRoot()) : rule === "drc-5-order" ? unorderedMerges(repositoryRoot(), { since: DRC5_ADOPTED }) : undefined;
      if (violations === undefined) throw new TypeError("--rule is drc-4-signed-cells or drc-5-order");
      print(recordBaseline({ repositoryRoot: repositoryRoot(), rule, violations, seat: seat() }));
      break;
    }
    case "drc": {
      const scratch = mkdtempSync(join(tmpdir(), "group-requirements-"));
      try {
        const verdict = detect({ repositoryRoot: repositoryRoot(), rule: options.rule, scratch });
        print({ ...verdict, added: verdict.added.slice(0, 50) });
        if (!verdict.ok) process.exitCode = 1;
      } finally { rmSync(scratch, { recursive: true, force: true }); }
      break;
    }
    default:
      throw new TypeError("commands: record-requirement, record-ruling, record-break, read, maintain, check-pull-request, brief, baseline, drc, carry-to-july, carried, convert, record-requirement-journal");
  }
} catch (error) {
  process.stderr.write(`group-requirements: ${error.message}\n`);
  process.exitCode = 2;
}
