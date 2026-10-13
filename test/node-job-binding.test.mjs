import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { nodeJobDeploymentRootsOf } from "../src/node-job-operation.mjs";
import { nodeJobsOf } from "@red-cup-engineering/node-job-service";

const identity = { id: "fixture.561.group", title: "Fixture", origin: "https://fixture.561.group/" };
const source = (deployment) => ({ module: "@561-group/group-operations/node-job-operation", export: "nodeJobSchedules", configuration: { deployment } });

function fixture(run) {
  const root = mkdtempSync(resolve(tmpdir(), "group-job-binding-"));
  const deployments = resolve(root, "deployments");
  const instancePath = resolve(root, "instance.json");
  const options = { deployments, environment: { METROPLAT_INSTANCE: instancePath }, instanceIdentity: identity };
  const manifest = (sources, ownIdentity = identity) => writeFileSync(instancePath, JSON.stringify({
    version: 1, instanceOf: "@red-cup-engineering/metroplat", identity: ownIdentity, operationSources: [], scheduleSources: sources,
  }));
  const declare = (name, host = "local", destination = resolve(deployments, name)) => {
    mkdirSync(resolve(destination, "deploy/jobs"), { recursive: true });
    writeFileSync(resolve(destination, "deploy/release.json"), JSON.stringify({ host, releaseRoot: `releases/${name}`, unit: { name: `${name}.service` } }));
    writeFileSync(resolve(destination, "deploy/jobs/manual.json"), JSON.stringify({ id: "manual", summary: "Manual fixture", directory: "app", node: ["fixture.mjs"], maxSeconds: 300 }));
    return destination;
  };
  try { run({ root, options, instancePath, manifest, declare }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("only installed source declarations select deployments, regardless of transport label", () => fixture(({ options, manifest, declare }) => {
  const own = declare("own", "remote-transport-name");
  declare("other");
  manifest([source("own")]);
  const roots = nodeJobDeploymentRootsOf(options);
  assert.deepEqual([...roots], [["own", own]]);
  assert.equal(roots.has("other"), false);
  // A declared deployment with no triggered jobs still permits its manual jobs.
  assert.equal(nodeJobsOf(roots.get("own")).jobs.has("manual"), true);
}));

test("multiple distinct installed job sources retain each declared deployment", () => fixture(({ options, manifest, declare }) => {
  declare("first"); declare("second"); declare("unselected");
  manifest([source("first"), { module: "@fixture/unrelated", export: "schedules" }, source("second")]);
  assert.deepEqual([...nodeJobDeploymentRootsOf(options).keys()], ["first", "second"]);
}));

test("absent or conflicting factory identity and instance paths fail closed", () => fixture(({ options, instancePath, manifest, declare }) => {
  declare("own"); manifest([source("own")]);
  assert.throws(() => nodeJobDeploymentRootsOf(), /installed instance/);
  assert.throws(() => nodeJobDeploymentRootsOf({ ...options, instanceIdentity: undefined }), /admitted identity/);
  for (const changed of [{ id: "other.561.group" }, { title: "Different" }, { origin: "https://other.561.group/" }]) {
    assert.throws(() => nodeJobDeploymentRootsOf({ ...options, instanceIdentity: { ...identity, ...changed } }), /differs/);
  }
  assert.throws(() => nodeJobDeploymentRootsOf({ ...options, instanceIdentity: { id: identity.id } }), /admitted identity/);
  assert.throws(() => nodeJobDeploymentRootsOf({ ...options, processConfig: { instance: `${instancePath}.other` } }), /differs/);
  assert.deepEqual([...nodeJobDeploymentRootsOf({ ...options, environment: {}, processConfig: { instance: instancePath } }).keys()], ["own"]);
}));

test("missing, malformed and duplicate source selections fail closed", () => fixture(({ options, manifest, declare }) => {
  declare("own");
  for (const sources of [undefined, [], [source("missing")], [source("../escape")], [source("own"), source("own")],
    [source("own"), null], [source("own"), []], [source("own"), {}],
    [{ ...source("own"), configuration: null }], [{ ...source("own"), configuration: [] }], [{ ...source("own"), configuration: "own" }]]) {
    manifest(sources);
    assert.throws(() => nodeJobDeploymentRootsOf(options), /no job|no Group|repeats|schedule source|valid deployment/);
  }
}));

