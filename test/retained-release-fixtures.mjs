// Distinct synthetic retained envelopes; no host or producer effects.
import { createHash } from "node:crypto";
export const observed = (value) => {
  if (value === undefined) return { state: "unavailable" };
  const bytes = Buffer.from(JSON.stringify(value));
  return { state: "read", bytesBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), value };
};
export function envelope({ id = "701", attempt = "2", mode = "build", outcome = "staged", stage = "pre-switch-check", absent = false } = {}) {
  const invocation = { repository: "fixture/machine", revision: "a".repeat(40), run: `https://github.com/fixture/machine/actions/runs/${id}`, runAttempt: attempt, mode };
  const candidate = { ...invocation, storePath: "/gnu/store/private-candidate", root: "/private/runner/gcroot", narSha256: "b".repeat(64) };
  const receipt = { ...invocation, machine: "fixture-machine", storePath: candidate.storePath, outcome, stage, at: "2026-10-10T04:00:00Z" };
  return {
    kind: "guix-machine-release-outcome", version: 1,
    machine: "fixture-machine", run: { repository: "fixture/machine", id, attempt }, jobOutcome: "failure",
    invocation: { ...observed(absent ? undefined : invocation), attributed: !absent },
    candidate: { ...observed(absent ? undefined : candidate), attributed: !absent, reason: absent ? "invocation-unattributed" : null },
    receipt: { ...observed(absent ? undefined : receipt), attributed: !absent, reason: absent ? "invocation-unattributed" : null },
    assemblyBreak: observed({ kind: "561-group.assembly-break", class: "repository-formation-unavailable", privateContext: "private-evidence-sentinel" }),
  };
}
export const bindingAt = (root) => ({ machine: "fixture-machine", repository: "fixture/machine", root });
export const entryOf = (value = envelope()) => ({ directory: `${value.run.id}-${value.run.attempt}`, state: "read", bytes: Buffer.from(JSON.stringify(value, null, 2) + "\n") });
