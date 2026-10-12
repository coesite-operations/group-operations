// Primary-system health, read by the always-on node and carried to the Group's fallbacks.
//
// Each pulse probes the primary systems and tells each one's state with the house's four charges:
// Properties report HTTP availability. Machines additionally require their explicit readiness
// claim. Changes of charge, readiness or release evidence are recorded,
// so the journal grows with what changed, not with every pulse, and the current reading is written
// as a public status document and page that the node's web server serves as the fallback status.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fetchWithPolicy } from "@red-cup-engineering/http-services-section/fetch-policy";
import { receiveRetainedReleaseOutcomes, separateReleaseOutcomeCustody } from "./retained-release-outcomes.mjs";

/** The primary systems a pulse reads by default: the machines, then every public property. */
export const PRIMARY_HEALTH_TARGETS = Object.freeze([
  { id: "cold-red-gate", url: "http://127.0.0.1:18818/healthz", public: "https://cold-red-gate.561.group/healthz", kind: "machine" },
  { id: "bare-cedar-fog", url: "https://bare-cedar-fog.561.group/healthz", kind: "machine" },
  ...["561.group", "market.561.group", "registry.561.group", "play.561.group", "farstone.561.group", "aletheon.561.group",
    "flickering.561.group", "onestone.561.group", "ruinfold.561.group", "durante.561.group", "casino.561.group",
    "turntide.561.group", "pool.turntide.561.group", "muse.561.group", "holofoam.561.group", "weiqi.561.group",
    "mud.561.group", "shop.561.group", "portage.561.group", "pacing.561.group", "iyappy.561.group", "parlor.561.group",
    "crucible.561.group", "fearful.561.group", "solitaire.561.group", "stoke.561.group", "gambling-trainer.561.group",
    "you-are-conscious.561.group", "equivo.play.561.group", "north-shore-scenic-railroad-service.561.group",
    "l-space.561.group", "emsenn.net", "koios.news"]
    .map((host) => ({ id: host, url: `https://${host}/`, kind: "property",
      ...(host === "l-space.561.group" ? { redirectOrigins: Object.freeze(["https://bare-cedar-fog.561.group"]) } : {}) })),
].map(Object.freeze));

/** The charge a probe's answer tells. */
export function chargeOf(answer) {
  if (answer === undefined) return "unknown";
  if (answer.status === undefined) return "denied";
  // A redirect without its receiving destination does not establish availability.
  if (answer.status >= 300 && answer.status < 400) return "unknown";
  if (answer.readiness?.state === "failed") return "denied";
  if (answer.status < 400 && answer.readiness?.state === "unknown") return "unknown";
  if (answer.status < 400) return "held";
  if (answer.status === 503 && answer.retryAfter !== undefined) return "contested";
  return "denied";
}

const TOLD = Object.freeze({
  held: Object.freeze({ for: true, against: false }),
  denied: Object.freeze({ for: false, against: true }),
  contested: Object.freeze({ for: true, against: true }),
  unknown: Object.freeze({ for: false, against: false }),
});

// The latest receipt describes an attempt, not necessarily the release that is running.
// Keep the public producer's scalar fields exactly, including false/empty legacy values.
const DEPLOYMENT_FIELDS = Object.freeze([
  "outcome", "machine", "revision", "repository", "run", "runAttempt", "stage", "at",
  "reason", "storePath", "previous", "retained",
]);
const isScalar = (value) => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** Read explicit machine readiness without inferring an actor requirement for every machine. */
export function machineReadiness(body) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(body)) return Object.freeze({ state: "unknown", reason: "missing-machine-health" });
  const actor = body.nativeActor;
  const evidence = {
    ...(Object.hasOwn(body, "ok") && isScalar(body.ok) ? { ok: body.ok } : {}),
    ...(Object.hasOwn(body, "state") && isScalar(body.state) ? { serviceState: body.state } : {}),
    ...(object(actor) && Object.hasOwn(actor, "ok") && isScalar(actor.ok) ? { nativeActorOk: actor.ok } : {}),
  };
  if (body.ok === false || actor?.ok === false || ["failed", "unready", "stopped"].includes(body.state))
    return Object.freeze({ state: "failed", reason: "machine-reports-unready", ...evidence });
  if (body.ok !== true)
    return Object.freeze({ state: "unknown", reason: "missing-readiness-claim", ...evidence });
  // The selected producer accepts ready/degraded and emits failed/unready on
  // explicit failures. Other present states cannot be inferred ready.
  if (Object.hasOwn(body, "state") && !["ready", "degraded"].includes(body.state))
    return Object.freeze({ state: "unknown", reason: "indeterminate-machine-state", ...evidence });
  if (Object.hasOwn(body, "nativeActor") && (!object(actor) || typeof actor.ok !== "boolean"))
    return Object.freeze({ state: "unknown", reason: "indeterminate-native-actor", ...evidence });
  return Object.freeze({ state: "ready", ...evidence });
}

function deploymentOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fields = DEPLOYMENT_FIELDS.filter((key) => Object.hasOwn(value, key) && isScalar(value[key]));
  return fields.length === 0 ? undefined : Object.freeze(Object.fromEntries(fields.map((key) => [key, value[key]])));
}

function sourcesOf(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const fields = ["repository", "commit", "url"];
  // A malformed source list is unknown; dropping malformed entries would assert a smaller set.
  if (!value.every((source) => source !== null && typeof source === "object" && !Array.isArray(source)
    && fields.every((key) => Object.hasOwn(source, key) && typeof source[key] === "string"))) return undefined;
  return Object.freeze(value.map((source) => Object.freeze(Object.fromEntries(fields.map((key) => [key, source[key]])))));
}

function releaseEvidenceOf(system) {
  const deployment = Object.fromEntries(Object.entries(system.deployment ?? {}).filter(([key]) => key !== "at"));
  return { release: system.release, artifact: system.artifact, sources: system.sources, deployment };
}

/** Receive one declared target with a single timeout signal shared by all hops.
 * Redirects stay in admitted origins. Injected transports must honor the signal.
 */
async function answerOf(target, { probe, timeoutMs }) {
  try {
    const initial = new URL(target.url);
    const origins = new Set([initial.origin, ...(target.redirectOrigins ?? [])]);
    const response = await fetchWithPolicy(target.url, {
      method: "GET", credentials: "omit", signal: AbortSignal.timeout(timeoutMs),
      headers: { "cache-control": "no-cache", "user-agent": "561-group-primary-health-pulse" },
    }, "primary-health", {
      fetchImpl: probe, maxRedirects: target.kind === "machine" ? 0 : 5,
      authorize(url, { redirect }) {
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new TypeError("unadmitted-primary-health-url");
        // The initial URL is the explicit probe binding (including the local
        // machine health check). Redirects cannot broaden that binding.
        if (redirect > 0 && (target.kind !== "property" || url.protocol !== "https:" || !origins.has(url.origin)))
          throw new TypeError("unadmitted-primary-health-redirect");
      },
    });
    const answer = { status: response.status };
    const retryAfter = response.headers?.get?.("retry-after");
    if (retryAfter) answer.retryAfter = retryAfter;
    if (target.kind === "machine") {
      let body;
      try { body = await response.json(); }
      catch { answer.readiness = Object.freeze({ state: "unknown", reason: "unreadable-machine-health" }); }
      answer.readiness ??= machineReadiness(body);
      // Keep PR96's release-identity boundary: a 503 still reports its running
      // release, while other failed HTTP answers do not establish that identity.
      // Optional metadata must never erase already-read failed readiness.
      if (response.status < 400 || response.status === 503) {
        for (const key of ["release", "artifact"]) {
          if (body?.[key] === null || typeof body?.[key] === "string") answer[key] = body[key];
        }
        const sources = sourcesOf(body?.sources);
        if (sources !== undefined) answer.sources = sources;
        const deployment = deploymentOf(body?.deployment);
        if (deployment !== undefined) answer.deployment = deployment;
      }
    } else {
      await response.body?.cancel?.();
    }
    return answer;
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.name ?? error?.message ?? error) };
  }
}

/** One reading of every target, in order. */
export async function readPrimaryHealth({ targets = PRIMARY_HEALTH_TARGETS, probe = globalThis.fetch, clock = () => new Date().toISOString(), timeoutMs = 20_000 } = {}) {
  const at = clock();
  const systems = await Promise.all(targets.map(async (target) => {
    const answer = await answerOf(target, { probe, timeoutMs });
    return Object.freeze({ id: target.id, kind: target.kind, url: target.public ?? target.url, charge: chargeOf(answer), ...answer });
  }));
  return Object.freeze({ at, systems: Object.freeze(systems) });
}

/** Changes of charge, readiness or release evidence, ignoring pulse/receipt timestamps alone. */
export function primaryHealthChanges(previous, current) {
  const before = new Map((previous?.systems ?? []).map((system) => [system.id, system]));
  return current.systems.filter((system) => {
    const was = before.get(system.id);
    return was === undefined || was.charge !== system.charge || !isDeepStrictEqual(releaseEvidenceOf(was), releaseEvidenceOf(system))
      || !isDeepStrictEqual(was.readiness, system.readiness);
  }).map((system) => Object.freeze({ ...system, was: before.get(system.id)?.charge ?? "unknown" }));
}

const escape = (text) => String(text).replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const WORD = Object.freeze({ held: "answering", denied: "not answering", contested: "unavailable (says so)", unknown: "not read" });

const stateWord = (system) => system.kind !== "machine" ? WORD[system.charge]
  : system.charge === "held" ? "ready"
  : system.readiness?.state === "failed" ? "not ready"
  : system.charge === "unknown" ? "readiness unknown" : WORD[system.charge];

/** The public status page of one reading. */
export function renderPrimaryHealthPage(status) {
  const rows = status.systems.map((system) => `<tr class="${system.charge}"><td><a href="${escape(system.url)}">${escape(system.id)}</a></td><td>${stateWord(system)}</td><td>${escape(system.status ?? system.error ?? "")}${system.readiness?.reason ? ` &middot; ${escape(system.readiness.reason)}` : ""}${system.deployment ? ` &middot; last deployment receipt ${escape(system.deployment.outcome ?? "unknown")}${system.deployment.stage ? ` at ${escape(system.deployment.stage)}` : ""}` : ""}</td><td>${escape(system.since ?? "")}</td></tr>`).join("\n");
  const down = status.systems.filter((system) => system.charge !== "held").length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>561 Group status</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:56rem;padding:1rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #8884}tr.denied td:nth-child(2){color:#c33}tr.contested td:nth-child(2){color:#b80}tr.held td:nth-child(2){color:#2a2}td{overflow-wrap:anywhere}</style>
</head><body>
<h1>561 Group status</h1>
<p>Read by Cold Red Gate at ${escape(status.at)}; ${down === 0 ? "all monitored checks are satisfied" : `${down} of ${status.systems.length} monitored checks need attention`}. Machine-readable: <a href="status.json">status.json</a>. This page is rewritten every pulse.</p>
<table><thead><tr><th>System</th><th>State</th><th>Answer</th><th>Since</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>
`;
}

async function writeAtomically(path, text) {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

/**
 * Read the primary systems, record every change of charge, readiness or release evidence, and write the public
 * status document and page. Returns the reading and the changes it recorded.
 */
export async function runPrimaryHealthPulse({ statusDirectory, journal, targets, probe, clock, timeoutMs, retainedReleaseOutcomes } = {}) {
  if (typeof statusDirectory !== "string" || statusDirectory === "") throw new TypeError("primary health needs a status directory");
  if (retainedReleaseOutcomes !== undefined) separateReleaseOutcomeCustody({ statusDirectory, journal, binding: retainedReleaseOutcomes.binding });
  await mkdir(statusDirectory, { recursive: true });
  const previous = await readJson(join(statusDirectory, "status.json"));
  const reading = await readPrimaryHealth({ targets, probe, clock, timeoutMs });
  const changes = primaryHealthChanges(previous, reading);
  const since = new Map((previous?.systems ?? []).map((system) => [system.id, system.since]));
  const changed = new Set(changes.map((change) => change.id));
  const status = Object.freeze({ ...reading, systems: reading.systems.map((system) => Object.freeze({ ...system, since: changed.has(system.id) ? reading.at : since.get(system.id) ?? reading.at })) });
  const recorded = [];
  for (const change of changes) {
    const record = journal?.record({ category: "primary-system-health", recordedAt: reading.at, told: TOLD[change.charge],
      record: { system: change.id, kind: change.kind, url: change.url, charge: change.charge, was: change.was,
        ...(change.status === undefined ? {} : { status: change.status }), ...(change.error === undefined ? {} : { error: change.error }),
        ...(change.release === undefined ? {} : { release: change.release }), ...(change.artifact === undefined ? {} : { artifact: change.artifact }),
        ...(change.sources === undefined ? {} : { sources: change.sources }),
        ...(change.deployment === undefined ? {} : { deployment: change.deployment }),
        ...(change.readiness === undefined ? {} : { readiness: change.readiness }) } });
    recorded.push(Object.freeze({ system: change.id, charge: change.charge, was: change.was, ...(record?.id === undefined ? {} : { evidence: record.id }) }));
  }
  // Optional private receiving shares this pulse and its existing journal. The
  // CLI supplies no binding or reader. Never merge private outcomes into status.
  const releaseOutcomes = retainedReleaseOutcomes === undefined ? undefined
    : await receiveRetainedReleaseOutcomes({ ...retainedReleaseOutcomes, journal, at: reading.at });
  await writeAtomically(join(statusDirectory, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
  await writeAtomically(join(statusDirectory, "index.html"), renderPrimaryHealthPage(status));
  return Object.freeze({ status, changes: Object.freeze(recorded), ...(releaseOutcomes === undefined ? {} : { releaseOutcomes }) });
}

