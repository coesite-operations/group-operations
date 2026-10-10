/**
 * Carry the plain-JSON requirement records (<section>/content/requirements/<id>.json, the 2026-07
 * requirement.schema.json form) and the requirement-intake indexes into signed cells, recorded in
 * the same sections. Nothing is dropped: the record's own words, its met-when checks, its board
 * opening and its provenance travel with it, and the JSON it was carried from is named. A record
 * whose provenance says its words were relayed and not quoted, or whose authority is unresolved,
 * is told against as well as for: it reads contested until its raiser corroborates it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { cell } from "@red-cup-engineering/signcell/cell";
import { INTAKE, REQUIREMENT, admitSigned, recordGoverning, registerSeatKey, seatKey, signed } from "./requirement-cells.mjs";

export { INTAKE };

/** Every plain-JSON requirement record under a repository root. */
export function legacyRequirementFiles(repositoryRoot, { skip = /^(node_modules|\.git|legacy|_archive|triage)$/u } = {}) {
  const found = [];
  const walk = (directory, depth) => {
    if (depth > 40) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.name === "requirements" && directory.endsWith(`${"/"}content`)) {
        for (const file of readdirSync(path)) if (file.endsWith(".json")) found.push(join(path, file));
      } else walk(path, depth + 1);
    }
  };
  walk(resolve(repositoryRoot), 0);
  return found.sort();
}

/** The section a legacy record lives in: the directory holding its content/requirements. */
const sectionOfLegacy = (repositoryRoot, file) => relative(resolve(repositoryRoot), dirname(dirname(dirname(file))));

/**
 * The Leader's utterance corpus (…/leader-utterances/*.jsonl): each line an utterance's content
 * address with its session, time and verbatim text. A requirement that cites utterances by address
 * carries their words from here.
 */
export function utteranceIndex(repositoryRoot) {
  const index = new Map();
  const walk = (directory, depth) => {
    if (depth > 40) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || /^(node_modules|\.git|legacy)$/u.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.name === "leader-utterances") {
        for (const file of readdirSync(path)) {
          if (!file.endsWith(".jsonl")) continue;
          for (const line of readFileSync(join(path, file), "utf8").split("\n")) {
            if (line.trim() === "") continue;
            try { const utterance = JSON.parse(line); if (typeof utterance.address === "string") index.set(utterance.address, { ...utterance, locator: relative(resolve(repositoryRoot), join(path, file)) }); } catch { /* a torn line tells nothing */ }
          }
        }
      } else walk(path, depth + 1);
    }
  };
  walk(resolve(repositoryRoot), 0);
  return index;
}

/** The requirement input a legacy record carries (the met-when form, or the EARS form citing utterances). */
export function requirementInputOf(repositoryRoot, file, { utterances = new Map() } = {}) {
  const legacy = JSON.parse(readFileSync(file, "utf8"));
  if (legacy.kind !== "requirement") throw new TypeError(`${file} is not a requirement record`);
  const provenance = legacy["x-provenance"] ?? {};
  const opening = provenance["board-opening"];
  const relayed = /^\s*\[relayed/iu.test(legacy.asks ?? "") || provenance["relayed-not-quoted"] !== undefined;
  const locator = relative(resolve(repositoryRoot), file);
  const cited = [...(legacy["source-utterances"] ?? []), ...(provenance.utterances ?? [])];
  const unresolved = cited.filter((address) => !utterances.has(address));
  const sources = [
    ...cited.filter((address) => utterances.has(address)).map((address) => {
      const utterance = utterances.get(address);
      return { words: utterance.text, locator: `${utterance.locator}#${address}`, ...(utterance.session ? { session: String(utterance.session) } : {}), ...(utterance.at ? { at: String(utterance.at) } : {}) };
    }),
    ...(opening?.sources ?? []).filter((source) => typeof source?.words === "string" && source.words !== "").map((source) => ({
      words: source.words, ...(source.session ? { session: String(source.session) } : {}), ...(source["at-utc"] ? { at: String(source["at-utc"]) } : {}), relayed,
    })),
  ];
  if (sources.length === 0) sources.push({ kind: "requirement-record", locator, words: legacy.asks ?? legacy.name, relayed: relayed || legacy.asks === undefined,
    ...(provenance["recorded-on"] ? { at: String(provenance["recorded-on"]) } : {}) });
  const says = new Map((opening?.conditions ?? []).map((condition) => [condition.id, condition.says]));
  const metWhen = (legacy["met-when"] ?? []).map((check) => ({ cell: check.cell, command: check.command, expectedExit: check["expected-exit"] ?? 0,
    ...(says.has(check.cell) ? { says: says.get(check.cell) } : {}) }));
  const objections = [
    ...(provenance["unresolved-authority"] ? [`unresolved-authority:${provenance["unresolved-authority"]}`] : []),
    ...(provenance["relayed-not-quoted"] ? [`relayed-not-quoted:${provenance["relayed-not-quoted"]}`] : []),
    ...unresolved.map((address) => `utterance-not-held:${address}`),
    // Huidu: a requirement no check can fail is recorded, and the grey says so, instead of being dropped.
    ...(metWhen.length === 0 ? ["no-met-when: no check a machine runs says when this is met"] : []),
  ];
  const statements = opening?.requirements ?? legacy.requirements;
  return {
    id: legacy.id, name: legacy.name, section: sectionOfLegacy(repositoryRoot, file), raisedBy: legacy["raised-by"],
    asks: legacy.asks ?? sources.filter((source) => !source.relayed).map((source) => source.words).join("\n\n") ?? legacy.name,
    sources, metWhen, allowUnchecked: true,
    ...(legacy.tier ? { tier: legacy.tier } : {}), ...(legacy.changes ? { changes: legacy.changes } : {}),
    ...(legacy["realized-by"] ? { realizedBy: legacy["realized-by"] } : {}),
    ...(opening?.serves ? { serves: opening.serves } : {}), ...(opening?.after ? { after: opening.after } : {}),
    ...(opening || statements ? { opening: { ...(opening?.need ? { need: opening.need } : {}), ...(opening?.scope ? { scope: opening.scope } : {}),
      ...(statements ? { requirements: statements } : {}), ...(opening?.conditions ? { conditions: opening.conditions } : {}), ...(opening?.context ? { context: opening.context } : {}) } } : {}),
    ...(legacy.note ? { note: legacy.note } : {}),
    objections, carriedFrom: locator,
  };
}

/** Every requirement-intake index under a repository root. */
export function intakeFiles(repositoryRoot) {
  const found = [];
  const walk = (directory, depth) => {
    if (depth > 40) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || /^(node_modules|\.git|legacy)$/u.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.name === "requirement-intake") for (const file of readdirSync(path)) { if (file.endsWith(".json")) found.push(join(path, file)); }
      else walk(path, depth + 1);
    }
  };
  walk(resolve(repositoryRoot), 0);
  return found.sort();
}

/**
 * Record an intake index as a signed cell, (seat:<recorder>, carried, intake:<id>), told for by each
 * record it names that is now a signed requirement and against by each it names that is not.
 */
export function recordIntake({ repositoryRoot, file, seat, at, keyDirectory, carried }) {
  const index = JSON.parse(readFileSync(file, "utf8"));
  const named = (index.prompts ?? []).flatMap((prompt) => (prompt.records ?? []).map((record) => record.id));
  const body = { kind: INTAKE, id: index.id, name: index.name, statement: index.statement, recordedBy: index["recorded-by"], customer: index.customer,
    notPlayedOnTheBoard: index["not-played-on-the-board"], prompts: index.prompts, carriedFrom: relative(resolve(repositoryRoot), file) };
  const told = { for: named.filter((id) => carried.has(id)).map((id) => `signed:requirement:${id}`), against: named.filter((id) => !carried.has(id)).map((id) => `unsigned:requirement:${id}`) };
  const key = seatKey(seat, { directory: keyDirectory });
  const root = join(dirname(file), "..", "..", "requirement-intakes", index.id);
  registerSeatKey({ root, key, at });
  const record = signed({ body, cell: cell(`seat:${seat}`, "carried", `intake:${index.id}`, told), key, at });
  return { id: index.id, root, admitted: admitSigned({ root, record, at }) };
}

/** Carry every legacy requirement and intake index under `repositoryRoot` into signed cells as `seat`. */
export function convertRequirements({ repositoryRoot, seat, at = new Date().toISOString(), keyDirectory }) {
  const results = [];
  const refused = [];
  const utterances = utteranceIndex(repositoryRoot);
  for (const file of legacyRequirementFiles(repositoryRoot)) {
    try {
      const input = requirementInputOf(repositoryRoot, file, { utterances });
      if (existsSync(join(resolve(repositoryRoot), input.section, "data", "requirements", input.id, "data", "journals"))) { results.push({ id: input.id, skipped: "already signed" }); continue; }
      results.push(recordGoverning({ kind: REQUIREMENT, input, repositoryRoot, seat, at, keyDirectory }));
    } catch (error) { refused.push({ file: relative(resolve(repositoryRoot), file), reason: error.message }); }
  }
  const carried = new Set(results.map((result) => result.id));
  const intakes = intakeFiles(repositoryRoot).map((file) => recordIntake({ repositoryRoot, file, seat, at, keyDirectory, carried }));
  return Object.freeze({ requirements: results, intakes, refused });
}
