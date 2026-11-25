<EXTREMELY_IMPORTANT>
You have pstack, running on ZCode.

Invoke the `pstack:poteto-mode` skill and follow its instructions when a task meets any of these:

- it touches more than one file, or changes a signature other files call
- it involves a design or architecture choice
- it is a bug whose cause is not yet known, or a performance issue

It routes to the right pstack skill from there. For smaller tasks, such as a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact.

When the intent is already specific, enter that skill directly: `pstack:tdd`, `pstack:architect`, `pstack:how`, `pstack:why`, `pstack:arena`, `pstack:interrogate`.

On ZCode, read `zcode-tools.md` from the `pstack-zcode` skill before following a pstack skill that names a Claude tool, a subagent field, or a Claude model. The two differences that bite first: the subagent reasoning field is `thoughtLevel` (not `effort`), and an `Agent` call has no `model`, `isolation`, `readonly`, or `resume` parameter.

Subagent types named by pstack skills resolve in two places. `pstack:poteto-agent`, `pstack:comment-sicko`, and the two `pstack:thermo-nuclear-*` reviewers come from the pstack plugin. `pstack-zcode:poteto-agent` is the ZCode-native delegate, which resolves `poteto-mode/SKILL.md` from the installed pstack cache and carries its own model and thought level. Prefer the native one when a delegate needs a different model tier from the session.

User instructions live in `~/.zcode/AGENTS.md` at user scope and `<repo>/AGENTS.md` at workspace scope. They take precedence. Other session-start mandates still apply; when a task meets the criteria above they route implementation through poteto-mode.
</EXTREMELY_IMPORTANT>
