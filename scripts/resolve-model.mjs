#!/usr/bin/env node
// Resolve a pstack model alias to a ZCode model ID.
//
// The sheet at ~/.zcode/pstack-models.md holds aliases such as `glm-5.4`, because
// pstack's own parser accepts only [a-z0-9][a-z0-9.-]* while a ZCode ID holds a
// colon and a slash. This script is the other half of that translation.
//
// Usage:
//   node scripts/resolve-model.mjs glm-5.4      -> account:.../GLM-5.4
//   node scripts/resolve-model.mjs --role hillclimb
//   node scripts/resolve-model.mjs --list
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(join(ROOT, "skills/pstack-zcode/references/model-map.json"), "utf8"));

const args = process.argv.slice(2);

function die(message) {
  console.error(message);
  process.exit(1);
}

if (args.length === 0 || args.includes("--help")) {
  console.error("usage: resolve-model.mjs <alias> | --role <role> | --list");
  process.exit(1);
}

if (args.includes("--list")) {
  for (const [alias, spec] of Object.entries(map.aliases)) {
    const levels = spec.reasoning ? (spec.levels ?? []).join("|") || "unknown" : "none";
    console.log(`${alias}\t${spec.id}\tlevels=${levels}`);
  }
  process.exit(0);
}

// pstack's ladder, weakest to strongest. Mirrors render-sheet.mjs so the sheet
// and this resolver never disagree about which level a seat ends up at.
const LADDER = map.effort.pstackLevels;

function snap(level, accepted) {
  if (accepted.includes(level)) return level;
  const want = LADDER.indexOf(level);
  if (want < 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of accepted) {
    const at = LADDER.indexOf(candidate);
    if (at < 0) continue;
    const distance = Math.abs(at - want);
    if (distance < bestDistance || (distance === bestDistance && at > (LADDER.indexOf(best) ?? -1))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

if (args[0] === "--role") {
  const role = args[1];
  if (!role) die("--role needs a role name");
  const tierName = map.roles[role];
  if (!tierName) die(`unknown role: ${role}\nknown roles:\n  ${Object.keys(map.roles).join("\n  ")}`);
  const tier = map.tiers[tierName];
  for (const alias of tier.models ?? [tier.model]) {
    const spec = map.aliases[alias];
    if (!spec) die(`alias "${alias}" missing from aliases`);
    // A model without reasoning levels is dispatched with no level at all.
    let note = "";
    if (spec.reasoning && tier.thoughtLevel) {
      const level = snap(tier.thoughtLevel, spec.levels ?? []);
      if (level) note = ` @${level}`;
    }
    console.log(`${alias}\t${spec.id}${note}`);
  }
  process.exit(0);
}

const alias = args[0];
const spec = map.aliases[alias];
if (!spec) die(`unknown alias: ${alias}\nknown aliases:\n  ${Object.keys(map.aliases).join("\n  ")}`);
console.log(spec.id);
