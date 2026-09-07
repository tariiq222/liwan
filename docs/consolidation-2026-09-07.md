# Nasq consolidation — 2026-09-07

> UI authority update — 2026-09-07: [DESIGN.md](../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

## Scope and preservation

The user authorized local integration, verification, and workspace cleanup.
`codex/chat-workspace` and `codex/cyan-meetings-trial`, their worktrees, files,
branches and processes are excluded from integration and cleanup.

The starting main commit is `07fed619644392e50bded94163532785feef8922`.
The verified product integration was fast-forwarded locally into `main` at
`8af1060f9b961ffa67e8d5fc6dd1fe38c3beb816`. Final closure changes documentation
only. The temporary `codex/consolidation-20260907` worktree is retired as the
last cleanup step; the final registry is captured in recovery.

Recovery is `/Users/tariq/code/nasq-recovery-merge-20260907-004623`.
Its verified Git bundle and 20 source snapshots preserve original non-chat
refs, tracked/untracked files, hashes, staged changes and incomplete merges.
Read its `RESTORE.md` before restoring into a separate directory.

## Integration policy

- PSC comes from the resolved `psc-integration-current` candidate, including
  completion approvals, company creation requirements, deadline reminders,
  digest visibility and guarded verification tooling.
- Charter adds its 26 fields, project references and stale-write protection.
  Optional charter metadata does not bypass the company's configured manager
  and end-date requirements. Name-only creation is available when those
  requirements are disabled. Existing partial dates retain PSC behavior.
- Settings navigation and unsaved-change confirmation retain their approved
  source behavior. The header search and notification exceptions remain.
- Old design/navigation changes are compared as changes against their original
  base; whole older files must not replace newer main fixes.
- The Cyan meeting trial remains in its original worktree at the user’s request.
  No files from that trial were applied to this integration.
- Main's existing `apps/web/nuxt.config.ts` and `deploy/Caddyfile` changes are
  retained uncommitted and included in effective-tree verification. `.agent/`
  remains local evidence. No upstream Odoo source or `odoo19` tests are allowed.

## Verification and promotion

Backend r3 is verified on a fresh isolated database: 355 Odoo tests, zero
failures or errors. Legacy upgrade and repeat-upgrade both pass preservation
checks after the managed-catalog ACL repair. The r2 concurrent completion,
policy-change and digest-worker checks pass; subsequent backend changes only
repair reviewer company eligibility and catalog ACLs, leaving locking unchanged.
Operations tests pass (39). No check ran against `odoo19`.

Frontend remediation is verified: 95 contract and 335 web unit tests pass;
Vue type checks and Ruff pass; the final production build passes. The focused
browser rerun passes 14/14, followed by the full final run passing 130/130
(exit 0, `logs/e2e-final.log`). The final run uses fresh digest fixtures because
the digest scenario deliberately changes visibility and dates. Earlier failed
runs are diagnostic evidence, not the acceptance result.

Independent backend and frontend remediation review is accepted in
`final-review.md`. Repairs include managed-user catalog ACLs, foreign-company
reviewer eligibility, charter/catalog unsaved guards, stale-search protection,
and containment of the assigned-users table on mobile. No production rollout
or database upgrade is implied by these isolated checks.

## Promotion and cleanup

Local promotion is complete. Every non-document file in main, including the
preserved local runtime edits, matched the recorded tested effective-source
manifest after fast-forward. The original stash remains unchanged.

18 original worktrees and their local branch refs were retired after a fresh
source/hash/HEAD check, full-directory preservation, and process ownership
checks. Their complete original directories, including ignored local files,
are retained in `retired-worktrees`; `retired-map.json` maps original paths to
archives. The original bundle retains their committed history and snapshots
retain staged/uncommitted source and interrupted merge states.

The retained working set is:

- `/Users/tariq/code/nasq` — `main`.
- The original `nasq-chat-workspace` — `codex/chat-workspace`, excluded.
- The original Cyan meetings trial — `codex/cyan-meetings-trial`, excluded.

The temporary integration worktree is archived after this closure record is
promoted. `final-worktrees.json` and `final-branches.txt` in recovery record the
actual closing registry; `final-main.bundle` preserves the final main history.
Old preview/scratch servers belonging to retired worktrees were stopped.
Temporary verification servers are shut down during final cleanup. Scratch
databases are retained; no database or protected worktree is deleted.

## Remaining work and boundaries

Chat and meetings remain ongoing and unmerged. Main's prior runtime changes in
`apps/web/nuxt.config.ts` and `deploy/Caddyfile` remain uncommitted; `.agent/`
remains local. No remote push, deployment, production upgrade or `odoo19`
verification occurred. Older branch plans/reports are recovery/history, not
new outstanding work in this consolidated source.
