## Result

What problem does this solve, and what changes for the user?

## Scope and dependencies

- Included branches / prerequisite PRs:
- Remote `main` baseline SHA:
- Reviewed head SHA:
- Affected applications, shared contracts or migrations:

## Verification

List actual commands / CI links, checked commit, result and environment.
Distinguish focused checks, combined-candidate checks and a full release run.

- [ ] Applicable local checks passed on the combined result.
- [ ] Current PR `ci-result` and selected stages passed; skipped stages inspected.
- [ ] Current-head Claude GitHub review completed; automation-authored heads also need the owner approval of that SHA.
- [ ] Actual diff reviewed against the recorded remote baseline.
- [ ] Prior approved behavior and regression requirements preserved.
- [ ] Remaining failures, unverified behavior and release blockers described below.

## Authorization and delivery

- Delivery scope (low-risk policy, or sensitive owner approval of this exact SHA):
- Remaining risks / recovery approach:

Keep this PR **draft** until local preparation and checks are complete. Mark
ready to request GitHub review, CI and bounded automatic delivery. Sensitive scope
needs `/webvue approve <head-sha>` from the owner. Safe repairs have a three-cycle
limit. These boxes are evidence; actual SHA-bound gates control protected merging. Before merge,
recheck base/head and repeat affected verification if either moved. Publication,
merge, release, deployment and cleanup have separate authorization boundaries.
