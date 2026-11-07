#!/bin/sh
# Prints the AI_EGRESS_HOSTS value for the deployment's providers: the chat provider, and the embedding provider when one is set.
#   sh ai/egress_hosts.sh <provider> [base url] [embedding provider] [embedding base url]
#                                                      (provision.sh writes the result into deploy/.env)
# A bare hostname allows CONNECT to port 443 only; host:port allows exactly that port, which is how a local
# model server such as ollama:11434 is reached. An explicit base URL replaces the provider default, and its
# port is included whenever it is not 443. The anthropic provider ignores AI_BASE_URL in the service, so it
# always prints api.anthropic.com; openai_compatible has no default and needs its base URL. The embedding provider is
# openai (api.openai.com, or its base URL) or ollama (ollama:11434, or its base URL); when its host is the chat
# provider's the list names it once. Tenants' own keys are not listed here: ai-egress learns their hosts from the
# ai service at run time.
set -eu

provider="${1:?usage: egress_hosts.sh <provider> [base url] [embedding provider] [embedding base url]}"
base_url="${2:-}"
embedding_provider="${3:-}"
embedding_base_url="${4:-}"

fail() {
  echo "egress_hosts: $1" >&2
  exit 1
}

is_host() {
  printf '%s' "$1" | grep -Eqx '[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?'
}

is_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "${#1}" -le 5 ] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# The host item (host or host:port) of one provider's endpoint.
host_of() {
  provider="$1"
  base_url="$2"
  # The anthropic provider always uses its own endpoint, whatever base URL is configured.
  if [ "$provider" = anthropic ]; then
    printf '%s\n' api.anthropic.com
    return 0
  fi

  url="$base_url"
  if [ -z "$url" ]; then
    case "$provider" in
      openrouter) printf '%s\n' openrouter.ai; return 0 ;;
      openai) printf '%s\n' api.openai.com; return 0 ;;
      ollama) url='http://ollama:11434' ;;
      openai_compatible) fail "provider openai_compatible needs a base URL" ;;
      *) fail "unknown AI provider '$provider'" ;;
    esac
  fi
  scheme='https'
  case "$url" in
    *://*) scheme="${url%%://*}"; rest="${url#*://}" ;;
    *) rest="$url" ;;
  esac
  authority="${rest%%/*}"
  authority="${authority%%\?*}"
  authority="${authority%%\#*}"
  authority="${authority##*@}"
  host="${authority%%:*}"
  port=''
  case "$authority" in
    *:*) port="${authority##*:}" ;;
  esac
  if [ -z "$port" ]; then
    case "$scheme" in
      https) port=443 ;;
      http) port=80 ;;
      *) fail "unsupported base URL scheme '$scheme'" ;;
    esac
  fi

  is_host "$host" || fail "'$url' does not name a lowercase host"
  is_port "$port" || fail "'$url' does not name a valid port"
  if [ "$port" = 443 ]; then
    printf '%s\n' "$host"
  else
    printf '%s:%s\n' "$host" "$port"
  fi
}

chat_host="$(host_of "$provider" "$base_url")"
if [ -z "$embedding_provider" ]; then
  printf '%s\n' "$chat_host"
  exit 0
fi
case "$embedding_provider" in
  openai|ollama) ;;
  *) fail "unknown embedding provider '$embedding_provider'" ;;
esac
embedding_host="$(host_of "$embedding_provider" "$embedding_base_url")"
if [ "$embedding_host" = "$chat_host" ]; then
  printf '%s\n' "$chat_host"
else
  printf '%s,%s\n' "$chat_host" "$embedding_host"
fi
