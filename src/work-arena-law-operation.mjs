/**
 * The work arena's law on this node: which edition is in force, and its adoption (561 Group note
 * 2026-10-03 "How the node changes itself").
 *
 * A release realizes editions of the arena's law (organizing enterprise/work-arena-law); an act on
 * the agency's law record adopts one. The Chief Operations Officer adopts, since its enterprise,
 * group-operations, runs the board: a new edition is first dark, realized by the running release
 * but admitting nothing, and the COO adopts it once two measurements hold. The release that
 * realizes it has run for ADOPTION_SOAK_SECONDS, so a release rolled back in that time leaves no
 * move admitted under an edition the node no longer has. And every move this board admitted in
 * the last ADMISSIBILITY_WINDOW_HOURS is admissible under the edition too, so adopting it refuses
 * nothing its players now say. The act records both readings as its evidence. An adoption the
 * second measurement holds back is a finding against the engineering section that realizes the
 * arena's law, never a stop: the edition in force keeps admitting.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { resolve as resolveRecord } from "@red-cup-engineering/organizing/agency";
import { agencyAt, agencyMoved } from "@red-cup-engineering/organizing/agency/held";
import { enactAgencyRecord, recordPower } from "@red-cup-engineering/organizing/agency/records";
import { moveOf, openingOf, ordinal, workArenaLawOf, WORK_ARENA_LAW_RECORD } from "@red-cup-engineering/organizing/enterprise";
import { agencyRootOf } from "@red-cup-engineering/metroplat/offices";

const DEPLOYMENTS = fileURLToPath(new URL("../../../deployments/", import.meta.url));
const DEPLOYMENT = /^[a-z0-9][a-z0-9-]*$/;
/** The section whose agency holds the arena's law record, and the office that adopts its editions. */
export const LAW_SECTION = "emsenn/services/561-group/services/561-group-services-section";
export const ADOPTING_OFFICE = `${LAW_SECTION}#chief-operations-officer`;
/** How long the release realizing an edition runs before the edition may admit moves. */
export const ADOPTION_SOAK_SECONDS = 3600;
/** How far back the board's admitted moves are read again under an edition before it is adopted. */
export const ADMISSIBILITY_WINDOW_HOURS = 24;
/** How long an adoption stands before the COO revisits it (Huidu: a held judgment carries its revisit). */
const REVISIT_DAYS = 30;
const DAY_MS = 86_400_000;

export const WORK_ARENA_LAW_FINDING = "The work arena's law in force on a node is the edition its agency adopted, and the node's release realizes it.";
const LAW_TAG = "work-arena-law";
// The arena's law is realized by organizing, so a finding against it is at home there.
const ORGANIZING_SECTION = "section:services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/agent-computer-system-engineering-services-section/apps/agent-organization-engine/lib/organizing";

// The deployment this node releases itself from: the one Group deployment released locally here.
function localDeploymentOf(home, deployments) {
  const local = readdirSync(deployments, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => {
    const spec = resolve(deployments, name, "deploy/release.json");
    if (!existsSync(spec)) return false;
    const { host, releaseRoot } = JSON.parse(readFileSync(spec, "utf8"));
    return host === "local" && typeof releaseRoot === "string" && existsSync(resolve(home, releaseRoot, "current"));
  });
  if (local.length !== 1) throw new TypeError(`work-arena-law: name the deployment; this node releases ${local.length === 0 ? "none" : local.join(", ")} locally`);
  return local[0];
}

/** Where a deployment's releases live on this host. */
function releaseRootOf(home, deployments, deployment = localDeploymentOf(home, deployments)) {
  if (typeof deployment !== "string" || !DEPLOYMENT.test(deployment)) throw new TypeError(`work-arena-law: ${JSON.stringify(deployment)} names no Group deployment`);
  const spec = resolve(deployments, deployment, "deploy/release.json");
  if (!existsSync(spec)) throw new TypeError(`work-arena-law: ${deployment} declares no release`);
  return resolve(home, JSON.parse(readFileSync(spec, "utf8")).releaseRoot);
}

// The soak is the edition's, not one release's: a node that releases every few minutes keeps realizing
// the same edition across releases, and the pointer's time (the release's own) never reached the soak
// (2026-10-03: the 17th edition's soak restarted with each of the queue's releases). The host notes when
// it first saw an edition realized and dark; a release realizing another edition starts it again.
const DARK_RECORD = "work-arena-law-dark.json";

/** When `edition` was first seen realized and dark on this host, or undefined. */
export function darkSinceOf(releaseRoot, edition) {
  try {
    const dark = JSON.parse(readFileSync(resolve(releaseRoot, DARK_RECORD), "utf8"));
    return dark?.edition === edition && typeof dark.since === "string" ? dark.since : undefined;
  } catch { return undefined; }
}

/** Note that `edition` is realized and dark at `now`, unless it already is noted. */
export function noteDark(releaseRoot, edition, now) {
  if (darkSinceOf(releaseRoot, edition) !== undefined) return;
  const path = resolve(releaseRoot, DARK_RECORD);
  writeFileSync(`${path}.partial`, `${JSON.stringify({ edition, since: now })}\n`);
  renameSync(`${path}.partial`, path);
}

function releaseOf(home, deployments, deployment = localDeploymentOf(home, deployments)) {
  if (typeof deployment !== "string" || !DEPLOYMENT.test(deployment)) throw new TypeError(`work-arena-law: ${JSON.stringify(deployment)} names no Group deployment`);
  const spec = resolve(deployments, deployment, "deploy/release.json");
  if (!existsSync(spec)) throw new TypeError(`work-arena-law: ${deployment} declares no release`);
  const { releaseRoot } = JSON.parse(readFileSync(spec, "utf8"));
  const current = resolve(home, releaseRoot, "current");
  if (!existsSync(current)) return undefined;
  const receipt = resolve(current, "release-receipt.json");
  return Object.freeze({
    commit: existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")).source?.commit ?? null : null,
    // The pointer is swapped at promotion, so its own time is when this release went live.
    since: new Date(lstatSync(current).mtimeMs).toISOString(),
  });
}

/**
 * Every move the board admitted since `since` under the edition in force, read again under
 * `edition`: { read, refused: [{ move, why }] }. A move is re-admitted as its player said it, its
 * time and id kept, its edition left for the reading to name.
 */
export function admissibilityUnder(edition, inForce, { dataRoot, since }) {
  const journal = createSemanticRecordJournal({ root: dataRoot, objectKind: "work-arena-move" });
  const recent = journal.query({ category: "move" }).map(({ record }) => record)
    .filter((move) => move.at >= since && (move.edition ?? inForce.address) === inForce.address);
  const refused = [];
  for (const move of recent) {
    const { edition: _admitted, ...said } = move;
    try { moveOf(said, { law: edition }); } catch (error) { refused.push(Object.freeze({ move: move.id ?? `${move.move}@${move.thread}`, why: error.message })); }
  }
  return Object.freeze({ read: recent.length, refused: Object.freeze(refused) });
}

/** The law's standing and what adopting its realized edition would read, at `now`. */
export function workArenaLawReading({ agency, dataRoot, release, now, darkSince = () => undefined }) {
  const law = workArenaLawOf(agency);
  const reading = { standing: law.standing, inForce: law.inForce.address, inForceEdition: law.inForce.edition, realized: law.realized.address, realizedEdition: law.realized.edition, ...(law.adopted === undefined ? {} : { adopted: law.adopted }), release };
  if (law.standing !== "pending" && law.standing !== "unadopted") return Object.freeze(reading);
  // Dark since the host first saw the edition realized, or (never noted) since this release went live.
  const dark = release === undefined ? undefined : darkSince(law.realized.address) ?? release.since;
  const soaked = dark !== undefined && Date.parse(now) - Date.parse(dark) >= ADOPTION_SOAK_SECONDS * 1000;
  const since = new Date(Date.parse(now) - ADMISSIBILITY_WINDOW_HOURS * 3_600_000).toISOString();
  const admissibility = admissibilityUnder(law.realized, law.inForce, { dataRoot, since });
  return Object.freeze({ ...reading, soaked, darkSince: dark ?? null, soakUntil: dark === undefined ? null : new Date(Date.parse(dark) + ADOPTION_SOAK_SECONDS * 1000).toISOString(), admissibility: { since, ...admissibility } });
}

/**
 * Adopt the realized edition as the COO when the reading allows it: the act on the agency's law
 * record names the edition, says why, and carries the readings as evidence.
 */
function adopt({ root, agency, reading, account, now }) {
  const record = resolveRecord(agency, "policies", `${LAW_SECTION}#${WORK_ARENA_LAW_RECORD}`);
  if (record === undefined) throw new TypeError(`work-arena-law: ${LAW_SECTION} has no ${WORK_ARENA_LAW_RECORD} policy to adopt an edition on`);
  const office = resolveRecord(agency, "offices", ADOPTING_OFFICE);
  if (office === undefined) throw new TypeError(`work-arena-law: no office ${ADOPTING_OFFICE}`);
  const { "last-governance-act": _last, ...authored } = record.authored;
  const evidence = [
    `release:${reading.release.commit}@${reading.release.since}`,
    `dark-since:${reading.darkSince}`,
    `admissibility:${reading.admissibility.read} moves since ${reading.admissibility.since}, 0 refused under ${reading.realized}`,
  ];
  const next = {
    ...authored,
    edition: reading.realized,
    "edition-number": reading.realizedEdition,
    because: `The ${ordinal(reading.realizedEdition)} edition has run dark since ${reading.darkSince} (now in release ${reading.release.commit}), and every move the board admitted in the ${ADMISSIBILITY_WINDOW_HOURS} hours before ${now} is admissible under it, so adopting it refuses nothing its players now say.`,
    "adopted-at": now,
    "revisit-by": new Date(Date.parse(now) + REVISIT_DAYS * DAY_MS).toISOString().slice(0, 10),
  };
  return enactAgencyRecord({
    root, pool: "policies", id: WORK_ARENA_LAW_RECORD, section: LAW_SECTION, expectedRevision: record.revision, record: next,
    act: { actor: account, office: ADOPTING_OFFICE, evidence, at: now },
    authorize: ({ agency: current, pool, source }) => {
      const power = recordPower(current, resolveRecord(current, "offices", ADOPTING_OFFICE), pool, `lib/${source}`);
      if (!power) throw new TypeError(`work-arena-law: ${ADOPTING_OFFICE} holds no power over ${source}`);
      return power.key;
    },
  });
}

/** The node's work-arena law: its standing, the COO's adoption of a dark edition, and the findings against it. */
export function workArenaLawOperations(binding, { home = homedir(), deployments = DEPLOYMENTS } = {}) {
  const now = () => (binding?.now === undefined ? new Date().toISOString() : binding.now());
  const root = () => agencyRootOf(binding);
  const readingOf = (deployment) => {
    const release = releaseOf(home, deployments, deployment);
    const releaseRoot = release === undefined ? undefined : releaseRootOf(home, deployments, deployment);
    return workArenaLawReading({ agency: agencyAt(root()), dataRoot: binding.dataRoot, release, now: now(),
      darkSince: (edition) => (releaseRoot === undefined ? undefined : darkSinceOf(releaseRoot, edition)) });
  };
  // The reconcile pass is the one writer of the dark note: it runs on the node's clock every 15 minutes.
  const noteDarkOf = (deployment, reading) => {
    if (reading.release === undefined || reading.realized === reading.inForce) return;
    if (reading.standing !== "pending" && reading.standing !== "unadopted") return;
    // First seen now, but realized since the running release went live: the note starts there.
    noteDark(releaseRootOf(home, deployments, deployment), reading.realized, reading.release.since);
  };
  return Object.freeze([
    operation({
      verb: "work-arena-law", inputFormat: "json", outputFormat: "json",
      summary: "Which edition of the work arena's law admits moves on this node, which one its release realizes and which its agency adopted.",
      description: "Domain: { deployment? } (by default the deployment this node releases locally). Returns { standing: adopted | pending | unadopted | unrealized | ungoverned, inForce, realized, adopted?, release: { commit, since } } and, while an edition is dark (pending or unadopted), what adopting it would read: soaked (its release has run ADOPTION_SOAK_SECONDS), soakUntil, admissibility { since, read, refused[] } (the board's moves of the last day read again under it).",
      reads: ["agency", "work-arena-move"],
      effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
      run: (input) => readingOf(input?.deployment),
    }),
    operation({
      verb: "work-arena-law-reconcile", inputFormat: "json", outputFormat: "json",
      summary: "The COO adopts the edition of the work arena's law this release realizes, once it has run dark long enough and refuses nothing the board's players now say.",
      description: "Domain: { deployment? }. Reads work-arena-law; when the realized edition is dark, its release has soaked and the board's moves of the last day are all admissible under it, appends the COO's act on the agency's work-arena-law policy naming its address, with the readings as evidence. Returns { kind: work-arena-law-reconcile.v1, reading, adopted?: { edition, record }, held?: reason }.",
      reads: ["agency", "work-arena-move"],
      writes: ["agency"],
      effects: { class: "external", replay: "coordinated", coordination: "coordination-required", deterministic: "unmeasured", totality: "partial" },
      run: (input, _args, context) => {
        noteDarkOf(input?.deployment, readingOf(input?.deployment));
        const reading = readingOf(input?.deployment);
        const result = (fields) => Object.freeze({ kind: "work-arena-law-reconcile.v1", reading, ...fields });
        if (reading.standing !== "pending" && reading.standing !== "unadopted") return result({ held: `nothing dark to adopt (${reading.standing})` });
        if (reading.inForce === reading.realized) return result({ held: "the realized edition is already the one in force" });
        if (!reading.soaked) return result({ held: `its release soaks until ${reading.soakUntil}` });
        if (reading.admissibility.refused.length > 0) return result({ held: `${reading.admissibility.refused.length} of ${reading.admissibility.read} recent moves would be refused under it` });
        const record = adopt({ root: root(), agency: agencyAt(root()), reading, account: context?.invocation?.subject ?? "node", now: now() });
        agencyMoved(root());
        return result({ adopted: { edition: reading.realized, record: record?.source ?? null } });
      },
    }),
    operation({
      verb: "work-arena-law-findings", inputFormat: "json", outputFormat: "json",
      summary: "Derive the law-in-force finding: a realized edition the COO cannot adopt, or an adopted one this release lacks.",
      description: "Domain: { poster, deployment? }. A derivation by poster under WORK_ARENA_LAW_FINDING: one report, at home in organizing (which realizes the arena's law), when the adopted edition is not realized here, or when a soaked dark edition would refuse moves the board's players now say (naming the first refusals). Domain tags: work-arena-law.",
      reads: ["agency", "work-arena-move"],
      effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
      run: (input) => {
        if (typeof input?.poster !== "string" || input.poster === "") throw new TypeError("work-arena-law-findings: poster names the enterprise its findings are by");
        const reading = readingOf(input.deployment);
        const held = reading.soaked === true && (reading.admissibility?.refused.length ?? 0) > 0;
        const observation = reading.standing === "unrealized"
          ? `The agency adopted work-arena law edition ${reading.adopted}, which release ${reading.release?.commit ?? "unknown"} does not realize; the ${ordinal(reading.realizedEdition)} edition admits moves meanwhile.`
          : held
            ? `The ${ordinal(reading.realizedEdition)} edition (${reading.realized}) would refuse ${reading.admissibility.refused.length} of the ${reading.admissibility.read} moves admitted since ${reading.admissibility.since}, so it is not adopted: ${reading.admissibility.refused.slice(0, 3).map((entry) => entry.why).join(" | ")}`
            : undefined;
        return Object.freeze({
          kind: "work-arena-law-findings.v1",
          poster: input.poster,
          domain: Object.freeze({ tags: Object.freeze([LAW_TAG]) }),
          evidence: `work-arena-law=${reading.standing}; in force ${reading.inForce}; realized ${reading.realized}`,
          openings: Object.freeze(observation === undefined ? [] : [Object.freeze({ opening: openingOf({
            move: "report", by: input.poster, law: WORK_ARENA_LAW_FINDING, subject: `law:work-arena@${reading.realized}`,
            observation: observation.slice(0, 800), evidence: [`law:${reading.realized}`], scope: [ORGANIZING_SECTION], tags: [LAW_TAG], at: now(),
          }) })]),
        });
      },
    }),
  ]);
}
