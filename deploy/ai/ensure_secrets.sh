#!/bin/sh
# Generates the deployment secrets the AI service needs, into the given .env file, once.
#   sh ai/ensure_secrets.sh .env        (provision.sh runs this from deploy/)
# A name without a non-empty value gets its first value (`<openssl rand -hex 32>` unless stated): an existing
# empty assignment is replaced in place, otherwise the line is appended. An existing value is never touched or
# rotated: rotating the service token cuts the web server off from the AI service until both restart together,
# and the key-encryption secret is rotated only by adding a new id (deploy/OPERATIONS.md).
# No value is ever printed.
set -eu
# The temporary file holds the secrets too: create everything owner-only.
umask 077

env_file="${1:?usage: ensure_secrets.sh <path to .env>}"
[ -f "$env_file" ] || { echo "ensure_secrets: $env_file not found" >&2; exit 1; }

ensure_secret() {
  name="$1"
  first_value="${2:-}"
  count="$(grep -c "^${name}=" "$env_file" || true)"
  current="$(sed -n "s/^${name}=//p" "$env_file" | sed '/^$/d' | head -n 1)"
  # Already provisioned exactly once: leave the file byte-for-byte as it is.
  if [ "$count" = 1 ] && [ -n "$current" ]; then
    return 0
  fi
  value="${current:-${first_value:-$(openssl rand -hex 32)}}"
  awk -v name="$name" -v value="$value" '
    index($0, name "=") == 1 {
      if (!written) { print name "=" value; written = 1 }
      next
    }
    { print }
    END { if (!written) print name "=" value }
  ' "$env_file" > "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
}

ensure_secret AI_SERVICE_TOKEN
# The web server's own key for the AI tokens that carry mobile numbers and emails past the provider; never given to ai.
ensure_secret AI_TOKEN_KEY
ensure_secret AI_DB_PASSWORD
# Tenant provider keys are encrypted under a versioned key-encryption value (id k1 first, more pairs after a rotation).
ensure_secret AI_KEY_ENCRYPTION_KEYS "k1:$(openssl rand -hex 32)"
ensure_secret AI_KEY_ENCRYPTION_KEY_ID k1
chmod 600 "$env_file"
