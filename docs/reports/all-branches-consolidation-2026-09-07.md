# Authorized all-branch consolidation — 2026-09-07

The user authorized merging all WebVue branches/worktrees into main, cleaning obsolete workspaces, and restarting the canonical local runtime. Scope is WebVue only; upstream Odoo source/configuration and business databases are preserved.

## Reconciliation

The inventory contained main plus eleven worktrees. Every dirty source was checkpointed before integration. The verified dashboard tree combines its data/view/mine workers byte-for-byte. Older UI source changes were already present in main with later refinements. An independent Astra source review reconciled the remaining differences. Its report is retained in the recovery directory.

The older unified-projects experiment conflicts with the latest approved dashboard and four-link sidebar. Its report tabs, hidden contextual sidebar, and templates move remain preserved in source history/recovery rather than overriding the approved design. Three independent list-page fixes are salvaged: pending search before Create, newest creation-capability outcome across cached pages, and visible capability-probe retry. History-preserving reconciliation merges explicitly retain the approved tree; they are not unreviewed wholesale source merges.

Projects now opens `/projects/dashboard`. Context links are إحصائية المشاريع, مشروع جديد, كل المشاريع, مشاريعي. My Projects filters by the current project manager before pagination; create remains capability gated. Templates remain accessible from All Projects. `/reports` redirects to the dashboard with filters.

## Recovery

Recovery directory: `/Users/tariq/code/nasq-recovery-all-20260907-212511`. Original/checkpoint bundles, per-worktree source tarballs, staged/unstaged binary patches, status/HEAD manifests and checksum manifest preserve the starting state. Full retired directories including ignored files and original Git worktree metadata are retained there. `RESTORE.md` explains recovery without using obsolete .git pointers. The old Phase2 stash is preserved in the bundle; its card/table functionality already exists and its modal design is superseded by route-backed task details.

## Verification and runtime

Backend verification passed on fresh isolated database `webvue_all_verify_20260907`: 37 focused project/report tests, zero failures/errors. No tests run on `odoo19`. Fresh frontend gates: 122 contract + 542 web unit tests, Vue typecheck, changed-Python Ruff and Nuxt production build passed. Ten browser cases passed against isolated Nuxt3983/Odoo9983 (three widths, dark/large type, navigation, filtered returns, error/retry and cached capability denial). Independent Astra salvage review found no blocker. Canonical local restart completed after promotion at product commit `30901b0`. Odoo8069 and Nuxt3000 use main and database `odoo19`. `/login` and `/api/v1/branding` return 200; unauthenticated `/api/v1/me` returns expected 403, and dashboard requests redirect to login. The browser visibly renders institution branding and the login form after reload. An authenticated canonical dashboard flow was not exercised; authenticated browser acceptance above used the isolated scratch runtime. No production deployment or push is claimed.

## Final cleanup and data preservation

Only canonical `/Users/tariq/code/nasq` on `main` remains, with a clean working tree. Eleven source/integration worktrees and branches were retired only after clean-status and ancestry checks. Their full directories were moved into recovery, then stale worktree metadata was pruned and merged branches removed. Original Phase2 stash was removed from the active stash list after preserving its ref, patch and bundled object history. Old main generated output was archived before clean regeneration of the development runtime.

All associated preview/mock processes were stopped; Odoo8069/Nuxt3000 were restarted from main. A PostgreSQL custom dump with verified catalog plus the full `odoo19` filestore were captured while canonical Odoo was stopped, under recovery/runtime/. No schema update or test flag was applied to `odoo19`. Pre/post read-only counts match: 153 projects, 701 tasks, 5 users, 2 employees and 62 attachments. Upstream Odoo HEAD and working-tree status are unchanged. Scratch databases and their test data remain isolated and were not dropped.

Recovery contains `retired.json`, `git-worktree-metadata/`, `integrated-before-cleanup.bundle`, `final-main.bundle`, source archives/checksums, review reports, test logs and runtime startup/HTTP evidence. Logs record existing Nuxt duplicated-auto-import and i18n baseUrl warnings; build and runtime gates passed.
