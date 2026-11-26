#!/usr/bin/env node
// Run: node scripts/self-check.mjs. Exits 1 when any check fails.
// Expected values come from the requirement, never from the thing under test.
// The hook and the injector are driven only through their command line.
// A record key is `plugin:<plugin id>:<bare name lowercased>`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allSelections, loadMap, roleAgentSelections, snap } from "./tiers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "hooks/zcode-session-start.sh");
const MANDATE = "You have pstack, running on ZCode.";

const map = loadMap(ROOT);

const SCRATCH_HOME = mkdtempSync(join(tmpdir(), "pstack-selfcheck-home-"));
const TEMP_DIRS = [SCRATCH_HOME];

const BASE_ENV = { ...process.env };
for (const key of [
  "ZCODE_HOOK_FORCE",
  "PSTACK_SESSION_HOOK",
  "ZCODE_CONFIG_DIR",
  "ZCODE_SESSION_ID",
  "CLAUDE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
]) {
  delete BASE_ENV[key];
}
BASE_ENV.ZCODE_PLUGIN_ROOT = ROOT;
BASE_ENV.HOME = SCRATCH_HOME;

function runHook(extra = {}) {
  const result = spawnSync("bash", [HOOK], {
    env: { ...BASE_ENV, ...extra },
    input: "",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result.stdout;
}

function context(extra = {}) {
  const stdout = runHook(extra);
  const event = JSON.parse(stdout).hookSpecificOutput;
  return event.additionalContext;
}

function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `pstack-selfcheck-${prefix}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

function renderSheet(dir) {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts/render-sheet.mjs")], {
    env: { ...BASE_ENV, ZCODE_CONFIG_DIR: dir },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`render-sheet.mjs exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
}

function check(method, args) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", "resolve-model.mjs"), ...args], {
    env: BASE_ENV,
    encoding: "utf8",
  });
}

function frontmatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`${file} has no frontmatter`);
  return match[1];
}

function field(fm, name) {
  const match = fm.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^"(.*)"$/, "$1");
}

const LADDER = map.effort.pstackLevels;

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    else if (entry.endsWith(".md")) found.push(path);
  }
  return found;
}

const checks = [
  {
    name: "the hook emits valid JSON for a session",
    run() {
      const stdout = runHook({ ZCODE_SESSION_ID: "self-check" });
      let event;
      try {
        event = JSON.parse(stdout).hookSpecificOutput;
      } catch {
        throw new Error(`stdout is not a JSON hookSpecificOutput object: ${JSON.stringify(stdout.slice(0, 120))}`);
      }
      if (event?.hookEventName !== "SessionStart") {
        throw new Error(`hookSpecificOutput.hookEventName is ${JSON.stringify(event?.hookEventName)}, expected "SessionStart"`);
      }
      if (typeof event.additionalContext !== "string" || event.additionalContext.length === 0) {
        throw new Error("hookSpecificOutput.additionalContext is missing or empty");
      }
    },
  },
  {
    name: "the hook stays silent when disabled and with no live session id",
    run() {
      const disabled = runHook({ ZCODE_SESSION_ID: "self-check", PSTACK_SESSION_HOOK: "off" });
      if (disabled !== "") throw new Error(`PSTACK_SESSION_HOOK=off printed ${JSON.stringify(disabled.slice(0, 120))}`);
      const noSession = runHook({});
      if (noSession !== "") {
        throw new Error(`no live session id printed ${JSON.stringify(noSession.slice(0, 120))}; a teardown run must stay silent`);
      }
    },
  },
  {
    name: "the dependency notice replaces the mandate only when pstack is disabled",
    run() {
      const cases = [
        {
          label: "pstack disabled",
          config: '{"plugins":{"enabledPlugins":{"pstack@pstack-claude":false,"pstack-zcode@pstack-zcode":true}}}',
          wantMandate: false,
        },
        {
          label: "pstack enabled",
          config: '{"plugins":{"enabledPlugins":{"pstack@pstack-claude":true,"pstack-zcode@pstack-zcode":true}}}',
          wantMandate: true,
        },
        { label: "no config file", config: null, wantMandate: true },
      ];
      for (const testCase of cases) {
        const dir = scratchDir("notice");
        if (testCase.config !== null) {
          mkdirSync(join(dir, "cli"), { recursive: true });
          writeFileSync(join(dir, "cli", "config.json"), testCase.config);
        }
        const text = context({ ZCODE_CONFIG_DIR: dir, ZCODE_SESSION_ID: "self-check" });
        const hasMandate = text.includes(MANDATE);
        if (testCase.wantMandate !== hasMandate) {
          const seen = `mandate=${hasMandate} names-pstack=${text.includes("pstack@pstack-claude")}`;
          throw new Error(`${testCase.label}: ${seen}, expected the mandate ${testCase.wantMandate ? "present" : "absent"}`);
        }
        if (!testCase.wantMandate && !text.includes("pstack@pstack-claude")) {
          throw new Error(`${testCase.label}: the notice does not name pstack@pstack-claude`);
        }
      }
    },
  },
  {
    name: "every role of a freshly rendered sheet reaches the context",
    run() {
      const dir = scratchDir("roles");
      renderSheet(dir);
      const roles = Object.keys(map.roles);
      if (roles.length === 0) throw new Error("model-map.json holds no roles");
      const text = context({ ZCODE_CONFIG_DIR: dir, ZCODE_SESSION_ID: "self-check" });
      const missing = roles.filter((role) => !text.includes(`${role}:`));
      if (missing.length > 0) throw new Error(`roles dropped from the injected context: ${missing.join(", ")}`);
      const leaked = ["default effort:", "session hook:"].filter((line) => text.includes(line));
      if (leaked.length > 0) throw new Error(`settings lines leaked into the context: ${leaked.join(", ")}`);
    },
  },
  {
    name: "the drift check tells a current sheet from a drifted one",
    run() {
      const dir = scratchDir("sheet");
      renderSheet(dir);
      const check = () =>
        spawnSync(process.execPath, [join(ROOT, "scripts/render-sheet.mjs"), "--check"], {
          env: { ...BASE_ENV, ZCODE_CONFIG_DIR: dir },
          encoding: "utf8",
        }).status;
      const current = check();
      if (current !== 0) throw new Error(`--check on a freshly rendered sheet exited ${current}, expected 0`);
      const sheet = join(dir, "pstack-models.md");
      writeFileSync(sheet, `${readFileSync(sheet, "utf8")}bug-fix: glm-5.3\n`);
      const drifted = check();
      if (drifted !== 1) throw new Error(`--check after an appended line exited ${drifted}, expected 1`);
    },
  },
  {
    name: "every alias resolves to an ID",
    run() {
      for (const alias of Object.keys(map.aliases)) {
        const result = check(null, [alias]);
        const got = result.stdout.trim();
        if (result.status !== 0) throw new Error(`${alias}: resolve-model.mjs exited ${result.status}: ${result.stderr.trim()}`);
        // A ZCode ID names a provider and a model, so it holds a slash. A bare
        // alias or a Claude family name does not.
        if (!got.includes("/")) throw new Error(`${alias} resolved to ${JSON.stringify(got)}, which is not a provider-prefixed ID`);
      }
    },
  },
  {
    name: "poteto-agent sets no model and no thoughtLevel",
    run() {
      const file = "agents/poteto-agent.md";
      const fm = frontmatter(readFileSync(join(ROOT, file), "utf8"), file);
      for (const name of ["model", "thoughtLevel"]) {
        const value = field(fm, name);
        if (value !== null) throw new Error(`${file} sets ${name}: ${value}; it must inherit the session's model`);
      }
    },
  },
  {
    name: "every tier delegate exists and sets no model of its own",
    run() {
      for (const [tierName, tier] of Object.entries(map.tiers)) {
        if (!tier.agent) continue;
        if (!tier.model) throw new Error(`tier ${tierName} names agent ${tier.agent} but no model`);
        const file = `agents/${tier.agent}.md`;
        const path = join(ROOT, file);
        if (!existsSync(path)) throw new Error(`${file} does not exist for tier ${tierName}`);
        const fm = frontmatter(readFileSync(path, "utf8"), file);
        const name = field(fm, "name");
        if (name !== tier.agent) throw new Error(`${file} name is ${JSON.stringify(name)}, expected ${JSON.stringify(tier.agent)}`);
        for (const unset of ["model", "thoughtLevel"]) {
          const value = field(fm, unset);
          if (value !== null) {
            throw new Error(`${file} sets ${unset}: ${value}; the agent record supplies it`);
          }
        }
      }
    },
  },
  {
    name: "every tier level maps onto a level its model accepts",
    run() {
      const bad = [];
      for (const [tierName, tier] of Object.entries(map.tiers)) {
        if (!tier.thoughtLevel) continue;
        for (const alias of tier.models ?? [tier.model]) {
          const spec = map.aliases[alias];
          if (!spec) {
            bad.push(`${tierName} -> ${alias}: alias missing from the map`);
            continue;
          }
          if (!spec.reasoning) {
            bad.push(`${tierName} -> ${alias}: tier sets ${tier.thoughtLevel} but the model has no levels`);
            continue;
          }
          if (!snap(tier.thoughtLevel, spec.levels ?? [], LADDER)) {
            bad.push(`${tierName} -> ${alias}: ${tier.thoughtLevel} cannot map onto ${(spec.levels ?? []).join("/") || "(none)"}`);
          }
        }
      }
      if (bad.length > 0) throw new Error(bad.join("; "));
    },
  },
  {
    name: "the injector reports, writes only what the map names, and is idempotent",
    run() {
      const id = `${JSON.parse(readFileSync(join(ROOT, ".zcode-plugin/plugin.json"), "utf8")).name}@${
        JSON.parse(readFileSync(join(ROOT, "marketplace.json"), "utf8")).name
      }`;

      const expected = [
        {
          agentType: "pstack-zcode:poteto-worker",
          key: "plugin:pstack-zcode@pstack-zcode:poteto-worker",
          selection: { providerId: "new-provider-2", modelId: "deepseek-flash", options: { reasoningLevel: "high" } },
        },
        {
          agentType: "pstack-zcode:poteto-default",
          key: "plugin:pstack-zcode@pstack-zcode:poteto-default",
          selection: {
            providerId: "account:bigmodel-individual-coding-plan",
            modelId: "GLM-5.3",
            options: { reasoningLevel: "high" },
          },
        },
        {
          agentType: "pstack-zcode:poteto-strongest",
          key: "plugin:pstack-zcode@pstack-zcode:poteto-strongest",
          selection: {
            providerId: "account:bigmodel-individual-coding-plan",
            modelId: "GLM-5.4",
            options: { reasoningLevel: "max" },
          },
        },
        {
          agentType: "pstack:comment-sicko",
          key: "plugin:pstack@pstack-claude:comment-sicko",
          selection: { providerId: "new-provider-2", modelId: "deepseek-flash", options: { reasoningLevel: "high" } },
        },
        {
          agentType: "pstack:thermo-nuclear-review-subagent",
          key: "plugin:pstack@pstack-claude:thermo-nuclear-review-subagent",
          selection: {
            providerId: "account:bigmodel-individual-coding-plan",
            modelId: "GLM-5.3",
            options: { reasoningLevel: "high" },
          },
        },
        {
          agentType: "pstack:thermo-nuclear-code-quality-review-subagent",
          key: "plugin:pstack@pstack-claude:thermo-nuclear-code-quality-review-subagent",
          selection: {
            providerId: "account:bigmodel-individual-coding-plan",
            modelId: "GLM-5.3",
            options: { reasoningLevel: "high" },
          },
        },
      ];

      const namedKeys = new Set(allSelections(map, id).map((selection) => selection.stateKey));
      const absentFromTable = [...namedKeys].filter((key) => !expected.some((entry) => entry.key === key));
      const absentFromMap = expected.map((entry) => entry.key).filter((key) => !namedKeys.has(key));
      if (absentFromTable.length > 0) throw new Error(`the map names agents the table omits: ${absentFromTable.join(", ")}`);
      if (absentFromMap.length > 0) throw new Error(`the table names agents the map omits: ${absentFromMap.join(", ")}`);

      const preservedKey = "plugin:pstack@pstack-claude:poteto-agent";
      const preserved = { providerId: "new-provider-2", modelId: "deepseek-flash", options: { reasoningLevel: "max" } };

      const dir = scratchDir("inject");
      const recordPath = join(dir, "v2", "agents-state.json");
      mkdirSync(join(dir, "v2"), { recursive: true });

      const foreignKey = "plugin:other@market:agent";
      const foreign = { providerId: "other-provider", modelId: "other-model", options: { reasoningLevel: "low" } };
      const overrides = { [foreignKey]: foreign, [preservedKey]: preserved };
      for (const entry of expected) {
        overrides[entry.key] = {
          providerId: entry.selection.providerId,
          modelId: `${entry.selection.modelId}-other`,
          options: { reasoningLevel: "low" },
        };
      }
      const original = {
        builtInModelOverrides: { Explore: "custom:builtin%3Abigmodel-coding-plan:GLM-5.3-Flash" },
        builtInThoughtLevelOverrides: { Explore: "low" },
        disabledAgentIds: ["user:user:implementer"],
        builtInModelSelectionOverrides: {
          Explore: { providerId: "account:bigmodel-individual-coding-plan", modelId: "GLM-5.3-Flash", options: { reasoningLevel: "max" } },
        },
        pluginAgentModelSelectionOverrides: overrides,
      };
      const originalText = JSON.stringify(original, null, 2);
      writeFileSync(recordPath, originalText);

      const inject = (extra = []) =>
        spawnSync(process.execPath, [join(ROOT, "scripts/inject-models.mjs"), ...extra], {
          env: { ...BASE_ENV, ZCODE_CONFIG_DIR: dir },
          encoding: "utf8",
        });

      const checked = inject();
      if (checked.status !== 1) {
        throw new Error(`check mode exited ${checked.status}, expected 1: ${(checked.stderr || checked.stdout).trim().slice(0, 200)}`);
      }
      for (const entry of expected) {
        if (!new RegExp(`^${entry.agentType}\\t.*\\tdiffers`, "m").test(checked.stdout)) {
          throw new Error(`check mode did not report ${entry.agentType} as differs:\n${checked.stdout}`);
        }
        if (!checked.stdout.includes(entry.key)) throw new Error(`check mode did not print the key ${entry.key}`);
      }
      if (readFileSync(recordPath, "utf8") !== originalText) throw new Error("check mode changed the record");

      const applied = inject(["--apply"]);
      if (applied.status !== 0) throw new Error(`--apply exited ${applied.status}: ${(applied.stderr || applied.stdout).trim().slice(0, 200)}`);
      const written = JSON.parse(readFileSync(recordPath, "utf8"));
      if (JSON.stringify(written.pluginAgentModelSelectionOverrides[foreignKey]) !== JSON.stringify(foreign)) {
        throw new Error("--apply changed the foreign plugin's entry");
      }
      if (JSON.stringify(written.pluginAgentModelSelectionOverrides[preservedKey]) !== JSON.stringify(preserved)) {
        throw new Error(`--apply changed ${preservedKey}, which the map does not name`);
      }
      for (const entry of expected) {
        const got = written.pluginAgentModelSelectionOverrides[entry.key];
        if (JSON.stringify(got) !== JSON.stringify(entry.selection)) {
          throw new Error(`${entry.key} holds ${JSON.stringify(got)}, expected ${JSON.stringify(entry.selection)}`);
        }
      }
      const foreignPlusOwn = new Set([foreignKey, preservedKey, ...expected.map((entry) => entry.key)]);
      const writtenKeys = Object.keys(written.pluginAgentModelSelectionOverrides);
      const missingFromRecord = [...namedKeys].filter((key) => !writtenKeys.includes(key));
      if (missingFromRecord.length > 0) {
        throw new Error(`the injector wrote no entry for agents the map names: ${missingFromRecord.join(", ")}`);
      }
      const extraKeys = writtenKeys.filter((key) => !foreignPlusOwn.has(key));
      if (extraKeys.length > 0) throw new Error(`the overrides hold keys no test put there: ${extraKeys.join(", ")}`);
      for (const key of ["builtInModelOverrides", "builtInThoughtLevelOverrides", "disabledAgentIds", "builtInModelSelectionOverrides"]) {
        if (JSON.stringify(written[key]) !== JSON.stringify(original[key])) throw new Error(`--apply changed ${key}`);
      }
      const backups = readdirSync(join(dir, "v2")).filter((name) => name.startsWith("agents-state.json.bak-"));
      if (backups.length !== 1) throw new Error(`expected one backup beside the record, found ${backups.length}`);
      if (readFileSync(join(dir, "v2", backups[0]), "utf8") !== originalText) {
        throw new Error("the backup does not hold the record as the test wrote it");
      }

      const afterFirst = readFileSync(recordPath, "utf8");
      const again = inject(["--apply"]);
      if (again.status !== 0) throw new Error(`a second --apply exited ${again.status}, expected 0`);
      if (readFileSync(recordPath, "utf8") !== afterFirst) throw new Error("a second --apply changed the record");
      const backupsAgain = readdirSync(join(dir, "v2")).filter((name) => name.startsWith("agents-state.json.bak-"));
      if (backupsAgain.length !== 1) throw new Error(`a second --apply left ${backupsAgain.length} backups, expected 1`);

      const empty = scratchDir("inject-empty");
      mkdirSync(join(empty, "v2"), { recursive: true });
      const missing = spawnSync(process.execPath, [join(ROOT, "scripts/inject-models.mjs")], {
        env: { ...BASE_ENV, ZCODE_CONFIG_DIR: empty },
        encoding: "utf8",
      });
      if (missing.status !== 2) throw new Error(`a missing record exited ${missing.status}, expected 2`);
      const created = readdirSync(join(empty, "v2"));
      if (created.length > 0) throw new Error(`a missing record created ${created.join(", ")}`);
    },
  },
  {
    name: "a model ID splits at its first slash",
    run() {
      // A synthetic map: one role agent, and the worker tier on the alias whose
      // ID holds two slashes. The expectation is written here, not read back.
      const synthetic = structuredClone(map);
      synthetic.roleAgents = { "no-comments reviewer": ["x@y:agent"] };
      synthetic.tiers.worker.model = "gpt-6-luna";
      const [entry, ...rest] = roleAgentSelections(synthetic);
      if (!entry) throw new Error("roleAgentSelections returned no record for no-comments reviewer");
      if (rest.length > 0) throw new Error(`roleAgentSelections returned ${rest.length + 1} records, expected 1`);
      const got = {
        providerId: entry.providerId,
        modelId: entry.modelId,
        agentType: entry.agentType,
        stateKey: entry.stateKey,
      };
      const want = {
        providerId: "new-provider-2",
        modelId: "group/gpt-6-luna",
        agentType: "x:agent",
        stateKey: "plugin:x@y:agent",
      };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      }

      // A role the map gives agents to but roles does not know must throw.
      const orphan = structuredClone(map);
      orphan.roleAgents = { "no such role": ["x@y:agent"] };
      let threw = false;
      try {
        roleAgentSelections(orphan);
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("roleAgentSelections accepted a role missing from roles");

      const noAt = structuredClone(map);
      noAt.roleAgents = { "no-comments reviewer": ["x:agent"] };
      let rejected = false;
      try {
        roleAgentSelections(noAt);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("roleAgentSelections accepted an entry whose plugin id holds no @");
    },
  },
  {
    name: "no model ID appears in a Markdown file under skills/, hooks/ or agents/",
    run() {
      const needles = new Set();
      for (const spec of Object.values(map.aliases)) {
        needles.add(spec.id);
        needles.add(spec.id.split("/")[0]);
      }
      const hits = [];
      for (const dir of ["skills", "hooks", "agents"]) {
        for (const path of markdownFiles(join(ROOT, dir))) {
          const text = readFileSync(path, "utf8");
          for (const needle of needles) {
            if (text.includes(needle)) hits.push(`${path.slice(ROOT.length + 1)} names ${needle}`);
          }
        }
      }
      if (hits.length > 0) throw new Error(hits.join("; "));
    },
  },
  {
    name: "the hook's Markdown files copy nothing from upstream",
    run() {
      const hits = [];
      for (const path of markdownFiles(join(ROOT, "hooks"))) {
        const text = readFileSync(path, "utf8");
        const names = [...text.matchAll(/pstack:[a-zA-Z0-9]/g)].map(
          (match) => text.slice(match.index).match(/^[a-zA-Z0-9:_-]+/)[0],
        );
        if (names.length > 0) hits.push(`${path.slice(ROOT.length + 1)} names ${names.join(", ")}`);
      }
      if (hits.length > 0) throw new Error(hits.join("; "));
    },
  },
];

let failed = 0;
for (const entry of checks) {
  try {
    entry.run();
    console.log(`ok: ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL: ${entry.name}: ${error.message}`);
  }
}

for (const dir of TEMP_DIRS) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
process.exit(failed > 0 ? 1 : 0);
