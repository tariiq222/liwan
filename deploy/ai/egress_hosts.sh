#!/bin/sh
# Prints the AI_EGRESS_HOSTS value for one provider, derived from the provider and an optional base URL.
#   sh ai/egress_hosts.sh <provider> [base url]        (provision.sh writes the result into deploy/.env)
# A bare hostname allows CONNECT to port 443 only; host:port allows exactly that port, which is how a local
# model server such as ollama:11434 is reached. An explicit base URL replaces the provider default, and its
# port is included whenever it is not 443.
set -eu

provider="${1:?usage: egress_hosts.sh <provider> [base url]}"
base_url="${2:-}"

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

url="$base_url"
if [ -z "$url" ]; then
  case "$provider" in
    openrouter) printf '%s\n' openrouter.ai; exit 0 ;;
    anthropic) printf '%s\n' api.anthropic.com; exit 0 ;;
    openai) printf '%s\n' api.openai.com; exit 0 ;;
    ollama) url='http://ollama:11434' ;;
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
