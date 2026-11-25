#!/usr/bin/env node
// Pin the mandate text to the pstack skills it names.
//
// hooks/session-start-zcode.md is a hand-adapted copy of pstack's own
// hooks/session-start-context.md. A copy drifts: pstack renames a skill, adds a
// trigger, or changes which subagent types exist, and this file keeps naming the
// old ones. That drift is silent, because the mandate still parses as JSON and
// still gets injected.
//
// This check enforces two anchors:
//   1. Every `pstack:<skill>` the mandate names must resolve to a skill the
//      installed pstack actually ships.
//   2. Every skill pstack's own mandate names must still be named here, or be
//      listed in ALLOWED_DROPS with a reason.
//
// Usage:
//   node scripts/check-anchors.mjs
//   node scripts/check-anchors.mjs --verbose
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANDATE = join(ROOT, "hooks/session-start-zcode.md");
const CACHE = join(homedir(), ".zcode/cli/plugins/cache/pstack-claude/pstack");
const verbose = process.argv.includes("--verbose");

// Skills pstack's mandate names that this one deliberately does not carry, each
// with the reason it is absent. An entry whose skill is no longer named upstream
// is stale and fails below.
const ALLOWED_DROPS = new Map();

function latestInstall() {
  if (!existsSync(CACHE)) return null;
  const versions = readdirSync(CACHE)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  return versions.length > 0 ? join(CACHE, versions[0]) : null;
}

/**
 * Names a mandate refers to after `pstack:`. This covers both skills and agents,
 * so callers must filter against the set they mean; a token can be either.
 */
function pstackNames(text) {
  return new Set([...text.matchAll(/pstack:([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]));
}

const mandate = readFileSync(MANDATE, "utf8");
const install = latestInstall();

// CI has no installed pstack, so anchor 2 (nothing upstream names may vanish)
// cannot run there. The --offline path checks against a fixture that a local run
// regenerates from the real install, and is what CI uses.
const SKILLS_FIXTURE = join(ROOT, "skills/pstack-zcode/references/pstack-names.json");

if (!install) {
  if (!process.argv.includes("--offline")) {
    console.error(`No installed pstack found under ${CACHE}`);
    console.error("Run with --offline to check against the checked-in name list instead.");
    process.exit(2);
  }
  const fixture = JSON.parse(readFileSync(SKILLS_FIXTURE, "utf8"));
  const known = new Set([...fixture.skills, ...fixture.agents]);
  const named = pstackNames(mandate);
  const problems = [];

  for (const name of named) {
    if (!known.has(name)) {
      problems.push(`mandate names pstack:${name}, which the checked-in name list does not contain`);
    }
  }
  for (const name of fixture.upstreamMandateNames) {
    if (!named.has(name) && !ALLOWED_DROPS.has(name)) {
      problems.push(`upstream mandate names pstack:${name}; this mandate dropped it with no ALLOWED_DROPS entry`);
    }
  }

  if (problems.length > 0) {
    console.error("\nMANDATE DRIFT");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`anchors ok (offline): ${named.size} names against a ${known.size}-name fixture`);
  process.exit(0);
}

const shipped = new Set(
  readdirSync(join(install, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(install, "skills", d.name, "SKILL.md")))
    .map((d) => d.name),
);

// pstack also ships agents, and a mandate legitimately names those too. They live
// in a different directory, so a token is only "missing" when neither holds it.
const agents = new Set(
  existsSync(join(install, "agents"))
    ? readdirSync(join(install, "agents"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
    : [],
);

const upstreamMandate = join(install, "hooks/session-start-context.md");
const upstreamText = existsSync(upstreamMandate) ? readFileSync(upstreamMandate, "utf8") : "";

const named = pstackNames(mandate);
const upstreamNamed = pstackNames(upstreamText);
const problems = [];

// Anchor 1: everything named must exist as a skill or an agent.
for (const name of named) {
  if (!shipped.has(name) && !agents.has(name)) {
    problems.push(`mandate names pstack:${name}, which is neither a skill nor an agent in this install`);
  }
}

// Anchor 2: nothing pstack names may vanish without a recorded reason.
for (const name of upstreamNamed) {
  if (named.has(name)) continue;
  if (ALLOWED_DROPS.has(name)) continue;
  problems.push(`pstack's mandate names pstack:${name}; this mandate dropped it with no ALLOWED_DROPS entry`);
}

// Anchor 2b: a drop entry whose name upstream no longer mentions is itself stale.
for (const [name, reason] of ALLOWED_DROPS) {
  if (!upstreamNamed.has(name)) {
    problems.push(`ALLOWED_DROPS entry "${name}" is stale: upstream no longer names it. Reason given: ${reason}`);
  }
}

if (verbose) {
  console.log(`install:  ${install}`);
  console.log(`shipped:  ${shipped.size} skills, ${agents.size} agents`);
  console.log(`mandate:  names ${named.size} -> ${[...named].join(", ") || "(none)"}`);
  console.log(`upstream: names ${upstreamNamed.size} -> ${[...upstreamNamed].join(", ") || "(none)"}`);
}

if (problems.length > 0) {
  console.error("\nMANDATE DRIFT");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nFix hooks/session-start-zcode.md, or record the drop in ALLOWED_DROPS with a reason.");
  process.exit(1);
}

console.log(`anchors ok: ${named.size} names, ${upstreamNamed.size} upstream, ${ALLOWED_DROPS.size} allowed drops`);

// Keep the offline fixture current for CI, which has no installed pstack.
const fixture = {
  generatedFrom: install,
  skills: [...shipped].sort(),
  agents: [...agents].sort(),
  upstreamMandateNames: [...upstreamNamed].sort(),
};
const fixtureText = `${JSON.stringify(fixture, null, 2)}\n`;
const current = existsSync(SKILLS_FIXTURE) ? readFileSync(SKILLS_FIXTURE, "utf8") : "";
if (current !== fixtureText) {
  if (process.argv.includes("--check-fixture")) {
    console.error(`\n${SKILLS_FIXTURE} is out of date. Re-run without --check-fixture to update it.`);
    process.exit(1);
  }
  writeFileSync(SKILLS_FIXTURE, fixtureText);
  console.log(`updated ${SKILLS_FIXTURE} from ${install}`);
}

process.exit(0);
