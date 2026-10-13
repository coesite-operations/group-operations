import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { openingOf } from "@red-cup-engineering/organizing/enterprise";
import { nodeJobReadings, nodeJobSchedulesOf, nodeJobsOf, runNodeJob } from "@red-cup-engineering/node-job-service";
import { nodeJobDeploymentSelectionOf } from "./node-job-instance.mjs";
import { primaryHealthFindingsOperation } from "./primary-health-findings-operation.mjs";

// The Group's deployments, as released with this module.
const DEPLOYMENTS = process.env.METROPLAT_DEPLOYMENTS_ROOT ?? fileURLToPath(new URL("../../../deployments/", import.meta.url));
const DEPLOYMENT = /^[a-z0-9][a-z0-9-]*$/;

export const NODE_JOB_LAW = "A node runs each job its deployment declares from its released bytes, and each run ends in success.";
const FINDING_LIMIT = 800;
const TAIL_LINES = 6;

const deploymentRootOf = (deployments, deployment) => {
  if (typeof deployment !== "string" || !DEPLOYMENT.test(deployment) || nodeJobsOf(resolve(deployments, deployment)) === undefined) {
    throw new TypeError(`node-job: ${JSON.stringify(deployment)} is no Group deployment that declares jobs`);
  }
  return resolve(deployments, deployment);
};

// A job's failure is at home in the section whose code it runs: the deepest services/<section> its
// directory names under the Group.
function sectionOf(directory) {
  const parts = directory.split("/");
  const group = parts.indexOf("561-group");
  if (group === -1) return [];
  let end = group + 1;
  while (parts[end] === "services" && parts[end + 1] !== undefined) end += 2;
  return end === group + 1 ? [] : [`section:${parts.slice(group + 1, end).join("/")}`];
}

function endingOf(run, job) {
  if (run.result === "timeout") return `ran past its ${job.maxSeconds}s limit`;
  if (run.result === "exit-code") return `exited ${run.exit?.status}`;
  if (run.result === "signal" || run.result === "core-dump") return `was killed by ${run.exit?.status}`;
  return `ended ${run.result}`;
}

/**
 * What this node's job receipts find against the job law, as a derivation by `poster`: one report
 * per declared job whose last run did not succeed, at home in the section whose code the job runs,
 * carrying how the run ended and the tail of what it said. A job whose last run succeeded is no
 * finding, so its report is resolved by the run that repaired it. The domain is the jobs that have
 * a receipt: a job not yet run is not measured.
 * Direct callers retain all declared deployment roots; the hosted operation supplies only
 * the installed instance's selected roots.
 */
export function nodeJobFindingsOf({ poster, home = homedir(), deployments = DEPLOYMENTS, deploymentRoots }) {
  if (typeof poster !== "string" || poster === "") throw new TypeError("node-job-findings: poster names the enterprise its findings are by");
  const roots = deploymentRoots ?? new Map(readdirSync(deployments, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && nodeJobsOf(resolve(deployments, entry.name)) !== undefined)
    .map((entry) => entry.name).sort().map((deployment) => [deployment, resolve(deployments, deployment)]));
  const readings = [...roots]
    .flatMap(([deployment, root]) => nodeJobReadings({ deploymentRoot: root, home }).map((reading) => ({ deployment, ...reading })));
  const read = readings.filter(({ last }) => last !== undefined);
  const openings = read.filter(({ last }) => last.ok !== true).map(({ deployment, job, receipt, last }) => {
    const said = `The ${job.id} job on ${deployment} ${endingOf(last, job)} at ${last.endedAt}, running release ${last.release ?? "unknown"}`;
    const tail = (last.tail ?? []).slice(-TAIL_LINES).join(" | ");
    return {
      deployment,
      job: job.id,
      opening: openingOf({
        move: "report",
        by: poster,
        law: NODE_JOB_LAW,
        subject: `node-job:${deployment}:${job.id}`,
        observation: `${said}${tail === "" ? "." : `: ${tail}`}`.slice(0, FINDING_LIMIT),
        evidence: [receipt],
        scope: sectionOf(job.directory),
        tags: [jobTag(deployment, job.id)],
        at: last.endedAt,
      }),
    };
  });
  return Object.freeze({
    kind: "node-job-findings.v1",
    poster,
    domain: Object.freeze({ tags: Object.freeze(read.map(({ deployment, job }) => jobTag(deployment, job.id))) }),
    evidence: readings.map(({ deployment, job, last }) => `node-job:${deployment}:${job.id}=${last === undefined ? "unrun" : `${last.result}@${last.endedAt}`}`).join("; "),
    openings: Object.freeze(openings),
  });
}

const jobTag = (deployment, job) => `node-job-${deployment}-${job}`;

/** Resolve installed selections through this composition's existing deployment discovery. */
export function nodeJobDeploymentRootsOf({ deployments = DEPLOYMENTS, ...context } = {}) {
  return new Map(nodeJobDeploymentSelectionOf(context).map((deployment) => [deployment, deploymentRootOf(deployments, deployment)]));
}

/**
 * The clock schedules of the jobs one Group deployment declares, as an instance's schedule source
 * (`scheduleSources` in its manifest): { deployment } names the deployment, and each job with a
 * trigger becomes a node-job-run schedule run as the instance's own account.
 */
export function nodeJobSchedules({ deployment } = {}, { account, deployments = DEPLOYMENTS } = {}) {
  return nodeJobSchedulesOf({ deploymentRoot: deploymentRootOf(deployments, deployment), deployment, account });
}

/** The node's jobs: start one declared job's next run, and derive the job law's reports. */
export function nodeJobOperations(binding, { home, deployments = DEPLOYMENTS, environment, processConfig, instanceIdentity } = {}) {
  const ownRoots = () => nodeJobDeploymentRootsOf({ environment, processConfig, instanceIdentity, deployments });
  const ownRoot = (deployment) => {
    const root = ownRoots().get(deployment);
    if (root === undefined) throw new TypeError(`node-job: ${JSON.stringify(deployment)} is not declared by this instance`);
    return root;
  };
  return Object.freeze([
    primaryHealthFindingsOperation(binding, { home }),
    operation({
      verb: "node-job-run", inputFormat: "json", outputFormat: "json",
      summary: "Start the next run of a job this node's deployment declares, from its running release.",
      description: "Domain: { deployment, job }. The deployment must be selected by this installed instance's nodeJobSchedules sources; manual jobs in a selected deployment remain available. The job is read from its committed deploy/jobs/ declarations in this node's release, never from the caller. Unless a run of it has not ended, starts one in a transient user unit (<unit>-job-<job>) from the running release, which outlives this node's restart and records its own receipt (<releaseRoot>/jobs/<job>.json) when it ends. A job holding working-tree custody is told this node's declared authored workspace and the paths it holds there. Returns { kind: node-job-run.v1, job, unit, state: running | started, release?, startedAt?, last? }, last being the receipt of the job's last run to end.",
      reads: ["node-job"],
      writes: ["node-job"],
      effects: { class: "external", replay: "coordinated", coordination: "coordination-required", deterministic: "unmeasured", totality: "partial" },
      run: (input) => runNodeJob({
        deploymentRoot: ownRoot(input?.deployment),
        job: input?.job,
        // A job holding working-tree custody writes the node's own declared working tree.
        ...(binding?.repositoryRoot === undefined ? {} : { workingTree: environment?.METROPLAT_CODEX_WORKSPACE ?? binding.repositoryRoot }),
        ...(home === undefined ? {} : { home }),
        ...(binding?.now === undefined ? {} : { now: () => new Date(binding.now()) }),
      }),
    }),
    operation({
      verb: "node-job-findings", inputFormat: "json", outputFormat: "json",
      summary: "Derive the job law's reports from this node's job receipts.",
      description: "Domain: { poster }. Reads the jobs of deployments selected by this installed instance's nodeJobSchedules sources and the receipt of each one's last run, and returns a derivation by poster: { kind: node-job-findings.v1, poster, domain: { tags: [node-job-<deployment>-<job> for each job with a receipt] }, evidence, openings: [{ deployment, job, opening }] }, one report under the job law per job whose last run did not succeed, scoped to the section whose code the job runs. Missing receipts remain unrun. An enterprise derives from it by naming { operation: \"node-job-findings\" } among its derives.",
      reads: ["node-job"],
      effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
      run: (input) => nodeJobFindingsOf({ poster: input?.poster, ...(home === undefined ? {} : { home }), deployments, deploymentRoots: ownRoots() }),
    }),
  ]);
}
