#!/usr/bin/env bash
# Publish stage: build the production images natively for linux/arm64, scan them, and only then write them to the private
# GitHub container registry (ghcr.io) with the release document of the commit. Run by .github/workflows/publish.yml for a
# release/19.0.X.Y.Z tag only; the owned images and how they are built come from deploy/production-images.json. The
# images are built on an arm64 runner (staging and production are arm64; nothing is emulated) and the document, under
# liwan-release:<commit>, covers linux/arm64.
#   plan           print the images and the registry; touches nothing (local inspection)
#   packages       refuse unless every package this run pushes to (the images and liwan-release) already exists in
#                  the registry and is private; the workflow never creates one (check, push and merge run it first)
#   login          sign in to the registry host with GITHUB_TOKEN (read from the environment, passed on stdin)
#   check          decide what this run does and write it as `state=` to $GITHUB_OUTPUT: `published` (the document of
#                  the commit already covers linux/arm64: nothing is rebuilt, so the digests a host may have pulled stay
#                  valid and the caller only tells the environment again) or `build`. The ref must be a release tag
#                  whose commit is in origin/main
#   build          build every image for linux/arm64 into the local daemon (nothing reaches the registry), then
#                  smoke-check and scan them with deploy/ci/image.sh (the same images, tagged locally)
#   push           only after build passed: push each image under <commit>-arm64 and check the tag holds exactly what
#                  was pushed
#   merge          join the <commit>-arm64 images under the full commit SHA, write the release document
#                  (deploy/ci/lib/release_manifest.py) and push it as <registry>/liwan-release:<commit>, a scratch
#                  image holding exactly one file, /release.json, replacing any earlier one under that tag
# Because the architecture tags are written only after the scan, a failed scan leaves no unscanned image in the registry.
# Docker comes from the environment; nothing here names a socket. The job token is read from the environment and never
# placed in an argument.
set -euo pipefail
export LC_ALL=C  # [0-9] below means the ASCII digits only
cd "$(dirname "$0")/.."/..
# Staging and production are arm64: the images and the release document image are built for this platform only.
PLATFORM="linux/arm64"

# One tab-separated line per published image: registry image, reference, local name for image.sh,
# Dockerfile, context, NAME=value build arguments (see deploy/image_pins.py --print-builds). CI-only builds are left out.
builds() { python3 -B deploy/image_pins.py --print-builds | awk -F'\t' '$1 != "-"'; }
registry() { builds | head -n 1 | cut -d/ -f1,2; }
fail() { echo "publish: $*" >&2; exit 1; }
set_output() { [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; }
require_ref() {
  # The same tag form as deploy/release/source.py: three numbers, ASCII digits, no leading zero.
  [[ "$GITHUB_REF" =~ ^refs/tags/release/19\.0\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
    || fail "images are published from release/19.0.X.Y.Z tags only, not $GITHUB_REF"
}
arch_tag() { printf '%s:%s-%s' "$1" "$GITHUB_SHA" "${PLATFORM#linux/}"; }
require_in_main() {
  git rev-parse --verify --quiet origin/main > /dev/null || fail "origin/main is not fetched: check out with the full history"
  git merge-base --is-ancestor "$GITHUB_SHA" origin/main || fail "$GITHUB_REF names $GITHUB_SHA, which is not in main"
}
manifest_digest() { docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | python3 -c 'import json, sys; print(json.load(sys.stdin)["digest"])'; }
metadata_digest() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["containerimage.digest"])' "$1"; }
# /release.json of a release document image, on stdout: a scratch image has no command, so it is created, not run. The
# registry's current content is always read (--pull always): an image already in the local store is not refreshed by a
# `buildx --push`, and a stale copy would hide the document this run just wrote or another run replaced.
fetch_document() {
  local id
  id="$(docker create --pull always "$1" /release.json)"
  docker cp "$id:/release.json" - | tar -xOf -
  docker rm "$id" > /dev/null
}
# The platforms map (reference -> {platform: digest}) of a release document file for $GITHUB_SHA, as JSON on stdout.
read_platforms() { PYTHONPATH=. python3 -B deploy/ci/lib/release_manifest.py --read "$1" --commit "$GITHUB_SHA"; }
# 0 if the release document image $1 exists, 1 if the registry says it is not there; any other answer (denied, network)
# is a hard failure, never read as "no document".
anchor_exists() {
  local output
  if output="$(docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' 2>&1)"; then return 0; fi
  grep -qiE 'not found|manifest unknown' <<< "$output" || fail "cannot tell whether $1 exists: $output"
  return 1
}
# The visibility the GitHub packages API reports for one container package of the registry owner; empty on any failure.
package_visibility() {
  curl -fsS --max-time 30 --config <(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN") \
    -H 'Accept: application/vnd.github+json' "https://api.github.com/users/${1%%/*}/packages/container/$2" 2> /dev/null \
    | python3 -c 'import json, sys; print(json.load(sys.stdin).get("visibility", ""))' 2> /dev/null || true
}
# 0 if every reference of the platforms file $1 records $PLATFORM.
covers_platform() {
  python3 -c '
import json, sys
platforms = json.load(open(sys.argv[1]))
sys.exit(0 if platforms and all(sys.argv[2] in each for each in platforms.values()) else 1)' "$1" "$PLATFORM"
}
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

# 0 if the release document of this commit already exists and covers $PLATFORM: what this run would push is then already
# recorded, and pushing it again would replace the image the document names.
document_covers() {
  local work anchor
  anchor="$(registry)/liwan-release:$GITHUB_SHA"
  anchor_exists "$anchor" || return 1
  work="$(mktemp -d)"
  fetch_document "$anchor" > "$work/document.json"
  read_platforms "$work/document.json" > "$work/platforms.json"
  if covers_platform "$work/platforms.json"; then rm -rf "$work"; return 0; fi
  rm -rf "$work"
  return 1
}
# After writing the document: the registry must hold the digests this run wrote. The workflow serializes the runs of one
# commit, so this guards against anything else replacing the document between the write and now; a run that finds another
# document fails here, and its re-run repairs it.
verify_written() {
  local work
  work="$(mktemp -d)"
  fetch_document "$1" > "$work/document.json"
  read_platforms "$work/document.json" > "$work/platforms.json"
  python3 -c '
import json, sys
recorded = json.load(open(sys.argv[2]))
for line in open(sys.argv[1]):
    reference, _, platform, digest = line.rstrip("\n").split("\t")
    if recorded.get(reference, {}).get(platform) != digest:
        sys.exit(1)' "$2" "$work/platforms.json" || fail "$1 does not hold the digests this run wrote: another run replaced the document; re-run this job"
  rm -rf "$work"
}

# Fail closed: the repository is public and the images are not. A package first created by a push may come out public,
# so the owner creates every package by hand as private; anything but a confirmed `private` stops the run.
packages() {
  local owner name visibility
  [ -n "${GITHUB_TOKEN-}" ] || fail "GITHUB_TOKEN must hold the registry token"
  owner="$(registry)"
  owner="${owner#*/}"
  for name in $( { builds | awk -F'\t' '{ print $2 }'; echo liwan-release; } | sort -u); do
    visibility="$(package_visibility "$owner" "$name")"
    [ "$visibility" = private ] || fail "package $name of $owner is not confirmed private (got '${visibility:-no answer}'): create it as a private package and grant this repository Actions write access (see the environment bring-up checklist)"
  done
}

login() {
  local host
  host="$(registry)"
  [ -n "${GITHUB_TOKEN-}" ] || fail "GITHUB_TOKEN must hold the registry token"
  printf '%s' "$GITHUB_TOKEN" | docker login "${host%%/*}" --username "${GITHUB_ACTOR:?}" --password-stdin
}

check() {
  : "${GITHUB_SHA:?}" "${GITHUB_REF:?}"
  require_ref
  packages
  require_in_main
  if document_covers; then
    echo "publish: $(registry)/liwan-release:$GITHUB_SHA already covers $PLATFORM: not rebuilding, staging is told again"
    set_output state published
  else
    set_output state build
  fi
}

build() {
  local image reference local_name dockerfile context args argv pair
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SERVER_URL:?}"
  require_ref
  use_builder
  while IFS=$'\t' read -r image reference local_name dockerfile context args; do
    argv=()
    for pair in ${args//,/ }; do argv+=(--build-arg "$pair"); done
    docker buildx build --platform "$PLATFORM" -f "$dockerfile" ${argv[@]+"${argv[@]}"} --provenance=false \
      --label "org.opencontainers.image.source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
      --label "org.opencontainers.image.revision=$GITHUB_SHA" --load -t "$(arch_tag "$image")" "$context"
    docker tag "$(arch_tag "$image")" "liwan-$local_name:ci-$GITHUB_RUN_ID"
  done < <(builds)
  LIWAN_IMAGE_PREBUILT=1 deploy/ci/image.sh
}

# Pushes the scanned arm64 images. The tag must then hold the digest this run pushed: a tag
# moved in between cannot put another image into the release document.
push() {
  local image reference tag digest held
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}"
  require_ref
  packages
  if document_covers; then
    echo "publish: the release document of $GITHUB_SHA already covers $PLATFORM: nothing is pushed"
    return 0
  fi
  while IFS=$'\t' read -r image reference _ _ _ _; do
    tag="$(arch_tag "$image")"
    docker image inspect "$tag" > /dev/null 2>&1 || fail "no scanned image for $reference: run build first"
    docker push --quiet "$tag" > /dev/null
    digest="$(manifest_digest "$tag")"
    held="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$tag")"
    grep -qFx "$image@$digest" <<< "$held" || fail "$tag holds $digest, not the image this run pushed"
  done < <(builds)
}

# Joins the arm64 images under the commit tag and writes the release document of the commit, safely whatever the plan
# said: the registry is read again here, and once more after the write. A document that already covers $PLATFORM is left
# alone; any other document of the commit (for example one written by an earlier design) is replaced under the same tag.
merge() {
  local work anchor metadata image reference digest
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}"
  require_ref
  packages
  anchor="$(registry)/liwan-release"
  if document_covers; then
    echo "publish: $anchor:$GITHUB_SHA already covers $PLATFORM: nothing to write"
    return 0
  fi
  work="$(mktemp -d)"
  use_builder
  : > "$work/digests.tsv"
  while IFS=$'\t' read -r image reference _ _ _ _; do
    digest="$(manifest_digest "$(arch_tag "$image")")"
    printf '%s\t%s\t%s\t%s\n' "$reference" "$image" "$PLATFORM" "$digest" >> "$work/digests.tsv"
    docker buildx imagetools create -t "$image:$GITHUB_SHA" "$image@$digest"
  done < <(builds)
  python3 -c '
import json, sys
images, platforms = {}, {}
for line in open(sys.argv[1]):
    reference, image, platform, digest = line.rstrip("\n").split("\t")
    images[reference] = f"{image}@{digest}"
    platforms[reference] = {platform: digest}
json.dump(images, open(sys.argv[2], "w"))
json.dump(platforms, open(sys.argv[3], "w"))
' "$work/digests.tsv" "$work/images.json" "$work/platforms.json"
  PYTHONPATH=. python3 -B deploy/ci/lib/release_manifest.py --commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" \
    --images "$work/images.json" --platforms "$work/platforms.json" > "$work/release.json"
  printf 'FROM scratch\nCOPY release.json /release.json\n' > "$work/Dockerfile"
  metadata="$work/metadata.json"
  docker buildx build --platform "$PLATFORM" --provenance=false --push -t "$anchor:$GITHUB_SHA" \
    --label "org.opencontainers.image.source=${GITHUB_SERVER_URL:?}/${GITHUB_REPOSITORY:?}" --metadata-file "$metadata" "$work"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { printf 'Release document for %s\n\n| Image | Platform | Digest |\n| --- | --- | --- |\n' "$GITHUB_SHA"
      awk -F'\t' '{ printf "| %s | %s | %s |\n", $1, $3, $4 }' "$work/digests.tsv"
      printf '\nRelease document: `%s@%s`\n' "$anchor" "$(metadata_digest "$metadata")"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  verify_written "$anchor:$GITHUB_SHA" "$work/digests.tsv"
  rm -rf "$work"
}

case "${1:-}" in
  plan|packages|login|check|build|push|merge) "$@" ;;
  *) echo "usage: publish.sh plan | packages | login | check | build | push | merge" >&2; exit 2 ;;
esac
