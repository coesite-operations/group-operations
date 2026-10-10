#!/usr/bin/env node
// Read the primary systems from the always-on node, record each change of their health as a told
// semantic record, and rewrite the public status page the node serves as the Group's fallback.
//
//   run-primary-health-pulse.mjs [--status-directory <dir>] [--journal-root <dir>]
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { runPrimaryHealthPulse } from "../src/primary-health.mjs";

const { values } = parseArgs({ options: { "status-directory": { type: "string" }, "journal-root": { type: "string" } } });
const state = join(homedir(), ".local/state/561-group/primary-health");
const statusDirectory = values["status-directory"] ?? process.env.PRIMARY_HEALTH_STATUS_DIR ?? join(state, "public");
const journalRoot = values["journal-root"] ?? process.env.PRIMARY_HEALTH_JOURNAL_ROOT ?? join(state, "knowledge");
mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
const journal = createSemanticRecordJournal({ root: journalRoot, objectKind: "561-group.primary-system-health" });
const { status, changes } = await runPrimaryHealthPulse({ statusDirectory, journal });
const down = status.systems.filter((system) => system.charge !== "held").map((system) => `${system.id}:${system.charge}`);
console.log(JSON.stringify({ at: status.at, systems: status.systems.length, notHeld: down, changes }));
