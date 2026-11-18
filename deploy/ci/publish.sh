#!/usr/bin/env bash
# Publish stage: build the production images, release them as a signed manifest, and promote that manifest. Run by
# .github/workflows/publish.yml; the owned images and how they are built come from deploy/production-images.json.
#   plan                     print the images, the registry and the attestation types; touches nothing (local inspection)
#   build <arch> <out-dir>   build every image for linux/<arch> on a native runner, push it by digest, smoke-check and scan
#                            it with deploy/ci/image.sh (the same images, tagged locally), write one digest file per image
#   merge <digests-dir>      combine the per-arch digests (digests-amd64/ and digests-arm64/ as downloaded) into a
#                            multi-arch index per image tagged with the commit, write the
#                            release document and attest it keylessly on <registry>/liwan-release:<commit>
#   promote                  on a release/* tag: re-attest the already published release document of the tagged commit for
#                            production; nothing is rebuilt, and a commit with no published document is a failure
set -euo pipefail
cd "$(dirname "$0")/.."/..
OIDC_ISSUER="https://token.actions.githubusercontent.com"
ATTESTATION_BASE="https://liwanos.com/attestations/release-manifest"

# One tab-separated line per published image: registry image, reference, local name for image.sh ("-" if none),
# Dockerfile, context, NAME=value build arguments (see deploy/image_pins.py --print-builds). CI-only builds are left out.
builds() { python3 -B deploy/image_pins.py --print-builds | awk -F'\t' '$1 != "-"'; }
registry() { builds | head -n 1 | cut -d/ -f1,2; }
attestation_type() { printf '%s/%s/v1' "$ATTESTATION_BASE" "$1"; }
signer() { printf 'https://github.com/%s/.github/workflows/publish.yml@%s' "${GITHUB_REPOSITORY:?}" "$1"; }
fail() { echo "publish: $*" >&2; exit 1; }
index_digest() { docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | python3 -c 'import json, sys; print(json.load(sys.stdin)["digest"])'; }

plan() {
  echo "registry: $(registry)"
  builds | while IFS=$'\t' read -r image reference _ dockerfile context args; do
    echo "image: $image (docker build -f $dockerfile $context; args: ${args:-none})"
  done
  echo "staging attestation: $(attestation_type staging)"
  echo "production attestation: $(attestation_type production)"
}

# On main the images are pushed by digest. On any other ref (a manual run on a branch) they are only loaded into the
# local daemon: nothing leaves the runner, and image.sh still smoke-checks and scans them.
build() {
  local arch="${1:?arch}" out="${2:?out dir}" metadata digest argv tag
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}" "${GITHUB_REPOSITORY:?}"
  mkdir -p "$out"
  docker buildx create --name liwan-publish --driver docker-container --use >/dev/null
  metadata="$(mktemp)"
  while IFS=$'\t' read -r image reference local_name dockerfile context args; do
    argv=()
    for pair in ${args//,/ }; do argv+=(--build-arg "$pair"); done
    tag="liwan-$reference:ci-$GITHUB_RUN_ID"
    if [ "$GITHUB_REF" = refs/heads/main ]; then
      docker buildx build --platform "linux/$arch" -f "$dockerfile" ${argv[@]+"${argv[@]}"} --provenance=false \
        --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
        --label "org.opencontainers.image.revision=$GITHUB_SHA" --metadata-file "$metadata" \
        --output "type=image,name=$image,push-by-digest=true,name-canonical=true,push=true" "$context"
      digest="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["containerimage.digest"])' "$metadata")"
      printf '%s\n' "$digest" > "$out/$reference"
      [ "$local_name" = - ] || { docker pull "$image@$digest"; docker tag "$image@$digest" "liwan-$local_name:ci-$GITHUB_RUN_ID"; }
    else
      docker buildx build --platform "linux/$arch" -f "$dockerfile" ${argv[@]+"${argv[@]}"} --provenance=false --load \
        -t "$tag" "$context"
      [ "$local_name" = - ] || docker tag "$tag" "liwan-$local_name:ci-$GITHUB_RUN_ID"
    fi
  done < <(builds)
  rm -f "$metadata"
  LIWAN_IMAGE_PREBUILT=1 deploy/ci/image.sh
}

# The index just created must hold exactly the two per-arch images; the digest is read once and then checked by content,
# so a tag moved in between cannot put another image into the release document.
index_of() {
  local image="$1" amd64="$2" arm64="$3" digest
  digest="$(index_digest "$image:$GITHUB_SHA")"
  docker buildx imagetools inspect --raw "$image@$digest" | python3 -c '
import json, sys
found = sorted(item["digest"] for item in json.load(sys.stdin)["manifests"])
sys.exit(0 if found == sorted(sys.argv[1:]) else "index " + sys.argv[0] + " does not hold exactly the built images")
' "$amd64" "$arm64" || fail "$image index does not hold exactly the amd64 and arm64 images just pushed"
  printf '%s' "$digest"
}

merge() {
  local digests="${1:?digests dir}" work anchor anchor_digest metadata amd64 arm64
  : "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_REF:?}" "${GITHUB_REPOSITORY:?}"
  [ "$GITHUB_REF" = refs/heads/main ] || fail "release documents are published from main only, not $GITHUB_REF"
  work="$(mktemp -d)"
  : > "$work/images.tsv"
  while IFS=$'\t' read -r image reference _ _ _ _; do
    amd64="$(cat "$digests/digests-amd64/$reference")"
    arm64="$(cat "$digests/digests-arm64/$reference")"
    docker buildx imagetools create -t "$image:$GITHUB_SHA" "$image@$amd64" "$image@$arm64"
    printf '%s\t%s@%s\n' "$reference" "$image" "$(index_of "$image" "$amd64" "$arm64")" >> "$work/images.tsv"
  done < <(builds)
  python3 -c 'import json, sys; print(json.dumps(dict(line.rstrip("\n").split("\t") for line in open(sys.argv[1]))))' \
    "$work/images.tsv" > "$work/images.json"
  PYTHONPATH=. python3 -B deploy/ci/lib/release_manifest.py --commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" \
    --images "$work/images.json" > "$work/release.json"
  printf 'FROM scratch\nCOPY release.json /release.json\n' > "$work/Dockerfile"
  anchor="$(registry)/liwan-release"
  metadata="$work/metadata.json"
  docker buildx build --provenance=false --push -t "$anchor:$GITHUB_SHA" --metadata-file "$metadata" "$work"
  anchor_digest="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["containerimage.digest"])' "$metadata")"
  cosign attest --yes --type "$(attestation_type staging)" --predicate "$work/release.json" "$anchor@$anchor_digest"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { printf 'Signed staging release for %s\n\n| Image | Index digest |\n| --- | --- |\n' "$GITHUB_SHA"
      awk -F'\t' '{ printf "| %s | %s |\n", $1, $2 }' "$work/images.tsv"
      printf '\nRelease document: `%s@%s`, attestation type `%s`\n' "$anchor" "$anchor_digest" "$(attestation_type staging)"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  rm -rf "$work"
}

promote() {
  : "${GITHUB_SHA:?}" "${GITHUB_REF:?}" "${GITHUB_REPOSITORY:?}"
  case "$GITHUB_REF" in refs/tags/release/*) ;; *) fail "promote runs on a release/* tag, not $GITHUB_REF" ;; esac
  local anchor anchor_digest work
  anchor="$(registry)/liwan-release"
  anchor_digest="$(index_digest "$anchor:$GITHUB_SHA" 2>/dev/null)" ||
    fail "no published release document for commit $GITHUB_SHA: merge it to main and wait for the publish run before tagging"
  work="$(mktemp -d)"
  cosign verify-attestation --type "$(attestation_type staging)" --certificate-oidc-issuer "$OIDC_ISSUER" \
    --certificate-identity "$(signer refs/heads/main)" "$anchor@$anchor_digest" > "$work/verified.jsonl" ||
    fail "the staging release document of $GITHUB_SHA is not signed by the main branch of this workflow"
  python3 -c '
import base64, json, sys
commit = sys.argv[2]
for line in open(sys.argv[1]):
    predicate = json.loads(base64.b64decode(json.loads(line)["payload"]))["predicate"]
    if predicate["commit"] == commit:
        json.dump(predicate, open(sys.argv[3], "w"))
        sys.exit(0)
sys.exit("the verified release document is not for commit " + commit)
' "$work/verified.jsonl" "$GITHUB_SHA" "$work/release.json"
  cosign attest --yes --type "$(attestation_type production)" --predicate "$work/release.json" "$anchor@$anchor_digest"
  echo "Promoted $GITHUB_SHA to production as $GITHUB_REF (same digests, no rebuild)."
  rm -rf "$work"
}

case "${1:-}" in
  plan|build|merge|promote) "$@" ;;
  *) echo "usage: publish.sh plan | build <arch> <out-dir> | merge <digests-dir> | promote" >&2; exit 2 ;;
esac
