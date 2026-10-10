/**
 * The July requirement management system's pools as the one place requirements and rulings are
 * read and written: requirements in each owning section's content/requirements, the team's rulings,
 * decision records and quality attestations in the requirement management section's content.
 *
 * A record is read only when its SignCell address holds (its x-provenance["sign-cell"] is the typed
 * mark its content is under its July schema). The seat that recorded it may attest it with an
 * Ed25519 signed content claim over that address (x-provenance.attestation): identity attestation,
 * checked when present, never what makes the record a sign.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { signContentClaim, verifyContentClaim } from "@red-cup-engineering/computer-content-engineering-services-section/signed-content-claim";
import { REQUIREMENT_SECTION, existenceOnly, seatKey } from "./requirement-cells.mjs";
import { JULY_SCHEMA_DIRECTORY, addressHolds, addressed, julyTypes } from "./requirement-july.mjs";

const MEDIA = "text/plain";
const PURPOSE = "561-group.july-record-attestation.v1";
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

/** The July pool files under a repository, by kind. */
export function julyPoolFiles(repositoryRoot) {
  const listed = git(repositoryRoot, "ls-files", "-co", "--exclude-standard", "-z", "--",
    ":(glob)lib/**/content/requirements/*.json",
    `:(glob)${REQUIREMENT_SECTION}/content/rulings/*.json`,
    `:(glob)${REQUIREMENT_SECTION}/content/decision-records/*.json`,
    `:(glob)${REQUIREMENT_SECTION}/content/quality-attestations/*.json`).split("\0").filter(Boolean)
    .filter((path) => !/\/(legacy|_archive|node_modules)\//u.test(path));
  const kind = (path) => path.match(/\/content\/(requirements|rulings|decision-records|quality-attestations)\//u)?.[1];
  return Object.freeze(Object.groupBy(listed, kind));
}

/** Attest a record's address as `seat` (identity attestation). */
export function attest(record, key, at) {
  const mark = record["x-provenance"]["sign-cell"].mark;
  const claim = signContentClaim({ bytes: Buffer.from(mark, "utf8"), mediaType: MEDIA, purpose: PURPOSE, issuer: key.seat, issuedAt: at, privateKey: key.privateKey });
  return { ...record, "x-provenance": { ...record["x-provenance"], attestation: { claim, publicKey: key.publicKey } } };
}

/** Whether a record's attestation holds over its address; undefined when it carries none. */
export function attestationHolds(record) {
  const attestation = record?.["x-provenance"]?.attestation;
  if (attestation === undefined) return undefined;
  const result = verifyContentClaim({ bytes: Buffer.from(record["x-provenance"]["sign-cell"]?.mark ?? "", "utf8"), claim: attestation.claim, publicKey: attestation.publicKey,
    expectedIssuer: attestation.claim?.issuer, expectedPurpose: PURPOSE, expectedMediaType: MEDIA });
  return result.ok ? result.issuer : false;
}

const sectionOf = (path) => dirname(dirname(dirname(path)));
const told = (sources = []) => ({ for: sources.length > 0, against: sources.some((source) => source.relayed) });
const chargeOf = ({ for: forSide, against }) => (forSide && against ? "contested" : forSide ? "held" : against ? "denied" : "unknown");

/** A July requirement read in the shape the maintenance loop measures. */
function requirementOf(path, record) {
  const provenance = record["x-provenance"] ?? {};
  const opening = provenance["board-opening"];
  const sources = provenance.sources ?? [];
  const objections = [provenance["unresolved-authority"], provenance["relayed-not-quoted"], provenance["pending-conditions"]].filter(Boolean);
  const evidence = { for: sources.length > 0 || typeof record.asks === "string", against: objections.length > 0 || told(sources).against };
  return Object.freeze({
    body: Object.freeze({
      id: record.id, name: record.name, section: provenance.section ?? sectionOf(path), raisedBy: record["raised-by"], asks: record.asks,
      class: provenance.class ?? "requirement", authority: provenance.authority ?? `party:${record["raised-by"]}`, sources,
      metWhen: record["met-when"].map((condition) => ({ cell: condition.cell, ...(condition.command ? { command: condition.command } : {}),
        expectedExit: condition["expected-exit"] ?? 0, exercises: condition.command && !existenceOnly(condition.command) ? "behavior" : "existence" })),
      ...(opening ? { opening, ...(opening.after ? { after: opening.after } : {}), ...(opening.serves ? { serves: opening.serves } : {}) } : {}),
      ...(record.tier ? { tier: record.tier } : {}),
    }),
    address: provenance["sign-cell"].mark, cell: { for: [], against: objections }, charge: chargeOf(evidence), source: path, signature: { seat: provenance["recorded-by"] },
  });
}

/** A July ruling with the decision it backs, read in the shape the loop checks. */
function rulingOf(path, record, decisions) {
  const decision = decisions.get(record.backs);
  return Object.freeze({
    body: Object.freeze({ id: record.id, name: record.name, section: REQUIREMENT_SECTION, raisedBy: "emsenn", ruling: decision?.decision ?? record.quote,
      quote: record.quote, checks: (decision?.["x-provenance"]?.checks ?? []).map((check) => ({ ...check, expectedExit: check.expectedExit ?? 0 })) }),
    address: record["x-provenance"]["sign-cell"].mark, charge: record["x-provenance"].relayed ? "contested" : "held", source: path,
  });
}

/**
 * Every July requirement, ruling and attestation under a repository whose address holds, and every
 * record refused (no address, an address that does not hold, or an attestation that does not).
 */
export function readPools({ repositoryRoot, schemaDirectory = join(repositoryRoot, JULY_SCHEMA_DIRECTORY) }) {
  const root = resolve(repositoryRoot);
  const types = julyTypes(schemaDirectory);
  const files = julyPoolFiles(root);
  const refused = [];
  const load = (path) => {
    try {
      const record = JSON.parse(readFileSync(join(root, path), "utf8"));
      if (!addressHolds(types, record)) { refused.push({ path, reason: "no SignCell address, or one its content does not hold" }); return undefined; }
      if (attestationHolds(record) === false) { refused.push({ path, reason: "its attestation does not hold over its address" }); return undefined; }
      return record;
    } catch (error) { refused.push({ path, reason: error.message }); return undefined; }
  };
  const loaded = (kind) => (files[kind] ?? []).map((path) => [path, load(path)]).filter(([, record]) => record !== undefined);
  const decisions = new Map(loaded("decision-records").map(([, record]) => [record.id, record]));
  return Object.freeze({
    requirements: Object.freeze(loaded("requirements").map(([path, record]) => requirementOf(path, record)).sort((a, b) => a.body.id.localeCompare(b.body.id))),
    rulings: Object.freeze(loaded("rulings").map(([path, record]) => rulingOf(path, record, decisions))),
    attestations: Object.freeze(loaded("quality-attestations").map(([path, record]) => Object.freeze({ path, record }))),
    refused: Object.freeze(refused),
  });
}

/** Write a July record as an addressed typed mark, attested by `seat`. */
export function writeJuly({ repositoryRoot, schemaDirectory = join(repositoryRoot, JULY_SCHEMA_DIRECTORY), kind, record, path, seat, keyDirectory, at = new Date().toISOString() }) {
  const types = julyTypes(schemaDirectory);
  const key = seatKey(seat, { directory: keyDirectory });
  const withProvenance = { ...record, "x-provenance": { "recorded-by": seat, "recorded-on": at.slice(0, 10), ...(record["x-provenance"] ?? {}) } };
  const signed = attest(addressed(types[kind], withProvenance), key, at);
  const target = join(resolve(repositoryRoot), path);
  if (!target.startsWith(resolve(repositoryRoot))) throw new TypeError("path must lie inside the repository");
  const existed = existsSync(target);
  mkdirSync(dirname(target), { recursive: true });
  // Written whole, so a reader never sees a half record.
  writeFileSync(`${target}.partial`, `${JSON.stringify(signed, null, 2)}\n`);
  renameSync(`${target}.partial`, target);
  return Object.freeze({ path: relative(resolve(repositoryRoot), target), mark: signed["x-provenance"]["sign-cell"].mark, existed });
}
