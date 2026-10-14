import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { observeComputeResources } from "./observe-compute-resources.mjs";
import { COMPUTE_OBJECT_KIND } from "./group-operations.mjs";
import { sendPeerEvidence } from "./peer-evidence.mjs";
import { projectCloudResourceClaims } from "./cloud-resource-claims.mjs";
import { put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

export function groupComputeResourceOperation({ environment = process.env, now = () => new Date().toISOString() } = {}) {
  return operation({
    verb: "group-compute-resource-observation-produce",
    inputFormat: "json", outputFormat: "json",
    summary: "Observe the Group's compute resources and deliver the dated reading to its MetroPlat peer.",
    reads: ["provider-accounts", "METROPLAT_WEB_DATA_DIR", "GROUP_PEER_ACTOR"],
    writes: ["group-compute-resource-observation"],
    effects: { class: "external", replay: "coordinated", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: async () => {
      if (!environment.METROPLAT_WEB_DATA_DIR || !environment.GROUP_PEER_ACTOR) {
        throw new TypeError("Compute observation requires the author node's data directory and Group peer actor");
      }
      const directory = join(environment.METROPLAT_WEB_DATA_DIR, "records");
      const path = join(directory, "compute-resources.json");
      let record;
      try { record = JSON.parse(await readFile(path, "utf8")); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      const age = Date.parse(now()) - Date.parse(record?.observedAt);
      const refreshed = record?.kind !== "compute-resource-observation" || !Number.isFinite(age) || age < 0 || age >= 86_400_000;
      if (refreshed) record = await observeComputeResources();
      // Project and commit for both fresh and previously cached observations:
      // otherwise an upgrade leaves up to 24 hours of apparent resource
      // subjects without admitted SEN/SEAVT rows. The native store's put()
      // is idempotent by SCA content address, so replay makes no duplicates.
      const facts = projectCloudResourceClaims(record);
      const witness = put(environment.METROPLAT_WEB_DATA_DIR, "cloud-observation", facts.witnessRecord);
      if (witness !== facts.observationWitness)
        throw new TypeError("SCA witness record address differs from its SignCell address");
      for (const row of facts.rows) put(environment.METROPLAT_WEB_DATA_DIR, "cloud-resource", row);
      if (refreshed) {
        await mkdir(directory, { recursive: true });
        const temporary = `${path}.tmp-${process.pid}`;
        await writeFile(temporary, JSON.stringify(record) + "\n", { mode: 0o600 });
        await rename(temporary, path);
      }
      const delivery = await sendPeerEvidence({
        environment, peerActor: environment.GROUP_PEER_ACTOR,
        peerInbox: environment.GROUP_PEER_INBOX,
        objectKind: COMPUTE_OBJECT_KIND,
        value: { type: "GroupComputeResourceObservation", asOf: record.observedAt, record,
          // Existing signed SEN SignCell delivery carries the subjects and
          // native witness anchor; peers reconstruct the SEAVT projection.
          resourcePredications: {kind:facts.kind,
            observationWitness:facts.observationWitness,
            resourceSubjects:facts.resourceSubjects,sourceCommitment:facts.sourceCommitment} },
      });
      return { observedAt: record.observedAt, resourceCount: facts.rows.length, resourceWitness:facts.observationWitness, delivery };
    },
  });
}
