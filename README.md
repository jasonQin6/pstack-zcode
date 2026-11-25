# pstack-zcode

A ZCode adapter layer for [`pstack`](https://github.com/michael-denyer/pstack-claude). It does not fork pstack. It fixes the three places where pstack assumes Claude Code and ZCode behaves differently.

## What is actually broken without this

1. **pstack's routing mandate never reaches the model.** pstack's `hooks/hooks.json` runs `session-start.sh claude`, whose `claude` branch `cat`s plain Markdown. ZCode parses hook stdout as strict JSON and drops anything else, so the hook fails on every start. This plugin's hook emits `{"additionalContext": ...}` instead.
2. **`pstack:poteto-agent` bootstraps to the wrong pstack.** Its body resolves `poteto-mode/SKILL.md` under `${CLAUDE_CODE_PLUGIN_CACHE_DIR:-$HOME/.claude/plugins}`, which on ZCode points at a different and usually older install. The native agent here resolves the ZCode cache and picks the highest version.
3. **Claude model names do not resolve.** The sheet at `~/.claude/pstack-models.md` names `opus`/`sonnet`/`fable`, none of which exist on ZCode. This plugin's reference lists the provider-prefixed IDs that do.

## What it contains

| Path | Purpose |
|---|---|
| `.zcode-plugin/plugin.json` | Manifest |
| `hooks/hooks.json` | SessionStart hook entry, ZCode shape |
| `hooks/zcode-session-start.sh` | Emits the JSON ZCode accepts; honours `session hook: off` and `PSTACK_SESSION_HOOK=off` |
| `hooks/session-start-zcode.md` | The mandate text, written for ZCode |
| `agents/poteto-agent.md` | Native delegate: ZCode path resolution, own model and thought level |
| `skills/pstack-zcode/` | `SKILL.md` plus `references/zcode-tools.md`, the Claude Code -> ZCode mapping |
| `scripts/check-upstream.mjs` | Drift detector, run daily in CI |
| `.github/workflows/track-upstream.yml` | Opens a PR when upstream moves, an issue when the contract breaks |

## Install

This plugin depends on `pstack@pstack-claude` being installed; it adapts that install and ships none of its 68 skills.

```sh
zcode plugins marketplace add jasonQin6/pstack-zcode
zcode plugins install pstack-zcode@pstack-zcode
```

Then restart ZCode and confirm on a new task that the log shows the SessionStart hook succeeding:

```sh
grep 'SessionStart' ~/.zcode/cli/log/zcode-*.jsonl | tail
```

## Agents

| Agent | Model | Use for |
|---|---|---|
| `pstack-zcode:poteto-agent` | inherits the session's model | The default delegate. Sets no `model`, matching pstack's own `poteto-agent`, whose Subagents section says a role with no configured model runs on the parent's. |
| `pstack-zcode:poteto-worker` | `deepseek-flash` at `low` | Mechanical, repetitive, or already-specified work: bulk edits, sweeps, formatting passes, verification re-runs. Cheapest tier, and the payload says so. |

Levels are per model, not global, so `model-map.json` records each alias's accepted set. On this machine `deepseek-flash`, `GLM-5.3` and `GLM-5.4` take `low/high/max`, and `gpt-6-luna` takes only `high`. A tier's level is snapped to the nearest level its own model accepts, preferring the higher one on a tie, and CI fails if a level cannot be mapped at all.

Cost control comes from picking the agent at dispatch, not from changing the default. `poteto-agent` inheriting is deliberate: pinning it to the cheap model would silently downgrade every delegated task, including the ones that needed the session's judgment. pstack's `pstack:poteto-agent` and `pstack:thermo-nuclear-*` reviewers come from the pstack plugin itself and are unaffected.

## Model tiering

pstack names roles and tiers, never models. This adapter keeps that abstraction and owns the only translation, in [`skills/pstack-zcode/references/model-map.json`](skills/pstack-zcode/references/model-map.json):

| pstack tier | ZCode model | Use it for |
|---|---|---|
| `worker` | `deepseek-flash` @ `low` | Fastest and cheapest: bulk edits, mechanical fan-out, verification passes |
| `default` | `GLM-5.3` | Bug fixes, perf work, judgment, prose |
| `strongest` | `GLM-5.4` @ `max` | Escalation: design and contested decisions |
| `panel` | `GLM-5.4`, `gpt-6-luna`, `deepseek-flash` | Arena and interrogate seats |

The sheet holds aliases rather than IDs, because pstack's own parser accepts only `[a-z0-9][a-z0-9.-]*` while a ZCode ID holds a colon and a slash. `check-sheet.sh` from pstack passes on the generated sheet:

```sh
node scripts/render-sheet.mjs                      # regenerate ~/.zcode/pstack-models.md from the map
node scripts/resolve-model.mjs --role hillclimb    # alias -> real ZCode ID
node scripts/resolve-model.mjs glm-5.4             # one alias
```

`poteto-worker` ships on the `worker` tier, and `poteto-agent` deliberately sets no model. To move the worker tier without editing the agent, override in `~/.zcode/cli/config.json`:

```json
{
  "pluginAgentModelSelectionOverrides": {
    "pstack-zcode:poteto-worker": { "model": "new-provider-2/group/gpt-6-luna", "options": { "reasoningLevel": "high" } }
  }
}
```

CI fails when the rendered sheet drifts from the map, when `poteto-agent` grows a `model` field, or when `poteto-worker` leaves the `worker` tier.

## Disabling pstack's own hook

pstack's `SessionStart` hook fails on every ZCode start (see above). There is no per-plugin hook switch in the ZCode config, and `zcode plugins update` rewrites the plugin cache, so the fix is a script you re-run after an update:

```sh
node scripts/disable-upstream-hook.mjs          # set enabled:false on the superseded hook
node scripts/disable-upstream-hook.mjs --check  # exit 1 if an update re-enabled it
```

It only touches hook entries running pstack's own `session-start.sh`; anything else pstack ships is left alone.


## Following upstream

`scripts/check-upstream.mjs` exits 0 when clean, 2 when upstream moved without a structural break, 1 when a file this adapter relies on changed shape, and 3 when GitHub was unreachable. CI runs it nightly: exit 2 opens a tracking PR that only records the upstream stamp, exit 1 opens an issue. Merging a tracking PR never changes adapter behaviour, so a human still reads the upstream diff.

```sh
node scripts/check-upstream.mjs
```

## Troubleshooting

Each entry names a real failure, its cause, and a fix you can run.

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

**`SessionStart` hooks from several plugins fail at once, each in a few milliseconds.** The host was tearing down while still firing hooks. On 2026-11-25 a session closed at 16:21:45 and SessionStart hooks ran at 16:21:54; this plugin's hook, the `design` plugin's, and the config-level `deja` hook all failed in 2-17 ms, too fast for any to have run. The hook now stays silent when `ZCODE_SESSION_ID` is empty, which is what a teardown run looks like. Set `ZCODE_HOOK_FORCE=1` to make a manual or CI run emit anyway.

**The `Skill` tool rejects `pstack:poteto-mode` with `Unknown skill`.** The cause is unknown. Read the SKILL.md straight from the plugin cache instead, highest version first. The path is `~/.zcode/cli/plugins/cache/pstack-claude/pstack/<version>/skills/poteto-mode/SKILL.md`.

**The session-start routing mandate is missing.** Look for the hook in the log:

```sh
grep 'SessionStart' ~/.zcode/cli/log/zcode-*.jsonl | tail
```

A plugin update can re-enable pstack's own hook. `node scripts/disable-upstream-hook.mjs --check` exits 1 when that happened. Re-run the script without the flag, as Disabling pstack's own hook describes.

**`~/.zcode/pstack-models.md` was hand-edited or drifted from the map.** The sheet itself says not to hand-edit it. CI fails when the sheet drifts. Regenerate it:

```sh
node scripts/render-sheet.mjs
```

**An alias in the sheet resolves to a model that no longer exists.** Edit the `aliases` layer in [`skills/pstack-zcode/references/model-map.json`](skills/pstack-zcode/references/model-map.json), then re-run `node scripts/render-sheet.mjs`.

`node scripts/check-upstream.mjs` reports its verdict in the exit code.

| Exit | Meaning |
|---|---|
| 0 | Clean |
| 2 | Upstream moved without a structural break |
| 1 | The contract broke |
| 3 | GitHub was unreachable. Retry later. |

Following upstream covers what CI does with each.

**Agents from this plugin are missing from the `Agent` tool after an install or an update.** Restart ZCode, then confirm the SessionStart hook the way Install shows.

## Retiring this plugin

If pstack starts emitting JSON from its own hook, or gains a native ZCode runtime, delete this plugin. `check-upstream.mjs` watches for the first case and reports it rather than silently passing.
