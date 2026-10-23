import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { nodeJobConfigurationsOf } from "@red-cup-engineering/computer-system-engine/rpc/node-job-operations";
import { nodeJobsAt } from "@red-cup-engineering/node-job-service";
import { tradingFleetOperations } from "../src/trading-fleet-operations.mjs";
import { selectFinancialFleetPulseDeployment } from "../src/financial-fleet-job-selection.mjs";

const LAW = "A node runs each job its deployment declares from its released bytes, and each run ends in success.";
const job = (id) => ({ id, summary: id, directory: "node_modules/@561-group/group-operations", node: ["scripts/run-financial-fleet-pulse.mjs"], maxSeconds: 240 });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "original-financial-fleet-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = join(root, "release");
  const state = join(root, "state");
  const jobsDir = join(release, "deploy/jobs");
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(jobsDir, "financial-fleet-pulse.json"), JSON.stringify(job("financial-fleet-pulse")));
  const configuration = {
    runtimeRoot: release, jobsDirectory: "deploy/jobs", stateRoot: state,
    unitPrefix: "financial-fixture", artifact: release,
  };
  const records = {
    law: LAW,
    deploymentRecords: [{
      deployment: "owned-fixture",
      host: "fixture.561.group",
      scope: ["section:fixture"],
      jobConfiguration: configuration,
    }],
  };
  return { root, release, state, records };
}

test("real Systems and Code providers select one installed job without executing it", (t) => {
  const f = fixture(t);
  const admitted = nodeJobConfigurationsOf(f.records);
  assert.equal(selectFinancialFleetPulseDeployment(admitted, c => nodeJobsAt(c).jobs), "owned-fixture");
  const selected = tradingFleetOperations({ repositoryRoot: f.release }, { configuration: f.records });
  assert.equal(selected.filter(x => x.verb === "financial-fleet-pulse").length, 1);
  assert.equal(selected.find(x => x.verb === "financial-fleet-pulse").execute instanceof Function, true);
});

test("real original node-job-run starts the unique declared pulse, not a hard-coded path", async (t) => {
  const f = fixture(t);
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  const invoked = join(f.root, "invoked.json");
  writeFileSync(join(bin, "systemctl"), "#!" + process.execPath + "\\nprocess.stdout.write('inactive\\\\n');\\n", { mode: 0o700 });
  writeFileSync(join(bin, "systemd-run"), "#!" + process.execPath + "\\nrequire('node:fs').writeFileSync(" + JSON.stringify(invoked) + ", JSON.stringify(process.argv.slice(2)));\\n", { mode: 0o700 });
  const originalPath = process.env.PATH;
  const originalFleet = process.env.NODE_JOB_FLEET;
  process.env.PATH = bin + delimiter + originalPath;
  delete process.env.NODE_JOB_FLEET;
  try {
    const operation = tradingFleetOperations({ repositoryRoot: f.release }, {
      configuration: f.records, environment: {},
    }).find(x => x.verb === "financial-fleet-pulse");
    const result = await operation.execute({});
    assert.equal(result.state, "started");
    assert.equal(result.job, "financial-fleet-pulse");
    const args = JSON.parse(readFileSync(invoked, "utf8"));
    assert.ok(args.some(x => x === "--unit=financial-fixture-job-financial-fleet-pulse.service"));
    assert.ok(args.some(x => x === "--setenv=NODE_JOB_ID=financial-fleet-pulse"));
  } finally {
    process.env.PATH = originalPath;
    if (originalFleet === undefined) delete process.env.NODE_JOB_FLEET;
    else process.env.NODE_JOB_FLEET = originalFleet;
  }
});

test("full original reader refuses two actually installed providers of the same pulse", (t) => {
  const f = fixture(t);
  const second = join(f.root, "other-release");
  mkdirSync(join(second, "deploy/jobs"), { recursive: true });
  writeFileSync(join(second, "deploy/jobs/financial-fleet-pulse.json"), JSON.stringify(job("financial-fleet-pulse")));
  const invalid = structuredClone(f.records);
  invalid.deploymentRecords.push({
    deployment: "foreign-fixture", host: "foreign.561.group", scope: ["section:foreign"],
    jobConfiguration: { ...invalid.deploymentRecords[0].jobConfiguration, runtimeRoot: second, artifact: second, unitPrefix: "foreign-fixture" },
  });
  assert.throws(() => selectFinancialFleetPulseDeployment(nodeJobConfigurationsOf(invalid), c => nodeJobsAt(c).jobs), /exactly one installed deployment/);
});
