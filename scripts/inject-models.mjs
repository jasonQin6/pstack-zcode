#!/usr/bin/env node
// ZCode reads ~/.zcode/v2/agents-state.json every time it discovers agents. An
// entry under pluginAgentModelSelectionOverrides with a key of
// plugin:<plugin id>:<bare name> sets that agent's model and level, and wins over
// the agent definition. The map names the agents this script writes. The ZCode
// settings app writes the same record: it reads the file, changes the one entry
// you touched, and writes it back.
//
// ZCode keeps an entry only when its value matches { providerId, modelId,
// options?: { reasoningLevel } } exactly, so anything else in a selection would
// be dropped silently.
//
// Usage:
//   node scripts/inject-models.mjs            compare the record with the map
//   node scripts/inject-models.mjs --apply    write the entries the map names
//
// Exit: 0 in sync or after a write, 1 a difference in check mode or an invalid
// tier, 2 the record is missing or is not a JSON object.
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap, pluginId, allSelections } from "./tiers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = join(process.env.ZCODE_CONFIG_DIR ?? join(homedir(), ".zcode"), "v2/agents-state.json");
const KEY = "pluginAgentModelSelectionOverrides";
const apply = process.argv.includes("--apply");

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

function wanted(record) {
  return record.level === null ? record.alias : `${record.alias}@${record.level}`;
}

function recordedText(value) {
  if (value === undefined) return "missing";
  if (typeof value !== "object" || value === null || typeof value.providerId !== "string" || typeof value.modelId !== "string") {
    return `differs (recorded ${JSON.stringify(value)})`;
  }
  const level = value.options?.reasoningLevel;
  const at = typeof level === "string" ? `@${level}` : "";
  return `differs (recorded ${value.providerId}/${value.modelId}${at})`;
}

let map;
let selections;
let id;
try {
  map = loadMap(ROOT);
  id = pluginId(ROOT);
  selections = allSelections(map, id);
} catch (error) {
  fail(error.message, 1);
}

if (!existsSync(RECORD)) fail(`no agent record at ${RECORD}; ZCode has not written one yet`, 2);

let record;
try {
  record = JSON.parse(readFileSync(RECORD, "utf8"));
} catch (error) {
  fail(`the agent record at ${RECORD} is not valid JSON: ${error.message}`, 2);
}
if (typeof record !== "object" || record === null || Array.isArray(record)) {
  fail(`the agent record at ${RECORD} is not a JSON object`, 2);
}

const overrides = typeof record[KEY] === "object" && record[KEY] !== null ? record[KEY] : {};
const rows = selections.map((selection) => {
  const current = overrides[selection.stateKey];
  const state = current === undefined ? "missing" : deepEqual(current, selection.selection) ? "in sync" : recordedText(current);
  return { selection, state };
});

const counts = { "in sync": 0, missing: 0, differs: 0 };
for (const row of rows) {
  if (row.state === "in sync") counts["in sync"] += 1;
  else if (row.state === "missing") counts.missing += 1;
  else counts.differs += 1;
}
const inSync = counts.differs === 0 && counts.missing === 0;

for (const row of rows) {
  console.log(`${row.selection.agentType}\t${row.selection.stateKey}\t${wanted(row.selection)}\t${row.state}`);
}
console.log(
  `${counts["in sync"]} in sync, ${counts.differs} differ, ${counts.missing} missing in ${RECORD}`,
);

if (!apply) {
  if (!inSync) console.log("Run with --apply to write the entries the map names into the agent record.");
  process.exit(inSync ? 0 : 1);
}

if (inSync) {
  console.log("already in sync");
  process.exit(0);
}

const stamp = (() => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
})();
const backup = `${RECORD}.bak-${stamp}`;
copyFileSync(RECORD, backup);

const next = { ...record };
const nextOverrides = { ...overrides };
for (const selection of selections) nextOverrides[selection.stateKey] = selection.selection;
next[KEY] = nextOverrides;

// ZCode reads a record that does not parse as an empty one, and the settings
// app then writes that empty state back. So this lands by rename: a reader sees
// the old file or the new one, never a half-written one.
const temp = `${RECORD}.tmp-${process.pid}`;
writeFileSync(temp, JSON.stringify(next, null, 2), { mode: statSync(RECORD).mode });
try {
  renameSync(temp, RECORD);
} catch (error) {
  try {
    unlinkSync(temp);
  } catch {}
  fail(`could not replace ${RECORD}: ${error.message}`, 1);
}

console.log(`wrote ${selections.length} entries to ${RECORD}`);
console.log(`backup: ${backup}`);
console.log("a new session picks the change up");
process.exit(0);