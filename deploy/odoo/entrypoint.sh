#!/bin/sh
# deploy/odoo/entrypoint.sh — every start goes through the guarded launcher.
set -eu

# Odoo inspects argv[1] to select its CLI command. Keep the command first so
# shell invocations used for provisioning are dispatched correctly, while
# ordinary starts default to the server command.
subcommand=server
case "${1:-}" in
  shell|server)
    subcommand=$1
    shift
    ;;
esac

exec /opt/venv/bin/python /opt/nasq/odoo_secure.py \
  --odoo-root /opt/odoo \
  "$subcommand" \
  -c /etc/odoo/odoo.conf \
  --addons-path=/opt/odoo/addons,/opt/nasq/addons \
  --data-dir=/var/lib/odoo \
  "$@"
