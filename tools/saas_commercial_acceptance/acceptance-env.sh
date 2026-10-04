# Usage: source tools/saas_commercial_acceptance/acceptance-env.sh   (never prints secrets)
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export NASQ_SCA_DIR="$_d"
export NASQ_SCA_PROJECT=nasq-saas-commercial-acceptance
export NASQ_SCA_DOMAIN=saas.commercial.nasq.test
export NASQ_SCA_EDGE_PORT=8443
export NASQ_SCA_VENDOR_URL="https://vendor.$NASQ_SCA_DOMAIN"
export NASQ_SCA_MAILPIT_UI="http://127.0.0.1:55428"
export NASQ_SCA_MAILPIT_SMTP_PORT=55427
export NASQ_SCA_CONTROL_DB_PORT=55449
export NASQ_SCA_STATE_DIR="$_d/.state/$NASQ_SCA_PROJECT"
export NASQ_SCA_CA="$NASQ_SCA_STATE_DIR/caddy-root.crt"
export NASQ_PAYMENT_PROVIDER=simulator NASQ_MAIL_MODE=smtp
if [ -r "$_d/.secrets/customer_commercial_issuer" ]; then
  export CUSTOMER_COMMERCIAL_ISSUER="$(cat "$_d/.secrets/customer_commercial_issuer")"
  export CUSTOMER_COMMERCIAL_SERVICE_KEY="$(cat "$_d/.secrets/customer_commercial_service_key")"
  export CONTROL_SERVICE_KEY="$(cat "$_d/.secrets/control_service_key")"
fi
# curl helper: portless Host, mapped to the 8443 edge listener.
sca_curl() { curl --cacert "$NASQ_SCA_CA" --connect-to "::127.0.0.1:8443" "$@"; }

# Opt-in only: does not change any running stack or its compose environment.
sca_load_moyasar() {
  local _sca_flags="$-" _sca_result=0
  [ -r "$NASQ_SCA_DIR/.secrets/moyasar.env" ] || return 1
  # Keep sourced assignments out of shell traces, then restore caller options.
  set +x
  set -a
  . "$NASQ_SCA_DIR/.secrets/moyasar.env" || _sca_result=$?
  case "$_sca_flags" in *a*) ;; *) set +a ;; esac
  case "$_sca_flags" in *x*) set -x ;; esac
  return "$_sca_result"
}
