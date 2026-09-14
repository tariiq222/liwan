# Nasq agent entry point

## واجهة العميل

ابدأ من [DESIGN.md](DESIGN.md): سياسة الواجهة الوحيدة وروابط فهرس المكونات والمرجع التقني.
التنفيذ في `apps/web/app`. [الأرشيف](docs/archive/ui/README.md) والتقارير وخطط التنفيذ أدلة لسياقها، لا تعليمات واجهة نشطة.
اتبع [UPDATE_POLICY.md](docs/UPDATE_POLICY.md).

Read `CLAUDE.md` for the product architecture and engineering rules, then
`docs/WORKSPACE.md` for the workspace and recovery map. Read
`docs/parallel-work.md` before parallel work or changing shared files.
These are repository instructions for every coding agent, regardless of tool.

- Verify the current branch, worktree, and dirty paths before editing. The
  canonical local development checkout is `/Users/tariq/code/nasq` on `main`.
- Develop bounded tasks in temporary `codex/<task>` worktrees based on current
  `main`. Give each task explicit file ownership and independent dependencies,
  generated files, databases, and ports. One orchestrator owns Git integration,
  shared-file edits, runtime changes, and final checks.
- Preserve stock Odoo source. Extend `project` through `nasq_pmo` and `hr`
  through `nasq_hr`. Do not recreate either pillar.
- The HR page is `/hr`; `/api/v1/people` remains the PMO user-id picker. Preserve
  HR documents and the `{items, total}` list envelopes.
- Presentation (pages, the one route-backed record sheet, and the three overlay
  exceptions) follows DESIGN.md. Keep direct links, refresh/back, filters,
  permissions and draft protection. Do not stack business dialogs. Confirm
  destructive actions inline. Value-selection menus are controls, not screens.
- Read `docs/WORKSPACE.md` for the checkout map and current delivery records.
  Verify branch and dirty state live. Dated integration/recovery reports and
  older WIP describe their own checkpoints, not the current source state.
- Never run tests on `odoo19`. Do not commit, merge, push, deploy, remove
  worktrees/branches, or discard work without authorization for that action.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.

## Preserve approved work on every merge — 2026-09-08

The user's instruction «كومت ودمج» means: commit the requested work and
integrate it into the latest local `main`, preserving previously approved
behavior and adding the requested changes. It does not authorize undoing an
earlier decision, merging unrelated worktrees, or deleting recovery material.

Before every integration, including from an older worktree:

1. Read this policy from the canonical `/Users/tariq/code/nasq/AGENTS.md` and
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
   new tip. Promote only the verified candidate with a fast-forward, then
   verify the resulting commit and working-tree state. Preserve other active
   worktrees; cleanup still needs separate authorization.

These are mandatory agent workflow instructions. They are not a Git hook or
server-enforced branch protection; do not claim automated merge protection
exists unless it has actually been installed and verified.

## Implementation agent routing — 2026-09-07 (scoped 2026-09-09)

This rule applies to Codex only. When the coordinator runs inside Codex, all
implementation agents must use GPT-5.6 Luna with high reasoning effort
(`luna-high`); read-only review agents may use Astra. Do not substitute another
implementation model there without a new user instruction.

In OpenCode (including the Flex-* agents and `flex_delegate`) this rule does
not apply: models are chosen per task from the connected providers by cost and
adequacy, subject to any restriction the user gives in that session. The
coordinator owns planning, integration and review in both tools.
