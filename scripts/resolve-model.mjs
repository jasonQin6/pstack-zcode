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
    console.log(`${alias}\t${spec.id}\treasoning=${spec.reasoning ? "yes" : "no"}`);
  }
  process.exit(0);
}

if (args[0] === "--role") {
  const role = args[1];
  if (!role) die("--role needs a role name");
  const tierName = map.roles[role];
  if (!tierName) die(`unknown role: ${role}\nknown roles:\n  ${Object.keys(map.roles).join("\n  ")}`);
  const tier = map.tiers[tierName];
  const level = tier.thoughtLevel ? ` @${tier.thoughtLevel}` : "";
  for (const alias of tier.models ?? [tier.model]) {
    const spec = map.aliases[alias];
    if (!spec) die(`alias "${alias}" missing from aliases`);
    // A model without reasoning support must be dispatched with no level at all.
    const note = spec.reasoning ? level : "";
    console.log(`${alias}\t${spec.id}${note}`);
  }
  process.exit(0);
}

const alias = args[0];
const spec = map.aliases[alias];
if (!spec) die(`unknown alias: ${alias}\nknown aliases:\n  ${Object.keys(map.aliases).join("\n  ")}`);
console.log(spec.id);
