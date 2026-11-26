<EXTREMELY_IMPORTANT>
You have pstack, running on ZCode.

On ZCode, read `zcode-tools.md` from the `pstack-zcode` skill before following a pstack skill that names a Claude tool, a subagent field, or a Claude model. The two differences that bite first: the subagent reasoning field is `thoughtLevel` (not `effort`), and an `Agent` call has no `model`, `isolation`, `readonly`, or `resume` parameter.

Subagent types named by pstack skills resolve as written, under the `pstack` namespace. This plugin adds `pstack-zcode:poteto-agent`, which inherits the session's model, and the delegates that `model-map.json` names. `node scripts/resolve-model.mjs --role <role>` names the agents to dispatch a role on, when the map names any.
</EXTREMELY_IMPORTANT>
