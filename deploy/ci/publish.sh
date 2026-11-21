#!/usr/bin/env bash
# Publish stage: build the production images natively, scan them, and only then write them to the private GitHub
# container registry (ghcr.io) with the release document of the commit. Run by .github/workflows/publish.yml; the owned
# images and how they are built come from deploy/production-images.json. A main push builds linux/amd64 only and
# publishes a document that covers amd64. A release/19.0.X.Y.Z tag builds linux/arm64 for that commit on an arm64 runner,
# reuses the amd64 digests already recorded in the document of the commit (amd64 is built only when no document exists)
# and replaces the document, under the same tag, with one that covers both architectures. Nothing is emulated.
#   plan           print the images and the registry; touches nothing (local inspection)
#   packages       refuse unless every package this run pushes to (the images and liwan-release) already exists in
#                  the registry and is private; the workflow never creates one (check, push and merge run it first)
#   login          sign in to the registry host with GITHUB_TOKEN (read from the environment, passed on stdin)
#   check          decide what this run does and write it as `state=` to $GITHUB_OUTPUT: `superseded` (main only: the
#                  commit is no longer the head of main: nothing is built or pushed, exit 0), `published` (main: the
#                  document exists; tag: the document already covers both architectures; nothing is rebuilt, so the
#                  digests a host may have pulled stay valid and the caller only tells the environment again) or
#                  `build`, with `amd64=` `build` or `reuse` (a tag whose commit has an amd64 document). A release/* tag
#                  is refused unless its commit is in origin/main
#   build          build every image for $PUBLISH_PLATFORM into the local daemon (nothing reaches the registry), then
#                  smoke-check and scan them with deploy/ci/image.sh (the same images, tagged locally)
#   push           only after build passed: push each image under <commit>-<arch> and check the tag holds exactly what
#                  was pushed. A main commit that is no longer the head of main by then pushes nothing, exit 0
#   merge          join the per-architecture images of $PUBLISH_PLATFORMS under the full commit SHA (digests recorded in
#                  an existing document are reused, the rest are read from the <commit>-<arch> tags), write the release
#                  document (deploy/ci/lib/release_manifest.py) and push it as <registry>/liwan-release:<commit>, a
#                  scratch image holding exactly one file, /release.json, replacing any earlier one under that tag. A
#                  main commit that is no longer the head of main pushes nothing, exit 0
# Because the architecture tags are written only after the scan, a failed scan leaves no unscanned image in the registry.
# Docker comes from the environment; nothing here names a socket. The job token is read from the environment and never
# placed in an argument.
set -euo pipefail
export LC_ALL=C  # [0-9] below means the ASCII digits only
cd "$(dirname "$0")/.."/..
# The release document is read on hosts of either architecture and holds no binary, so one image serves both.
DOCUMENT_PLATFORMS="linux/amd64,linux/arm64"

# One tab-separated line per published image: registry image, reference, local name for image.sh,
# Dockerfile, context, NAME=value build arguments (see deploy/image_pins.py --print-builds). CI-only builds are left out.
builds() { python3 -B deploy/image_pins.py --print-builds | awk -F'\t' '$1 != "-"'; }
registry() { builds | head -n 1 | cut -d/ -f1,2; }
fail() { echo "publish: $*" >&2; exit 1; }
set_output() { [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; }
is_main() { [ "${GITHUB_REF:?}" = refs/heads/main ]; }
require_ref() {
  # The same tag form as deploy/release/source.py: three numbers, ASCII digits, no leading zero.
  [[ "$GITHUB_REF" =~ ^refs/(heads/main|tags/release/19\.0\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$ ]] \
    || fail "images are published from main and release/19.0.X.Y.Z tags only, not $GITHUB_REF"
}
# The platform this runner builds: arm64 only for a release tag.
build_platform() {
  : "${PUBLISH_PLATFORM:?}"
  if [ "$PUBLISH_PLATFORM" = linux/arm64 ] && is_main; then fail "arm64 images are built for a release tag only, not $GITHUB_REF"; fi
  [[ "$PUBLISH_PLATFORM" =~ ^linux/(amd64|arm64)$ ]] || fail "unknown platform $PUBLISH_PLATFORM"
}
# The platforms the release document covers: amd64 for main, both for a release tag.
document_platforms() {
  : "${PUBLISH_PLATFORMS:?}"
  if is_main; then
    [ "$PUBLISH_PLATFORMS" = "linux/amd64" ] || fail "the document of a main commit covers linux/amd64 only, not $PUBLISH_PLATFORMS"
  else
    [ "$PUBLISH_PLATFORMS" = "linux/amd64 linux/arm64" ] || fail "the document of a release tag covers both platforms, not $PUBLISH_PLATFORMS"
  fi
}
arch_tag() { printf '%s:%s-%s' "$1" "$GITHUB_SHA" "${2#linux/}"; }
# The head of main on GitHub, read with the job token (sent as an environment-held git header, never an argument).
remote_head() {
  local auth
  [ -n "${GITHUB_TOKEN-}" ] || fail "GITHUB_TOKEN must hold the read token for $GITHUB_REPOSITORY"
  auth="$(printf '%s:%s' x-access-token "$GITHUB_TOKEN" | base64 | tr -d '\n')"
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader GIT_CONFIG_VALUE_0="Authorization: basic $auth" \
    git ls-remote "${GITHUB_SERVER_URL:?}/${GITHUB_REPOSITORY:?}.git" refs/heads/main | cut -f1
}
# A newer main commit supersedes this run: it is the newer run's job to publish, and a rerun of an old run must not.
# A release tag is never superseded.
is_superseded() {
  local head
  is_main || return 1
  head="$(remote_head)"
  [ -n "$head" ] || fail "cannot read the head of main on $GITHUB_SERVER_URL"
  [ "$head" != "$GITHUB_SHA" ] || return 1
  echo "publish: superseded: main is at $head, this run is for $GITHUB_SHA; nothing is built or pushed"
}
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
# 0 if every reference of the platforms file $1 records every platform of $PUBLISH_PLATFORMS.
covers_all() {
  PLATFORMS="$PUBLISH_PLATFORMS" python3 -c '
import json, os, sys
platforms = json.load(open(sys.argv[1]))
wanted = set(os.environ["PLATFORMS"].split())
sys.exit(0 if platforms and all(wanted <= set(each) for each in platforms.values()) else 1)' "$1"
}
recorded_digest() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], {}).get(sys.argv[3], ""))' "$@"; }
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

# 0 if the release document of this commit already exists and covers platform $1: what this run would push is then
# already recorded, and pushing it again would replace the image the document names.
document_covers() {
  local work anchor
  anchor="$(registry)/liwan-release:$GITHUB_SHA"
  anchor_exists "$anchor" || return 1
  work="$(mktemp -d)"
  fetch_document "$anchor" > "$work/document.json"
  read_platforms "$work/document.json" > "$work/platforms.json"
  if PUBLISH_PLATFORMS="$1" covers_all "$work/platforms.json"; then rm -rf "$work"; return 0; fi
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

# A tag whose document already covers both architectures is complete; one whose document covers amd64 only reuses it.
decide_for_tag() {
  local work covered
  work="$(mktemp -d)"
  fetch_document "$1" > "$work/document.json"
  covered="$(read_platforms "$work/document.json" | python3 -c 'import json, sys; print(" ".join(sorted(next(iter(json.load(sys.stdin).values())))))')"
  rm -rf "$work"
  [[ " $covered " == *" linux/amd64 "* ]] || fail "$1 covers $covered but no linux/amd64 image"
  if [[ " $covered " == *" linux/arm64 "* ]]; then
    echo "publish: $1 already covers both architectures: not rebuilding, staging is told again"
    set_output state published
  else
    echo "publish: $1 covers linux/amd64: its digests are reused, only linux/arm64 is built"
    set_output state build
    set_output amd64 reuse
  fi
}

check() {
  : "${GITHUB_SHA:?}" "${GITHUB_REF:?}"
  require_ref
  packages
  local anchor
  anchor="$(registry)/liwan-release:$GITHUB_SHA"
  if is_superseded; then set_output state superseded; return 0; fi
  if ! is_main; then require_in_main; fi
  if anchor_exists "$anchor"; then
    if is_main; then
      echo "publish: $anchor is already published: not rebuilding (the digests hosts pulled stay valid)"
      set_output state published
    else
      decide_for_tag "$anchor"
    fi
  else
    set_output state build
    set_output amd64 build
  fi
}

build() {
  local image reference local_name dockerfile context args argv pair
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SERVER_URL:?}"
  require_ref
  build_platform
  use_builder
  while IFS=$'\t' read -r image reference local_name dockerfile context args; do
    argv=()
    for pair in ${args//,/ }; do argv+=(--build-arg "$pair"); done
    docker buildx build --platform "$PUBLISH_PLATFORM" -f "$dockerfile" ${argv[@]+"${argv[@]}"} --provenance=false \
      --label "org.opencontainers.image.source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
      --label "org.opencontainers.image.revision=$GITHUB_SHA" --load -t "$(arch_tag "$image" "$PUBLISH_PLATFORM")" "$context"
    docker tag "$(arch_tag "$image" "$PUBLISH_PLATFORM")" "liwan-$local_name:ci-$GITHUB_RUN_ID"
  done < <(builds)
  LIWAN_IMAGE_PREBUILT=1 deploy/ci/image.sh
}

# Pushes the scanned images of this runner's architecture. The tag must then hold the digest this run pushed: a tag
# moved in between cannot put another image into the release document.
push() {
  local image reference tag digest held
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}"
  require_ref
  build_platform
  if is_superseded; then return 0; fi
  packages
  if document_covers "$PUBLISH_PLATFORM"; then
    echo "publish: the release document of $GITHUB_SHA already covers $PUBLISH_PLATFORM: nothing is pushed"
    return 0
  fi
  while IFS=$'\t' read -r image reference _ _ _ _; do
    tag="$(arch_tag "$image" "$PUBLISH_PLATFORM")"
    docker image inspect "$tag" > /dev/null 2>&1 || fail "no scanned image for $reference: run build first"
    docker push --quiet "$tag" > /dev/null
    digest="$(manifest_digest "$tag")"
    held="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$tag")"
    grep -qFx "$image@$digest" <<< "$held" || fail "$tag holds $digest, not the image this run pushed"
  done < <(builds)
}

# Joins the per-architecture images under the commit tag and writes the release document of the commit, safely whatever
# the plan said: the registry is read again here, and once more after the write. A main commit whose document exists is left alone, and a document that
# already covers every platform of this run is left alone; otherwise a digest the existing document records is kept as it
# is and only the platforms it lacks are read from their <commit>-<arch> tag, so no platform is dropped and no recorded
# digest changes.
merge() {
  local work anchor existing metadata image reference platform digest sources
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}"
  require_ref
  document_platforms
  if is_superseded; then return 0; fi
  packages
  anchor="$(registry)/liwan-release"
  work="$(mktemp -d)"
  existing="$work/existing.json"
  echo '{}' > "$existing"
  if anchor_exists "$anchor:$GITHUB_SHA"; then
    if is_main; then
      echo "publish: $anchor:$GITHUB_SHA already exists: main never rewrites a document"
      rm -rf "$work"; return 0
    fi
    fetch_document "$anchor:$GITHUB_SHA" > "$work/document.json"
    read_platforms "$work/document.json" > "$existing"
    if covers_all "$existing"; then
      echo "publish: $anchor:$GITHUB_SHA already covers $PUBLISH_PLATFORMS: nothing to write"
      rm -rf "$work"; return 0
    fi
  fi
  use_builder
  : > "$work/digests.tsv"
  while IFS=$'\t' read -r image reference _ _ _ _; do
    sources=()
    for platform in $PUBLISH_PLATFORMS; do
      digest="$(recorded_digest "$existing" "$reference" "$platform")"
      [ -n "$digest" ] || digest="$(manifest_digest "$(arch_tag "$image" "$platform")")"
      sources+=("$image@$digest")
      printf '%s\t%s\t%s\t%s\n' "$reference" "$image" "$platform" "$digest" >> "$work/digests.tsv"
    done
    docker buildx imagetools create -t "$image:$GITHUB_SHA" "${sources[@]}"
  done < <(builds)
  python3 -c '
import json, sys
images, platforms = {}, {}
for line in open(sys.argv[1]):
    reference, image, platform, digest = line.rstrip("\n").split("\t")
    images.setdefault(reference, f"{image}@{digest}")
    platforms.setdefault(reference, {})[platform] = digest
json.dump(images, open(sys.argv[2], "w"))
json.dump(platforms, open(sys.argv[3], "w"))
' "$work/digests.tsv" "$work/images.json" "$work/platforms.json"
  PYTHONPATH=. python3 -B deploy/ci/lib/release_manifest.py --commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" \
    --images "$work/images.json" --platforms "$work/platforms.json" > "$work/release.json"
  printf 'FROM scratch\nCOPY release.json /release.json\n' > "$work/Dockerfile"
  metadata="$work/metadata.json"
  docker buildx build --platform "$DOCUMENT_PLATFORMS" --provenance=false --push -t "$anchor:$GITHUB_SHA" \
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
