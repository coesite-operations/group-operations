import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { openingOf } from "@red-cup-engineering/organizing/enterprise";
import { reconcileNodeRelease } from "@red-cup-engineering/node-runtime-release-promotion-service/reconcile";

const COLD_RELEASE_SPEC = "lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/deployments/cold-red-gate-host/deploy/release.json";
// The Group's deployments, as released with this module.
const DEPLOYMENTS = fileURLToPath(new URL("../../../deployments/", import.meta.url));

export const NODE_RELEASE_LAW = "A node runs the released bytes of the branch it follows: each commit the branch releases is installed, verified and promoted on it.";
// The release authority keeps the law; a refused release is engineering's to repair.
const NODE_RELEASE_SECTION = "section:services/engineering-services-section/services/computer-engineering-services-section/services/computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/services/node-runtime-authority-services-section/services/node-runtime-release-promotion-service";
const FINDING_LIMIT = 800;

/**
 * What this node's release readings find against the release law, as a derivation by `poster`:
 * one report per deployment whose reading carries a refusal no release has since repaired (each
 * pass of node-release-reconcile leaves its reading at <releaseRoot>/status.json, under this
 * host's home, for a peer it releases as for itself). A deployment reading converged, or reading
 * no standing refusal, is no finding, so a report the derivation no longer asks is resolved by
 * the readings it names, and a refusal found again reopens it. Its domain is the deployments it
 * read: a deployment with no reading is not measured, so its report stands as it was said.
 */
export function nodeReleaseFindingsOf({ poster, home = homedir(), deployments = DEPLOYMENTS }) {
  if (typeof poster !== "string" || poster === "") throw new TypeError("node-release-findings: poster names the enterprise its findings are by");
  const readings = readdirSync(deployments, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    .flatMap((deployment) => {
      let spec;
      try {
        spec = JSON.parse(readFileSync(resolve(deployments, deployment, "deploy/release.json"), "utf8"));
      } catch {
        return [];
      }
      if (typeof spec.releaseRoot !== "string" || spec.releaseRoot === "") return [];
      try {
        return [{ deployment, status: JSON.parse(readFileSync(resolve(home, spec.releaseRoot, "status.json"), "utf8")) }];
      } catch {
        return [{ deployment, status: undefined }];
      }
    });
  const openings = readings.flatMap(({ deployment, status }) => {
    const refusal = status?.state === "refused" ? status : status?.state === "converged" ? undefined : status?.refusal;
    if (refusal === undefined) return [];
    const said = `The ${deployment} release of ${refusal.target} was refused, so the node still runs ${status.running?.commit ?? "no release"}: `;
    return [{
      deployment,
      opening: openingOf({
        move: "report",
        by: poster,
        law: NODE_RELEASE_LAW,
        subject: `node-release:${deployment}`,
        observation: `${said}${String(refusal.reason ?? "its receipt names no reason")}`.slice(0, FINDING_LIMIT),
        evidence: [refusal.receipt],
        scope: [NODE_RELEASE_SECTION],
        tags: [deploymentTag(deployment)],
        at: status.checkedAt,
      }),
    }];
  });
  return Object.freeze({
    kind: "node-release-findings.v1",
    poster,
    domain: Object.freeze({ tags: Object.freeze(readings.filter(({ status }) => status !== undefined).map(({ deployment }) => deploymentTag(deployment))) }),
    evidence: readings.map(({ deployment, status }) => `node-release-status:${deployment}=${status === undefined ? "unread" : `${status.state}@${status.checkedAt}`}`).join("; "),
    openings: Object.freeze(openings),
  });
}

const deploymentTag = (deployment) => `node-release-${deployment}`;

// A measurement only this node can take: its own release readings, derived into the poster's reports.
export function nodeReleaseFindingsOperation({ home, deployments } = {}) {
  return operation({
    verb: "node-release-findings", inputFormat: "json", outputFormat: "json",
    summary: "Derive the release law's reports from this node's release readings.",
    description: "Domain: { poster }. Reads each Group deployment's release reading (<releaseRoot>/status.json, left by node-release-reconcile) and returns a derivation by poster: { kind: node-release-findings.v1, poster, domain: { tags: [node-release-<deployment> for each deployment read] }, evidence, openings: [{ deployment, opening }] }, one report under the release law per deployment whose reading carries a refusal no release has since repaired. An enterprise derives from it by naming { operation: \"node-release-findings\" } among its derives.",
    reads: ["node-release", "cold-red-gate.node-release"],
    effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: (input) => nodeReleaseFindingsOf({ poster: input?.poster, home, deployments }),
  });
}

// The node's own release duty. The repository is the host's configured checkout, never the caller's.
export function nodeReleaseReconcileOperation({ environment = process.env, clock } = {}) {
  return operation({
    verb: "node-release-reconcile", inputFormat: "json", outputFormat: "json",
    summary: "Keep this node running the released bytes of its branch.",
    description: "Domain: { spec, remote?: \"origin\", branch?: \"main\", settleSeconds?: 120, verifyDrift?: false }. spec is the repository-relative release.json, read from the branch's commit. Fetches the branch; when its released paths differ from the running release, starts one release of it in a transient user unit (<unit>-release) that survives this node's restart. A commit that failed to release is not retried: its refusal receipt is reported. verifyDrift re-hashes the running release and re-releases its own commit when it was edited in place. Returns { state: converged | releasing | refused | settling | launched | healing, desired, running, ... }.",
    reads: ["METROPLAT_REPOSITORY_ROOT"],
    writes: ["node-release"],
    effects: { class: "external", replay: "safe", coordination: "coordination-required", deterministic: "unmeasured", totality: "partial" },
    run: (input) => reconcileNodeRelease({
      repository: environment.METROPLAT_REPOSITORY_ROOT,
      spec: input?.spec,
      remote: input?.remote,
      branch: input?.branch,
      settleSeconds: input?.settleSeconds,
      verifyDrift: input?.verifyDrift === true,
      environment,
      ...(clock === undefined ? {} : { now: () => new Date(clock()) }),
    }),
  });
}

export function nodeReleaseReconcileOperations(binding) {
  return Object.freeze([
    nodeReleaseReconcileOperation({ clock: binding?.now }),
    nodeReleaseFindingsOperation(),
    operation({
      verb: "group-peer-release-reconcile", inputFormat: "json", outputFormat: "json",
      summary: "Keep the Cold Red Gate MetroPlat peer on the Group's released commit.",
      reads: ["METROPLAT_REPOSITORY_ROOT", "cold-red-gate.release-receipt"],
      writes: ["cold-red-gate.node-release"],
      effects: { class: "external", replay: "safe", coordination: "coordination-required", deterministic: "unmeasured", totality: "partial" },
      run: () => reconcileNodeRelease({
        repository: process.env.METROPLAT_REPOSITORY_ROOT,
        spec: COLD_RELEASE_SPEC,
        allowedRemoteHost: "cold-red-gate",
        settleSeconds: 120,
      }),
    }),
  ]);
}
