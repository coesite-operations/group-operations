import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Only the declared systemd/journal process boundary is replaced. The operation constructor,
// node-job provider and recorder are the actual installed package implementations.
test("genuine operations retain instance admission, demand receipts and authored custody", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "group-job-execution-"));
  const calls = [];
  const saved = { execFile: childProcess.execFile, execFileSync: childProcess.execFileSync };
  const environmentBefore = { ...process.env };
  const argvBefore = process.argv;
  childProcess.execFile = (command, args, options, callback) => {
    calls.push({ command, args });
    if (command === "systemctl" && args[1] === "show") return callback(null, "inactive\n", "");
    if (command === "systemd-run") return callback(null, "", "");
    throw new Error(`Unexpected process: ${command}`);
  };
  childProcess.execFileSync = (command) => {
    if (command !== "journalctl") throw new Error(`Unexpected process: ${command}`);
    return "";
  };
  syncBuiltinESMExports();
  try {
    const { nodeJobOperations, nodeJobSchedules } = await import("../src/node-job-operation.mjs");
    const { nodeJobReadings, writeNodeJobDemand } = await import("@red-cup-engineering/node-job-service");
    const home = resolve(root, "home");
    process.env.HOME = home;
    const deployments = resolve(root, "deployments");
    const declare = (name) => {
      const destination = resolve(deployments, name);
      mkdirSync(resolve(destination, "deploy/jobs"), { recursive: true });
      writeFileSync(resolve(destination, "deploy/release.json"), JSON.stringify({ host: "transport-label", releaseRoot: "releases/fixture", unit: { name: "fixture.service" } }));
      for (const [id, extra] of [["demand", { demand: true }], ["manual", { workingTree: { custody: ["authored"] } }]]) {
        writeFileSync(resolve(destination, `deploy/jobs/${id}.json`), JSON.stringify({ id, summary: "Synthetic fixture", directory: "app", node: ["fixture.mjs"], maxSeconds: 300, ...extra }));
      }
      return destination;
    };
    const own = declare("own"); declare("unselected");
    const identity = { id: "fixture.561.group", title: "Fixture" };
    const manifest = resolve(root, "instance.json");
    writeFileSync(manifest, JSON.stringify({ version: 1, instanceOf: "@red-cup-engineering/metroplat", identity,
      scheduleSources: [{ module: "@561-group/group-operations/node-job-operation", export: "nodeJobSchedules", configuration: { deployment: "own" } }] }));
    const release = resolve(home, "releases/fixture/current");
    mkdirSync(resolve(release, ".metadata"), { recursive: true });
    const commit = "a".repeat(40);
    writeFileSync(resolve(release, ".metadata/release.json"), JSON.stringify({ machineCommit: commit }));
    const workspace = resolve(root, "authored-workspace"); mkdirSync(workspace);
    const binding = { repositoryRoot: release, now: () => "2026-10-03T00:05:00Z" };
    const context = { home, deployments, environment: { METROPLAT_INSTANCE: manifest, METROPLAT_CODEX_WORKSPACE: workspace }, instanceIdentity: identity };
    const operations = nodeJobOperations(binding, context);
    const run = operations.find(({ verb }) => verb === "node-job-run");
    assert.equal(run.kind, "metroplat.action");
    assert.equal(Object.isFrozen(run), true);
    assert.equal(typeof run.ref, "string");
    assert.equal(run.effects.coordination, "coordination-required");
    assert.match(run.description, /declared authored workspace/);
    assert.throws(() => run.execute({ deployment: "unselected", job: "demand", environment: context.environment, instanceIdentity: identity }), /not declared/);
    const unbound = nodeJobOperations(binding).find(({ verb }) => verb === "node-job-run");
    assert.throws(() => unbound.execute({ deployment: "own", job: "demand" }), /installed instance/);
    assert.equal(calls.length, 0);
    const schedules = nodeJobSchedules({ deployment: "own" }, { account: identity.id, deployments });
    assert.equal(schedules.length, 1, "manual jobs remain available without being scheduled");
    const started = await run.execute(schedules[0].input);
    assert.equal(started.state, "started"); assert.equal(started.release, commit);
    const launch = calls.find(({ command }) => command === "systemd-run");
    const envOf = (args) => Object.fromEntries(args.filter(arg => arg.startsWith("--setenv=")).map(arg => { const value = arg.slice(9), i = value.indexOf("="); return [value.slice(0, i), value.slice(i + 1)]; }));
    const runEnvironment = envOf(launch.args);
    assert.equal(runEnvironment.NODE_JOB_DEMAND, schedules[0].demand.replace(/\.json$/, ".demand.json"));
    assert.equal(runEnvironment.NODE_JOB_WORKING_TREE, undefined);
    assert.equal(runEnvironment.NODE_JOB_CUSTODY, undefined);
    writeNodeJobDemand({ pending: 0, nextAt: "2030-01-01T00:00:00Z" }, runEnvironment);
    Object.assign(process.env, runEnvironment, { SERVICE_RESULT: "success" });
    process.argv = [argvBefore[0], "synthetic-recorder", schedules[0].demand];
    const recorder = launch.args.find(arg => arg.startsWith("--property=ExecStopPost=")).slice("--property=ExecStopPost=".length).split(" ")[1];
    await import(`${pathToFileURL(recorder).href}?node-job-fixture=${encodeURIComponent(root)}`);
    const receipt = nodeJobReadings({ deploymentRoot: own, home }).find(({ job }) => job.id === "demand").last;
    assert.equal(receipt.demandAsked, true); assert.equal(receipt.demand.pending, 0);
    assert.equal(receipt.release, commit);
    const findings = operations.find(({ verb }) => verb === "node-job-findings").execute({ poster: "fixture" });
    assert.match(findings.evidence, /own:demand=success/); assert.ok(!findings.evidence.includes("unselected"));
    await run.execute({ deployment: "own", job: "manual" });
    const manual = calls.filter(({ command }) => command === "systemd-run").at(-1);
    const manualEnvironment = envOf(manual.args);
    assert.ok(manual.args.includes(`--property=WorkingDirectory=${resolve(release, "app")}`));
    assert.equal(manualEnvironment.METROPLAT_REPOSITORY_ROOT, release);
    assert.equal(manualEnvironment.NODE_JOB_WORKING_TREE, workspace);
    assert.deepEqual(JSON.parse(manualEnvironment.NODE_JOB_CUSTODY), ["authored"]);
    assert.equal(calls.filter(({ command }) => command === "systemd-run").length, 2);
  } finally {
    childProcess.execFile = saved.execFile; childProcess.execFileSync = saved.execFileSync; syncBuiltinESMExports();
    process.argv = argvBefore;
    for (const key of Object.keys(process.env)) if (!(key in environmentBefore)) delete process.env[key];
    Object.assign(process.env, environmentBefore);
    rmSync(root, { recursive: true, force: true });
  }
});
