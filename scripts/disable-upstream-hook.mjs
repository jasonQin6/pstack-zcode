#!/usr/bin/env node
// Disable the pstack plugin's own SessionStart hook.
//
// pstack's hook runs `session-start.sh claude`, whose stdout is plain Markdown.
// ZCode parses hook stdout as strict JSON, drops non-JSON, and records
// hook.run.failed on every session start. This plugin replaces that mandate with
// a JSON-emitting hook, so the upstream one is dead weight and a failed run on
// every start.
//
// There is no per-plugin hook enable/disable in the ZCode config, and the plugin
// cache is rewritten by `zcode plugins update`, so the fix has to be reapplied.
// Hook entries do accept "enabled": false, which is what this script sets.
//
// Usage:
//   node scripts/disable-upstream-hook.mjs           apply
//   node scripts/disable-upstream-hook.mjs --check   exit 1 if not applied
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE = join(homedir(), ".zcode/cli/plugins/cache/pstack-claude/pstack");

function hookFiles() {
  if (!existsSync(CACHE)) return [];
  return readdirSync(CACHE)
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .map((v) => join(CACHE, v, "hooks/hooks.json"))
    .filter((p) => existsSync(p));
}

// Only the entries this adapter supersedes: SessionStart commands running pstack's
// own session-start.sh. Anything else the plugin ships stays untouched.
function isSuperseded(entry) {
  return typeof entry?.command === "string" && entry.command.includes("hooks/session-start.sh");
}

const checkOnly = process.argv.includes("--check");
const files = hookFiles();
if (files.length === 0) {
  console.error(`No pstack hooks.json found under ${CACHE}`);
  process.exit(2);
}

let needsWork = 0;
for (const path of files) {
  const original = readFileSync(path, "utf8");
  let doc;
  try {
    doc = JSON.parse(original);
  } catch (error) {
    console.error(`${path}: not valid JSON (${error.message})`);
    process.exit(2);
  }

  let changed = 0;
  for (const groups of Object.values(doc.hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const entry of group?.hooks ?? []) {
        if (!isSuperseded(entry)) continue;
        if (entry.enabled === false) continue;
        entry.enabled = false;
        changed += 1;
      }
    }
  }

  if (changed === 0) {
    console.log(`${path}: already disabled`);
    continue;
  }

  needsWork += 1;
  if (checkOnly) {
    console.error(`${path}: ${changed} upstream hook(s) still enabled`);
    continue;
  }

  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${path}: disabled ${changed} upstream hook(s)`);
}

if (checkOnly && needsWork > 0) {
  console.error("\nThe pstack plugin update rewrote its hooks.json. Re-run:");
  console.error("  node scripts/disable-upstream-hook.mjs");
  process.exit(1);
}
process.exit(0);
