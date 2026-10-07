#!/usr/bin/env node
/**
 * The node's token-usage admission: FeltOS's `agent-session-token-usage-admit` operation run over
 * this host's Claude Code and Codex session transcripts, for both providers, bounded as the operation
 * is (its default `limit`, the most recent transcripts of each provider). The node's job runs it with
 * the node's env file, so METROPLAT_DATA_ROOT names the journal it admits into:
 *
 *   node --env-file=<node env> --import <house resolver> scripts/admit-token-usage.mjs [--limit N] [--provider all|claude|codex]
 *
 * Claude Code keeps a project's transcripts under the slug of the directory its sessions ran in,
 * which is the workspace (METROPLAT_CODEX_WORKSPACE), not the data root inside it; so the Claude
 * root is that slug unless METROPLAT_CLAUDE_SESSION_ROOT names another. It parses nothing itself:
 * the operation's service reads the transcripts and appends the rows, once each. It lives with the
 * deployment, not in FeltOS, because building the node's filesystem binding is the node's to do.
 * @module
 */
import { homedir } from "node:os";
import path from "node:path";
import { defaultFilesystemBinding } from "@red-cup-engineering/computer-system-engine/rpc/binding";
import { agentTokenUsageOperations } from "@red-cup-engineering/feltos/agents/sessions/token-usage/service";

const argument = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const dataRoot = process.env.METROPLAT_DATA_ROOT;
if (dataRoot === undefined || dataRoot.length === 0) throw new Error("admit-token-usage: METROPLAT_DATA_ROOT names the journal to admit into");
const workspace = process.env.METROPLAT_CODEX_WORKSPACE;
const claudeSessionRoot = process.env.METROPLAT_CLAUDE_SESSION_ROOT
  ?? (workspace === undefined || workspace.length === 0 ? undefined : path.join(homedir(), ".claude", "projects", path.resolve(workspace).split(path.sep).join("-")));

const binding = defaultFilesystemBinding(dataRoot, claudeSessionRoot === undefined ? {} : { claudeSessionRoot });
const admit = agentTokenUsageOperations(binding).find((entry) => entry.verb === "agent-session-token-usage-admit");
const limit = argument("limit") === undefined ? undefined : Number(argument("limit"));
const admitted = await admit.execute({ provider: argument("provider") ?? "all", ...(limit === undefined ? {} : { limit }) }, {});
const { results: _results, ...summary } = admitted;
process.stdout.write(`${JSON.stringify({ at: binding.now(), claudeSessionRoot, ...summary })}\n`);
