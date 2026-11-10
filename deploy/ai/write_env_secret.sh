#!/bin/sh
# Stores one secret in a .env file without ever printing it. The value is read from standard input.
#   printf '%s' "$value" | sh ai/write_env_secret.sh .env LIWAN_AI_USAGE_KEY
# An existing assignment of the name is replaced in place (its first line; later duplicates are dropped), otherwise the
# line is appended. Unlike ensure_secrets.sh this REPLACES a value: it is how a rotated key reaches deploy/.env.
set -eu
umask 077

env_file="${1:?usage: write_env_secret.sh <path to .env> <NAME> (value on stdin)}"
name="${2:?usage: write_env_secret.sh <path to .env> <NAME> (value on stdin)}"
case "$name" in *[!A-Z0-9_]*|'') echo "write-env-value: invalid name" >&2; exit 1 ;; esac
[ -f "$env_file" ] || { echo "write-env-value: $env_file not found" >&2; exit 1; }
value="$(cat)"
case "$value" in ''|*[!0-9a-f]*) echo "write-env-value: the value must be a non-empty lowercase hex key" >&2; exit 1 ;; esac
tmp="$env_file.tmp"
# The value travels in the environment of awk, never on its command line (a process list would show it).
SECRET_VALUE="$value" awk -v name="$name" '
  index($0, name "=") == 1 {
    if (!written) { print name "=" ENVIRON["SECRET_VALUE"]; written = 1 }
    next
  }
  { print }
  END { if (!written) print name "=" ENVIRON["SECRET_VALUE"] }
' "$env_file" > "$tmp"
mv "$tmp" "$env_file"
chmod 600 "$env_file"
