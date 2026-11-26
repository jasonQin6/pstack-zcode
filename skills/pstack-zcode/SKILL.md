---
name: pstack-zcode
description: Use when running a pstack skill on ZCode and it names a Claude Code tool, subagent field, model, transcript path, or instruction file. Maps each to its ZCode equivalent and names the fields ZCode lacks (model/thoughtLevel/isolation/readonly on a subagent call). Also covers how pstack's role tiers and model aliases reach a ZCode subagent through ZCode's agent record.
---

# pstack on ZCode

Read [references/zcode-tools.md](references/zcode-tools.md) in full before following the pstack skill you are running. It maps every Claude Code tool, subagent field, model, and path that a pstack skill names onto ZCode, and it records what ZCode does not have.

The three differences that bite first:

- A subagent's reasoning level is `thoughtLevel`, not `effort`.
- An `Agent` call takes no `model`, `effort`, `isolation`, `readonly`, or `resume`. Model and level live in ZCode's agent record.
- Claude family names (`opus`, `sonnet`, `fable`, `haiku`) do not resolve here. The aliases in [references/model-map.json](references/model-map.json) are the translation.

pstack's own SessionStart hook prints plain Markdown, which ZCode drops, so the `pstack-zcode` plugin supplies a hook that emits the JSON ZCode requires. If the ZCode context and the saved role choices are missing at session start, check that this plugin is enabled.
