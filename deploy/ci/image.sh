#!/usr/bin/env bash
# CI stage: build every production image; install the release in the Odoo one and assert it is hardened;
# smoke-check the others without external services; scan and write an SBOM for every image; record each image digest.
# Postgres listens on the job's loopback (a published service container on GitHub), so the containers use the host network.
# The Docker daemon may sit outside the job (a persistent rootless daemon): no job path is ever bind-mounted and no
# daemon socket is mounted. Config files reach a container through a derived image (`docker build` streams the context),
# and the scanner reads `docker save` tarballs copied into its container.
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
# Every image this stage builds and smoke-checks, and how, comes from the `builds` list of deploy/production-images.json
# (the list deploy/ci/publish.sh pushes from). Odoo is built separately; OTHER_IMAGES holds name:Dockerfile:context:NAME=value,... build arguments.
OTHER_IMAGES=()
ODOO_BUILD_ARGS=()
while IFS=$'\t' read -r _ _ name dockerfile context args; do
  if [ "$name" = odoo ]; then
    ODOO_DOCKERFILE="$dockerfile"
    ODOO_CONTEXT="$context"
    for pair in ${args//,/ }; do ODOO_BUILD_ARGS+=(--build-arg "$pair"); done
  else
    OTHER_IMAGES+=("$name:$dockerfile:$context:$args")
  fi
done < <(python3 -B deploy/image_pins.py --print-builds)
: "${ODOO_DOCKERFILE:?deploy/production-images.json has no build for the odoo image}"
# deploy/ci/publish.sh sets LIWAN_IMAGE_PREBUILT=1 after tagging the images it pushed, so this stage smoke-checks
# and scans those exact images instead of building them a second time. An image with no tag is still built here.
build_image() {
  local tag="$1"
  shift
  if [ "${LIWAN_IMAGE_PREBUILT:-0}" = 1 ] && docker image inspect "$tag" >/dev/null 2>&1; then return 0; fi
  docker build -t "$tag" "$@"
}
tag_of() { printf 'liwan-%s:ci-%s' "$1" "$GITHUB_RUN_ID"; }
files_tag_of() { printf 'liwan-%s-files:ci-%s' "$1" "$GITHUB_RUN_ID"; }
# derive <name> <base-tag> <src:dest>...: the base image plus the given files of $IMAGE_ROOT/<name>-files (relative
# sources), tagged files_tag_of <name>. Only files are added; user, entrypoint, capabilities and every runtime option
# of the image under test are unchanged.
derive() {
  local name="$1" base="$2" pair
  shift 2
  { printf 'FROM %s\n' "$base"; for pair in "$@"; do printf 'COPY %s %s\n' "${pair%%:*}" "${pair#*:}"; done; } \
    | docker build -q -t "$(files_tag_of "$name")" -f - "$IMAGE_ROOT/$name-files" >/dev/null
}
container_of() { printf 'liwan-ci-%s-%s' "$GITHUB_RUN_ID" "$1"; }
cleanup() {
  docker rm -fv "$IMAGE_CONTAINER" "$CHECK_CONTAINER" "$(container_of trivy)" >/dev/null 2>&1 || true
  docker volume rm -f "$TRIVY_CACHE" >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
  docker rmi -f "$(files_tag_of odoo)" >/dev/null 2>&1 || true
  for entry in "${OTHER_IMAGES[@]}"; do
    docker rm -fv "$(container_of "${entry%%:*}")" >/dev/null 2>&1 || true
    docker rmi -f "$(files_tag_of "${entry%%:*}")" >/dev/null 2>&1 || true
    docker rmi -f "$(tag_of "${entry%%:*}")" >/dev/null 2>&1 || true
  done
  docker rm -fv "$(container_of proxy)-hardened" >/dev/null 2>&1 || true
  docker rmi -f "$(files_tag_of proxy)" >/dev/null 2>&1 || true
  rm -rf "$IMAGE_ROOT"
}
trap cleanup EXIT
docker info
build_image "$IMAGE" -f "$ODOO_DOCKERFILE" ${ODOO_BUILD_ARGS[@]+"${ODOO_BUILD_ARGS[@]}"} "$ODOO_CONTEXT"
SCRATCH_DB="liwan_image_scratch"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
mkdir -p "$IMAGE_ROOT/odoo-files"
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode non_saas --output "$IMAGE_ROOT/odoo-files/classification.json"
printf '%s\n' '[options]' 'db_host = 127.0.0.1' "db_port = $PGPORT" "db_user = $PGUSER" "db_password = $PGPASSWORD" 'list_db = False' > "$IMAGE_ROOT/odoo-files/odoo.conf"
chmod 644 "$IMAGE_ROOT/odoo-files/odoo.conf" "$IMAGE_ROOT/odoo-files/classification.json"
derive odoo "$IMAGE" odoo.conf:/etc/odoo/odoo.conf classification.json:/run/liwan/classification.json
docker run --rm --name "$IMAGE_CONTAINER" --network host \
  -e LIWAN_COMMERCIAL_CONFIG=/run/liwan/classification.json "$(files_tag_of odoo)" \
  -d "$SCRATCH_DB" -i "$MODULES" --without-demo=all --http-port="$ODOO_PORT" --stop-after-init
docker run --rm --name "$CHECK_CONTAINER" --entrypoint sh "$IMAGE" -c 'test ! -w /opt/liwan/addons && test "$(id -u)" = 10001 && ! command -v git'

# Start a long-running image detached, assert its user is not root, and wait (bounded) for a probe run inside it.
# The probe runs in the container, so no host port is published and parallel runs cannot collide.
smoke_started() {
  local name="$1" container
  shift
  container="$(container_of "$name")"
  docker run -d --name "$container" "$@" "${SMOKE_TAG:-$(tag_of "$name")}" >/dev/null
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
  IFS=: read -r name dockerfile context args <<< "$entry"
  build_args=()
  for pair in ${args//,/ }; do build_args+=(--build-arg "$pair"); done
  build_image "$(tag_of "$name")" -f "$dockerfile" ${build_args[@]+"${build_args[@]}"} "$context"
done

# web: the published build is the shared one (compiled tenancy mode `shared`; the server refuses to start when the runtime
# mode differs), so it runs as the shared stack runs it. A public static file is answered by the Nitro server before the
# tenant boundary, needing no upstream (the probe of deploy/stack/compose.yml). Throwaway per-run token.
for name in web guard; do
  mkdir -p "$IMAGE_ROOT/$name-files"
  printf '%s\n' '{"schemaVersion":1,"snapshotRevision":0,"targets":[]}' > "$IMAGE_ROOT/$name-files/registry.json"
  chmod 644 "$IMAGE_ROOT/$name-files/registry.json"
  derive "$name" "$(tag_of "$name")" registry.json:/etc/liwan/registry.json
done
PROXY_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
SESSION_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
PROBE=(node -e "$HTTP_PROBE" http://127.0.0.1:3000/favicon.ico)
SMOKE_TAG="$(files_tag_of web)" smoke_started web \
  -e LIWAN_TENANCY_MODE=shared -e LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json \
  -e "LIWAN_SHARED_PROXY_TOKEN=$PROXY_TOKEN" -e NUXT_ODOO_URL=http://127.0.0.1:1
# vendor-admin: every page asks the control plane for a session first (503 without it), so probe a built static
# asset that Nitro serves from .output/public.
PROBE=(node -e "$HTTP_PROBE" http://127.0.0.1:3100/robots.txt)
smoke_started vendor-admin
# ai-service: /healthz answers (ollama needs no key; in-memory state needs no database; no model call is made).
# The service requires its service token outside development. AI_DEV_INSECURE=true is the only token-free mode, accepted
# only with AI_ALLOW_MEMORY_STATE=true and no AI_DATABASE_URL, which is exactly this smoke run.
PROBE=(python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8600/healthz', timeout=2)")
# The platform provider is read from a file (AI_PLATFORM_PROVIDER_FILE), in a directory mounted read-only like the deployment does.
mkdir -p "$IMAGE_ROOT/ai-service-files"
printf '%s\n' '{"revision": 1, "margin_bps": 0, "providers": {"main": {"provider": "ollama"}}, "models": {"main": {"provider": "main", "model": "ci-smoke"}}, "routes": {"default": "main"}}' > "$IMAGE_ROOT/ai-service-files/platform-provider.json"
chmod 644 "$IMAGE_ROOT/ai-service-files/platform-provider.json"
derive ai-service "$(tag_of ai-service)" platform-provider.json:/etc/liwan-ai/platform-provider.json
SMOKE_TAG="$(files_tag_of ai-service)" smoke_started ai-service -e AI_PLATFORM_PROVIDER_FILE=/etc/liwan-ai/platform-provider.json \
  -e AI_ALLOW_MEMORY_STATE=true -e AI_DEV_INSECURE=true

# ai-egress: squid itself accepts the configuration rendered with tenant hosts (tools/test_ai_egress.py, SquidParseCase).
LIWAN_AI_EGRESS_IMAGE_TEST=1 python3 -B -m unittest tools.test_ai_egress.SquidParseCase
# guard: starts in shared mode with a deny-all bootstrap registry, and its own healthcheck answers (the registry file and
# throwaway token and session key are the ones created for the web check above).
PROBE=(node deploy/shared/healthcheck.mjs)
SMOKE_TAG="$(files_tag_of guard)" smoke_started guard \
  -e LIWAN_TENANCY_MODE=shared -e LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json \
  -e "LIWAN_SHARED_PROXY_TOKEN=$PROXY_TOKEN" \
  -e "LIWAN_SESSION_KEYS={\"k1\":\"$SESSION_KEY\"}" -e LIWAN_SESSION_ACTIVE_KID=k1 \
  -e LIWAN_GUARD_ODOO_URL=http://127.0.0.1:1 -e LIWAN_GUARD_WEB_URL=http://127.0.0.1:1
# The guard denies an unknown host with 403 (a 5xx or no answer would be a broken guard).
[ "$(docker exec "$(container_of guard)" node -e "fetch('http://127.0.0.1:8080/',{headers:{host:'unknown.invalid'}}).then(r => console.log(r.status))")" = 403 ]
# odoo-mail: no start check (it needs an SMTP relay account); it is built, scanned and recorded like every other image.
# proxy: the stack Caddyfile validates against the image's Caddy, which has the rate-limit module compiled in.
# Caddy runs as an unprivileged user; ports 80/443 are bound through its NET_BIND_SERVICE file capability.
# Caddy fails to parse a placeholder with no default that is unset, so the container gets every variable the Caddyfile
# reads, with the values of the local environment file (deploy/environments/local.env.example). Compose turns an empty
# value of a variable with a default in the Caddyfile into that default, and an empty string would not parse, so such
# a variable is left unset here.
mkdir -p "$IMAGE_ROOT/proxy-files"
PROXY_ENV="$IMAGE_ROOT/proxy.env"
: > "$PROXY_ENV"
for variable in $(grep -oE '\{\$[A-Z_]+' deploy/stack/Caddyfile | tr -d '{$' | sort -u); do
  line="$(grep -E "^$variable=" deploy/environments/local.env.example)" \
    || { echo "deploy/environments/local.env.example sets no $variable, which deploy/stack/Caddyfile reads" >&2; exit 1; }
  if [ "$line" = "$variable=" ] && grep -qF "{\$$variable:" deploy/stack/Caddyfile; then continue; fi
  printf '%s\n' "$line" >> "$PROXY_ENV"
done
cp deploy/stack/Caddyfile "$IMAGE_ROOT/proxy-files/Caddyfile"
chmod 644 "$IMAGE_ROOT/proxy-files/Caddyfile"
derive proxy "$(tag_of proxy)" Caddyfile:/etc/caddy/Caddyfile
docker run --rm --name "$(container_of proxy)" --env-file "$PROXY_ENV" "$(files_tag_of proxy)" caddy validate --config /etc/caddy/Caddyfile
docker run --rm --name "$(container_of proxy)" "$(tag_of proxy)" sh -c 'caddy list-modules | grep -q http.handlers.rate_limit'
docker run --rm --name "$(container_of proxy)" --cap-drop ALL --cap-add NET_BIND_SERVICE "$(tag_of proxy)" \
  sh -c 'test "$(id -u)" != 0 && getcap /usr/bin/caddy | grep -q cap_net_bind_service'
# The compose settings of the proxy (read-only root, no capability but NET_BIND_SERVICE, writable /config and /data as in
# compose, where /data is the caddy_data volume): it must serve. The local file turns automatic HTTPS off for a machine
# behind no outer edge, so the served host and the HTTPS mode are set back to serve TLS on localhost.
PROXY_RUN="$(container_of proxy)-hardened"
docker run -d --name "$PROXY_RUN" --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE --tmpfs /tmp \
  --tmpfs /config:uid=10002,gid=10002 --tmpfs /data:uid=10002,gid=10002 --env-file "$PROXY_ENV" \
  -e DOMAIN=localhost -e LIWAN_AUTO_HTTPS=ignore_loaded_certs "$(files_tag_of proxy)" >/dev/null
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

# Every image of the build list is scanned and recorded, in that order (odoo first).
ALL_IMAGES=("$IMAGE")
for entry in "${OTHER_IMAGES[@]}"; do ALL_IMAGES+=("$(tag_of "${entry%%:*}")"); done

# Scan one image with Trivy (its official container reads a `docker save` tarball copied into it, so the daemon socket
# is never mounted; the vulnerability database lives in an owned volume so it downloads once). Findings with no fix available are ignored. Every HIGH and
# CRITICAL finding is listed on stderr; stdout carries "<critical> <high>". A scanner error (database download,
# timeout, unreadable report) is a failure with its own message, never a pass.
# trivy_run <image-tag> <trivy arguments>: the arguments scan `--input /tmp/image.tar`, the saved tag.
image_tar() { printf '%s/%s.tar' "$IMAGE_ROOT" "$(printf '%s' "$1" | tr '/:@' '___')"; }
trivy_run() {
  local tag="$1" tar container status=0
  shift
  tar="$(image_tar "$tag")"
  container="$(container_of trivy)"
  [ -s "$tar" ] || docker save -o "$tar" "$tag" || return 1
  docker rm -fv "$container" >/dev/null 2>&1 || true
  docker create --name "$container" -v "$TRIVY_CACHE:/root/.cache/trivy" "$TRIVY_IMAGE" "$@" >/dev/null || return 1
  docker cp "$tar" "$container:/tmp/image.tar" || status=$?
  [ "$status" -ne 0 ] || docker start -a "$container" || status=$?
  docker rm -fv "$container" >/dev/null 2>&1 || true
  return "$status"
}
scan_image() {
  local tag="$1" report="$IMAGE_ROOT/trivy.json"
  trivy_run "$tag" image --quiet --scanners vuln --timeout 15m \
    --format json --severity HIGH,CRITICAL --ignore-unfixed --exit-code 0 --input /tmp/image.tar > "$report" \
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

# A CycloneDX SBOM of one image (its packages and their licenses; no vulnerability data, the scan above owns that).
# A generator error is a failure, never an empty file.
write_sbom() {
  local tag="$1" file
  file="$SBOM_DIR/${tag%%:*}.cdx.json"
  trivy_run "$tag" image --quiet --scanners license --format cyclonedx --input /tmp/image.tar > "$file" \
    && python3 -c 'import json, sys; assert json.load(open(sys.argv[1])).get("bomFormat") == "CycloneDX"' "$file" \
    || { echo "$tag sbom failed: trivy could not produce a CycloneDX document" >&2; return 1; }
}
# One document per image lands in LIWAN_SBOM_DIR, which the workflow running this stage uploads.
SBOM_DIR="${LIWAN_SBOM_DIR:-$IMAGE_ROOT/sbom}"
mkdir -p "$SBOM_DIR"
sbom_failed=0
for image in "${ALL_IMAGES[@]}"; do write_sbom "$image" || sbom_failed=1; done

# CRITICAL findings with a fix fail the stage; HIGH ones are reported only. Scan every image before failing.
scan_failed=0
scan_rows=""
for image in "${ALL_IMAGES[@]}"; do
  counts_status=0
  counts="$(scan_image "$image")" || counts_status=$?
  rm -f "$(image_tar "$image")"
  if [ "$counts_status" -eq 0 ]; then
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

# Record every image's tag, its content digest (the image ID), its registry digest where it has one, and the scan counts.
# The CI images are built here and never pushed, so they have no RepoDigest: that is stated, not left blank.
repo_digest() { docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}not published{{end}}' "$1"; }
summary() {
  printf '| Image | Content digest (image ID) | Registry digest | SBOM |\n| --- | --- | --- | --- |\n'
  for image in "${ALL_IMAGES[@]}"; do
    printf '| %s | %s | %s | %s |\n' "$image" "$(docker image inspect --format '{{.Id}}' "$image")" "$(repo_digest "$image")" "${image%%:*}.cdx.json"
  done
  printf '\nVulnerability scan (Trivy 0.75.0, fixable findings only):\n\n| Scanned image | CRITICAL | HIGH |\n| --- | --- | --- |\n%s' "$scan_rows"
}
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then summary >> "$GITHUB_STEP_SUMMARY"; else summary; fi
[ "$sbom_failed" -eq 0 ] || { echo "image sbom failed: see above" >&2; exit 1; }
[ "$scan_failed" -eq 0 ] || { echo "image scan failed: a CRITICAL fixable vulnerability or a scanner error (see above)" >&2; exit 1; }
