#!/usr/bin/env bash
# CI stage: build every production image; install the release in the Odoo one and assert it is hardened;
# smoke-check the others without external services; scan every image for vulnerabilities; record each image digest.
# The Postgres service container is published on the runner, so the containers use the host network.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_PORT:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}"
IMAGE="liwan-odoo:ci-${GITHUB_RUN_ID}"
IMAGE_CONTAINER="liwan-ci-${GITHUB_RUN_ID}-image"
CHECK_CONTAINER="liwan-ci-${GITHUB_RUN_ID}-check"
IMAGE_ROOT="$(mktemp -d)"
# Trivy 0.75.0 (published 2026-10-01), pinned by tag and by the digest of its multi-arch index.
TRIVY_IMAGE="aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa"
TRIVY_CACHE="liwan-ci-${GITHUB_RUN_ID}-trivy-cache"
# name:Dockerfile:context for every production image besides Odoo (built, smoke-checked, digest recorded).
OTHER_IMAGES=(
  "web:apps/web/Dockerfile:."
  "vendor-admin:apps/vendor-admin/Dockerfile:."
  "ai-service:apps/ai-service/Dockerfile:apps/ai-service"
  "proxy:deploy/proxy/Dockerfile:."
  "guard:deploy/shared/Dockerfile:."
)
tag_of() { printf 'liwan-%s:ci-%s' "$1" "$GITHUB_RUN_ID"; }
container_of() { printf 'liwan-ci-%s-%s' "$GITHUB_RUN_ID" "$1"; }
cleanup() {
  docker rm -fv "$IMAGE_CONTAINER" "$CHECK_CONTAINER" "$(container_of trivy)" >/dev/null 2>&1 || true
  docker volume rm -f "$TRIVY_CACHE" >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
  for entry in "${OTHER_IMAGES[@]}"; do
    docker rm -fv "$(container_of "${entry%%:*}")" >/dev/null 2>&1 || true
    docker rmi -f "$(tag_of "${entry%%:*}")" >/dev/null 2>&1 || true
  done
  docker rm -fv "$(container_of proxy)-hardened" >/dev/null 2>&1 || true
  rm -rf "$IMAGE_ROOT"
}
trap cleanup EXIT
docker info
docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" --build-arg LIWAN_REVISION="${GITHUB_SHA:0:12}" -t "$IMAGE" .
SCRATCH_DB="liwan_image_scratch"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode non_saas --output "$IMAGE_ROOT/classification.json"
printf '%s\n' '[options]' 'db_host = 127.0.0.1' "db_port = $PGPORT" "db_user = $PGUSER" "db_password = $PGPASSWORD" 'list_db = False' > "$IMAGE_ROOT/odoo.conf"
chmod 644 "$IMAGE_ROOT/odoo.conf" "$IMAGE_ROOT/classification.json"
docker run --rm --name "$IMAGE_CONTAINER" --network host -v "$IMAGE_ROOT/odoo.conf:/etc/odoo/odoo.conf:ro" \
  -v "$IMAGE_ROOT/classification.json:/run/liwan/classification.json:ro" \
  -e LIWAN_COMMERCIAL_CONFIG=/run/liwan/classification.json "$IMAGE" \
  -d "$SCRATCH_DB" -i "$MODULES" --without-demo=all --http-port="$ODOO_PORT" --stop-after-init
docker run --rm --name "$CHECK_CONTAINER" --entrypoint sh "$IMAGE" -c 'test ! -w /opt/liwan/addons && test "$(id -u)" = 10001 && ! command -v git'

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
smoke_started guard -v "$IMAGE_ROOT/registry.json:/etc/liwan/registry.json:ro" \
  -e LIWAN_TENANCY_MODE=shared -e LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json \
  -e "LIWAN_SHARED_PROXY_TOKEN=$PROXY_TOKEN" \
  -e "LIWAN_SESSION_KEYS={\"k1\":\"$SESSION_KEY\"}" -e LIWAN_SESSION_ACTIVE_KID=k1 \
  -e LIWAN_GUARD_ODOO_URL=http://127.0.0.1:1 -e LIWAN_GUARD_WEB_URL=http://127.0.0.1:1
# The guard denies an unknown host with 403 (a 5xx or no answer would be a broken guard).
[ "$(docker exec "$(container_of guard)" node -e "fetch('http://127.0.0.1:8080/',{headers:{host:'unknown.invalid'}}).then(r => console.log(r.status))")" = 403 ]
# proxy: both Caddyfiles validate against the image's Caddy, which has the rate-limit module compiled in.
# Caddy runs as an unprivileged user; ports 80/443 are bound through its NET_BIND_SERVICE file capability.
for caddyfile in deploy/Caddyfile deploy/shared/Caddyfile; do
  docker run --rm --name "$(container_of proxy)" -e DOMAIN=ci.invalid -v "$PWD/$caddyfile:/etc/caddy/Caddyfile:ro" \
    "$(tag_of proxy)" caddy validate --config /etc/caddy/Caddyfile
done
docker run --rm --name "$(container_of proxy)" "$(tag_of proxy)" sh -c 'caddy list-modules | grep -q http.handlers.rate_limit'
docker run --rm --name "$(container_of proxy)" --cap-drop ALL --cap-add NET_BIND_SERVICE "$(tag_of proxy)" \
  sh -c 'test "$(id -u)" != 0 && getcap /usr/bin/caddy | grep -q cap_net_bind_service'
# The compose settings of the proxy (read-only root, no capability but NET_BIND_SERVICE, writable /config and /data as in
# compose, where /data is the caddy_data volume): it must serve.
PROXY_RUN="$(container_of proxy)-hardened"
docker run -d --name "$PROXY_RUN" --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE --tmpfs /tmp \
  --tmpfs /config:uid=10002,gid=10002 --tmpfs /data:uid=10002,gid=10002 -e DOMAIN=localhost -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" "$(tag_of proxy)" >/dev/null
# wget exits non-zero on the expected 502 (no upstreams), so read its text instead of its status.
proxy_answer() { docker exec "$PROXY_RUN" wget -q -S -O /dev/null --no-check-certificate https://localhost/ 2>&1 || true; }
for _ in $(seq 1 15); do
  case "$(proxy_answer)" in *"Bad Gateway"*) break ;; esac
  sleep 2
done
case "$(proxy_answer)" in
  *"Bad Gateway"*) ;;
  *) echo "hardened proxy does not answer on 443: $(proxy_answer)" >&2; docker ps -a --filter "name=$PROXY_RUN" >&2; docker logs "$PROXY_RUN" >&2; exit 1 ;;
esac
docker rm -fv "$PROXY_RUN" >/dev/null

ALL_IMAGES=("$IMAGE" "$(tag_of web)" "$(tag_of vendor-admin)" "$(tag_of ai-service)" "$(tag_of proxy)" "$(tag_of guard)")

# Scan one image with Trivy (through its official container and the Docker socket; the vulnerability database
# lives in an owned volume so it downloads once). Findings with no fix available are ignored. Every HIGH and
# CRITICAL finding is listed on stderr; stdout carries "<critical> <high>". A scanner error (database download,
# timeout, unreadable report) is a failure with its own message, never a pass.
scan_image() {
  local tag="$1" report="$IMAGE_ROOT/trivy.json"
  docker run --rm --name "$(container_of trivy)" -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$TRIVY_CACHE:/root/.cache/trivy" "$TRIVY_IMAGE" image --quiet --scanners vuln --timeout 15m \
    --format json --severity HIGH,CRITICAL --ignore-unfixed --exit-code 0 "$tag" > "$report" \
    || { echo "$tag scan failed: trivy exited with an error (vulnerability database download or scan error)" >&2; return 1; }
  python3 - "$report" "$tag" <<'PY' || { echo "$tag scan failed: unreadable trivy report" >&2; return 1; }
import json, sys

report, tag = sys.argv[1:3]
with open(report) as handle:
    document = json.load(handle)
counts = {'CRITICAL': 0, 'HIGH': 0}
for result in document.get('Results') or []:
    for finding in result.get('Vulnerabilities') or []:
        severity = finding.get('Severity')
        if severity in counts:
            counts[severity] += 1
            print(f"{tag}: {severity} {finding.get('VulnerabilityID')} {finding.get('PkgName')} "
                  f"{finding.get('InstalledVersion')} -> fixed in {finding.get('FixedVersion')}", file=sys.stderr)
print(counts['CRITICAL'], counts['HIGH'])
PY
}

# CRITICAL findings with a fix fail the stage; HIGH ones are reported only. Scan every image before failing.
scan_failed=0
scan_rows=""
for image in "${ALL_IMAGES[@]}"; do
  if counts="$(scan_image "$image")"; then
    read -r critical high <<< "$counts"
    scan_rows+="$(printf '| %s | %s | %s |\n' "$image" "$critical" "$high")"$'\n'
    if [ "$critical" -gt 0 ]; then
      echo "$image has $critical CRITICAL vulnerabilities with a fix available" >&2
      scan_failed=1
    fi
  else
    scan_rows+="$(printf '| %s | scan error | scan error |\n' "$image")"$'\n'
    scan_failed=1
  fi
done

# Record every image's tag and content digest, and the scan counts.
summary() {
  printf '| Image | Digest |\n| --- | --- |\n'
  for image in "${ALL_IMAGES[@]}"; do
    printf '| %s | %s |\n' "$image" "$(docker image inspect --format '{{.Id}}' "$image")"
  done
  printf '\nVulnerability scan (Trivy 0.75.0, fixable findings only):\n\n| Scanned image | CRITICAL | HIGH |\n| --- | --- | --- |\n%s' "$scan_rows"
}
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then summary >> "$GITHUB_STEP_SUMMARY"; else summary; fi
[ "$scan_failed" -eq 0 ] || { echo "image scan failed: a CRITICAL fixable vulnerability or a scanner error (see above)" >&2; exit 1; }
