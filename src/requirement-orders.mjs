/**
 * Rendanheyi (人单合一) in practice: every unit of work names the 单 it serves — the order of an
 * identified user, here a signed requirement (or ruling) its raiser holds the claim on. A pull
 * request says so in a line of its own:
 *
 *   Serves: requirement:<id>      (one or more; ruling:<id> for work a ruling orders)
 *
 * The check refuses a pull request that names none, or names one no signed record holds. The same
 * line, carried into the merge commit, ties each requirement's work to the worker who did it, and
 * the maintenance loop reads it back so a requirement's readings show who moved its charge.
 */
import { execFileSync } from "node:child_process";

const SERVES = /^\s*(?:[-*]\s*)?(?:\*\*)?Serves(?:\*\*)?\s*:\s*(.+)$/gimu;
const ORDER = /\b(requirement|ruling):([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu;

/** The orders a text names on its Serves lines. */
export function ordersNamed(text) {
  const orders = [];
  for (const line of String(text ?? "").matchAll(SERVES)) for (const [, kind, id] of line[1].matchAll(ORDER)) orders.push(`${kind}:${id}`);
  return [...new Set(orders)];
}

/** Whether a pull request's body names the signed orders it serves. */
export function pullRequestOrder({ body, requirements = [], rulings = [] }) {
  const named = ordersNamed(body);
  const held = new Set([...requirements.map((record) => `requirement:${record.body.id}`), ...rulings.map((record) => `ruling:${record.body.id}`)]);
  // A ruling is read by the maintenance loop; the check accepts any well-formed ruling order, and a
  // requirement must be one a signed record holds.
  const unknown = named.filter((order) => order.startsWith("requirement:") && !held.has(order));
  const ok = named.length > 0 && unknown.length === 0;
  return Object.freeze({
    ok, serves: named, unknown,
    reason: named.length === 0
      ? "The pull request names no order it serves. Add a line `Serves: requirement:<id>` naming the signed requirement (the user's order) this work is for; record the requirement first with `group-requirements record-requirement` if it is not yet recorded."
      : unknown.length > 0 ? `No signed requirement holds ${unknown.join(", ")}: record it with \`group-requirements record-requirement\` in the section that owns it, or name the one this work serves.` : "named",
  });
}

/** The merged work that names `requirement:<id>`: each commit, its worker, and when. */
export function contributionsOf(repositoryRoot, id, { since } = {}) {
  let log;
  try {
    log = execFileSync("git", ["-C", repositoryRoot, "log", "--format=%H%x1f%an%x1f%ae%x1f%cI%x1f%B%x1e", "-E", `--grep=Serves:.*requirement:${id}\\b`,
      ...(since ? [`--since=${since}`] : []), "-n", "200"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch { return []; }
  return log.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [commit, author, email, at, message] = entry.split("\x1f");
    return Object.freeze({ commit, worker: author, email, at, serves: ordersNamed(message) });
  }).filter((contribution) => contribution.serves.includes(`requirement:${id}`));
}
