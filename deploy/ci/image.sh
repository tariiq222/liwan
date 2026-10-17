#!/usr/bin/env bash
# CI stage: build the Odoo image, install the release in it, and assert it is hardened.
# The Postgres service container is published on the runner, so the containers use the host network.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_PORT:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}"
IMAGE="webvue-odoo:ci-${GITHUB_RUN_ID}"
IMAGE_CONTAINER="webvue-ci-${GITHUB_RUN_ID}-image"
CHECK_CONTAINER="webvue-ci-${GITHUB_RUN_ID}-check"
IMAGE_ROOT="$(mktemp -d)"
cleanup() {
  docker rm -fv "$IMAGE_CONTAINER" "$CHECK_CONTAINER" >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$IMAGE_ROOT"
}
trap cleanup EXIT
docker info
docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" --build-arg WEBVUE_REVISION="${GITHUB_SHA:0:12}" -t "$IMAGE" .
SCRATCH_DB="webvue_image_scratch"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode non_saas --output "$IMAGE_ROOT/classification.json"
printf '%s\n' '[options]' 'db_host = 127.0.0.1' "db_port = $PGPORT" "db_user = $PGUSER" "db_password = $PGPASSWORD" 'list_db = False' > "$IMAGE_ROOT/odoo.conf"
chmod 644 "$IMAGE_ROOT/odoo.conf" "$IMAGE_ROOT/classification.json"
docker run --rm --name "$IMAGE_CONTAINER" --network host -v "$IMAGE_ROOT/odoo.conf:/etc/odoo/odoo.conf:ro" \
  -v "$IMAGE_ROOT/classification.json:/run/webvue/classification.json:ro" \
  -e WEBVUE_COMMERCIAL_CONFIG=/run/webvue/classification.json "$IMAGE" \
  -d "$SCRATCH_DB" -i "$MODULES" --without-demo=all --http-port="$ODOO_PORT" --stop-after-init
docker run --rm --name "$CHECK_CONTAINER" --entrypoint sh "$IMAGE" -c 'test ! -w /opt/webvue/addons && test "$(id -u)" = 10001 && ! command -v git'
