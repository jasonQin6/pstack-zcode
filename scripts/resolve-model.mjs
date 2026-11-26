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
//        -> alias<TAB>ID @level<TAB>agents to dispatch on, when the map names any
//   node scripts/resolve-model.mjs --list
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap, pluginId, snap, roleAgentSelections, tierSelections } from "./tiers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const map = loadMap(ROOT);

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

const LADDER = map.effort.pstackLevels;

if (args[0] === "--role") {
  const role = args[1];
  if (!role) die("--role needs a role name");
  const tierName = map.roles[role];
  if (!tierName) die(`unknown role: ${role}\nknown roles:\n  ${Object.keys(map.roles).join("\n  ")}`);
  const tier = map.tiers[tierName];

  if (map.roleAgents?.[role]) {
    let named;
    try {
      named = roleAgentSelections(map).filter((entry) => entry.role === role);
    } catch (error) {
      die(error.message);
    }
    if (named.length > 0) {
      const first = named[0];
      const note = first.level === null ? "" : ` @${first.level}`;
      console.log(`${first.alias}\t${first.id}${note}\t${named.map((entry) => entry.agentType).join(", ")}`);
      process.exit(0);
    }
  }

  if (tier.models) {
    for (const alias of tier.models) {
      const spec = map.aliases[alias];
      if (!spec) die(`alias "${alias}" missing from aliases`);
      let note = "";
      if (spec.reasoning && tier.thoughtLevel) {
        const level = snap(tier.thoughtLevel, spec.levels ?? [], LADDER);
        if (level) note = ` @${level}`;
      }
      console.log(`${alias}\t${spec.id}${note}`);
    }
    process.exit(0);
  }

  let selection;
  try {
    selection = tierSelections(map, pluginId(ROOT)).find((entry) => entry.tier === tierName);
  } catch (error) {
    die(error.message);
  }
  if (!selection) die(`tier ${tierName} names no model to resolve`);
  const note = selection.level === null ? "" : ` @${selection.level}`;
  // A role whose tier has a delegate names it too, because ZCode takes the model
  // from its agent record and not from the dispatch.
  console.log(`${selection.alias}\t${selection.id}${note}\tpstack-zcode:${selection.agent}`);
  process.exit(0);
}

const alias = args[0];
const spec = map.aliases[alias];
if (!spec) die(`unknown alias: ${alias}\nknown aliases:\n  ${Object.keys(map.aliases).join("\n  ")}`);
console.log(spec.id);