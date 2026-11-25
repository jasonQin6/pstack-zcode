#!/bin/sh
# ZCode SessionStart hook for pstack.
#
# ZCode parses hook stdout as a strict JSON object and drops plain text, so this
# script emits {"additionalContext": "<mandate>"} rather than the raw Markdown
# that pstack's own claude branch prints. Anything unexpected means emitting
# nothing: empty stdout is a clean pass, while malformed JSON is a failed run.
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

# The sheet records per-role model choices. A ZCode sheet wins when present.
sheet=
for candidate in \
  "${ZCODE_CONFIG_DIR:-$HOME/.zcode}/pstack-models.md" \
  "${HOME}/.zcode/pstack-models.md"
do
  if [ -f "$candidate" ] && [ -r "$candidate" ]; then sheet=$candidate; break; fi
done

# "session hook: off" in the sheet turns injection off, as on other runtimes.
if [ -n "$sheet" ] && tr -d '\r' <"$sheet" | grep -qx 'session hook: off'; then
  exit 0
fi

# Emit the mandate plus any usable role lines as one JSON object.
ACCESS_MANDATE="$mandate" ACCESS_SHEET="$sheet" awk '
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
  if (roles != "") text = text "\n\nSaved pstack role choices, which override a role default when the named model resolves on this runtime:\n" roles
  printf "{\"additionalContext\": \"%s\"}\n", esc(text)
}
' </dev/null
