#!/usr/bin/env bash
# CI stage: build every production image; install the release in the Odoo one and assert it is hardened;
# smoke-check the others without external services; record each image digest.
# The Postgres service container is published on the runner, so the containers use the host network.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_PORT:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}"
IMAGE="webvue-odoo:ci-${GITHUB_RUN_ID}"
IMAGE_CONTAINER="webvue-ci-${GITHUB_RUN_ID}-image"
CHECK_CONTAINER="webvue-ci-${GITHUB_RUN_ID}-check"
IMAGE_ROOT="$(mktemp -d)"
# name:Dockerfile:context for every production image besides Odoo (built, smoke-checked, digest recorded).
OTHER_IMAGES=(
  "web:apps/web/Dockerfile:."
  "vendor-admin:apps/vendor-admin/Dockerfile:."
  "ai-service:apps/ai-service/Dockerfile:apps/ai-service"
  "proxy:deploy/proxy/Dockerfile:."
  "guard:deploy/shared/Dockerfile:."
)
tag_of() { printf 'webvue-%s:ci-%s' "$1" "$GITHUB_RUN_ID"; }
container_of() { printf 'webvue-ci-%s-%s' "$GITHUB_RUN_ID" "$1"; }
cleanup() {
  docker rm -fv "$IMAGE_CONTAINER" "$CHECK_CONTAINER" >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
  for entry in "${OTHER_IMAGES[@]}"; do
    docker rm -fv "$(container_of "${entry%%:*}")" >/dev/null 2>&1 || true
    docker rmi -f "$(tag_of "${entry%%:*}")" >/dev/null 2>&1 || true
  done
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

# Start a long-running image detached, assert its user is not root, and wait (bounded) for a probe run inside it.
# The probe runs in the container, so no host port is published and parallel runs cannot collide.
smoke_started() {
  local name="$1" container probe_status
  shift
  container="$(container_of "$name")"
  docker run -d --name "$container" "$@" "$(tag_of "$name")" >/dev/null
  for _ in $(seq 1 30); do
    if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != true ]; then
      echo "$name smoke failed: container exited" >&2; docker logs "$container" >&2; return 1
    fi
    if docker exec "$container" "${PROBE[@]}" >/dev/null 2>&1; then
      [ "$(docker exec "$container" id -u)" != 0 ] || { echo "$name runs as root" >&2; return 1; }
      return 0
    fi
    sleep 2
  done
  echo "$name smoke failed: no answer within 60s" >&2; docker logs "$container" >&2; return 1
}
HTTP_PROBE='fetch(process.argv[1]).then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))'
for entry in "${OTHER_IMAGES[@]}"; do
  IFS=: read -r name dockerfile context <<< "$entry"
  docker build -f "$dockerfile" -t "$(tag_of "$name")" "$context"
done

# web: the Nitro server serves the public login page without Odoo (rendered without an upstream call).
PROBE=(node -e "$HTTP_PROBE" http://127.0.0.1:3000/login)
smoke_started web -e NUXT_ODOO_URL=http://127.0.0.1:1
# vendor-admin: every page asks the control plane for a session first (503 without it), so probe a built static
# asset that Nitro serves from .output/public.
PROBE=(node -e "$HTTP_PROBE" http://127.0.0.1:3100/robots.txt)
smoke_started vendor-admin
# ai-service: /healthz answers (ollama needs no key; in-memory state needs no database; no model call is made).
PROBE=(python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8600/healthz', timeout=2)")
smoke_started ai-service -e AI_PROVIDER=ollama -e AI_MODEL=ci-smoke -e AI_ALLOW_MEMORY_STATE=true
# guard: starts in shared mode with a deny-all bootstrap registry, and its own healthcheck answers.
printf '%s\n' '{"schemaVersion":1,"snapshotRevision":0,"targets":[]}' > "$IMAGE_ROOT/registry.json"
chmod 644 "$IMAGE_ROOT/registry.json"
PROBE=(node deploy/shared/healthcheck.mjs)
# Throwaway per-run values for the guard's required token and session key.
PROXY_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
SESSION_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
smoke_started guard -v "$IMAGE_ROOT/registry.json:/etc/webvue/registry.json:ro" \
  -e WEBVUE_TENANCY_MODE=shared -e WEBVUE_TENANT_REGISTRY_PATH=/etc/webvue/registry.json \
  -e "WEBVUE_SHARED_PROXY_TOKEN=$PROXY_TOKEN" \
  -e "WEBVUE_SESSION_KEYS={\"k1\":\"$SESSION_KEY\"}" -e WEBVUE_SESSION_ACTIVE_KID=k1 \
  -e WEBVUE_GUARD_ODOO_URL=http://127.0.0.1:1 -e WEBVUE_GUARD_WEB_URL=http://127.0.0.1:1
# The guard denies an unknown host with 403 (a 5xx or no answer would be a broken guard).
[ "$(docker exec "$(container_of guard)" node -e "fetch('http://127.0.0.1:8080/',{headers:{host:'unknown.invalid'}}).then(r => console.log(r.status))")" = 403 ]
# proxy: both Caddyfiles validate against the image's Caddy, which has the rate-limit module compiled in.
# The official Caddy image has no USER and Caddy binds ports 80/443, so root is the image's documented base.
for caddyfile in deploy/Caddyfile deploy/shared/Caddyfile; do
  docker run --rm --name "$(container_of proxy)" -e DOMAIN=ci.invalid -v "$PWD/$caddyfile:/etc/caddy/Caddyfile:ro" \
    "$(tag_of proxy)" caddy validate --config /etc/caddy/Caddyfile
done
docker run --rm --name "$(container_of proxy)" "$(tag_of proxy)" sh -c 'caddy list-modules | grep -q http.handlers.rate_limit'

# Record every image's tag and content digest.
summary() {
  printf '| Image | Digest |\n| --- | --- |\n'
  for image in "$IMAGE" "$(tag_of web)" "$(tag_of vendor-admin)" "$(tag_of ai-service)" "$(tag_of proxy)" "$(tag_of guard)"; do
    printf '| %s | %s |\n' "$image" "$(docker image inspect --format '{{.Id}}' "$image")"
  done
}
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then summary >> "$GITHUB_STEP_SUMMARY"; else summary; fi
