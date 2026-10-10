// Optional private input of the existing primary-health pulse. Nothing here
// selects a runner directory, changes permissions, or installs another watcher.
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const RELEASE_OUTCOME_CATEGORY = "retained-machine-release-outcome";
export const RELEASE_OUTCOME_OBJECT_KIND = "561-group.primary-system-release-observation";
// The selected journal's 256 KiB string bound must hold after base64 expansion.
// Keep room for its actual semantic/witness representation as well.
export const MAX_RETAINED_OUTCOME_BYTES = 128 * 1024;
const ATTEMPT = /^([1-9][0-9]*)-([1-9][0-9]*)$/u;
const HELD = Object.freeze({ for: true, against: false });
const UNKNOWN = Object.freeze({ for: false, against: false });
const CONTESTED = Object.freeze({ for: true, against: true });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Explicit custody, supplied by the caller only after its own authorization.
 * There is deliberately no inferred home directory, machine, or repository. */
export function releaseOutcomeBinding(value) {
  if (!object(value) || typeof value.machine !== "string" || value.machine.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.machine)
    || typeof value.repository !== "string" || value.repository.length > 255 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository)
    || typeof value.root !== "string" || value.root.length > 4096 || !value.root.isWellFormed() || value.root.includes("\0") || !isAbsolute(value.root) || resolve(value.root) !== value.root
    || value.root === parse(value.root).root) throw new TypeError("retained outcomes need an explicit machine, repository, and absolute custody root");
  return Object.freeze({ machine: value.machine, repository: value.repository, root: value.root });
}

/** Refuse explicit destination overlap. This lexical check does not grant or
 * verify filesystem permissions; the runtime binder must establish private
 * custody and reject aliases before enabling the optional input. */
export function separateReleaseOutcomeCustody({ statusDirectory, journal, binding: input } = {}) {
  const binding = releaseOutcomeBinding(input);
  if (typeof journal?.root !== "string" || !isAbsolute(journal.root)) throw new TypeError("retained outcomes need an existing private journal root");
  const publicRoot = resolve(statusDirectory);
  for (const path of [binding.root, resolve(journal.root)]) {
    for (const below of [relative(publicRoot, path), relative(path, publicRoot)]) {
      if (below === "" || (!below.startsWith(`..${sep}`) && below !== ".." && !isAbsolute(below))) throw new TypeError("retained outcome custody must be outside public status");
    }
  }
}

const unknown = (reason) => Object.freeze({ state: "unknown", reason });
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

async function checkedDirectory(path) {
  // Reject known symlink ancestors as well as a symlink root or attempt folder.
  const chain = [];
  for (let at = path;; at = dirname(at)) { chain.push(at); if (at === dirname(at)) break; }
  for (const at of chain.reverse()) {
    const stat = await lstat(at);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("invalid-directory");
  }
  return lstat(path);
}

async function retainedFile(root, directory, maxBytes) {
  let file;
  try {
    const parent = await checkedDirectory(join(root, directory));
    const path = join(root, directory, "release-outcome.json");
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) return unknown("nonregular-outcome");
    if (before.size > maxBytes) return unknown("oversize-outcome");
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await file.stat();
    if (!opened.isFile() || !sameFile(before, opened)) return unknown("changed-outcome");
    const bytes = Buffer.alloc(Math.min(opened.size + 1, maxBytes + 1));
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await file.stat();
    const located = await lstat(path);
    const parentAfter = await checkedDirectory(join(root, directory));
    if (!sameFile(parent, parentAfter) || !sameFile(opened, located) || !located.isFile()
      || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs
      || length !== opened.size) return unknown("changed-outcome");
    if (length > maxBytes) return unknown("oversize-outcome");
    return { state: "read", bytes: bytes.subarray(0, length) };
  } catch (error) {
    return unknown(error.code === "ENOENT" ? "absent-outcome" : "unreadable-outcome");
  } finally { await file?.close(); }
}

/** One bounded, read-only enumeration of the existing immediate run-attempt
 * directories. No latest pointer and no acknowledgement/deletion in this root.
 * Partial/empty observations never claim there were no release attempts.
 * This is a cooperative custody reader, not a hostile-filesystem sandbox. */
export async function readRetainedReleaseOutcomes({ binding: input, maxEntries = 4096, maxBytes = MAX_RETAINED_OUTCOME_BYTES, maxTotalBytes = 32 * 1024 * 1024 } = {}) {
  const binding = releaseOutcomeBinding(input);
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 65536
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RETAINED_OUTCOME_BYTES
    || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxBytes || maxTotalBytes > 64 * 1024 * 1024) throw new TypeError("invalid retained-outcome read limits");
  const entries = [];
  let examined = 0, totalBytes = 0, directory, root;
  try {
    root = await checkedDirectory(binding.root);
    directory = await opendir(binding.root);
    for await (const entry of directory) {
      if (++examined > maxEntries) return { state: "unknown", reason: "entry-limit", entries };
      if (!ATTEMPT.test(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        entries.push({ directory: entry.name, ...unknown("nonregular-attempt") });
        continue;
      }
      const retained = await retainedFile(binding.root, entry.name, Math.min(maxBytes, maxTotalBytes - totalBytes));
      entries.push({ directory: entry.name, ...retained });
      totalBytes += retained.bytes?.length ?? 0;
      if (totalBytes >= maxTotalBytes) return { state: "unknown", reason: "byte-limit", entries };
    }
    if (!sameFile(root, await checkedDirectory(binding.root))) return { state: "unknown", reason: "changed-root", entries: [] };
    entries.sort((a, b) => a.directory.localeCompare(b.directory, "en"));
    return { state: entries.length === 0 ? "unknown" : "read", ...(entries.length === 0 ? { reason: "no-retained-outcomes" } : {}), entries };
  } catch (error) {
    return { state: "unknown", reason: error.code === "ENOENT" ? "absent-root" : "unreadable-root", entries };
  }
}

function observedBytes(bytes) {
  const evidence = { bytesBase64: bytes.toString("base64"), sha256: sha256(bytes) };
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return { ...evidence, state: "invalid" };
  try {
    const value = JSON.parse(text);
    return { ...evidence, state: object(value) ? "read" : "invalid", ...(object(value) ? { value } : {}) };
  } catch { return { ...evidence, state: "invalid" }; }
}

function sourceObservationHolds(value) {
  if (!object(value)) return false;
  if (value.state === "unavailable") return !["bytesBase64", "sha256", "value"].some((key) => Object.hasOwn(value, key));
  if (typeof value.bytesBase64 !== "string") return false;
  const bytes = Buffer.from(value.bytesBase64, "base64");
  if (bytes.toString("base64") !== value.bytesBase64) return false;
  const observed = observedBytes(bytes);
  return observed.sha256 === value.sha256 && observed.state === value.state && isDeepStrictEqual(observed.value, value.value);
}

/** Preserve the producer envelope, including its claims, without promoting a
 * writer observation into a receipt signature or a statement of current health. */
export function retainedReleaseObservation(input, entry) {
  const binding = releaseOutcomeBinding(input);
  const matched = typeof entry?.directory === "string" && entry.directory.length <= 255 && ATTEMPT.exec(entry.directory);
  if (!matched) throw new TypeError("retained outcome has no bounded run-attempt locator");
  const locator = { run: matched[1], attempt: matched[2], file: `${entry.directory}/release-outcome.json` };
  if (entry.state !== "read" || !Buffer.isBuffer(entry.bytes) || entry.bytes.length > MAX_RETAINED_OUTCOME_BYTES) {
    const reasons = ["nonregular-attempt", "nonregular-outcome", "oversize-outcome", "changed-outcome", "absent-outcome", "unreadable-outcome"];
    return { binding, locator, reading: "unknown", reason: entry.bytes?.length > MAX_RETAINED_OUTCOME_BYTES ? "oversize-outcome"
      : reasons.includes(entry.reason) ? entry.reason : "unavailable-outcome" };
  }
  const observed = observedBytes(entry.bytes);
  const { value, ...evidence } = observed;
  let reason = "invalid-outcome";
  try { if (evidence.state === "read") {
    if (value.kind !== "guix-machine-release-outcome" || value.version !== 1) reason = "unrecognized-outcome";
    else if (!object(value.run) || value.machine !== binding.machine || value.run.repository !== binding.repository
      || value.run.id !== locator.run || value.run.attempt !== locator.attempt) reason = "outcome-binding-mismatch";
    else if (!["invocation", "candidate", "receipt", "assemblyBreak"].every((key) => sourceObservationHolds(value[key]))) reason = "inconsistent-source-evidence";
    else reason = null;
  } } catch { reason = "inconsistent-source-evidence"; }
  // Preserve exact JSON bytes, not an unbounded/noncanonical JSON.parse value.
  // This keeps arbitrary parsed numbers/strings and structural depth outside
  // the genuine journal's parsed-value bridge and artifact resource limits.
  // A receiver can recover the original envelope from private base64 bytes.
  return { binding, locator, reading: reason === null ? "bound-envelope" : "unknown", reason, evidence };
}

const sameAttempt = (left, right) => object(left) && object(right) && isDeepStrictEqual(left.binding, right.binding) && isDeepStrictEqual(left.locator, right.locator);
const query = { objectKind: RELEASE_OUTCOME_OBJECT_KIND, category: RELEASE_OUTCOME_CATEGORY };

/** Receive through the already-existing private semantic journal. The journal
 * is the replay authority; the public status files are never a receipt cursor.
 * Requires the existing single pulse writer. Query must return complete verified
 * witness lines, including a line written before its admission index caught up. */
export async function receiveRetainedReleaseOutcomes({ binding: input, read, journal, at } = {}) {
  const binding = releaseOutcomeBinding(input);
  if (typeof read !== "function" || typeof journal?.record !== "function" || typeof journal?.query !== "function") throw new TypeError("retained outcomes need an injected reader and private semantic journal");
  const previous = await journal.query(query);
  if (!Array.isArray(previous)) throw new TypeError("semantic journal returned no record list");
  const received = [...previous];
  let snapshot;
  try { snapshot = await read({ binding }); }
  catch { snapshot = { state: "unknown", reason: "reader-unavailable", entries: [] }; }
  if (!object(snapshot) || !Array.isArray(snapshot.entries) || !["read", "unknown"].includes(snapshot.state)) throw new TypeError("invalid retained-outcome reader response");
  const reasons = ["absent-root", "unreadable-root", "changed-root", "no-retained-outcomes", "entry-limit", "byte-limit", "reader-unavailable"];
  const reason = snapshot.reason === undefined ? undefined : reasons.includes(snapshot.reason) ? snapshot.reason : "reader-unavailable";
  const result = { state: snapshot.state, ...(reason === undefined ? {} : { reason }), observed: 0, recorded: 0, replayed: 0, unknown: 0, conflicts: 0 };
  for (const entry of snapshot.entries) {
    const record = retainedReleaseObservation(binding, entry);
    const exact = received.find((row) => isDeepStrictEqual(row.record, record));
    const otherBytes = received.filter((row) => sameAttempt(row.record, record) && row.record.evidence !== undefined
      && record.evidence !== undefined && row.record.evidence.bytesBase64 !== record.evidence.bytesBase64);
    result.observed += 1;
    if (record.reading === "unknown") result.unknown += 1;
    if (otherBytes.length > 0) result.conflicts += 1;
    // Reuse the original timestamp, charge and content if an earlier call wrote
    // a complete witness and stopped before status publication or acknowledgement.
    // Never reinterpret or rewrite the earlier observation after a conflict.
    if (exact !== undefined && (typeof exact.event !== "string" || !object(exact.told)
      || typeof exact.origin !== "string" || !Array.isArray(exact.causes))) throw new Error("retained outcome has no replayable witness provenance");
    const request = exact === undefined
      ? { ...query, record, recordedAt: at, told: otherBytes.length > 0 ? CONTESTED : record.reading === "bound-envelope" ? HELD : UNKNOWN }
      : { ...query, record: exact.record, recordedAt: exact.recordedAt, told: exact.told, origin: exact.origin, causes: exact.causes };
    const receipt = await journal.record(request);
    const readback = await journal.query(query);
    const admitted = readback.find((row) => row.id === receipt?.id && receipt.events?.includes(row.event)
      && (exact === undefined || row.event === exact.event)
      && isDeepStrictEqual(row.record, request.record) && row.recordedAt === request.recordedAt && isDeepStrictEqual(row.told, request.told));
    if (admitted === undefined) throw new Error("retained outcome journal admission was not read back");
    if (exact === undefined) { received.push(admitted); result.recorded += 1; }
    else result.replayed += 1;
  }
  if (result.unknown > 0 || result.conflicts > 0) result.state = "unknown";
  return Object.freeze(result);
}
