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

# The pinned OCA repositories (deploy/oca-addons.json) come last, after the LiwanOS addons. The image has no git;
# the pins were verified when the image was built.
oca_path=$(/opt/venv/bin/python /opt/liwan/tools/oca_addons.py path --dest /opt/oca)

exec /opt/venv/bin/python /opt/liwan/odoo_secure.py \
  --odoo-root /opt/odoo \
  "$subcommand" \
  -c /etc/odoo/odoo.conf \
  --addons-path=/opt/odoo/addons,/opt/liwan/addons,"$oca_path" \
  --data-dir=/var/lib/odoo \
  "$@"
