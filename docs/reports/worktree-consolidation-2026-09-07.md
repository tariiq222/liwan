# Coordinated worktree consolidation — 2026-09-07

Status: accepted and promoted into local `main`. The later authorized [runtime upgrade and cleanup](runtime-upgrade-cleanup-2026-09-07.md) supersedes this phase's retained-worktree and no-database-update statements; source snapshots remain recoverable.

## Scope and preservation

The user authorized committing all sixteen dirty worktrees and merging them into local `main` before the layout and Projects migration. All sixteen source snapshots were committed on their original branches. The [checkpoint manifest](../consolidation/2026-09-07/checkpoints.json) records original heads, snapshot commits, trees and paths. Each snapshot is a real ancestor of the candidate, including the duplicate source branches.

The original inventory had 31 worktrees/branches, with 16 dirty and 15 clean. All branch tips before checkpointing were already ancestors of main; the remaining work was in their working directories. The meetings snapshot included three additional files and nine revised files since the initial audit; the commit captured the latest stable working tree. All original worktrees were clean immediately after checkpointing and are checked again at promotion.

No branches, worktrees, stash entries or source history are deleted. The old Phase 2 stash is outside the sixteen-worktree scope and remains untouched. No remote, push or deployment is involved. Existing services and `odoo19` are not upgraded or restarted by this consolidation.

Candidate: `/Users/tariq/code/nasq/.worktrees/consolidation-20260907`, branch `codex/consolidation-20260907`, based on main checkpoint `df282334` (previous main `a2c1534`). Independent reconciliation trees are `reconcile-web-20260907`, `reconcile-hr-20260907`, and `reconcile-meetings-20260907` under `.worktrees/`.

External recovery and detailed logs: `/Users/tariq/.codex/visualizations/2026/09/07/01a07b91-635e-7300-8483-4d649f43ae0e/webvue-consolidation`. Source commits preserve all untracked additions; binary pre-commit patches preserve tracked diffs. Ignored dependencies and local databases are not part of those Git snapshots.

## Reconciliation decisions

- Impeccable PMO and settings repair snapshots substantially duplicate `impeccable-fixes`. Useful behavior is ported into the later shared page chrome; original old page copies are not reapplied wholesale.
- HR repair snapshots and the department chart are combined in the current HR routes. The two different DirectoryTable versions receive an explicit reconciliation.
- Historical phase snapshots contain governance, schedule, templates, finance and reports already integrated through previous phase branches. [Per-path decisions](../consolidation/2026-09-07/phase-decisions.md) retain later capability checks, finance exact cents, optimistic-concurrency recovery, combined contract exports, and task/project cache invalidation. Source test-name comparison found no missing source cases.
- Gantt keeps the uncommitted project date range and capped axis. Integration restores visible dates, task state and undated information, a today cue, long-name containment, and inset milestone markers. The broad pressed-button color override is removed to preserve primary button contrast. Responsive child sizing and coarse-pointer hit areas are retained from the repair snapshot.
- Meetings and Cyan are combined with current task/template behavior. Notification visibility, meeting-only UI access, WebVue-dependent Cyan tests and resolution conversion require dedicated integration repairs and verification.
- The UI constitution, project frontend role, tool adapters and approved prototype are consolidated. `DESIGN.md` is the customer UI authority; existing light/cream/dark preferences remain supported. This does not implement the subsequent replacement layout or remove all legacy CSS.
- Delivery JSON, historical reports, screenshots and settings-navigation test output remain evidence from their original runs. Their presence does not constitute current verification.

## Verification

Fresh coordinator gates on the reconciled candidate:

| Gate | Result | Evidence |
| --- | --- | --- |
| Contracts + web units | 120 + 510 passed | external `full-web-test.log` |
| Type checking + Ruff | PASS | external `lint.log` |
| Nuxt production build | PASS | external `final-build.log` |
| WebVue fresh isolated install | 460 passed | external `verified-odoo.log` |
| WebVue final isolated update after calendar fix | 462 passed, zero failures/errors | external `final-odoo.log` |
| Standalone Cyan policy | 55 passed | external `cyan.log` |
| Brand palette checks | 28 passed after neutral-surface contrast correction | external `brand-test.log` |
| Concurrent resolution conversion | One HTTP 200, one 422; exactly one task and partial unique index verified | external `concurrent-result.json`, `concurrent-db.json` |
| Source preservation | All 16 checkpoint ancestors; original 16 worktrees clean | checkpoint manifest and promotion audit |

The combined WebVue selectors are `/webvue_core,/webvue_api,/webvue_pmo,/webvue_hr`.
Standalone Cyan is tested separately because installing WebVue intentionally makes
actual current-company capabilities authoritative over Cyan's global support
groups. The final run used only `webvue_consolidation_20260907_verified`; standalone
Cyan used `webvue_cyan_standalone_20260907_final`. Neither is `odoo19`.

Regression evidence includes four normal calendar membership failures before
repair, then two missing-datetime cases with three failing assertions before
the final fix. New multi-company tests prove an A-company manager grant cannot
expose unrelated B-company meetings, resolutions, attachments or notifications.

Independent source reviews: [web](../consolidation/2026-09-07/review-web-report.md),
[HR](../consolidation/2026-09-07/review-hr-report.md),
[meetings](../consolidation/2026-09-07/review-meetings-report.md), and
[final integration](../consolidation/2026-09-07/final-integration-review-report.md).
All Important findings were reworked and accepted. Detailed package reports
sit beside these reviews. Earlier failure/pending statements in their histories
are superseded by their addenda and the fresh coordinator gates here.

Runtime checks use Odoo9976/Nuxt3976 with the named scratch database and fixture
users only. Verified project list/detail/schedule navigation, visible calendar
dates and undated tasks at 1440/768/390 widths with horizontal scrolling contained
inside the timeline, light/dark navigation contrast, HR chart/zoom/fit/full-page
controls, and selected employee manager outside the first 200 results. This is
bounded integration QA, not an all-route/device audit. A meeting-only user
opened an invitation from the notification bell, saw the meeting, and had no
Projects navigation or linked-task action. The temporary 3976/9976 verification
servers were stopped afterward; scratch databases and evidence remain.

Known boundaries: the approved replacement shell and all-Projects redesign are
still the next phase; no claim that legacy CSS was removed. Meetings calendar
currently loads the first 200 results, and native Cyan owns its state workflow.
Existing database upgrades need their own validation (including pre-existing
conversion duplicates). Existing Nuxt auto-import and development i18n/websocket
warnings are not treated as deployment evidence. Development hard refresh also
logged a department-page hydration mismatch. Independent comparison found the
query, shared PageState, Vue Query plugin and branch conditions unchanged from
`a2c1534`; no introduced HR hydration regression was identified. A baseline
runtime reproduction was not performed, so the timing cause remains an inference.
A one-time Vite dependency optimization error cleared after reload. These are
recorded limitations, not a claim of a warning-free browser run.

## Promotion

Accepted product commit: `f117bac`, followed by the documentation closure commit.
Canonical `/Users/tariq/code/nasq` advances from its `df282334` checkpoint with
`git merge --ff-only codex/consolidation-20260907`. All16 checkpoint histories
are included; final main/source cleanliness and exact commit are captured in
external `promotion.json`. Original source worktrees and all branches remain.
The original Phase2 stash is unchanged. No remote, push, deployment, `odoo19`
upgrade or existing service restart is part of this delivery.
