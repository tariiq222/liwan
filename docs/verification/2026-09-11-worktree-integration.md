# Worktree consolidation — 2026-09-11

## Scope and reconciliation

Authorized by Tariq: commit existing changes, then consolidate all branches and
worktrees into local main. Baseline: `d4b6fc9eab5a1564750ce338b7bcf3448f22fdea`.
All nine existing task branch refs already pointed to this same commit; none had
unique committed history. The actual pending work was dirty/untracked content.

The 296 distinct changed paths across the nine source worktrees are represented
in the migration candidate. `nasq-nuxt-migration` already contains the combined
packages and later coordinator repairs, as confirmed by historical task evidence,
current variant diffs and three independent Luna high reconciliation reviews.
The coordinator applied its saved patch to a clean worktree at current main,
reviewed shared contracts/shell/query/theme changes and reconciled the findings.
No older worker file was restored over a later accepted repair.

Source worktrees: `nasq-all-ui-hr-access`, `nasq-all-ui-meetings-chat`,
`nasq-all-ui-projects-tasks`, `nasq-nuxt-advanced-grok`, `nasq-nuxt-migration`,
`nasq-nuxt-project-pages`, `nasq-nuxt-projects-claude`, `nasq-nuxt-shell-grok`,
`nasq-nuxt-tasks-claude`, all under `/Users/tariq/code/`.
Names of old external-provider worktrees are historical; this task used native
Luna high only. All original dirty worktrees and branches remain preserved.

## Review corrections

- HR department metadata uses the existing translated employee label; its numeric
  count is preserved.
- Password validation creates alert spans only when an error exists, retaining
  Nuxt field associations and live error announcements.
- Two browser fixtures explicitly set completion approval to none on their own
  projects before testing direct completion. The existing scratch database default
  required approval and returned 403; PMO backend source is unchanged from main.
- The review suggestion to move Projects filters out of header actions was withdrawn:
  their content is inside UPopover and the trigger beside Add matches DESIGN.md.
  Optional secondary-button variant polish remains outside this consolidation.

## Fresh verification

- Final `npm test`: 15 UI policy regressions, inventory check, 371 Vue templates
  with zero syntax errors, 160 contract tests and 811 web tests passed.
- Final `npm run lint`: Vue typecheck and Ruff passed.
- Final isolated `npm run build`: passed after the review corrections.
- Branding backend: 14 selected tests, zero failures/errors on the new isolated DB.
- Browser: 23 workflow scenarios passed across the recorded batches after fixture
  correction. After the two HR/account source repairs, two focused checks passed
  on the rebuilt candidate: translated department metadata/no empty alerts, and
  password/date accessibility associations. This is 24 distinct scenarios total.
- Inspected current desktop project-summary and mobile task-detail screenshots.
  This is representative integration coverage, not a new all-pages visual audit.
- `git diff --check`: clean. Existing source worktree patches/untracked bytes
  remained unchanged since the initial preservation snapshot.

Evidence: `test-final.log`, `lint-final.log`, `build-final.log`,
`odoo-branding.log`, `browser.log`, `browser-final.log`, `browser-fixture.log`,
`review-before.log` and `review-final.log` in the external artifacts directory.
The initial empty-alert check reproduced before the fix and passed afterward.

The isolated candidate runtime uses port3479 and proxies scratch Odoo9469/database
`nasq_nuxt_migration_20260910`. Browser test copies outside Git change only module
resolution and the explicit allowed preview port from3469 to3479. Application
source is the candidate build. Tests create records only in that scratch database.
Backend branding tests use a new database `nasq_merge_branding_20260911` with the
candidate addons path, never `odoo19`.

The first browser attempt retained an old port substring guard in13 tests; those
stopped before their scenarios. After correcting the temporary harness port,
21 scenarios passed and two exposed the inherited completion-approval fixture
assumption. Both passed after explicit per-project fixture setup. Logs preserve
all failed attempts and the final evidence; no assertion was removed or weakened.

## Preservation and promotion

External snapshots, variant reports, logs and screenshots:
`/Users/tariq/code/nasq-merge-20260911-artifacts`.
The integration worktree is `/Users/tariq/code/nasq-merge-all-20260911` on
`codex/merge-all-20260911`. Promotion is a fast-forward only after verifying
canonical main still equals the recorded baseline and is clean. The exact resulting
commit and post-promotion status are recorded in the external promotion log.

This is local source integration. No push, deployment, canonical runtime restart,
branch/worktree deletion, scratch database removal, or production verification.
Older verification reports remain historical and do not override this record.
