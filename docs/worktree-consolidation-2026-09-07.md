# Coordinated worktree consolidation — 2026-09-07

Status: candidate reconciliation and validation in progress. Main promotion is recorded below only after acceptance.

## Scope and preservation

The user authorized committing all sixteen dirty worktrees and merging them into local `main` before the layout and Projects migration. All sixteen source snapshots were committed on their original branches. The [checkpoint manifest](consolidation/2026-09-07/checkpoints.json) records original heads, snapshot commits, trees and paths. Each snapshot is a real ancestor of the candidate, including the duplicate source branches.

The original inventory had 31 worktrees/branches, with 16 dirty and 15 clean. All branch tips before checkpointing were already ancestors of main; the remaining work was in their working directories. The meetings snapshot included three additional files and nine revised files since the initial audit; the commit captured the latest stable working tree. All original worktrees were clean immediately after checkpointing and are checked again at promotion.

No branches, worktrees, stash entries or source history are deleted. The old Phase 2 stash is outside the sixteen-worktree scope and remains untouched. No remote, push or deployment is involved. Existing services and `odoo19` are not upgraded or restarted by this consolidation.

Candidate: `/Users/tariq/code/nasq/.worktrees/consolidation-20260907`, branch `codex/consolidation-20260907`, based on main checkpoint `df282334` (previous main `a2c1534`). Independent reconciliation trees are `reconcile-web-20260907`, `reconcile-hr-20260907`, and `reconcile-meetings-20260907` under `.worktrees/`.

External recovery and detailed logs: `/Users/tariq/.codex/visualizations/2026/09/07/01a07b91-635e-7300-8483-4d649f43ae0e/nasq-consolidation`. Source commits preserve all untracked additions; binary pre-commit patches preserve tracked diffs. Ignored dependencies and local databases are not part of those Git snapshots.

## Reconciliation decisions

- Impeccable PMO and settings repair snapshots substantially duplicate `impeccable-fixes`. Useful behavior is ported into the later shared page chrome; original old page copies are not reapplied wholesale.
- HR repair snapshots and the department chart are combined in the current HR routes. The two different DirectoryTable versions receive an explicit reconciliation.
- Historical phase snapshots contain governance, schedule, templates, finance and reports already integrated through previous phase branches. [Per-path decisions](consolidation/2026-09-07/phase-decisions.md) retain later capability checks, finance exact cents, optimistic-concurrency recovery, combined contract exports, and task/project cache invalidation. Source test-name comparison found no missing source cases.
- Gantt keeps the uncommitted project date range and capped axis. Integration restores visible dates, task state and undated information, a today cue, long-name containment, and inset milestone markers. The broad pressed-button color override is removed to preserve primary button contrast. Responsive child sizing and coarse-pointer hit areas are retained from the repair snapshot.
- Meetings and Cyan are combined with current task/template behavior. Notification visibility, meeting-only UI access, Nasq-dependent Cyan tests and resolution conversion require dedicated integration repairs and verification.
- The UI constitution, project frontend role, tool adapters and approved prototype are consolidated. `DESIGN.md` is the customer UI authority; existing light/cream/dark preferences remain supported. This does not implement the subsequent replacement layout or remove all legacy CSS.
- Delivery JSON, historical reports, screenshots and settings-navigation test output remain evidence from their original runs. Their presence does not constitute current verification.

## Verification

Pending final package integration, independent review and the coordinator's gates. Focused coordinator checks already reproduced the meeting-only inbox access regression before its fix and passed afterward (9 access-policy tests); 3 schedule date tests passed. These counts are not the full acceptance result.

## Promotion

Pending. Do not treat the candidate or source checkpoint commits alone as accepted main integration.
