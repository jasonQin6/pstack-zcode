#!/usr/bin/env node
// Detect drift between this adapter and the pstack install it adapts.
//
// Two things can break the adapter silently:
//   1. pstack bumps version, or moves/renames the files this adapter reads.
//   2. pstack changes the hook, agent, or skill contract the adapter mirrors.
//
// Exit 1 with a report when drift is found, exit 0 when clean. Designed for CI,
// and runnable locally: node scripts/check-upstream.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, ".zcode-plugin/plugin.json");

function gh(args) {
  // This host drops GitHub connections intermittently. Retry, then fail loudly so
  // a network blip never masquerades as adapter drift.
  const attempts = 4;
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    } catch (error) {
      lastError = error;
      const text = `${error.message}${error.stderr ?? ""}`;
      const transient = /connection reset|ECONNRESET|EOF|TLS handshake timeout|502|503/i.test(text);
      if (!transient || i === attempts) break;
      execFileSync("sleep", [String(i * 2)]);
    }
  }
  const text = `${lastError?.message ?? ""}${lastError?.stderr ?? ""}`;
  if (/connection reset|ECONNRESET|EOF|TLS handshake timeout/i.test(text)) {
    const network = new Error("GitHub unreachable after retries; this is a network failure, not adapter drift");
    network.network = true;
    throw network;
  }
  throw lastError;
}

function readUpstreamFile(path) {
  const raw = gh(["api", `repos/michael-denyer/pstack-claude/contents/${path}`, "--jq", ".content"]);
  return Buffer.from(raw.trim(), "base64").toString("utf8");
}

// Files this adapter depends on. A rename or deletion here breaks the adapter.
const DEPENDENCIES = [
  { path: "plugins/pstack/hooks/hooks.json", why: "hook entry shape the adapter mirrors" },
  { path: "plugins/pstack/hooks/session-start-context.md", why: "mandate text the adapter adapts" },
  { path: "plugins/pstack/agents/poteto-agent.md", why: "agent role the native copy mirrors" },
  { path: "plugins/pstack/skills/poteto-mode/SKILL.md", why: "skill the delegate is told to read" },
  { path: "plugins/pstack/models.json", why: "role tiers the mapping translates" },
  { path: "plugins/pstack/skills/setup-pstack/scripts/read-sheet.sh", why: "sheet format the hook mirrors" },
];

const failures = [];
const networkErrors = [];

function check(label, fn) {
  try {
    return fn();
  } catch (error) {
    if (error.network) {
      networkErrors.push(`${label}: ${error.message}`);
    } else {
      failures.push(`${label}: ${error.message.split("\n")[0]}`);
    }
    return null;
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const upstreamVersion = check("read VERSION", () => readUpstreamFile("VERSION").trim());
const upstreamSha = check("read HEAD sha", () =>
  gh(["api", "repos/michael-denyer/pstack-claude/commits/main", "--jq", ".sha"]).trim(),
);

console.log(`adapter version:  ${manifest.version}`);
console.log(`upstream version: ${upstreamVersion ?? "unavailable"}`);
console.log(`upstream head:    ${upstreamSha?.slice(0, 12) ?? "unavailable"}`);

// 1. Dependency existence.
for (const dep of DEPENDENCIES) {
  const ok = check(`dependency ${dep.path}`, () => {
    gh(["api", `repos/michael-denyer/pstack-claude/contents/${dep.path}`, "--jq", ".sha"]);
    return true;
  });
  if (ok === null) failures.push(`MISSING ${dep.path} (${dep.why})`);
}

// 2. Hook contract: upstream must still ship a prompt-only claude branch, which is
//    the exact reason this adapter exists. If that changes, the adapter may be obsolete.
const upstreamHooks = check("read hooks.json", () => readUpstreamFile("plugins/pstack/hooks/hooks.json"));
if (upstreamHooks) {
  const parsed = JSON.parse(upstreamHooks);
  const cmd = parsed?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? "";
  if (!cmd.includes("session-start.sh")) {
    failures.push(
      `hooks.json no longer runs session-start.sh (found: ${JSON.stringify(cmd)}). ` +
        "Re-check whether pstack now emits JSON itself, which would retire this adapter's hook.",
    );
  }
}

// 3. Model tiers: the mapping hard-codes substitutes for these role names.
const models = check("read models.json", () => JSON.parse(readUpstreamFile("plugins/pstack/models.json")));
if (models) {
  const expected = ["default", "strongest", "worker", "panel"];
  for (const tier of expected) {
    if (!(tier in (models.tiers ?? {}))) {
      failures.push(`models.json lost tier "${tier}", which the model mapping assumes`);
    }
  }
  const effortLevels = models.efforts ?? [];
  if (!effortLevels.includes("high")) {
    failures.push(`models.json efforts no longer include "high" (now: ${effortLevels.join(", ")})`);
  }
}

// 4. The native agent's path resolution assumes this cache layout.
const installLayout = "~/.zcode/cli/plugins/cache/pstack-claude/pstack/<version>/skills/poteto-mode/SKILL.md";
if (!existsSync(join(ROOT, "agents/poteto-agent.md"))) {
  failures.push(`agents/poteto-agent.md is missing, but the hook and plugin.json declare it`);
}

// 5. A version bump alone is not a failure, but it is worth surfacing.
const stampPath = join(ROOT, "upstream-stamp.json");
let stamp = null;
if (existsSync(stampPath)) stamp = JSON.parse(readFileSync(stampPath, "utf8"));

const versionChanged = stamp && stamp.upstreamVersion !== upstreamVersion;
const shaChanged = stamp && stamp.upstreamSha !== upstreamSha;

// A network failure is retried and reported distinctly: it must never read as drift.
if (networkErrors.length > 0) {
  console.error("\nNETWORK");
  for (const e of networkErrors) console.error(`  - ${e}`);
  process.exit(3);
}

if (failures.length > 0) {
  console.error("\nADAPTER DRIFT");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\nInstall layout still assumed: ${installLayout}`);
  process.exit(1);
}

if (versionChanged || shaChanged) {
  console.log(`\nUpstream moved: ${stamp.upstreamVersion} -> ${upstreamVersion} (${stamp.upstreamSha?.slice(0, 12)} -> ${upstreamSha?.slice(0, 12)})`);
  console.log("No structural break found. Review the upstream diff, then update upstream-stamp.json.");
  // Signal to CI that a PR is warranted, without failing the build.
  process.exit(2);
}

console.log("\nNo drift.");
process.exit(0);
