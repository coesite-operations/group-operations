#!/usr/bin/env node
// The weekly acceptance readout, as a node job: from the outcome journal and the Group's records
// alone (the released agency's territories, the key-management wallet registry), write the week's
// readout and the Group's derived book into node state.
//
//   produce-acceptance-readout [--period previous|current|both]   (both by default)
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agencyAt, agencyRootOf } from "@red-cup-engineering/metroplat/offices";
import { produceAcceptanceReadout } from "../src/acceptance.mjs";

function repositoryRoot(from) {
  for (let directory = from; directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
  }
  throw new Error("produce-acceptance-readout: repository root not found");
}

const root = repositoryRoot(dirname(fileURLToPath(import.meta.url)));
const WALLET_REGISTRY = join(root, "lib", "emsenn", "services", "561-group", "services", "engineering-services-section", "services", "computer-engineering-services-section", "services", "computer-systems-engineering-services-section", "services", "computer-blockchain-system-services-section", "services", "key-management-services-section", "data", "records", "2026-09-05-wallet-registry.json");

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { period: { type: "string", default: "both" } } });
    if (!["previous", "current", "both"].includes(values.period)) throw new TypeError("--period is previous, current or both");
    const walletRegistry = JSON.parse(await readFile(process.env.GROUP_WALLET_REGISTRY ?? WALLET_REGISTRY, "utf8"));
    // A release is no repository: the agency is the one this script was released with.
    const enterprises = [...agencyAt(agencyRootOf({ agencyRoot: process.env.METROPLAT_AGENCY_ROOT ?? join(root, "lib") })).enterprises.values()];
    for (const period of values.period === "both" ? ["previous", "current"] : [values.period]) {
      const { path, readout } = await produceAcceptanceReadout({ period, enterprises, walletRegistry });
      process.stdout.write(`${JSON.stringify({ path, week: readout.week, complete: readout.complete, judged: readout.judged, border: readout.border, journal: readout.journal, told: readout.told, reach: readout.reach.faces, book: readout.book })}\n`);
    }
  } catch (error) {
    process.stderr.write(`produce-acceptance-readout: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
