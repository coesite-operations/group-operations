#!/usr/bin/env node
/**
 * The host's disk budget, held by the deployment rather than by whoever notices a full disk. Accumulating state
 * leaves through its owners (offload-host-state to R2, the registry's prune-uplink-cache, journal packing); this is
 * the backstop for what no owner holds: build and tool caches. It reclaims them, then measures, and fails when
 * free space is under the budget, so a filling disk is a failed job on the node, not a surprise.
 *
 *   machine-disk-budget.mjs [--min-free-percent 25] [--keep-codex-days 14]
 *
 * Reclaims: Guix store items no root holds (the current and previous releases are roots), the pnpm store's
 * unreferenced packages, Codex session files older than --keep-codex-days, and the user journal beyond 100 MB.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "min-free-percent": { type: "string", default: "25" }, "keep-codex-days": { type: "string", default: "14" } } });
const home = homedir(), steps = [];
const run = (name, program, args) => {
  try { execFileSync("nice", ["-n", "19", "ionice", "-c3", program, ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 1800_000 }); steps.push({ name, ok: true }); }
  catch (error) { steps.push({ name, ok: false, detail: (error.stderr?.toString() || error.message).trim().split("\n").slice(-2).join(" | ") }); }
};
const free = () => { const [, size, , avail] = execFileSync("df", ["-B1", "--output=source,size,used,avail", home]).toString().trim().split("\n")[1].split(/\s+/u); return { sizeBytes: Number(size), freeBytes: Number(avail) }; };
const before = free();

run("guix-gc", "guix", ["gc"]);
run("pnpm-store-prune", "pnpm", ["store", "prune"]);
run("user-journal-vacuum", "journalctl", ["--user", "--vacuum-size=100M"]);
// Codex session files, by age (the Codex runs that wrote them are over).
let codexRemoved = 0;
const cutoff = Date.now() - Number(values["keep-codex-days"]) * 86400000;
const sweep = (dir) => { let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) { const p = join(dir, e.name); if (e.isDirectory()) sweep(p); else if (statSync(p).mtimeMs < cutoff) { rmSync(p, { force: true }); codexRemoved += 1; } } };
sweep(join(home, ".codex", "sessions"));
steps.push({ name: "codex-sessions", ok: true, removed: codexRemoved });

const after = free(), freePercent = Math.round((after.freeBytes / after.sizeBytes) * 1000) / 10, budget = Number(values["min-free-percent"]);
const report = { kind: "machine-disk-budget.v1", freedBytes: after.freeBytes - before.freeBytes, freePercent, minFreePercent: budget, withinBudget: freePercent >= budget, steps };
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.withinBudget) { process.stderr.write(`free space ${freePercent}% is under the ${budget}% budget: an owner's state is accumulating; see offload-host-state and the largest directories under ~/.local\n`); process.exitCode = 1; }
