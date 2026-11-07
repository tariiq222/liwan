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
- [ ] Actual combined diff reviewed at the recorded head; findings resolved or documented.
- [ ] Actual diff reviewed against the recorded remote baseline.
- [ ] Prior approved behavior and regression requirements preserved.
- [ ] Remaining failures, unverified behavior and release blockers described below.

## Authorization and delivery

- Authorization basis: standing authorization (integration-rules.md), or the owner's explicit words and their scope:
- Remaining risks / recovery approach:

Keep this PR **draft** until local preparation and checks are complete. Mark
ready to request CI and review of the current candidate. The required status-check
policy is `ci-result` only; review uses the selected available agent or a human.
Before merging, recheck base/head, live rules, selected CI stages and review
findings, and repeat affected verification when either head moves. Merging falls
under the standing authorization in
[integration-rules.md](../docs/agents/integration-rules.md); release tags,
deployment and the other excluded operations need the owner's explicit words.
These boxes record evidence; they do not grant authority.
