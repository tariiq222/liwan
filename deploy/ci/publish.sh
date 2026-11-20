#!/usr/bin/env bash
# Publish stage: build the production images, scan them, and only then write them to the private Forgejo registry with
# the release document of the commit. Run by .forgejo/workflows/publish.yml on every main push; the owned images and how
# they are built come from deploy/production-images.json. The runner is amd64, so every image is built natively for
# linux/amd64; the arm64 leg is added with the release/* tag workflow once the place that builds it is decided.
#   plan           print the images and the registry; touches nothing (local inspection)
#   check          decide what this run does and write it as `state=` to $GITHUB_OUTPUT: `superseded` (the commit is
#                  no longer the head of main: nothing is built or pushed, exit 0), `published` (liwan-release:<commit>
#                  already exists: nothing is rebuilt, so the digests a host may have pulled stay valid; the caller only
#                  tells staging again) or `build`
#   build          build every image for linux/amd64 into the local daemon (nothing reaches the registry), then smoke-check
#                  and scan them with deploy/ci/image.sh (the same images, tagged locally)
#   push           only after build passed: push each image under the full commit SHA, check the tag holds exactly what
#                  was pushed, write the release document (deploy/ci/lib/release_manifest.py) and push it as
#                  <registry>/liwan-release:<commit>, a scratch image holding exactly one file, /release.json. A commit
#                  that is no longer the head of main by then writes `superseded=true` and pushes nothing, exit 0
# Because the commit tag is written only after the scan, a failed scan leaves no unscanned image under it and no
# temporary tag in the registry for the retention job to clean. Docker comes from the environment (DOCKER_HOST); nothing
# here names a socket. Registry credentials are the caller's docker login; the job token is read from the environment
# and never placed in an argument.
set -euo pipefail
cd "$(dirname "$0")/.."/..
PLATFORM="linux/amd64"
# The release document is read on hosts of either architecture and holds no binary, so it is built for both.
DOCUMENT_PLATFORMS="linux/amd64,linux/arm64"

# One tab-separated line per published image: registry image, reference, local name for image.sh,
# Dockerfile, context, NAME=value build arguments (see deploy/image_pins.py --print-builds). CI-only builds are left out.
builds() { python3 -B deploy/image_pins.py --print-builds | awk -F'\t' '$1 != "-"'; }
registry() { builds | head -n 1 | cut -d/ -f1,2; }
fail() { echo "publish: $*" >&2; exit 1; }
set_output() { [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; }
# The head of main on Forgejo, read with the job token (sent as an environment-held git header, never an argument).
remote_head() {
  local auth
  [ -n "${GITHUB_TOKEN-}" ] || fail "GITHUB_TOKEN must hold the read token for $GITHUB_REPOSITORY"
  auth="$(printf '%s:%s' x-access-token "$GITHUB_TOKEN" | base64 | tr -d '\n')"
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader GIT_CONFIG_VALUE_0="Authorization: basic $auth" \
    git ls-remote "${GITHUB_SERVER_URL:?}/${GITHUB_REPOSITORY:?}.git" refs/heads/main | cut -f1
}
# A newer main commit supersedes this run: it is the newer run's job to publish, and a rerun of an old run must not.
is_superseded() {
  local head
  head="$(remote_head)"
  [ -n "$head" ] || fail "cannot read the head of main on $GITHUB_SERVER_URL"
  [ "$head" != "$GITHUB_SHA" ] || return 1
  echo "publish: superseded: main is at $head, this run is for $GITHUB_SHA; nothing is built or pushed"
}
manifest_digest() { docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | python3 -c 'import json, sys; print(json.load(sys.stdin)["digest"])'; }
metadata_digest() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["containerimage.digest"])' "$1"; }
# BuildKit v0.18.2, pinned by the digest of its multi-arch index.
BUILDKIT_IMAGE="moby/buildkit:v0.18.2@sha256:86c0ad9d1137c186e9d455912167df20e530bdf7f7c19de802e892bb8ca16552"
use_builder() {
  docker buildx rm --force liwan-publish >/dev/null 2>&1 || true
  docker buildx create --name liwan-publish --driver docker-container --driver-opt "image=$BUILDKIT_IMAGE" --use >/dev/null
}

plan() {
  echo "registry: $(registry)"
  builds | while IFS=$'\t' read -r image reference _ dockerfile context args; do
    echo "image: $image (docker build -f $dockerfile $context; args: ${args:-none})"
  done
}

check() {
  : "${GITHUB_SHA:?}" "${GITHUB_REF:?}"
  [ "$GITHUB_REF" = refs/heads/main ] || fail "images are published from main only, not $GITHUB_REF"
  local anchor output
  anchor="$(registry)/liwan-release:$GITHUB_SHA"
  if is_superseded; then set_output state superseded; return 0; fi
  if output="$(docker buildx imagetools inspect "$anchor" --format '{{json .Manifest}}' 2>&1)"; then
    echo "publish: $anchor is already published: not rebuilding (the digests hosts pulled stay valid), staging is told again"
    set_output state published
  elif grep -qi 'not found' <<< "$output"; then
    set_output state build
  else
    fail "cannot tell whether $anchor exists: $output"
  fi
}

build() {
  local image reference local_name dockerfile context args argv pair
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SERVER_URL:?}"
  [ "$GITHUB_REF" = refs/heads/main ] || fail "images are built for publishing from main only, not $GITHUB_REF"
  use_builder
  while IFS=$'\t' read -r image reference local_name dockerfile context args; do
    argv=()
    for pair in ${args//,/ }; do argv+=(--build-arg "$pair"); done
    docker buildx build --platform "$PLATFORM" -f "$dockerfile" ${argv[@]+"${argv[@]}"} --provenance=false \
      --label "org.opencontainers.image.source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
      --label "org.opencontainers.image.revision=$GITHUB_SHA" --load -t "$image:$GITHUB_SHA" "$context"
    docker tag "$image:$GITHUB_SHA" "liwan-$local_name:ci-$GITHUB_RUN_ID"
  done < <(builds)
  LIWAN_IMAGE_PREBUILT=1 deploy/ci/image.sh
}

# Pushes the scanned images. The commit tag must then hold the digest this run pushed and recorded: a tag moved in
# between cannot put another image into the release document.
push() {
  local work anchor metadata image reference digest held
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}"
  [ "$GITHUB_REF" = refs/heads/main ] || fail "release documents are published from main only, not $GITHUB_REF"
  if is_superseded; then set_output superseded true; return 0; fi
  use_builder
  work="$(mktemp -d)"
  : > "$work/images.tsv"
  while IFS=$'\t' read -r image reference _ _ _ _; do
    docker image inspect "$image:$GITHUB_SHA" > /dev/null 2>&1 || fail "no scanned image for $reference: run build first"
    docker push --quiet "$image:$GITHUB_SHA" > /dev/null
    digest="$(manifest_digest "$image:$GITHUB_SHA")"
    held="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image:$GITHUB_SHA")"
    grep -qFx "$image@$digest" <<< "$held" || fail "$image:$GITHUB_SHA holds $digest, not the image this run pushed"
    printf '%s\t%s@%s\t%s\n' "$reference" "$image" "$digest" "$digest" >> "$work/images.tsv"
  done < <(builds)
  python3 -c '
import json, sys
images, platforms = {}, {}
for line in open(sys.argv[1]):
    reference, image, digest = line.rstrip("\n").split("\t")
    images[reference] = image
    platforms[reference] = {sys.argv[4]: digest}
json.dump(images, open(sys.argv[2], "w"))
json.dump(platforms, open(sys.argv[3], "w"))
' "$work/images.tsv" "$work/images.json" "$work/platforms.json" "$PLATFORM"
  PYTHONPATH=. python3 -B deploy/ci/lib/release_manifest.py --commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" \
    --images "$work/images.json" --platforms "$work/platforms.json" > "$work/release.json"
  printf 'FROM scratch\nCOPY release.json /release.json\n' > "$work/Dockerfile"
  anchor="$(registry)/liwan-release"
  metadata="$work/metadata.json"
  docker buildx build --platform "$DOCUMENT_PLATFORMS" --provenance=false --push -t "$anchor:$GITHUB_SHA" \
    --metadata-file "$metadata" "$work"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { printf 'Release document for %s\n\n| Image | Digest (%s) |\n| --- | --- |\n' "$GITHUB_SHA" "$PLATFORM"
      awk -F'\t' '{ printf "| %s | %s |\n", $1, $3 }' "$work/images.tsv"
      printf '\nRelease document: `%s@%s`\n' "$anchor" "$(metadata_digest "$metadata")"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  rm -rf "$work"
}

case "${1:-}" in
  plan|check|build|push) "$@" ;;
  *) echo "usage: publish.sh plan | check | build | push" >&2; exit 2 ;;
esac
