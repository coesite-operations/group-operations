// Operational measurements enter the existing arena as reports, never as a second incident store.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { openingOf } from "@red-cup-engineering/organizing/enterprise/work-arena";
import { currentReading, witnessesIn } from "@red-cup-engineering/feltos-enterprise-host/peer-liveness";

export const PRIMARY_HEALTH_KIND = "561-group.primary-system-health";
export const PRIMARY_HEALTH_LAW = "Primary systems supply current, qualified service-health evidence.";
export const PEER_LIVENESS_LAW = "A continuously present work peer answers within its declared liveness threshold.";
const SCOPE = Object.freeze(["section:services/561-group-services-section"]);
// Proposed receiving bounds: two existing 300-second primary pulses / 900-second catch-ups.
// These are new conservative recovery policies, not changes to the liveness suspicion threshold.
const FRESH_SECONDS = 600;
const PEER_RECOVERY_FRESH_SECONDS = 1800;
const tagOf = (kind, id) => `${kind}-${createHash("sha256").update(id).digest("hex")}`;
const readyEvidence = value => value?.state === "ready" && value.ok === true
  && (!Object.hasOwn(value, "nativeActorOk") || value.nativeActorOk === true)
  && (!Object.hasOwn(value, "serviceState") || ["ready", "degraded"].includes(value.serviceState));
const isInstant = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const fresh = (value, at, seconds) => isInstant(value) && Date.parse(value) <= Date.parse(at)
  && Date.parse(at) - Date.parse(value) <= seconds * 1000;

/** The existing semantic record shapes and their retained evidence addresses are the input.
 * Only measured domain tags may settle prior reports. Missing, stale or contradictory recovery
 * evidence cannot make an old fault disappear. A later denied observation reopens the same id. */
export function primaryHealthFindingsOf({ poster, primaryRecords = [], primaryStatus, peerRecords = [], at }) {
  if (typeof poster !== "string" || poster === "") throw new TypeError("primary-health-findings needs its existing enterprise poster");
  if (!isInstant(at)) throw new TypeError("primary-health-findings needs an observation instant");
  const tags = new Set(), openings = [], evidence = new Set();
  const report = ({ system, law, subject, tag, observation, records, observedAt }) => {
    for (const record of records) evidence.add(record.id);
    tags.add(tag);
    // Own operational conformance is addressed through the arena's existing report-party
    // contract. The per-system condition stays in the law so distinct faults retain distinct ids.
    openings.push({ system, opening: openingOf({ move: "report", by: poster,
      law: `${law} Condition: ${subject}.`, subject: `enterprise:${poster}`,
      observation: observation.slice(0, 800), evidence: records.map(record => record.id),
      scope: SCOPE, tags: [tag], at: observedAt }) });
  };
  const primary = new Map();
  for (const row of primaryRecords) {
    if (typeof row.record?.system !== "string") continue;
    const rows = primary.get(row.record.system) ?? [];
    primary.set(row.record.system, [...rows, row]);
  }
  for (const [system, rows] of primary) {
    if (rows.some(row => typeof row.id !== "string" || !isInstant(row.recordedAt)
      || Date.parse(row.recordedAt) > Date.parse(at))) continue;
    const latest = rows.reduce((a, b) => Date.parse(a.recordedAt) > Date.parse(b.recordedAt) ? a : b).recordedAt;
    const current = rows.filter(row => row.recordedAt === latest);
    const charges = new Set(current.map(row => row.record.charge));
    const charge = charges.size === 1 ? [...charges][0] : "contested";
    const tag = tagOf("primary-system-health", system);
    const status = primaryStatus?.systems?.find(value => value.id === system);
    const kind = current[0].record.kind;
    const coherentKind = ["machine", "property"].includes(kind) && status?.kind === kind
      && current.every(row => row.record.kind === kind);
    const qualifiedReadiness = kind === "property" || (readyEvidence(status?.readiness)
      && current.every(row => readyEvidence(row.record.readiness)
        && isDeepStrictEqual(row.record.readiness, status.readiness)));
    const qualifiedRecovery = coherentKind && qualifiedReadiness && charge === "held" && fresh(primaryStatus?.at, at, FRESH_SECONDS)
      && Date.parse(primaryStatus.at) >= Date.parse(latest) && status?.charge === "held"
      && current.every(row => row.told?.for === true && row.told?.against === false);
    if (qualifiedRecovery) {
      tags.add(tag); current.forEach(row => evidence.add(row.id));
      evidence.add(`primary-health-reading:${primaryStatus.at}:${system}=held`);
    } else if (["denied", "contested"].includes(charge)) {
      report({ system, law: PRIMARY_HEALTH_LAW, subject: `primary-system:${system}`, tag,
        observation: `${system} was ${charge} in its retained primary-health observation at ${latest}; qualified recovery has not been observed.`,
        records: current, observedAt: latest });
    }
  }
  // The independent peer observer keeps its existing FOUR windows and intermittent policy.
  // A historical held window is not a fresh recovery receipt for this derivation.
  const validPeerRecord = row => typeof row.id === "string" && typeof row.record?.peer === "string"
    && isInstant(row.record.at) && Date.parse(row.record.at) <= Date.parse(at)
    && isInstant(row.record.window) && Date.parse(row.record.window) <= Date.parse(row.record.at)
    && typeof row.told?.for === "boolean" && typeof row.told?.against === "boolean";
  // A malformed/future witness cannot be discarded to expose an older successful recovery.
  const unmeasuredPeers = new Set(peerRecords.filter(row => !validPeerRecord(row)).map(row => row.record?.peer));
  const validPeerRecords = peerRecords.filter(row => validPeerRecord(row) && !unmeasuredPeers.has(row.record.peer));
  const witnesses = witnessesIn({ query: () => validPeerRecords });
  // A joined retained row may tell both sides; preserve that evidence instead of projecting it held.
  for (const row of validPeerRecords.filter(row => row.told.for && row.told.against))
    witnesses.push({ ...row.record, side: "against" });
  for (const peer of new Set(witnesses.map(witness => witness.peer))) {
    // A qualified body directly says readiness; it need not wait for silence suspicion.
    // This uses the same retained observation, with a distinct report law and domain.
    const serviceRows = validPeerRecords.filter(row => row.record.peer === peer
      && ["ready", "failed"].includes(row.record.serviceHealth?.state));
    if (serviceRows.length > 0) {
      const latestServiceAt = serviceRows.reduce((a, b) => Date.parse(a.record.at) > Date.parse(b.record.at) ? a : b).record.at;
      const currentService = serviceRows.filter(row => row.record.at === latestServiceAt);
      const tag = tagOf("work-peer-service-health", peer);
      if (currentService.some(row => row.record.serviceHealth.state === "failed")) {
        report({ system: peer, law: PRIMARY_HEALTH_LAW, subject: `work-peer-service:${peer}`, tag,
          observation: `The declared supervised health service at ${peer} explicitly reported unready at ${latestServiceAt}. This is direct readiness evidence, not a crash-cause diagnosis.`,
          records: currentService, observedAt: latestServiceAt });
      } else if (fresh(latestServiceAt, at, PEER_RECOVERY_FRESH_SECONDS)
        && currentService.every(row => row.told.for === true && row.told.against === false
          && readyEvidence(row.record.serviceHealth) && row.record.serviceHealth.nativeActorOk === true)
        && !validPeerRecords.some(row => row.record.peer === peer
          && (row.record.serviceHealth !== undefined || row.record.why?.startsWith("health-"))
          && Date.parse(row.record.at) > Date.parse(latestServiceAt))) {
        tags.add(tag); currentService.forEach(row => evidence.add(row.id));
      }
    }
    const reading = currentReading(witnesses, peer);
    const told = witnesses.filter(witness => witness.peer === peer && witness.side !== "none");
    if (told.length === 0) continue;
    const window = told.reduce((latest, witness) => witness.window > latest ? witness.window : latest, told[0].window);
    const current = validPeerRecords.filter(row => row.record.peer === peer && row.record.window === window && (row.told.for || row.told.against));
    const latest = current.reduce((a, b) => Date.parse(a.record.at) > Date.parse(b.record.at) ? a : b).record.at;
    const tag = tagOf("work-peer-health", peer);
    if (reading === "held" && fresh(latest, at, PEER_RECOVERY_FRESH_SECONDS)) {
      tags.add(tag); current.forEach(row => evidence.add(row.id));
    } else if (["denied", "contested"].includes(reading)) {
      report({ system: peer, law: PEER_LIVENESS_LAW, subject: `work-peer:${peer}`, tag,
        observation: `The existing peer observer reads ${peer} as ${reading} at ${latest}. This is peer-liveness evidence, not a diagnosis of every service on the machine.`,
        records: current, observedAt: latest });
    }
  }
  if (tags.size === 0) throw new TypeError("primary-health-findings has no measured domain; prior reports remain standing");
  return Object.freeze({ kind: "primary-health-findings.v1", poster, domain: Object.freeze({ tags: Object.freeze([...tags]) }),
    evidence: [...evidence].sort().join("; "), openings: Object.freeze(openings) });
}

