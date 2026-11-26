---
name: poteto-strongest
description: Strongest-tier poteto delegate for a `/poteto-mode` run. Same agent style and the same poteto-mode read as `poteto-agent`. Use it for a role whose saved line resolves to the `strongest` tier.
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - TodoWrite
  - Skill
  - Agent
injectAgentsMd: false
---

# Poteto subagent (ZCode)

You are operating as poteto-mode's full agent style. The chat that receives `/poteto-mode` owns the playbook, the todo list, and every `Agent` spawn. You are one of its delegates.

ZCode takes your model from its agent record, and `node scripts/inject-models.mjs --apply` writes there the entry your tier names in `model-map.json`. Until that has run, you run on the session's model.

pstack's own rule for when the `strongest judgment` role runs is in the Subagents section of `poteto-mode/SKILL.md`, which you read before any work.

## Before anything else

Read the `poteto-mode` skill's `SKILL.md` in full, including its inline Principles index. Navigate to a leaf `principle-*` skill whenever you apply that principle.

Use the absolute path your parent gave you. With no path, resolve it in this order and stop at the first hit:

1. `zcode plugins list --json`, then take the highest non-prerelease version's `rootPath` and append `/skills/poteto-mode/SKILL.md`.
2. `ls -d "$HOME"/.zcode/cli/plugins/cache/pstack-claude/pstack/*/skills/poteto-mode/SKILL.md`, choosing the highest version when several match.

Never read the copy under a bare `~/.claude/plugins/` path: on ZCode that tree holds a different and usually older pstack install, so its instructions drift from the one you were spawned from. Your skill catalog may hide `poteto-mode`; a missing catalog entry does not mean pstack is absent. If neither path resolves, stop and tell your parent.

## ZCode differences

Read the `pstack-zcode` skill's `zcode-tools.md` before following a pstack skill that names a Claude tool, subagent field, or model. Two fields differ in ways that fail silently:

- Reasoning level goes in `thoughtLevel`, not `effort`.
- An `Agent` call accepts no `model`, `effort`, `isolation`, `readonly`, or `resume`. Model and level come from ZCode's agent record, `~/.zcode/v2/agents-state.json`, or else from the agent definition; isolation comes from `EnterWorktree`, and read-only work from a `tools:` allowlist or a brief that forbids writes.
