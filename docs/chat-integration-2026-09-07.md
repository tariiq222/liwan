# Chat integration — 2026-09-07

> UI authority update — 2026-09-07: [DESIGN.md](../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

The user authorizes merging and cleaning `codex/chat-workspace`. The Cyan
meetings trial remains excluded. Base main is `d63f82f`; original chat HEAD
is `07fed61` with its full uncommitted source preserved before integration.

Recovery: `/Users/tariq/code/nasq-recovery-chat-merge-20260907`.
`original.bundle`, `chat-complete.patch`, `source`, `source-manifest.json`,
`chat.index` and `main-local` preserve original history, source and runtime
edits. Read `RESTORE.md` before restoring into a separate directory.

The chat module reuses native Odoo Discuss channels, messages, memberships
and attachment access. It adds routed chat pages, member and attachment
information, recipients, messaging, unread state and polling. Current sidebar
settings placement, charter contracts and existing runtime proxy changes are
preserved. New provisioned installations include `nasq_chat`; this operation
does not deploy or upgrade `odoo19`.

Final candidate gates passed on the integrated source:

- 102 contract tests, 347 web unit tests, 39 operations tests.
- 370 Odoo tests, zero failures/errors, on fresh isolated database
  `nasq_psc_scratch_chatmerge_final_20260907`.
- 135 browser tests in 3 minutes against isolated Odoo 9892 / web 3892,
  including chat delivery, focused short-thread read receipts, attachments,
  membership security, current project/HR flows and fresh PSC fixtures.
- Web types, Ruff and production build passed. Arabic mobile chat screenshot
  inspected; Arabic desktop and English mobile screenshots retained.
- Independent source review accepted all three repaired findings: cursor
  bursts preserve every message, explicit empty-capability role assignments
  remain eligible, and initial/polled visible messages mark read without a
  scroll event. Regressions were observed failing before repairs. The burst
  test was corrected to request all three pages for its 107 messages.

Fresh logs are in recovery `logs/final-*`; reviewer acceptance is
`review-final.md`. Product commit `651e179` was fast-forwarded into local `main`. All effective
tracked files matched the tested candidate after promotion. The original chat
and temporary integration directories and both branch refs were deleted.
Source snapshots, bundles and meaningful test evidence are retained; generated
dependencies and caches were removed. Exact chat/verification processes were
stopped. Meetings and the four independent Phase 1 worktrees were preserved.
`promotion-proof.txt` and `cleanup-proof.txt` record the final operations.
No production deployment or production database upgrade is claimed.

Cleanup removed the original and temporary worktree directories after source
preservation and stopped-process checks. Source/test evidence is retained;
regenerable dependencies and build caches are discarded. Meetings and main's
unrelated local runtime edits are preserved uncommitted. Independently created
Phase 1 worktrees are outside this cleanup scope.
