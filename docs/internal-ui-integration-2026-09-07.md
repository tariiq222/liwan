# Internal UI integration candidate — 2026-09-07

Worktree: `/Users/tariq/code/nasq-internal-ui-merge`
Branch: `codex/internal-ui-merge` based on `41964ca`, merge `--no-ff --no-commit` of `e6740da`.

This is a merge **candidate**. Canonical `main` was not updated. No commit, stage, push, or deploy was performed in this worktree.

## Conflict

Only `apps/web/app/pages/reports.vue` conflicted.

Resolution: keep main `41964ca` reports behaviour (filters, `useProjectReports`, totals/table/pagination, `data-testid="reports-page"`) and wrap the page in `SharedPageContainer width="list"` instead of `nasq-page-stack … max-w-7xl`. Incoming placeholder (`pages.reports` empty state) was discarded.

`reports.vue` remains **unmerged** for the orchestrator to stage.

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

Browser coverage: `apps/web/test-results/internal-ui-audit/desktop-coverage.json` and `mobile-coverage.json` — `reports.ok: true`, `batchDefects: []`. Reports requested `/api/v1/reports/projects?limit=50&offset=0` (not a 404 error page).

Ports 4387/4388 are free after the runner `finally` stop. No Odoo / `odoo19` / 8069 use.

## Git state left for orchestrator

Incoming merge paths remain staged. `reports.vue` is still `UU`. Wrapper/mock edits are unstaged working-tree changes. Do not treat this as merged to `main`.
