import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { PEER_LIVENESS_KIND } from "@red-cup-engineering/feltos-enterprise-host/peer-liveness";
import { primaryHealthFindingsOf, PRIMARY_HEALTH_KIND } from "./primary-health-findings.mjs";

const readStatusFile = path => JSON.parse(readFileSync(path, "utf8"));
const readJournalWitnesses = ({ root, objectKind, category }) =>
  createSemanticRecordJournal({ root, objectKind }).query({ category });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const charges = new Set(["unknown", "held", "denied", "contested"]);
const statusShape = value => object(value) && instant(value.at) && Array.isArray(value.systems)
  && value.systems.every(row => object(row) && typeof row.id === "string"
    && ["machine", "property"].includes(row.kind) && charges.has(row.charge)
    && (row.readiness === undefined || object(row.readiness)));
const witnessShape = (rows, kind) => Array.isArray(rows) && rows.every(row => object(row)
  && typeof row.id === "string" && instant(row.recordedAt) && object(row.record)
  && typeof row.told?.for === "boolean" && typeof row.told?.against === "boolean"
  && (kind === PRIMARY_HEALTH_KIND
    ? typeof row.record.system === "string" && ["machine", "property"].includes(row.record.kind)
      && charges.has(row.record.charge) && (row.record.readiness === undefined || object(row.record.readiness))
    : typeof row.record.peer === "string" && instant(row.record.at) && instant(row.record.window)
      && (row.record.why === undefined || typeof row.record.why === "string")
      && (row.record.serviceHealth === undefined || object(row.record.serviceHealth))));
const ERROR_TYPES = new Set(["Error", "TypeError", "SyntaxError", "RangeError"]);
const ERROR_CODES = new Set(["ENOENT", "EACCES", "EPERM", "EIO", "ENOTDIR", "EISDIR", "EBADMSG", "ERR_INVALID_ARG_TYPE"]);
const failedInput = (source, error, malformed = false) => Object.freeze({ source, availability: "unavailable", reading: "unknown",
  failure: Object.freeze({ type: malformed ? "MalformedInput" : ERROR_TYPES.has(error?.name) ? error.name : "ReadError",
    code: malformed ? "INVALID_SHAPE" : ERROR_CODES.has(error?.code) ? error.code : "UNCLASSIFIED" }) });
const evidenceOfInputs = inputs => inputs.filter(input => input.availability === "unavailable")
  .map(input => `${input.source}=unknown:${input.failure.type}:${input.failure.code}`);
const NO_DOMAIN = "primary-health-findings has no measured domain; prior reports remain standing";

/** A host-read derivation on the existing Group Operations turn; it adds no clock or network act.
 * The genuine journal query may maintain disposable segment-verification checkpoints.
 * Local primary health is read where the existing job keeps it. Peer witnesses are in this
 * settlement's own journal, so BCF's observations do not require CRG to answer a journal read. */
export function primaryHealthFindingsOperation(binding, {
  home = homedir(), readStatus = readStatusFile, readWitnesses = readJournalWitnesses,
} = {}) {
  const primaryRoot = join(home, ".local/state/561-group/primary-health");
  return operation({
    verb: "primary-health-findings", inputFormat: "json", outputFormat: "json",
    summary: "Derive operational reports from retained primary-health and independent peer-liveness witnesses.",
    description: "Domain: { poster }. Returns the existing derived-openings contract plus input availability readings. Failed inputs remain explicitly unknown without hiding independently measured faults. Only fresh qualified recovery settles its measured reports; missing evidence leaves prior reports standing.",
    reads: ["primary-health", "peer-liveness"],
    effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: (input) => {
      const inputReadings = [];
      const read = (source, reader, valid) => {
        try {
          const value = reader();
          if (!valid(value)) { inputReadings.push(failedInput(source, undefined, true)); return undefined; }
          inputReadings.push(Object.freeze({ source, availability: "available" }));
          return value;
        } catch (error) { inputReadings.push(failedInput(source, error)); return undefined; }
      };
      const primaryStatus = read("primary-status", () => readStatus(join(primaryRoot, "public/status.json")), statusShape);
      const primaryRecords = read("primary-journal", () => readWitnesses({ root: join(primaryRoot, "knowledge"),
        objectKind: PRIMARY_HEALTH_KIND, category: "primary-system-health" }), rows => witnessShape(rows, PRIMARY_HEALTH_KIND));
      const peerRecords = read("peer-journal", () => readWitnesses({ root: binding.dataRoot,
        objectKind: PEER_LIVENESS_KIND, category: "heartbeat" }), rows => witnessShape(rows, PEER_LIVENESS_KIND));
      const inputs = Object.freeze(inputReadings);
      try {
        const result = primaryHealthFindingsOf({ poster: input?.poster, at: binding.now(), primaryStatus,
          primaryRecords: primaryRecords ?? [], peerRecords: peerRecords ?? [] });
        return Object.freeze({ ...result, inputReadings: inputs,
          evidence: [result.evidence, ...evidenceOfInputs(inputs)].filter(Boolean).join("; ") });
      } catch (error) {
        if (error instanceof TypeError && error.message === NO_DOMAIN) {
          // Preserve the real no-domain refusal and the classified missing evidence. Never
          // return an empty successful derivation that could erase an earlier incident.
          Object.defineProperties(error, { inputReadings: { value: inputs, enumerable: true },
            evidence: { value: ["primary-health-findings=unknown:no-measured-domain", ...evidenceOfInputs(inputs)].join("; "), enumerable: true } });
        }
        throw error;
      }
    },
  });
}
