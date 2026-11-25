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

## Model tiering

pstack names roles and tiers, never models. This adapter keeps that abstraction and owns the only translation, in [`skills/pstack-zcode/references/model-map.json`](skills/pstack-zcode/references/model-map.json):

| pstack tier | ZCode model | Use it for |
|---|---|---|
| `worker` | `deepseek-flash` | Fastest and cheapest: bulk edits, mechanical fan-out, verification passes |
| `default` | `GLM-5.3` | Bug fixes, perf work, judgment, prose |
| `strongest` | `GLM-5.4` | Escalation: design and contested decisions |
| `panel` | `GLM-5.4`, `gpt-6-luna`, `deepseek-flash` | Arena and interrogate seats |

The sheet holds aliases rather than IDs, because pstack's own parser accepts only `[a-z0-9][a-z0-9.-]*` while a ZCode ID holds a colon and a slash. `check-sheet.sh` from pstack passes on the generated sheet:

```sh
node scripts/render-sheet.mjs                      # regenerate ~/.zcode/pstack-models.md from the map
node scripts/resolve-model.mjs --role hillclimb    # alias -> real ZCode ID
node scripts/resolve-model.mjs glm-5.4             # one alias
```

The native agent ships on `worker` (`deepseek-flash` at `medium`), which is the cheapest tier and the right default for delegated mechanical work. To put a different tier behind it without editing the agent, override in `~/.zcode/cli/config.json`:

```json
{
  "pluginAgentModelSelectionOverrides": {
    "pstack-zcode:poteto-agent": { "model": "new-provider-2/group/gpt-6-luna", "options": { "reasoningLevel": "high" } }
  }
}
```

CI fails when the rendered sheet drifts from the map, or when the agent's model no longer matches the `worker` tier.

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

## Retiring this plugin

If pstack starts emitting JSON from its own hook, or gains a native ZCode runtime, delete this plugin. `check-upstream.mjs` watches for the first case and reports it rather than silently passing.
