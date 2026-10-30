#!/usr/bin/env bash
# PreToolUse guard for Bash. Enforces two CLAUDE.md rules that nothing else enforces:
#   1. no mutating git commands inside the Odoo checkout (it is upstream-only)
#   2. never run Odoo tests / installs against the dev DB odoo19
# The Odoo checkout is LIWAN_ODOO_SRC (default: the owner's ~/code/odoo); the LiwanOS checkout is the project dir.
# Exit 2 = block (stderr goes back to Claude). Anything else = allow.
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null || true)
cwd=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("cwd",""))' 2>/dev/null || true)
[ -n "$cmd" ] || exit 0

ODOO=${LIWAN_ODOO_SRC:-$HOME/code/odoo}
LIWAN=${CLAUDE_PROJECT_DIR:-$HOME/code/webvue}
# --- rule 2: tests against odoo19 -------------------------------------------------------
if printf '%s' "$cmd" | grep -qE -- '-d[= ]+odoo19\b' && printf '%s' "$cmd" | grep -qE -- '--test-(tags|enable|file)|(^|\s)-i[= ]'; then
  echo "BLOCKED: odoo19 is the dev database. Run tests/installs against a scratch database (docs/agents/odoo-rules.md); use '-d odoo19 -u <addon> --no-http --stop-after-init' only to load changes." >&2
  exit 2
fi
# --- rule 1: mutating git in the Odoo checkout ------------------------------------------
if printf '%s' "$cmd" | grep -qE '(^|[;&|]\s*|\s)git\s+(-C\s+\S+\s+)?(add|commit|checkout|switch|reset|stash|rebase|merge|pull|push|clean|tag|restore|cherry-pick|am|apply|rm|mv|branch\s+-[dDm])\b'; then
  # explicit -C to the LiwanOS checkout is fine
  if printf '%s' "$cmd" | grep -qF "git -C $LIWAN"; then exit 0; fi
  target_is_odoo=0
  case "$cwd" in "$ODOO"|"$ODOO"/*) target_is_odoo=1;; esac
  printf '%s' "$cmd" | grep -qE "cd\s+($ODOO|~/code/odoo)(\s|;|&|$)" && target_is_odoo=1
  printf '%s' "$cmd" | grep -qE "git\s+-C\s+($ODOO|~/code/odoo)(\s|/)" && target_is_odoo=1
  printf '%s' "$cmd" | grep -qF "cd $LIWAN" && target_is_odoo=0
  if [ "$target_is_odoo" = 1 ]; then
    echo "BLOCKED: $ODOO is the upstream Odoo checkout and must stay untouched. Product work lives in $LIWAN — run git there (cd $LIWAN && git ... or git -C $LIWAN ...)." >&2
    exit 2
  fi
fi
exit 0
