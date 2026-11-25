---
name: pstack-zcode
description: Use when running a pstack skill on ZCode and it names a Claude Code tool, subagent field, model, transcript path, or instruction file. Maps each to its ZCode equivalent and names the fields ZCode lacks (model/effort/isolation/readonly on a subagent call). Also covers why pstack's own SessionStart hook fails here and which model IDs replace Claude family names.
---

# pstack on ZCode

Read [references/zcode-tools.md](references/zcode-tools.md) in full before following the pstack skill you are running. It maps every Claude Code tool, subagent field, model, and path that a pstack skill names onto ZCode, and it records what ZCode does not have.

The three differences that bite first:

- A subagent's reasoning level is `thoughtLevel`, not `effort`.
- An `Agent` call takes no `model`, `effort`, `isolation`, `readonly`, or `resume`. Model and effort live in the agent definition or the settings-level overrides.
- Claude family names (`opus`, `sonnet`, `fable`, `haiku`) do not resolve here. Use the provider-prefixed IDs the reference lists.

pstack's own SessionStart hook prints plain Markdown, which ZCode drops, so the `pstack-zcode` plugin supplies a hook that emits the JSON ZCode requires. If poteto-mode's routing mandate ever seems absent, check that this plugin is enabled before suspecting pstack.
