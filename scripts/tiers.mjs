#!/usr/bin/env node
// There is no CLI: this is a module.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAP = "skills/pstack-zcode/references/model-map.json";

export function loadMap(root) {
  return JSON.parse(readFileSync(join(root, MAP), "utf8"));
}

/** `<plugin name>@<marketplace name>`, the plugin id ZCode builds an agent key from. */
export function pluginId(root) {
  const plugin = JSON.parse(readFileSync(join(root, ".zcode-plugin/plugin.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(root, "marketplace.json"), "utf8"));
  if (!plugin.name || !marketplace.name) {
    throw new Error("a plugin id needs a name in both .zcode-plugin/plugin.json and marketplace.json");
  }
  return `${plugin.name}@${marketplace.name}`;
}

/**
 * Snap a requested pstack level onto the levels a model accepts.
 * Returns null when no accepted level sits on the ladder.
 */
export function snap(level, accepted, ladder) {
  if (accepted.includes(level)) return level;
  const want = ladder.indexOf(level);
  if (want < 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of accepted) {
    const at = ladder.indexOf(candidate);
    if (at < 0) continue;
    const distance = Math.abs(at - want);
    if (distance < bestDistance || (distance === bestDistance && at > (ladder.indexOf(best) ?? -1))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Turn one tier's model and level into the fields every selection carries.
 *
 * Throws on the three ways a tier cannot be translated: an alias missing from
 * the map, an ID with no `/`, and a requested level that maps onto nothing.
 */
function translate(map, tier, spec) {
  const alias = map.aliases[spec.model];
  if (!alias) throw new Error(`tier ${tier} names alias ${spec.model}, which is not in aliases`);
  const cut = alias.id.indexOf("/");
  if (cut < 1) {
    throw new Error(`alias ${spec.model} has ID ${JSON.stringify(alias.id)}, which holds no provider before a /`);
  }
  const accepted = alias.levels ?? [];
  let level = null;
  if (alias.reasoning !== false && spec.thoughtLevel) {
    level = snap(spec.thoughtLevel, accepted, map.effort.pstackLevels);
    if (level === null) {
      throw new Error(
        `tier ${tier} asks for level ${spec.thoughtLevel}, which maps onto none of ${accepted.join("/") || "(no levels)"} for ${spec.model}`,
      );
    }
  }
  const providerId = alias.id.slice(0, cut);
  const modelId = alias.id.slice(cut + 1);
  // ZCode keeps a record entry only when it matches this shape exactly, so the
  // selection carries nothing beyond the two IDs and an optional level.
  const selection = { providerId, modelId };
  if (level !== null) selection.options = { reasoningLevel: level };
  return { alias: spec.model, id: alias.id, level, providerId, modelId, selection };
}

export function tierSelections(map, id) {
  const records = [];
  for (const [tier, spec] of Object.entries(map.tiers)) {
    if (!spec.agent || !spec.model) continue;
    records.push({
      tier,
      agent: spec.agent,
      agentType: `${id.split("@")[0]}:${spec.agent}`,
      ...translate(map, tier, spec),
      stateKey: `plugin:${id}:${spec.agent.trim().toLowerCase()}`,
    });
  }
  return records;
}

export function roleAgentSelections(map) {
  const records = [];
  for (const [role, entries] of Object.entries(map.roleAgents ?? {})) {
    const tierName = map.roles[role];
    if (!tierName) throw new Error(`roleAgents names role ${role}, which is not in roles`);
    const spec = map.tiers[tierName];
    if (!spec?.model) throw new Error(`role ${role} names tier ${tierName}, which names no single model`);
    const translated = translate(map, tierName, spec);
    for (const entry of entries) {
      const cut = entry.indexOf(":");
      if (cut < 1) throw new Error(`role ${role} names agent ${JSON.stringify(entry)}, which holds no plugin id before a :`);
      const pluginId = entry.slice(0, cut);
      if (!pluginId.includes("@")) throw new Error(`role ${role} names agent ${JSON.stringify(entry)}, whose plugin id holds no @`);
      const name = entry.slice(cut + 1);
      records.push({
        role,
        tier: tierName,
        pluginId,
        name,
        agentType: `${pluginId.slice(0, pluginId.indexOf("@"))}:${name}`,
        stateKey: `plugin:${pluginId}:${name.trim().toLowerCase()}`,
        ...translated,
      });
    }
  }
  return records;
}

export function allSelections(map, id) {
  return [...tierSelections(map, id), ...roleAgentSelections(map)];
}
