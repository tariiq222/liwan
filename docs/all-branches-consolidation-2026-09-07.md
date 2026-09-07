# Authorized all-branch consolidation — 2026-09-07

The user authorized merging all Nasq branches/worktrees into main, cleaning obsolete workspaces, and restarting the canonical local runtime. Scope is Nasq only; upstream Odoo source/configuration and business databases are preserved.

## Reconciliation

The inventory contained main plus eleven worktrees. Every dirty source was checkpointed before integration. The verified dashboard tree combines its data/view/mine workers byte-for-byte. Older UI source changes were already present in main with later refinements. An independent Astra source review reconciled the remaining differences. Its report is retained in the recovery directory.

The older unified-projects experiment conflicts with the latest approved dashboard and four-link sidebar. Its report tabs, hidden contextual sidebar, and templates move remain preserved in source history/recovery rather than overriding the approved design. Three independent list-page fixes are salvaged: pending search before Create, newest creation-capability outcome across cached pages, and visible capability-probe retry. History-preserving reconciliation merges explicitly retain the approved tree; they are not unreviewed wholesale source merges.

Projects now opens `/projects/dashboard`. Context links are إحصائية المشاريع, مشروع جديد, كل المشاريع, مشاريعي. My Projects filters by the current project manager before pagination; create remains capability gated. Templates remain accessible from All Projects. `/reports` redirects to the dashboard with filters.

## Recovery

Recovery directory: `/Users/tariq/code/nasq-recovery-all-20260907-212511`. Original/checkpoint bundles, per-worktree source tarballs, staged/unstaged binary patches, status/HEAD manifests and checksum manifest preserve the starting state. Full retired directories including ignored files and original Git worktree metadata are retained there. `RESTORE.md` explains recovery without using obsolete .git pointers. The old Phase2 stash is preserved in the bundle; its card/table functionality already exists and its modal design is superseded by route-backed task details.

## Verification and runtime

Backend verification passed on fresh isolated database `nasq_all_verify_20260907`: 37 focused project/report tests, zero failures/errors. No tests run on `odoo19`. Fresh frontend gates: 122 contract + 542 web unit tests, Vue typecheck, changed-Python Ruff and Nuxt production build passed. Ten browser cases passed against isolated Nuxt3983/Odoo9983 (three widths, dark/large type, navigation, filtered returns, error/retry and cached capability denial). Independent Astra salvage review found no blocker. Canonical restart evidence is recorded at closure.
