---
name: pstack-zcode
description: ZCode adapter for pstack. Read when running a pstack skill on ZCode and it names a Claude Code tool, subagent field, model, transcript path, or instruction file. Maps those to their ZCode equivalents and records the fields ZCode does not have.
---

# pstack on ZCode

pstack skills are written in Claude Code tool language. ZCode keeps most of those names and changes a few in ways that fail silently rather than loudly, so read this before following a pstack skill that names a tool, a subagent field, a model, or a path.

This file is the ZCode mapping. Other runtimes have their own.

## Tool actions

| pstack / Claude action | ZCode equivalent |
|---|---|
| Read a file (`Read`) | `Read`, same name and shape |
| Create, edit, delete a file (`Write` / `Edit`) | `Write` / `Edit`, same names; `ApplyPatch` also exists |
| Run a shell command (`Bash`) | `Bash`, including `run_in_background` |
| Search contents, find files (`Grep` / `Glob`) | `Grep` / `Glob` are native read-only tools. Do not fall back to `Bash` with `rg`. |
| Fetch a URL (`WebFetch`) | `WebFetch` |
| Search the web (`WebSearch`) | `WebSearch` |
| Invoke a skill (the `Skill` tool, `/command`) | `Skill` with `skill: "pstack:<name>"`; the bare name works when it does not collide, and `<plugin>:<name>` always does |
| Read a principle leaf (the **principle-<title>** skill) | A normal `Skill` call. Unlike Codex, ZCode does not hide principle leaves from the catalog. |
| Dispatch a subagent (the `Agent` / `Task` tool) | `Agent` with `description`, `prompt`, `subagent_type`, `run_in_background` |
| Dispatch N parallel subagents in one turn | N `Agent` calls in one message |
| Wait for a subagent result | Background agents notify on completion; `TaskOutput` reads one, `TaskStop` ends one |
| Continue or steer a subagent (`SendMessage`) | `SendMessage` |
| Track tasks (`TodoWrite` / `TaskCreate` / `TaskUpdate`) | `TodoWrite`, `TodoRead`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, same parameter shapes as Claude Code |
| Ask the human a fixed-choice question (`AskUserQuestion`) | `AskUserQuestion`, same shape plus an optional per-option `value` and `preview` |
| Schedule a self-paced re-invocation (`ScheduleWakeup`) | `ScheduleWakeup`, plus `CronCreate` / `CronUpdate` / `CronDelete` / `CronList` for a cadence |
| Read this workspace's session transcripts (Claude Code's `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<encoded-cwd>/`) | ZCode keeps sessions under `~/.zcode/v2/sessions` and the rollouts and artifacts beside it. Resolve the current one with `ListSessions` / `ReadSession` rather than by guessing a filename. Never read another project's sessions. |

## Subagent policy

poteto-mode's Subagents section sets Claude defaults that map onto ZCode only partly. What carries over and what does not:

- `subagent_type` resolves to the same plugin-namespaced names: `pstack:poteto-agent`, `pstack:comment-sicko`, `pstack:thermo-nuclear-review-subagent`, `pstack:thermo-nuclear-code-quality-review-subagent`. Built-in types are `general-purpose` and `Explore` only. There is no `Plan` type.
- This plugin also registers `pstack-zcode:poteto-agent`, which is the same role with ZCode paths and its own model and thought level. Use it when a delegate should run on a tier other than the session's.
- **`model` and `effort` are not `Agent` parameters on ZCode.** A call cannot pick a model or a reasoning level. Both come from the agent definition's frontmatter (`model:`, `thoughtLevel:`) or from the settings-level overrides `pluginAgentModelSelectionOverrides` and `pluginAgentThoughtLevelOverrides`. Do not write `effort:` on an `Agent` call; it is ignored.
- **`isolation: "worktree"` does not exist.** Use the `EnterWorktree` / `ExitWorktree` tools, which switch the session's worktree, or create one with `git worktree add` and name its path in the brief.
- **`readonly: true` does not exist.** Use the `Explore` subagent type, or give the agent a `tools:` allowlist without `Write` / `Edit`, or say in the brief that it must not change files. An `Explore` agent keeps `Bash`, so the brief still has to forbid writes.
- `run_in_background` works and completion arrives as a notification. **`resume` does not exist**: spawn a fresh agent and paste the earlier report into its brief, which is poteto-mode's own default anyway.
- Keep the rest of the policy unchanged. Pass file pointers, not inlined context. Review every subagent's diff yourself.

## Model names

pstack names roles and tiers, never concrete models. Claude Code resolves those to `opus`/`fable`/`sonnet`/`haiku`; ZCode resolves none of them. The translation lives in exactly one place, [model-map.json](model-map.json). Read it rather than hard-coding an ID from this prose.

The map has two layers, because pstack's own sheet parser accepts only `[a-z0-9][a-z0-9.-]*` as a model entry while a ZCode ID holds a colon and a slash:

- `aliases` turns a sheet-safe alias into a real ZCode ID (`glm-5.4` -> `account:bigmodel-individual-coding-plan/GLM-5.4`).
- `tiers` and `roles` assign pstack's role names to those aliases.

So the sheet at `~/.zcode/pstack-models.md` holds aliases, and anything that dispatches a subagent resolves them:

```sh
node scripts/render-sheet.mjs              # regenerate the sheet from the map
node scripts/resolve-model.mjs --role hillclimb   # alias -> real ZCode ID
node scripts/resolve-model.mjs glm-5.4     # one alias
```

The ladder on this machine, cheapest and fastest first:

| pstack tier | Alias | ZCode model | Why |
|---|---|---|---|
| `worker` | `deepseek-flash` | `new-provider-2/deepseek-flash` | Fastest and cheapest. Bulk edits, mechanical fan-out, verification passes. |
| `default` | `glm-5.3` | `account:bigmodel-individual-coding-plan/GLM-5.3` | Balanced, for bug fixes, perf work, judgment and prose. |
| `strongest` | `glm-5.4` | `account:bigmodel-individual-coding-plan/GLM-5.4` | Escalation only, for design and contested decisions. |
| `panel` | three aliases | `glm-5.4`, `gpt-6-luna`, `deepseek-flash` | Three reachable models, so a four-seat panel is not model-diverse here. Use these three and say the diversity was reduced. |

Route by cost, not by habit. Anything mechanical, repetitive, or already specified goes to `worker`: a `deepseek-flash` turn costs a fraction of a `glm-5.4` turn and finishes sooner, so a queue of small edits belongs there. Reserve `default` for work needing real judgment that is not a design decision. Reach for `strongest` only when `default` has already failed, or when the user named it.

Do not add a model ID outside `model-map.json`. If a role needs one, add an alias there and regenerate; the CI check fails when the sheet and the map disagree.

Reasoning level is `thoughtLevel` in an agent definition and `reasoningLevel` in a model selection. The providers reachable here accept `low`, `medium` and `high` only: pstack's `xhigh` and `max` clamp to `high`, and `model-map.json` records that clamp so an upstream skill asking for `max` still yields a valid level.

## Session routing hook

`pstack-zcode` ships the SessionStart hook that injects poteto-mode's routing mandate. It is separate from pstack's own hook because ZCode parses hook stdout as strict JSON and pstack's `claude` branch prints plain Markdown, which ZCode drops: pstack's own hook therefore fails on every start here. If pstack ever learns to emit JSON, this plugin's hook can be removed.

`session hook: off` in the sheet disables injection, as does `PSTACK_SESSION_HOOK=off` for a single session.

## Driver and bundled skills pstack references

| Skill or driver named in pstack | On ZCode |
|---|---|
| `run` (drive a CLI/TUI to see a change work) | No equivalent skill. Run the app with `Bash` and observe its real output. |
| Project UI driver, `verify` at `.claude/skills/verify/` | Write the same project skill under `.zcode/skills/verify/` with `/create-verification-skill`; ZCode discovers it there. |
| `plugin-dev:skill-development` | Not installed. Use the `skill-creator` skill when present. |
| `loop` (recurring self-paced re-invocation, used by `babysit`) | `CronCreate` for a cadence, or re-run the step yourself each turn. |

## Per-skill notes

| Skill | On ZCode |
|---|---|
| `setup-pstack` | Write the sheet to `~/.zcode/pstack-models.md`. List models with `ListModels`, and use the IDs under Model names above. `default effort` becomes a `thoughtLevel`. |
| `reflect` | ZCode stores sessions under `~/.zcode/v2/sessions`. Find the current conversation with `ListSessions` and read it with `ReadSession`; do not reconstruct a Claude path. Never edit the installed plugin under `~/.zcode/cli/plugins/cache/`. |
| `recall` | Search this workspace's ZCode sessions, not `~/.claude/projects`. |
| `show-me-your-work` | Check the log against this session's own records, resolved through `ReadSession`, not a rollout filename. |
| `no-comments` | `pstack:comment-sicko` resolves; a `model` override has to come from the agent definition, not the call. |
| `thermos` | Both `pstack:thermo-nuclear-*` reviewers resolve. Dispatch both in one message for parallel review. |
| `babysit` | `loop` maps to `CronCreate`; `AskUserQuestion` is native. |
| `create-verification-skill` | Write the generated skill to `.zcode/skills/<area>/`, not `.claude/skills/`. |
| `maintain-verification-skill`, `create-formal-verification-skill`, `maintain-formal-verification-skill` | Project skills live under `.zcode/skills/` here. |
| `why` | List MCP servers from `~/.zcode/cli/config.json` under `mcp.servers`, not `.mcp.json`. |
| `arena`, `interrogate` | Fan out with `Agent` calls in one message. Only three models resolve here; see Model names. |
| `hillclimb`, `autonomous-run`, `multi-phase-plan` | ZCode has native multi-agent workflows (`CreateWorkflow`, `RunWorkflow`). Where a playbook's own orchestration is the point, the `dwf-run` skill documents the ZCode form. |
| `pause-safely`, `session-pickup` | ZCode checkpoints via `/rewind` are a real safety net here; prefer them over a hand-written resume file. |

## Instructions file

Where a pstack skill says "your instructions file", on ZCode that is `AGENTS.md`: `~/.zcode/AGENTS.md` at user scope and `<repo>/AGENTS.md` at workspace scope. `CLAUDE.md` is not read here.
