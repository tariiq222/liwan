# Pending work integration — 2026-09-09

## Baselines and preservation

Canonical main baseline: `013ea5342932c8f4ba60f1bc80d79506ecb181f5`.
Incoming branches: admin filters `fae3d9f`, meeting filter guards `98c9df6`, project layout `c1bb77d`. Built in `/Users/tariq/code/nasq-integrate-20260909-174608` on current main.

Admin/meeting checkpoint content was already present in improved form on main. Reconciled only the conflicting hunks, preserving RecordNumber, responsive filter label classes and the typed action-label lookup. Their integration introduced no net source changes against the baseline. Project changes preserve latest chat and agent governance; no backend, contract, dependency, update-gate or database changes are introduced by this candidate.

Incoming DESIGN.md records newer explicit project decisions: sidebar navigation, contextual breadcrumbs/collapse, standalone project settings, and task-context memory. These supersede older project tab instructions. All unrelated latest-main behavior remains retained.

## Review and corrections

Independent read-only review identified RACI missing its active stakeholders navigation and an obsolete settings-dialog test expectation. Browser tests reproduced both. Restored the semantic RACI mapping, added a visible active-link assertion, and retained settings coverage as standalone navigation, refresh, preserved search and collapsed sidebar. A second obsolete direct-settings dialog table case was likewise replaced by a dedicated standalone direct-link/refresh test. No baseline product requirement was removed to obtain a passing result.

## Fresh verification

- 157 contracts and 762 web unit tests passed after the source fix.
- `npm run lint`: vue-tsc and Ruff passed.
- Combined project browser run: 114 passed, one obsolete settings-dialog expectation failed. After correcting that expectation to the approved standalone design, all four focused cases passed (settings navigation, RACI active link, collapsed-sidebar return and direct settings refresh). No remaining failure from that run.
- Browser uses isolated mock data on 3998/4398; no real Odoo database writes/tests. Representative 1440px tasks screenshot inspected; no claim of full mobile/accessibility or real backend workflow validation.
- Production build result, promotion and cleanup are recorded in external final-state.json; this report does not promise success before that record exists.
- Initial tool commands with optional npm flags / npm exec were denied by the update gate. Source inspection identified explicit safe alternatives (`npm ci --ignore-scripts`, `npx --no-install`); used those without disabling protection. Initial Nuxt prepare ran at repo root, causing missing web .nuxt config; prepared inside apps/web and reran successfully.

## Pending security branch

`codex/security-updates` at `7aeb5db` is NOT merged. Its dependency major upgrades require specific approval under UPDATE_POLICY.md; generic merge authorization is explicitly insufficient. The source is retained in the branch and verified bundle/archive even if its worktree is retired. Review proposal: `/Users/tariq/code/nasq-recovery-merge-20260909-174608/SECURITY-MERGE-REVIEW.md`.

## Recovery and scope

Recovery: `/Users/tariq/code/nasq-recovery-merge-20260909-174608/`. `before.bundle` passed git bundle verify; per-worktree tar archives and SHA256 manifest preserve source/local files, excluding regenerable node_modules/.nuxt/.output and Git metadata. RESTORE.md describes isolated recovery. User authorized removal of all supplementary Nasq worktrees; only merged branches may be deleted, while security remains pending. The original Odoo repository, existing recovery directories, databases and canonical runtime are outside cleanup. No push, deployment or runtime upgrade.
