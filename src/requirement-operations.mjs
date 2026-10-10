/**
 * The requirement maintenance team's operations on a node. The team's enterprise derives
 * `requirement-maintenance-findings` on its loop (every 120 s on the host's clock), so each turn
 * reads every signed requirement and ruling in the node's repository, records the readings, and the
 * board holds a request for every requirement not held and a report for every broken ruling.
 */
import { join } from "node:path";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { repositoryRootOf } from "@red-cup-engineering/metroplat/offices";
import { REQUIREMENT, RULING, readGoverning } from "./requirement-cells.mjs";
import { maintainRequirements, readingsOf } from "./requirement-maintenance.mjs";

/** How often the node measures again: the enterprise loop derives every turn, the checks run at most this often. */
export const MEASURE_EVERY_SECONDS = 900;

/** The office whose seat attests the team's readings: the July requirements management team. */
export const MAINTAINING_OFFICE = "emsenn/services/561-group/services/operations-services-section/services/requirement-management-operation-services-section#requirements-management-team";

export function requirementOperations(binding = {}) {
  const now = () => (binding?.now === undefined ? new Date().toISOString() : binding.now());
  const repositoryRoot = (input) => input?.repositoryRoot ?? repositoryRootOf(binding);
  const journalRoot = () => join(binding.dataRoot, "requirement-maintenance");
  const keyDirectory = () => process.env.GROUP_SEAT_KEY_DIR ?? join(binding.stateDir ?? binding.dataRoot, "seat-keys");
  let last;
  const effects = { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" };
  return Object.freeze([
    operation({
      verb: "requirement-maintenance-findings", inputFormat: "json", outputFormat: "json",
      summary: "Run every signed requirement's met-when checks and every ruling's checks; record each reading as a signed cell; derive a request for each requirement not held and a report for each broken ruling.",
      description: "Domain: { poster, only?: [requirement id] }. A derivation by poster: requests tagged requirement-maintenance, requirement-<id> and charge-<held|denied|contested|unknown>, carrying the raiser as user; reports tagged ruling-violation. Readings are attested by the requirements-management-team seat into the node's requirement-maintenance journal.",
      reads: ["repository", "requirement", "ruling"],
      writes: ["requirement-reading"],
      effects: { ...effects, class: "external", replay: "coordinated" },
      run: (input) => {
        if (typeof input?.poster !== "string" || input.poster === "") throw new TypeError("requirement-maintenance-findings: poster names the enterprise its findings are by");
        const at = now();
        const key = JSON.stringify([input.poster, repositoryRoot(input), input.only ?? null]);
        // Between measurements the last reading's openings stand: the board keeps them, nothing is re-run.
        if (last?.key === key && Date.parse(at) - Date.parse(last.at) < MEASURE_EVERY_SECONDS * 1000) return last.result;
        const result = maintainRequirements({ repositoryRoot: repositoryRoot(input), journalRoot: journalRoot(), seat: `${MAINTAINING_OFFICE}@${input.poster}`,
          poster: input.poster, at, keyDirectory: keyDirectory(), only: input.only });
        last = { key, at, result };
        return result;
      },
    }),
    operation({
      verb: "requirements", inputFormat: "json", outputFormat: "json",
      summary: "The signed requirements and rulings recorded in the node's repository, each with its charge and its signature's standing.",
      description: "Domain: { kind?: requirement | ruling }. Returns { records: [{ body, address, charge, signature, recordedAt, source }], refused }.",
      reads: ["repository"], effects,
      run: (input) => readGoverning({ repositoryRoot: repositoryRoot(input), kind: input?.kind === "ruling" ? RULING : REQUIREMENT, scratch: join(binding.dataRoot, "requirement-maintenance", "scratch") }),
    }),
    operation({
      verb: "requirement-readings", inputFormat: "json", outputFormat: "json",
      summary: "The requirement maintenance team's signed readings: when each requirement was read, by which seat, and its charge.",
      description: "Domain: { requirement? }. Returns the readings, latest last.",
      reads: ["requirement-reading"], effects,
      run: (input) => readingsOf({ journalRoot: journalRoot(), requirement: input?.requirement }),
    }),
  ]);
}
