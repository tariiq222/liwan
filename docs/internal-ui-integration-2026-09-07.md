# Internal UI integration — 2026-09-07

> UI authority update — 2026-09-07: [DESIGN.md](../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

Worktree: `/Users/tariq/code/nasq-internal-ui-merge`
Branch: `codex/internal-ui-merge` based on `41964ca`, merge `--no-ff --no-commit` of `e6740da`.

The verified candidate was committed as `327064d` and fast-forwarded into canonical `main`. Its parents are main pin `41964ca` and UI source commit `e6740da`. Both histories are preserved. No push, deployment, canonical service restart, or worktree cleanup was performed.

## Conflict

Only `apps/web/app/pages/reports.vue` conflicted.

Resolution: keep main `41964ca` reports behaviour (filters, `useProjectReports`, totals/table/pagination, `data-testid="reports-page"`) and wrap the page in `SharedPageContainer width="list"` instead of `nasq-page-stack … max-w-7xl`. Incoming placeholder (`pages.reports` empty state) was discarded.

The resolved `reports.vue` was staged and included in the merge commit; no unmerged paths remain.

## Auto-merges inspected

`projects/index.vue` and `projects/[id].vue` auto-merged. Main planning/finance links, tabs, list filters, and archived-list gating remain. Incoming change is the shared container plus status-icon tokens on the projects summary.

## Extra UI wrappers (beyond `e6740da`)

New phase pages from main used ad-hoc `nasq-page-stack` + `max-w-*`. Consistency tests require `SharedPageContainer` / settings shells and no Tailwind status palettes. Wrappers only; no data/API changes:

- `project-templates/**`
- `projects/[id]/finance*`
- `projects/[id]/schedule*`
- `projects/[id]/raci.vue`
- `projects/[id]/register*`
- `projects/[id]/stakeholders*`
- `FinanceEntryForm.vue` stale callout → `nasq-status-callout-warning`
- `ScheduleGantt.vue` milestone mark → `nasq-status-dot-warning` (solid warning token; not a pale icon tile)

Mock: `apps/web/e2e/internal-ui-audit-mock.mjs` now serves a contract-valid `GET /api/v1/reports/projects` envelope (`pmo.projects.read` already on the fixture user).

Backend, contracts, locales, and Nuxt/package files are byte-equal to `41964ca` (`git diff --exit-code` 0).

## Verification (this worktree)

| Command | Cwd | Exit | Result |
| --- | --- | --- | --- |
| `npm ci --ignore-scripts` | worktree | 0 | 850 packages |
| `npm -w apps/web run postinstall` | worktree | 0 | Nuxt types |
| `npm test` | worktree | 0 | contracts 119; web 411 |
| `npm -w apps/web run lint` | worktree | 0 | `vue-tsc --build --noEmit` |
| `python3 apps/web/e2e/internal-ui-audit-with-server.py` | worktree | 0 | production build + Playwright **2 passed** (15 routes desktop + mobile). `PLAYWRIGHT_EXIT=0`. Isolated mock `nasq_ui_mock_only` on 4388 / Nuxt 4387. |
| `git diff --exit-code 41964ca -- odoo-addons packages/contracts apps/web/i18n apps/web/nuxt.config.ts package.json apps/web/package.json` | worktree | 0 | unchanged |
| `npm test` after promotion | canonical main | 0 | contracts **119**, web **411** |

Final independent review: **PASS**. Reviewer reran contracts (119), web tests (411), web type checking and Ruff, all exit 0. Review identified a pale milestone-marker regression; the final source uses `nasq-status-dot-warning` with a solid warning token. That two-line correction was source-reviewed and unit/type-checked after the browser/build run, not separately screenshot-tested.

Browser coverage: `apps/web/test-results/internal-ui-audit/desktop-coverage.json` and `mobile-coverage.json` — `reports.ok: true`, `batchDefects: []`. Reports requested `/api/v1/reports/projects?limit=50&offset=0` (not a 404 error page).

Ports 4387/4388 are free after the runner `finally` stop. No Odoo / `odoo19` / 8069 use.

## Final Git and runtime state

- Product merge: `327064d` on main; source `e6740da` and prior main `41964ca` are verified ancestors.
- Integration worktree is clean after the product commit. Source and integration worktrees/branches remain available; no deletion was authorized.
- Main's pre-existing `.agent/learnings.jsonl` edit remains uncommitted and unchanged. Its blob hash before and after promotion is `33134769653f793e3b1c7b851fae43d4f048e01a`.
- Browser evidence covers 15 representative routes, not every newly wrapped phase page or workflow. Backend/contracts are unchanged from prior main; no live Odoo tests were needed or run for this UI-only merge.
- Ignored integration `.output` contains the test mock environment. Rebuild with intended configuration before using that artifact outside the isolated audit runner.
- The earlier `internal-ui-audit-2026-09-07.md` describes the pre-integration snapshot; this report supersedes its pending-merge status.
