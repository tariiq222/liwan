# Meetings integration — 2026-09-08

The approved meetings work was combined in an isolated integration worktree before updating local main.

- Main baseline: `810c21a76fc227ef55f7f5a1931320fdced2529f`.
- Incoming meetings commit: `5ddd78f8ad7ca9b376835109906d180f63b03aba`.
- Candidate: `codex/meetings-integration`, based on the recorded main baseline.

## Preserved behavior

The merge preserves main's module order, pinned create actions, settings groups, shell motion, reduced-motion rules, no-breadcrumb policy, and latest-five notification formatting. The only textual conflict was the Lucide import in `useNav.ts`; main's CalendarDays choice remains, with Repeat added for meeting series. No source file is deleted by the merge.

`NotificationPreviewKind` now uses the contract's `NotificationKind`, so the existing preview formatter supports meeting changes, cancellation, reminders, and overdue resolutions. A regression test covers the new kinds while retaining every existing notification-formatting test.

The incoming branch adds the series/recurrence/calendar workflows and reviewed permission, lifecycle, resolution, conversion, scheduling, and SSR fixes. The new tests and existing main regression checks are retained.

## Verification

All checks run against the combined candidate, not either parent alone:

- Fresh isolated Odoo installation (`nasq_core,nasq_api,nasq_pmo,nasq_hr`) on `nasq_meetings_merge_20260908`: 518 passed, zero failures/errors.
- Contracts: 147 passed.
- Web: 648 passed in 113 files.
- `npm run lint`: vue-tsc and Ruff passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Cleanup and recovery

Only meetings worktrees are in this cleanup scope. Navigation, sidebar and notification worktrees are unrelated and remain untouched.

Before removing the three dirty worker checkouts, their complete source snapshots were archived and byte-verified against their files. Dependency/generated directories were excluded. The manifest records the original paths, heads, dirty statuses, and archive SHA256 values. A verified Git bundle contains main and the four meetings branch histories.

Recovery: `/Users/tariq/code/nasq-recovery-meetings-20260908/`.

Previous browser/scenario evidence remains at `/Users/tariq/.codex/visualizations/2026/09/08/01a080dd-629d-7aa3-9522-49ad2428a492/meetings-scenarios-verification.md`; those observations describe the meetings branch before integration, not a new browser run of this combined candidate.

No push, production deployment, canonical runtime restart, or odoo19 database upgrade is part of this merge. Test databases and earlier recovery material remain preserved.
