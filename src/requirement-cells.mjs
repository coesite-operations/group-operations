/**
 * Requirements and rulings as signed, cell-typed data (the founder's standing ruling).
 *
 * "Signed" is SignCell's sense: a record is a semiotic sign, not a cryptographic signature. Each
 * record is a SignCell typed mark (its body, admitted by its kind's data type and addressed by its
 * content) together with a SignCell predication cell that carries its evidence, so its charge is
 * FOUR-valued: a requirement is (party:<raiser>, requires, requirement:<id>), a ruling is
 * (party:<raiser>, rules, ruling:<id>), a requirement reading is (requirement:<id>, met,
 * requirement:<id>). A requirement whose raiser's own sentence is held is told for; one relayed
 * without that sentence is also told against, and reads contested until the raiser corroborates or
 * withdraws it (Huidu Guanli: the grey stays visible instead of being forced to pass or fail).
 * SignChain and SignGraph compose these signs; nothing here restates them.
 *
 * Separately, the recording seat attests the record with an Ed25519 signed content claim over the
 * mark and cell. That is identity attestation (which seat recorded it, and that the bytes are the
 * ones it recorded); it is not what makes the record a signed cell.
 *
 * Records are admitted into a semiotic-eavt witness journal with record-semantic-record, whose told
 * pair is the cell's, one journal root per record so two seats recording at once never append to
 * one file.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cell, address } from "@red-cup-engineering/signcell/cell";
import { admitTypedMark, createTypedMark } from "@red-cup-engineering/signcell/typed-mark";
import { REQUIREMENT_CLASSES, TYPES } from "./requirement-types.mjs";
import { semanticBytes } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { signContentClaim, verifyContentClaim } from "@red-cup-engineering/computer-content-engineering-services-section/signed-content-claim";
import { chargeOfTold, createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

export const REQUIREMENT = "561-group.requirement.v1";
export const RULING = "561-group.ruling.v1";
export const READING = "561-group.requirement-reading.v1";
export const SEAT_KEY = "561-group.seat-key.v1";
export const INTAKE = "561-group.requirement-intake.v1";
export const ASSEMBLY_BREAK = "561-group.assembly-break.v1";
export const BASELINE = "561-group.rule-baseline.v1";
/** The requirement management section: the requirement maintenance team, and the journal it keeps. */
export const REQUIREMENT_SECTION = "lib/emsenn/services/561-group/services/operations-services-section/services/requirement-management-operation-services-section";
/** The one category each kind is kept under: a reader lists a kind by it. */
export const CATEGORY = Object.freeze({ [REQUIREMENT]: "requirements", [RULING]: "rulings", [READING]: "readings", [SEAT_KEY]: "seat-keys", [INTAKE]: "requirement-intakes", [ASSEMBLY_BREAK]: "assembly-breaks", [BASELINE]: "rule-baselines" });
/** Where a kind's records live inside the section that owns them. */
export const POOL = Object.freeze({ [REQUIREMENT]: "requirements", [RULING]: "rulings", [INTAKE]: "requirement-intakes", [ASSEMBLY_BREAK]: "assembly-breaks", [BASELINE]: "rule-baselines" });
const MEDIA = "application/cbor";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

const text = (value, name) => {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
};
const slug = (value, name) => {
  if (typeof value !== "string" || !SLUG.test(value)) throw new TypeError(`${name} must be a lowercase slug`);
  return value;
};
const strings = (value, name) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry === "")) throw new TypeError(`${name} must be a list of names`);
  return [...new Set(value)];
};

/** Where a raiser's words were said: a session or document and when, with the words verbatim. */
function sourcesOf(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("sources: at least one source of the raiser's words is required");
  return value.map((source, index) => {
    if (source === null || typeof source !== "object") throw new TypeError(`sources[${index}] must be an object`);
    const words = text(source.words, `sources[${index}].words`);
    const out = { words };
    for (const key of ["session", "at", "locator", "kind"]) if (source[key] !== undefined) out[key] = text(source[key], `sources[${index}].${key}`);
    if (source.relayed !== undefined) out.relayed = Boolean(source.relayed);
    return out;
  });
}

/**
 * A met-when check: the command that exercises the capability, the exit it must give, and what it
 * exercises. A check that only finds a file is `existence`: it is evidence that something was
 * written, never that the capability works, so a pass is told for AND against (contested).
 */
export const EXERCISES = Object.freeze(["behavior", "existence"]);
const EXISTENCE_ONLY = [
  /^\s*(sh|bash) -c '\s*(! )?ls\b[^|;&]*(>\/dev\/null 2>&1)?'?\s*$/u,
  /^\s*(sh|bash) -c '\s*test -[fdse] [^|;&]*'?\s*$/u,
  /^\s*test -[fdse] \S+\s*$/u,
  /^\s*(sh|bash) -c '\s*(! )?grep (-[a-zA-Z]+ )*("[^"]*"|\S+) [^|;&]*'?\s*$/u,
];
/** Whether a command can only show that a file exists or contains a word. */
export const existenceOnly = (command) => EXISTENCE_ONLY.some((pattern) => pattern.test(command));

function checksOf(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be a list`);
  return value.map((check, index) => {
    const at = `${name}[${index}]`;
    if (check === null || typeof check !== "object") throw new TypeError(`${at} must be an object`);
    const command = text(check.command, `${at}.command`);
    const exercises = check.exercises ?? (existenceOnly(command) ? "existence" : "behavior");
    if (!EXERCISES.includes(exercises)) throw new TypeError(`${at}.exercises must be ${EXERCISES.join(" or ")}`);
    const expectedExit = check["expected-exit"] ?? check.expectedExit ?? 0;
    if (!Number.isInteger(expectedExit)) throw new TypeError(`${at}.expectedExit must be an integer`);
    return { cell: text(check.cell ?? check.id, `${at}.cell`), ...(check.says === undefined ? {} : { says: text(check.says, `${at}.says`) }),
      command, expectedExit, exercises };
  });
}

/** The evidence a record's sources give: each source told for, a relayed one (no raiser sentence located) also told against. */
function sourceEvidence(sources, objections = []) {
  const witness = (source) => `words:${source.session ?? source.locator ?? "unplaced"}@${source.at ?? "undated"}`;
  return {
    // A relayed source is still evidence that something was asked (for), and that the raiser's own
    // sentence was not located (against): it reads contested until the raiser corroborates it.
    for: sources.map(witness),
    against: [...sources.filter((source) => source.relayed).map((source) => `relayed-not-quoted:${witness(source)}`), ...objections],
  };
}

/** A requirement's body: who asked, their own words, where, and the checks that would satisfy them. */
export function requirementOf(input) {
  const sources = sourcesOf(input.sources);
  const body = {
    kind: REQUIREMENT,
    id: slug(input.id, "id"),
    name: text(input.name, "name"),
    section: text(input.section, "section"),
    raisedBy: slug(input.raisedBy, "raisedBy"),
    asks: text(input.asks, "asks"),
    sources,
    metWhen: checksOf(input.metWhen ?? [], "metWhen"),
  };
  // A requirement with no checks cannot fail: refused when a seat records it new, carried (and told
  // against, so it reads contested) when it is converted from a record that already holds it.
  if (body.metWhen.length === 0 && input.allowUnchecked !== true) throw new TypeError("metWhen: a requirement with no checks cannot fail; name at least one check that exercises it");
  for (const key of ["tier", "changes", "carriedFrom", "note"]) if (input[key] !== undefined) body[key] = text(input[key], key);
  for (const key of ["serves", "after", "realizedBy"]) if (input[key] !== undefined) body[key] = strings(input[key], key);
  if (input.opening !== undefined) body.opening = structuredClone(input.opening);
  // The requirements-to-specification class, and the party accountable for it (by default its raiser).
  body.class = input.class ?? "requirement";
  if (!REQUIREMENT_CLASSES.includes(body.class)) throw new TypeError(`class must be one of ${REQUIREMENT_CLASSES.join(", ")}`);
  body.authority = text(input.authority ?? `party:${body.raisedBy}`, "authority");
  if (input.breakClass !== undefined) body.breakClass = slug(input.breakClass, "breakClass");
  const objections = strings(input.objections, "objections");
  const told = sourceEvidence(sources, objections);
  return { body, cell: cell(`party:${body.raisedBy}`, "requires", `requirement:${body.id}`, told) };
}

/** A ruling's body: the founder's (or the Board's) verbatim ruling, its sources, and the checks a machine can run against it. */
export function rulingOf(input) {
  const sources = sourcesOf(input.sources);
  const body = {
    kind: RULING,
    id: slug(input.id, "id"),
    section: text(input.section, "section"),
    raisedBy: slug(input.raisedBy, "raisedBy"),
    ruling: text(input.ruling, "ruling"),
    sources,
    checks: checksOf(input.checks ?? [], "checks"),
  };
  for (const key of ["name", "scope", "supersedes"]) if (input[key] !== undefined) body[key] = text(input[key], key);
  const told = sourceEvidence(sources, strings(input.objections, "objections"));
  return { body, cell: cell(`party:${body.raisedBy}`, "rules", `ruling:${body.id}`, told) };
}

/* ---------------------------------------------------------------- seat keys */

/** Where this host keeps its seats' signing keys (never a repository). */
export const seatKeyDirectory = () => process.env.GROUP_SEAT_KEY_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "561-group", "seats");
const keyFileOf = (directory, seat) => join(directory, `${encodeURIComponent(seat)}.ed25519.pem`);

/** The seat's Ed25519 key, made on first use and kept owner-readable only. */
export function seatKey(seat, { directory = seatKeyDirectory() } = {}) {
  text(seat, "seat");
  const file = keyFileOf(directory, seat);
  let privateKey;
  let made = false;
  if (existsSync(file)) privateKey = createPrivateKey(readFileSync(file, "utf8"));
  else {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    ({ privateKey } = generateKeyPairSync("ed25519"));
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    chmodSync(file, 0o600);
    made = true;
  }
  const publicKey = createPublicKey(privateKey);
  // The key's id is the one a signed claim names (the ni: address of its SPKI).
  const { keyId } = signContentClaim({ bytes: new Uint8Array(0), mediaType: MEDIA, purpose: SEAT_KEY, issuer: seat, issuedAt: "1970-01-01T00:00:00.000Z", privateKey }).signature;
  return Object.freeze({ seat, privateKey, publicKey: publicKey.export({ type: "spki", format: "pem" }), keyId, made });
}

/* ---------------------------------------------------------------- signing and recording */

const signedBytes = (mark, recorded) => semanticBytes({ mark, cell: recorded });

/** The typed mark a body is, under its kind's data type; a body its type refuses is never recorded. */
export function markOf(body) {
  const type = TYPES[body.kind];
  if (type === undefined) throw new TypeError(`${body.kind} has no data type`);
  const made = createTypedMark(type, body);
  if (!made.ok) throw new TypeError(`${body.kind} refused by its type: ${made.refusal.message}`);
  return made.value;
}

/** Sign a body (as its typed mark) and its cell as `seat`: the record a journal admits. */
export function signed({ body, cell: recorded, key, at }) {
  const mark = markOf(body);
  const claim = signContentClaim({ bytes: signedBytes(mark, recorded), mediaType: MEDIA, purpose: body.kind, issuer: key.seat, issuedAt: at, privateKey: key.privateKey });
  return Object.freeze({ mark, cell: recorded, address: address(recorded), claim, publicKey: key.publicKey });
}

/** A record's body: its typed mark's content. */
export const bodyOf = (record) => record.mark.content;

/** Whether a record's signature holds over its body and cell, and whether its key is one a seat registered. */
export function verified(record, { registered = new Set() } = {}) {
  const kind = record.mark?.content?.kind;
  if (TYPES[kind] === undefined) return Object.freeze({ ok: false, reason: "not a typed mark of a requirement management kind" });
  const readmitted = admitTypedMark(TYPES[kind], record.mark);
  if (!readmitted.ok) return Object.freeze({ ok: false, reason: readmitted.refusal.message });
  const result = verifyContentClaim({ bytes: signedBytes(record.mark, record.cell), claim: record.claim, publicKey: record.publicKey,
    expectedIssuer: record.claim?.issuer, expectedPurpose: kind, expectedMediaType: MEDIA });
  if (!result.ok) return Object.freeze({ ok: false, reason: result.reason });
  if (address(record.cell) !== record.address) return Object.freeze({ ok: false, reason: "cell address does not match its triple" });
  return Object.freeze({ ok: true, seat: result.issuer, keyId: result.keyId, trust: registered.has(`${result.issuer}\0${result.keyId}`) ? "registered" : "self-asserted" });
}

const toldOf = (recorded) => ({ for: recorded.for.length > 0, against: recorded.against.length > 0 });

/** Admit one signed record into the journal at `root`, asserted as `seat records <kind>:<id>`. */
export function admitSigned({ root, record, at }) {
  const body = bodyOf(record);
  const kind = body.kind;
  return createSemanticRecordJournal({ root, objectKind: kind }).record({
    category: CATEGORY[kind], record, recordedAt: at, told: toldOf(record.cell), origin: record.claim.issuer,
    relation: { subject: record.claim.issuer, predicate: "records", object: `${kind}:${body.id ?? body.requirement}` },
  });
}

/** Register a seat's public key beside its records, so readers can tell a registered key from a self-asserted one. */
export function registerSeatKey({ root, key, at }) {
  const body = { kind: SEAT_KEY, id: slug(encodeURIComponent(key.seat).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "seat", "seat"), seat: key.seat, keyId: key.keyId, publicKey: key.publicKey };
  const recorded = cell(`seat:${key.seat}`, "holds-key", `key:${key.keyId}`, { for: [`self-signed:${key.keyId}`] });
  const record = signed({ body, cell: recorded, key, at });
  admitSigned({ root, record, at });
  return record;
}

/** The journal root a requirement or ruling is recorded under, in the section that owns it. */
export function recordRootOf({ repositoryRoot, kind, id, within }) {
  const pool = POOL[kind];
  if (pool === undefined) throw new TypeError(`${kind} is not recorded in the requirement journal`);
  // One journal root per record, so seats recording at once never append to one file.
  return join(resolve(repositoryRoot), REQUIREMENT_SECTION, "data", pool, ...(within === undefined ? [] : [slug(within, "within")]), slug(id, "id"));
}

/**
 * Record a requirement or ruling as `seat`: build its cell, sign it, register the seat's key beside
 * it and admit both into the record's own journal. Returns what was recorded and its charge.
 */
export function recordGoverning({ kind, input, repositoryRoot, seat, at = new Date().toISOString(), keyDirectory }) {
  const { body, cell: recorded } = kind === REQUIREMENT ? requirementOf(input) : kind === RULING ? rulingOf(input) : (() => { throw new TypeError(`unknown kind ${kind}`); })();
  const key = seatKey(seat, { directory: keyDirectory });
  const root = recordRootOf({ repositoryRoot, kind, id: body.id });
  registerSeatKey({ root, key, at });
  const record = signed({ body, cell: recorded, key, at });
  const admitted = admitSigned({ root, record, at });
  return Object.freeze({ kind, id: body.id, root, address: record.address, charge: chargeOfTold(toldOf(recorded)), keyId: key.keyId, event: admitted.events[0] });
}

/* ---------------------------------------------------------------- reading back */

/** Every directory under `repositoryRoot` that holds a pool of `kind` (…/data/requirements, …/data/rulings). */
export function poolsUnder(repositoryRoot, kind, { skip = /^(node_modules|\.git|legacy|_archive|triage)$/u } = {}) {
  const pool = POOL[kind];
  const found = [];
  const walk = (directory, depth) => {
    if (depth > 40) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.name === "data" && existsSync(join(path, pool))) found.push(join(path, pool));
      walk(path, depth + 1);
    }
  };
  walk(resolve(repositoryRoot), 0);
  return found.sort();
}

/**
 * Read every record of `kind` under a repository, verified. A released tree may be read-only and a
 * journal writes its index as it reads, so each record root is read from a copy under `scratch`.
 * Returns the latest record per id with its signature's standing, and the records that failed it.
 */
export function readGoverning({ repositoryRoot, kind, scratch }) {
  const records = new Map();
  const refused = [];
  // A record root is a directory holding data/journals; a pool may group roots (assembly breaks by class).
  const rootsUnder = (directory) => readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const path = join(directory, entry.name);
    return existsSync(join(path, "data", "journals")) ? [{ path, name: entry.name }] : rootsUnder(path);
  });
  for (const pool of poolsUnder(repositoryRoot, kind)) {
    for (const entry of rootsUnder(pool)) {
      let root = entry.path;
      if (scratch !== undefined) {
        const copy = join(scratch, createHash("sha256").update(root).digest("hex").slice(0, 24));
        cpSync(join(root, "data", "journals"), join(copy, "data", "journals"), { recursive: true, filter: (source) => !source.includes(`${join("data", "journals", "index")}`) });
        root = copy;
      }
      // A journal whose witnesses do not match their content addresses is refused whole; the rest read on.
      let registered;
      let rows;
      try {
        registered = new Set(createSemanticRecordJournal({ root, objectKind: SEAT_KEY }).query({ category: CATEGORY[SEAT_KEY] })
          .filter(({ record }) => verified(record).ok).map(({ record }) => `${bodyOf(record).seat}\0${bodyOf(record).keyId}`));
        rows = createSemanticRecordJournal({ root, objectKind: kind }).query({ category: CATEGORY[kind] });
      } catch (error) {
        refused.push(Object.freeze({ body: { id: entry.name }, source: entry.path, signature: Object.freeze({ ok: false, reason: error.message }) }));
        continue;
      }
      for (const row of rows) {
        const standing = verified(row.record, { registered });
        const read = Object.freeze({ ...row.record, body: row.record.mark?.content ?? {}, recordedAt: row.recordedAt, charge: chargeOfTold(row.told), signature: standing, source: entry.path });
        if (!standing.ok) { refused.push(read); continue; }
        records.set(read.body.id, read);
      }
    }
  }
  return Object.freeze({ records: Object.freeze([...records.values()].sort((a, b) => a.body.id.localeCompare(b.body.id))), refused: Object.freeze(refused) });
}
