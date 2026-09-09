# Seven pending worktrees reconciliation — 2026-09-09

The user requested cleanup of the seven worktrees below and explicitly required reconciling all pending work before removal. The protected `codex/chat-discuss-features` worktree was excluded throughout.

Baseline main: `42ff366bb89b5a54423d7783fe8d2f0c6e39347e`. All seven source branch tips: `566590220e6ebf5a6fee4657456ecf3a894a1604`. Their dirty/untracked content was reviewed separately from branch ancestry against integrated `eb321c4` and current main, with three independent read-only reviews.

| Source branch suffix | Reconciliation |
| --- | --- |
| filter-card-pmo | Filters already integrated; later main adds record columns and approved Projects navigation. |
| meeting-backend | Contracts and backend already integrated; retain main's historical snapshots, validation, event kinds, 403 semantics and null normalization. |
| meeting-minutes-ui | Minutes editor, print route and versions already integrated; retain later snapshot isolation, legacy-content and time-format corrections. |
| meeting-timeline | Timeline, follow-up/history and filtering already integrated; retain main's current-month priority. |
| table-numbers-admin | Admin record columns already integrated; preserve collapsed filters and later corrections. |
| table-numbers-people | HR/document/meeting record columns already integrated. |
| table-numbers-pmo | Project, task, finance, report and governance numbers already integrated; preserve newer Projects tabs/sheets. |

No missing product change was found. Applying old snapshots would undo later fixes; the reconciled product tree therefore remains byte-identical to baseline main. This reconciliation adds only this evidence record, not an artificial product merge.

Shared locale review found no missing keys. Differences are later approved periodic-meeting terminology and added content. Replicated update-policy hooks already exist in canonical main's pending files. Main's newer instructions and all pending files remain preserved, without committing unrelated update-policy work.

## Fresh verification

In isolated `/Users/tariq/code/nasq-seven-pending-integration`, using frozen `npm ci --ignore-scripts` and Nuxt preparation:

- Contract and web unit suites passed (`tests.log`; 721 web tests).
- `npm run lint` passed: Vue TypeScript check and Ruff.
- No product source changes; no dependency upgrade, runtime restart, database operation or deployment.

## Recovery and cleanup

Recovery directory: `/Users/tariq/code/nasq-recovery-seven-merge-20260909-133831`.

Contains a verified Git bundle; complete per-worktree tar archives (including dirty/untracked files), per-file SHA256 manifests, source patches, comparison ledger, and canonical-main pending-file fingerprints. Archive bytes were checked against source files. All pending work is preserved even where superseded by integrated fixes.

Cleanup is limited to these seven branches/worktrees and this temporary reconciliation worktree, after open-file, source-fingerprint and main-state checks. Actual completion and final refs are recorded externally in `result.json`; this document alone is not proof that removal ran. Other worktrees and recovery material remain untouched.
