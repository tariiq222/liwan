# Integration rules: preserve approved work on every merge

The authorization meaning of «كومت ودمج» and the git-hook caveat are in `AGENTS.md` ("Preserve approved work on every merge"). These steps are mandatory.

Before every integration, including from an older worktree:

1. Read this policy from the canonical `/Users/tariq/code/webvue/AGENTS.md` and
   the latest committed `main`, not only the incoming worktree's older copy.
   Inspect and preserve dirty changes in both checkouts. Record the current
   `main` commit and incoming commit as the integration baseline.
2. Prepare the combined result in an isolated integration worktree based on
   that current `main`. A branch that started earlier has no priority over
   later approved work. Do not replace whole files from the incoming tree,
   use blanket `ours`/`theirs` conflict resolution, reset `main` to that tree,
   or treat an ancestor commit's presence as proof its behavior survives.
3. Review the candidate diff against the recorded current `main`, including
   deletions, shared components, design decisions, navigation, permissions,
   contracts and regression tests affected by the incoming work. Reconcile
   changes so both compatible sets of approved behavior remain. Resolve
   accidental regressions without asking the user to reapprove old decisions.
4. Run applicable checks on the combined result. Retain the regression
   requirements from the recorded `main`; an incoming branch must not make
   its own regression pass by silently removing or weakening those checks.
   A failing check requires diagnosis: distinguish a reproduced baseline
   failure from a new regression and report the actual result. No new
   regression may be accepted as a completed merge.
5. If the new request genuinely conflicts with a prior approved behavior,
   preserve that behavior and ask for the specific decision needed. General
   permission to commit and merge does not authorize that reversal. Explicit
   user approval to replace the old behavior permits the corresponding code
   and regression-test update.
6. Before updating `main`, verify it still points to the recorded baseline.
   If another task advanced it, rebuild and verify the candidate against the
   new tip. For manual integration, promote the verified candidate with `git merge --no-ff`.
   Integration is a GitHub pull request merged with a merge commit once the `ci` workflow
   (`ci-result`) has passed on the PR; the owner's authorization for that merge is required.
   Then verify the
   resulting commit and working-tree state. Preserve other active
   worktrees; cleanup still needs separate authorization.
