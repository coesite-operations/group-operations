import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { nodeJobFindingsOf, nodeJobSchedules } from "../src/node-job-operation.mjs";

const deployment = "media-fixture";
const account = "schedule-fixture-account";
const releaseRoot = ".local/share/561-group/releases/media-fixture";

function declareJobs(root) {
  mkdirSync(resolve(root, "deploy/jobs"), { recursive: true });
  writeFileSync(resolve(root, "deploy/release.json"), JSON.stringify({
    host: "local", releaseRoot, unit: { name: "media-fixture.service" },
  }));
  const jobs = [
    { id: "flow-queue", demand: true },
    { id: "youtube-production", everySeconds: 1200, firstDueAt: "2026-10-03T00:05:00Z" },
    { id: "turntide-youtube-chatter", everySeconds: 1800, firstDueAt: "2026-10-03T00:05:00Z" },
  ];
  for (const job of jobs) writeFileSync(resolve(root, "deploy/jobs", `${job.id}.json`), JSON.stringify({
    summary: `Schedule fixture for ${job.id}`, directory: "app", node: ["fixture.mjs"], maxSeconds: 300, ...job,
  }));
}

function assertMediaSchedules(deployments) {
  const schedules = nodeJobSchedules({ deployment }, { account, deployments });
  assert.deepEqual(schedules.map(({ id }) => id), [
    "node-job-flow-queue", "node-job-turntide-youtube-chatter", "node-job-youtube-production",
  ]);
  assert.deepEqual(schedules[0], {
    id: "node-job-flow-queue", verb: "node-job-run", input: { deployment, job: "flow-queue" }, account,
    demand: resolve(homedir(), releaseRoot, "jobs/flow-queue.json"),
  });
  assert.deepEqual(schedules.slice(1).map(({ everySeconds, firstDueAt }) => ({ everySeconds, firstDueAt })), [
    { everySeconds: 1800, firstDueAt: "2026-10-03T00:05:00Z" },
    { everySeconds: 1200, firstDueAt: "2026-10-03T00:05:00Z" },
  ]);
}

test("the released deployment schedules demand-driven media alongside interval jobs", () => {
  const root = mkdtempSync(resolve(tmpdir(), "group-media-schedules-"));
  try {
    declareJobs(resolve(root, "deployments", deployment));
    assertMediaSchedules(resolve(root, "deployments"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing receipts remain unrun, while an existing successful receipt is read", () => {
  const root = mkdtempSync(resolve(tmpdir(), "group-media-schedules-"));
  try {
    declareJobs(resolve(root, "deployments", deployment));
    const options = { poster: "receipt-fixture", home: resolve(root, "home"), deployments: resolve(root, "deployments") };
    const unrun = nodeJobFindingsOf(options);
    assert.equal(unrun.openings.length, 0);
    assert.deepEqual(unrun.domain.tags, []);
    assert.equal(unrun.evidence.split("; ").filter((item) => item.endsWith("=unrun")).length, 3);
    const receipt = resolve(options.home, releaseRoot, "jobs/flow-queue.json");
    mkdirSync(resolve(receipt, ".."), { recursive: true });
    writeFileSync(receipt, JSON.stringify({ ok: true, result: "success", endedAt: "2026-10-03T00:06:00Z" }));
    const received = nodeJobFindingsOf(options);
    assert.equal(received.openings.length, 0);
    assert.deepEqual(received.domain.tags, ["node-job-media-fixture-flow-queue"]);
    assert.match(received.evidence, /node-job:media-fixture:flow-queue=success@2026-10-03T00:06:00Z/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
