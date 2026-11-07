#!/usr/bin/env bash
# CI alert: keep one open `CI is red on main` issue while the main/nightly run of the `ci` workflow is red.
#   CI_RESULT=<needs.ci-result.result> deploy/ci/main-alert.sh
# A failed ci-result opens the issue (label ci-red) or, when one is open, comments the run URL and the failed jobs.
# A passed ci-result comments the green run URL on the open issue and closes it. Any other result changes nothing.
# A run of a commit that is no longer the head of main changes nothing: push and nightly runs overlap, and an
# older green run must not close the alert of a newer red one.
# A failing `gh` call fails the job on purpose: a broken alert must be seen.
set -euo pipefail
for name in GH_TOKEN GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_SHA CI_RESULT; do
  [ -n "${!name:-}" ] || { echo "main-alert: $name is required" >&2; exit 2; }
done
export GH_REPO="$GITHUB_REPOSITORY"
LABEL=ci-red
TITLE='CI is red on main'
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
open_issue() { gh issue list --label "$LABEL" --state open --limit 1 --json number --jq '.[0].number // empty'; }
failed_jobs() {
  gh run view "$GITHUB_RUN_ID" --json jobs \
    --jq '[.jobs[] | select(.conclusion == "failure" and .name != "ci-result") | .name] | join(", ")'
}
main_head() { gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha; }
case "$CI_RESULT" in
  failure|success)
    head="$(main_head)"
    if [ "$GITHUB_SHA" != "$head" ]; then
      echo "run of $GITHUB_SHA is stale: main is at $head; no alert change"
      exit 0
    fi
    ;;
esac
case "$CI_RESULT" in
  failure)
    body="The \`ci\` run is red: $RUN_URL
Failed jobs: $(failed_jobs)"
    issue="$(open_issue)"
    if [ -n "$issue" ]; then
      gh issue comment "$issue" --body "$body"
    else
      gh label create "$LABEL" --force --color B60205 --description 'CI is red on main'
      gh issue create --title "$TITLE" --label "$LABEL" --body "$body"
    fi
    ;;
  success)
    issue="$(open_issue)"
    if [ -n "$issue" ]; then
      gh issue comment "$issue" --body "The \`ci\` run is green again: $RUN_URL"
      gh issue close "$issue"
    fi
    ;;
  *) echo "ci-result is $CI_RESULT: no alert change" ;;
esac
