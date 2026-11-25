#!/bin/sh
# ZCode SessionStart hook for pstack.
#
# ZCode parses hook stdout as a strict JSON object and drops plain text, so this
# script emits the mandate as JSON rather than the raw Markdown that pstack's own
# claude branch prints. That difference is why pstack's hook fails on every start
# here and why this plugin exists.
#
# A SessionStart hook must never make noise or block a session, so every failure
# path below exits 0 with no output. Silence is a clean pass; a broken JSON line
# would be a failed run.
#
# Environment from ZCode: ZCODE_PLUGIN_ROOT (this plugin), ZCODE_PROJECT_DIR,
# ZCODE_SESSION_ID, plus CLAUDE_* mirrors. Missing ZCODE_PLUGIN_ROOT falls back
# to this script's own parent directory.
set -eu

: "${ZCODE_PLUGIN_ROOT:=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)}"
export LC_ALL=C

mandate="$ZCODE_PLUGIN_ROOT/hooks/session-start-zcode.md"
[ -f "$mandate" ] || exit 0

# PSTACK_SESSION_HOOK=off disables injection for a single session.
[ "${PSTACK_SESSION_HOOK:-}" = off ] && exit 0

# Drain stdin so a caller writing a payload never blocks on a full pipe. ZCode
# sends an event object here; this script does not need it, but reading it also
# keeps the hook safe to run by hand with stdin left open.
if [ ! -t 0 ]; then
  dd bs=4096 count=64 2>/dev/null >/dev/null || true
fi

# The sheet records per-role model choices. A ZCode sheet wins when present.
sheet=
for candidate in \
  "${ZCODE_CONFIG_DIR:-$HOME/.zcode}/pstack-models.md" \
  "${HOME}/.zcode/pstack-models.md"
do
  if [ -f "$candidate" ] && [ -r "$candidate" ]; then sheet=$candidate; break; fi
done

# "session hook: off" in the sheet turns injection off, as on other runtimes.
if [ -n "$sheet" ] && tr -d '\r' <"$sheet" 2>/dev/null | grep -qx 'session hook: off'; then
  exit 0
fi

# Emit the mandate plus any usable role lines. The payload uses ZCode's complete
# hookSpecificOutput shape; a top-level additionalContext is also accepted, but
# naming the event leaves no room for the runtime to guess which event it is for.
output=$(ACCESS_MANDATE="$mandate" ACCESS_SHEET="$sheet" awk '
function esc(s,    out, i, c) {
  if (!esc_ready) {
    for (i = 1; i < 32; i++) esc_ctl[sprintf("%c", i)] = 1
    esc_ctl[sprintf("%c", 127)] = 1
    delete esc_ctl["\t"]
    esc_ctl["\r"] = 1
    esc_ready = 1
  }
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "\\") out = out "\\\\"
    else if (c == "\"") out = out "\\\""
    else if (c == "\t") out = out "\\t"
    else if (c == "\r") out = out "\\r"
    else if (c == "\n") out = out "\\n"
    else if (!(c in esc_ctl)) out = out c
  }
  return out
}
function slurp(path,    line, text, first) {
  text = ""
  first = 1
  while ((getline line < path) > 0) {
    sub(/\r$/, "", line)
    text = text (first ? "" : "\n") line
    first = 0
  }
  close(path)
  return text
}
BEGIN {
  body = slurp(ENVIRON["ACCESS_MANDATE"])

  sheet = ENVIRON["ACCESS_SHEET"]
  roles = ""
  if (sheet != "") {
    while ((getline line < sheet) > 0) {
      sub(/\r$/, "", line)
      if (line ~ /^[ \t]*#/) continue
      # "session hook" and "default effort" are settings, not role lines.
      if (line ~ /^session hook:/) continue
      if (line ~ /^default effort:/) continue
      # A role line is "role: model[, model...][ @level]" with a known role.
      if (line !~ /^[a-zA-Z][a-zA-Z0-9 ,]*:[ \t]*[^ \t]/) continue
      roles = roles (roles == "" ? "" : "\n") line
    }
    close(sheet)
  }

  text = body
  if (roles != "") {
    text = text "\n\nSaved pstack role choices. Each value is an alias from pstack-zcode references/model-map.json; resolve it with scripts/resolve-model.mjs before dispatching:\n" roles
  }
  printf "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"%s\"}}\n", esc(text)
}
' 2>/dev/null) || exit 0

# Never emit a partial or empty object: a failed awk run stays silent.
[ -n "$output" ] || exit 0
printf '%s\n' "$output"
exit 0
