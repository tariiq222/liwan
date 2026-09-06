# Nasq consolidation — 2026-09-07

## Scope and preservation

The user authorized local integration, verification, and workspace cleanup.
`codex/chat-workspace` and `codex/cyan-meetings-trial`, their worktrees, files,
branches and processes are excluded from integration and cleanup.

The starting main commit is `07fed619644392e50bded94163532785feef8922`.
Integration is prepared in `/Users/tariq/code/nasq-consolidation-20260907`,
branch `codex/consolidation-20260907`.

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

The tested source is ready for local promotion; Git promotion and retirement
will be recorded after execution. Main's existing local edits remain separate.
