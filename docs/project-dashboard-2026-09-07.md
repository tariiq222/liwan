# Project dashboard and navigation — 2026-09-07

Status: implemented and verified in `/Users/tariq/code/nasq-project-dashboard`, branch `codex/project-dashboard`, based on `c8f0448`. Changes are uncommitted and not merged into canonical main. No push/deployment or canonical service restart was performed.

## User-visible result

Selecting Projects opens `/projects/dashboard` with contextual links in this order: إحصائية المشاريع, مشروع جديد (capability gated), كل المشاريع, مشاريعي. `/projects` retains the complete permitted project list, with templates accessible from its existing action. `/projects?mine=1` is server-filtered to projects managed by the current user, before sorting/count/pagination. Mine and other list filters survive refresh and return from a project; unscoped navigation clears mine.

The dashboard replaces the Reports screen. `/reports` redirects to it while preserving query filters. Search and status apply to both summary and detailed table. Summary includes all matching active, permitted current-company projects: project/attention/overdue counts, status distribution, per-currency budget/actual/remaining and proportional bars, and up to ten projects requiring attention. The existing detailed table remains paginated. Task information remains null when unavailable. Budget coverage text explicitly distinguishes known-budget totals from actual spending across all projects; currencies are never combined. Progress remains closed-task count divided by total, rather than weighted effort.

## Composition and ownership

Uses SharedPageContainer, SharedPageHeader, FilterBar, SharedPageState, shared controls, existing ReportTable and ProjectStatusBadge, and existing semantic design tokens. New specialized ProjectDashboardSummary is under project/finance. No global theme or new dependencies. DESIGN.md reflects the user's navigation change.

Data package: controllers/project_reports.py, serializers/project_reports.py, project-reports contract and tests. Mine package: controllers/projects.py, useProjects, project list and tests. UI package: dashboard route, reports redirect, summary component/composable/helpers, projects locales. Coordinator: shared navigation, common locales, integration, browser coverage and this evidence.

## Fresh verification

- `npm test`: 122 contract and 542 web tests passed.
- `npm -w apps/web run lint`: Vue typecheck passed.
- `npm run build`: passed. Final preview build explicitly set NUXT_ODOO_URL/DB and WS URL to the isolated runtime at build time and runtime.
- Focused Ruff for changed PMO Python files: passed.
- Odoo `/nasq_pmo:TestProjectReports,/nasq_pmo:TestProjects`: 37 tests, 0 failures, 0 errors, using isolated `nasq_dashboard_scratch_20260907` before browser fixtures were seeded. Full Odoo suite was not rerun.
- `E2E_BASE_URL=http://127.0.0.1:3983 ./node_modules/.bin/playwright test --config=apps/web/playwright.config.ts apps/web/e2e/project-dashboard.spec.ts`: 7 passed. Covers exact menu and active item, authenticated summary/list API values, all/mine/create navigation, legacy filter redirect, contextual return preserving mine/search, summary failure without hiding the table, and mobile dark/large text.
- Browser sizes: 390, 768, 1440; document overflow checks passed. Desktop and mobile screenshots reviewed; final dark chart fills use the shared foreground token for contrast; English translations added, but English browser presentation was not separately exercised.
- Independent Astra source review cleared spec compliance and code quality after partial-budget wording/chart fix. Remaining nonblocking test opportunities: explicit aggregate isolation assertions and more hidden-task/top-ten tie coverage.

## Runtime and reproduction

Preview: Nuxt `127.0.0.1:3983`, Odoo `127.0.0.1:9983`, database `nasq_dashboard_scratch_20260907`. Odoo preview uses `/tmp/nasq-dashboard-briefs/odoo-data` for isolated sessions and a copy of this scratch database's filestore. Browser fixtures are in `apps/web/e2e/fixtures/project-dashboard.py` with an exact scratch-database guard. They must run once on a disposable initialized database. Accounts/passwords are explicit test-only fixture data.

The first browser run failed because build-time /web proxies retained the default Odoo URL while the API used the scratch runtime URL, causing session logout. The final build points proxies to the scratch server and uses isolated session storage; all seven browser cases then passed. No business-write browser cases were used. Earlier failures and final evidence are preserved under `/tmp/nasq-dashboard-briefs/`.

Screenshots: [desktop](evidence/project-dashboard-2026-09-07/dashboard-1440.png), [mobile](evidence/project-dashboard-2026-09-07/dashboard-390.png), [tablet](evidence/project-dashboard-2026-09-07/dashboard-768.png), [dark/large mobile](evidence/project-dashboard-2026-09-07/dashboard-dark-large-mobile.png).

Worker sources remain preserved in `/Users/tariq/code/nasq-dashboard-data`, `/Users/tariq/code/nasq-dashboard-view`, and `/Users/tariq/code/nasq-my-projects`. Logs, briefs, and independent review: `/tmp/nasq-dashboard-briefs/`. No worktree cleanup, Git commit, or merge is included in this delivery.

Final verification after dark contrast adjustment: `unit-verified.log` (122 contracts + 542 web), `build-contrast.log` (successful build), `browser-contrast.log` (7 passed). The independent reviewer accepted the scoped semantic-token adjustment.
