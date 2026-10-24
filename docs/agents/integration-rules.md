# Integration rules: one PR, green CI, owner's go

This is the operational source for integration. `AGENTS.md` owns architecture and
product contracts; `REVIEW.md` owns review criteria; `docs/testing.md` owns check
commands. Historical plans and an incoming worktree's older instructions do not
replace the current policy.

## The development-stage flow

WebVue is in development (owner decision 2026-10-24): integration is kept simple.

1. Work on a `claude/<area>-<slug>` branch from current `main`, run the focused local
   checks from `docs/testing.md`, push and open a PR.
2. `ci` runs on the PR. `ci-result` is the only required check.
3. The Claude review in `pr-review` comments on ready PRs. It is advisory: read its
   findings and fix real defects, but it does not block the merge.
4. When `ci-result` is green, the branch is up to date with `main` and the owner says
   to merge ("ادمج", "تصرف" or equivalent for that PR), merge it with a merge commit.
5. The push to `main` runs the full `ci`; `release-version` then tags the release.

The owner's go is given per PR or per batch in the conversation; it does not extend to
other PRs, production deployment or cleanup.

## Integration steps

1. **Record the baseline.** Fetch `origin` and compare local and remote `main`.
   Remote `main` is the baseline; local `main` can be stale. Inspect dirty paths
   before editing.
2. **Prepare one candidate.** An independent task uses its own PR. A coupled batch
   uses one `claude/tools-integrate-<slug>` branch and one PR. Bring the latest
   `main` in with a merge, never by rebasing someone else's branch. Preserve incoming
   commits and approved behavior: no blanket `ours`/`theirs`, no replacing whole
   files, no reset of `main` to an incoming tree. Regenerate the API artifacts once
   on the integration branch when routes or contracts change.
3. **Review the complete delta** against the baseline, following `REVIEW.md`,
   including deletions, permissions, contracts and migrations. If the request
   conflicts with an earlier owner decision, keep that decision and ask.
4. **Verify the combined result** with the checks of the affected layers. Odoo
   checks use isolated scratch databases, never `odoo19`. Record commands, commit
   and results in the PR, including any failure that also exists on `main`.
5. **Merge** when `ci-result` is green on the current head and the owner has said so.
6. **Synchronize.** Confirm the merge SHA and the post-merge CI. Fast-forward local
   `main` only when it is clean or its dirty paths are provably disjoint; never
   auto-stash, reset or force-push to synchronize. Cleanup of worktrees, branches and
   scratch databases is a separate authorized action through `tools/wt.py gc`.

## PR handoff

Use the repository PR template: one bounded outcome, prerequisites, baseline and head,
verification evidence and what is unverified. A dependent branch stays draft until it
is tested against the merged parent.

## GitHub protection

`protect-main` requires a PR, `ci-result`, an up-to-date branch, resolved conversations
and merge commits, with no bypass actors, force updates or branch deletion. Recheck the
live settings before relying on them; this document is not a snapshot.

## Release numbers

`release-version` runs after successful CI on `main`. It verifies the CI workflow
identity, repository, event, exact `main` SHA and all twelve stage groups, including
every matrix job and `ci-result`, with no skipped stages. It then creates the next
immutable `release/19.0.X.Y.Z` tag by incrementing the final numeric component; a
repeated event reuses the commit's existing tag. Scoped PR CI cannot create a release
number. A tag never deploys production or changes addon schema versions.
