#!/usr/bin/env node
/**
 * A host's state, kept in the cloud and only its working window kept on the host. The founder, 2026-10-08:
 * "we want full data store in cloud stuff like cloudflare or as a fallback my google drive, keeping only whats
 * necessary on bare cedar fog or cold red gate".
 *
 * For each declared directory, every file is copied to Cloudflare R2 under `<host>/<path from ~>`, and files older
 * than the directory's window are moved there: rclone deletes the local file only after the upload verifies
 * (checksum for single-part uploads, size for multipart). State a node keeps is written once and never rewritten
 * (content-addressed evidence, closed journal days), so the cloud copy is the file.
 *
 *   offload-host-state.mjs --host <name> --env <file with CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN>
 *     --bucket <r2 bucket> --path <dir, ~-relative>=<hours kept locally>[=<glob>] [--path ...] [--dry-run]
 *
 * A glob narrows a directory to the files it matches (rclone filter syntax, relative to the directory), e.g.
 * a journal tree to its write-only packet archives: journals=48=**packets/**
 *
 * R2's S3 credentials derive from the API token (access key = token id, secret = SHA-256 of the token value).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { host: { type: "string" }, env: { type: "string" }, bucket: { type: "string" }, path: { type: "string", multiple: true }, "dry-run": { type: "boolean" } } });
if (!values.host || !values.env || !values.bucket || !values.path?.length) throw new Error("usage: offload-host-state.mjs --host <name> --env <file> --bucket <bucket> --path <dir>=<hours>[=<glob>] [--path ...] [--dry-run]");
const home = homedir(), expand = (p) => (p.startsWith("/") ? p : join(home, p.replace(/^~\/?/u, "")));
const env = Object.fromEntries(readFileSync(expand(values.env), "utf8").split("\n").map((l) => /^([A-Z0-9_]+)=(.*)$/u.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/gu, "")]));
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = env;
if (!account || !token) throw new Error(`${values.env} must set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN`);
const verify = await (await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { authorization: `Bearer ${token}` } })).json();
if (!verify.success || !verify.result?.id) throw new Error(`Cloudflare token unusable: ${JSON.stringify(verify.errors ?? [])}`);

const rcloneEnv = {
  ...process.env,
  RCLONE_CONFIG_R2_TYPE: "s3", RCLONE_CONFIG_R2_PROVIDER: "Cloudflare", RCLONE_CONFIG_R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`,
  RCLONE_CONFIG_R2_ACCESS_KEY_ID: verify.result.id, RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: createHash("sha256").update(token).digest("hex"),
  RCLONE_CONFIG_R2_NO_CHECK_BUCKET: "true",
};
// Files still being written or that only exist for a writer's coordination never leave.
const excludes = ["*.tmp", "*.lock", "*.lease", "*.partial", ".coordination.lease/**"].flatMap((p) => ["--exclude", p]);
const rclone = (args, filter = []) => execFileSync("nice", ["-n", "19", "ionice", "-c3", "rclone", ...args, ...excludes, ...filter, "--transfers", "4", "--stats", "0", ...(values["dry-run"] ? ["--dry-run"] : [])], { env: rcloneEnv, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const bytesUnder = (dir) => { try { return Number(execFileSync("du", ["-sb", dir]).toString().split("\t")[0]); } catch { return 0; } };

const startedAt = Date.now(), report = [];
for (const spec of values.path) {
  const m = /^([^=]+)=(\d+(?:\.\d+)?)(?:=(.+))?$/u.exec(spec);
  if (!m) throw new Error(`--path ${spec}: expected <dir>=<hours>[=<glob>]`);
  const filter = m[3] ? ['--filter', `+ ${m[3]}`, '--filter', '- **'] : [];
  const dir = expand(m[1]), remote = `r2:${values.bucket}/${values.host}/${relative(home, dir)}`;
  const row = { path: relative(home, dir), keepHours: Number(m[2]), ...(m[3] ? { glob: m[3] } : {}), remote, bytesBefore: bytesUnder(dir) };
  try {
    rclone(["copy", dir, remote], filter);
    rclone(["move", dir, remote, "--min-age", `${m[2]}h`], filter);
  } catch (error) { row.error = (error.stderr?.toString() || error.message).trim().split("\n").slice(-3).join(" | "); }
  row.bytesAfter = bytesUnder(dir);
  report.push(row);
}
process.stdout.write(`${JSON.stringify({ kind: "host-state-offload.v1", host: values.host, bucket: values.bucket, dryRun: Boolean(values["dry-run"]), seconds: Math.round((Date.now() - startedAt) / 1000), paths: report })}\n`);
