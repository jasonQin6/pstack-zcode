# pstack-zcode

A ZCode adapter layer for [`pstack`](https://github.com/michael-denyer/pstack-claude). It does not fork pstack. It fixes the three places where pstack assumes Claude Code and ZCode behaves differently.

## What is actually broken without this

1. **pstack's session-start context never reaches the model.** ZCode drops hook stdout that is not JSON, so pstack's plain-Markdown context is dropped. This plugin's hook emits the part of it that is specific to ZCode as JSON.
2. **`pstack:poteto-agent` bootstraps to the wrong pstack.** Its body resolves `poteto-mode/SKILL.md` under `${CLAUDE_CODE_PLUGIN_CACHE_DIR:-$HOME/.claude/plugins}`, which on ZCode points at a different and usually older install. The native agent here resolves the ZCode cache and picks the highest version.
3. **Claude model names do not resolve.** The sheet at `~/.claude/pstack-models.md` names `opus`/`sonnet`/`fable`, none of which exist on ZCode. [`skills/pstack-zcode/references/model-map.json`](skills/pstack-zcode/references/model-map.json) holds the aliases that do.

## What it contains

| Path | Purpose |
|---|---|
| `README.md` | This file |
| `.gitignore` | Ignores `node_modules/` and `.DS_Store` |
| `.zcode-plugin/plugin.json` | Plugin manifest |
| `marketplace.json` | Marketplace entry |
| `hooks/hooks.json` | SessionStart hook entry, ZCode shape |
| `hooks/zcode-session-start.sh` | Emits the JSON ZCode accepts, plus the saved role lines; honours `session hook: off` and `PSTACK_SESSION_HOOK=off` |
| `hooks/session-start-zcode.md` | The ZCode-specific context the hook emits |
| `hooks/pstack-disabled.md` | The notice shown when the pstack plugin is disabled |
| `agents/` | The delegates. `model-map.json` names the agent for each tier, and `poteto-agent.md` inherits the session's model |
| `skills/pstack-zcode/` | `SKILL.md` plus `references/zcode-tools.md`, the Claude Code to ZCode mapping, and `references/model-map.json` |
| `scripts/tiers.mjs` | The one place that turns a tier into what ZCode runs |
| `scripts/inject-models.mjs` | Writes the named agents' models into ZCode's agent record |
| `scripts/render-sheet.mjs` | Writes `~/.zcode/pstack-models.md` from the map |
| `scripts/resolve-model.mjs` | Resolves an alias or a role, and names the role's delegate or agents |
| `scripts/self-check.mjs` | The adapter's checks, run by hand |

## Install

This plugin depends on `pstack@pstack-claude` being installed and enabled; it adapts that install and ships none of pstack's skills.

This plugin injects only what is specific to ZCode. The rule for when to enter poteto-mode is your own: keep it in `~/.zcode/AGENTS.md`.

```sh
zcode plugins marketplace add jasonQin6/pstack-zcode
zcode plugins install pstack-zcode@pstack-zcode
```

Then restart ZCode and confirm on a new task that the log shows the SessionStart hook succeeding:

```sh
grep 'SessionStart' ~/.zcode/cli/log/zcode-*.jsonl | tail
```

Then write the named agents' models into ZCode's agent record, and restart ZCode once more:

```sh
node scripts/inject-models.mjs --apply
```

## Agents

`node scripts/resolve-model.mjs --role <role>` names the agents to dispatch a role on, as [`model-map.json`](skills/pstack-zcode/references/model-map.json) records them.

ZCode decides an agent's model in `~/.zcode/v2/agents-state.json`. The delegate definitions set no model, so without an entry there a delegate runs on the session's model. `node scripts/inject-models.mjs` compares the record with `model-map.json` and reports. With `--apply` it writes the entries the map names, after a backup, and never touches an entry the map does not name. The ZCode settings app writes the same record, so run the injector again when the record and the map disagree. Run it after an install and after the map changes. `~/.zcode/cli/config.json` holds no such key.

## Model tiering

pstack names roles and tiers, never models. This adapter owns the only translation, in [`skills/pstack-zcode/references/model-map.json`](skills/pstack-zcode/references/model-map.json).

```sh
node scripts/resolve-model.mjs --list             # every alias with its ID and accepted levels
node scripts/resolve-model.mjs --role <role>      # a role's alias, level and delegate
node scripts/render-sheet.mjs                     # regenerate ~/.zcode/pstack-models.md from the map
node scripts/inject-models.mjs --apply  # write the named agents' models into ZCode's agent record
```

The sheet holds aliases rather than IDs, because pstack's own parser accepts only `[a-z0-9][a-z0-9.-]*` while a ZCode ID holds a colon and a slash.

## Troubleshooting

`node scripts/self-check.mjs` checks the hook, the sheet, the map and the delegates, and exits 1 on any failure.

**`Agent` dispatch fails with `Reasoning level unsupported / 不支持所选思考档位 [reason=reasoning-level-not-supported]`.** ZCode builds a model's reasoning levels from its own provider config, not from what the gateway advertises. `deepseek-flash` was missing `optionSpecs.reasoningLevel` in `~/.zcode/v2/provider_config.json`, so ZCode saw a model with no levels and refused any dispatch that named one.

Two separate things have to line up:

1. ZCode knows the model's levels. Confirm the entry in `~/.zcode/v2/provider_config.json` under `modelConfigRules.providerModelRules` carries `optionSpecs.reasoningLevel.values`.
2. The level you name is in that set. Check which set an alias maps to:

```sh
node scripts/resolve-model.mjs --list
```

Compare against the gateway's own view, which is the ground truth for what the backend will accept:

```sh
curl -s http://127.0.0.1:3425/v1/models | jq '.data[] | select(.id|test("deepseek")) | {id, reasoning, reasoning_levels}'
```

pstack's own ladder has `medium` and `xhigh`, which most models here do not expose. `render-sheet.mjs` snaps a tier's level to the nearest level its model accepts, so `medium` becomes `high` rather than an invalid value.

**`SessionStart` hooks from several plugins fail at once, each in a few milliseconds.** The host was tearing down while still firing hooks. On 2026-11-25 a session closed at 16:21:45 and SessionStart hooks ran at 16:21:54; this plugin's hook, the `design` plugin's, and the config-level `deja` hook all failed in 2-17 ms, too fast for any to have run. The hook now stays silent when `ZCODE_SESSION_ID` is empty, which is what a teardown run looks like. Set `ZCODE_HOOK_FORCE=1` to make a manual run emit anyway.

**The ZCode context and the saved role choices are missing at session start.** Look for the hook in the log:

```sh
grep 'SessionStart' ~/.zcode/cli/log/zcode-*.jsonl | tail
```

**`~/.zcode/pstack-models.md` was hand-edited or drifted from the map.** The sheet itself says not to hand-edit it. `node scripts/render-sheet.mjs --check` exits 1 when the sheet has drifted. Regenerate it:

```sh
node scripts/render-sheet.mjs
```

**An alias in the sheet resolves to a model that no longer exists.** Edit the `aliases` layer in [`skills/pstack-zcode/references/model-map.json`](skills/pstack-zcode/references/model-map.json), then re-run `node scripts/render-sheet.mjs`.

**Agents from this plugin are missing from the `Agent` tool after an install or an update.** Restart ZCode, then confirm the SessionStart hook the way Install shows.

**A delegate runs on the session's model or on the wrong model.** ZCode's agent record does not hold what the map says. Run `node scripts/inject-models.mjs` to see the difference, then `node scripts/inject-models.mjs --apply` to write it. A new session picks the change up.

## Retiring this plugin

If pstack starts emitting JSON from its own hook, or gains a native ZCode runtime, delete this plugin.
