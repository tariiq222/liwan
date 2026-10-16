# Project dashboard charts — 2026-09-07

## Delivered behavior

The Projects statistics route `/projects/dashboard` uses Apache ECharts 6.1.0 via vue-echarts 8.3.0. Six interactive SVG charts cover every visible project matching the current search/status filters: status, disjoint task composition, progress bands, budget health, per-project progress, and planned versus actual expenses within one selected currency. The two per-project comparisons retain the full dataset and use internal zoom when needed.

The compact table contains only the latest five projects by project `write_date DESC, id DESC`. It is a record-modification list, not a task/comment activity stream. Detail links preserve return filters. Unknown budgets, unavailable tasks, and projects with no tasks remain distinct. The existing module sidebar, My Projects manager filter, legacy `/reports` redirect and response envelopes remain intact.

The page uses the approved prototype's content spacing, quiet metrics strip, panel headers, borders and contextual shell. Chart colors follow the organization's semantic tokens and appearance settings; charts are rendered in an LTR SVG coordinate space for correct Arabic label placement. This delivery changes the dashboard, not every internal route.

## Implementation and review

- New read-only analytics endpoint in `webvue_pmo`; current-company and normal project/task visibility checks remain authoritative.
- Shared task and finance batches avoid repeated per-project queries. Existing report APIs remain compatible.
- Shared chart renderer imports only required bar/pie, tooltip, legend, grid, zoom, ARIA and SVG modules.
- Luna implemented isolated backend and UI packages. Coordinator integrated dependencies, contracts, documentation, fixtures and browser acceptance. Independent Astra review accepted backend; four UI findings were fixed and re-reviewed.
- Runtime visual review additionally identified RTL SVG text positioning and fast-empty hydration mismatches; final evidence below tracks the corrected version.

## Verification

- Isolated database `webvue_charts_scratch_20260907`: 41 report/project tests plus one finance/grouped-task regression passed. No tests on `odoo19`.
- Browser fixture contains 12 projects, 110 tasks, known recent ordering and a manager with 10 owned projects; these data were created only in the scratch database.
- Final source: 124 contract tests and 548 web tests passed; Vue type checks, Ruff and production build passed. Eight browser cases passed at 390/768/1440 px, dark/cream large mobile text, recent-five order/detail/back, manager scope, legacy redirect/empty reload, API error/retry, and narrow-to-wide chart resize. See `docs/evidence/project-charts-2026-09-07/` for screenshots and review reconciliation.
- Browser language verification is Arabic. English locale keys are supplied, but the current app has no language-switch control and disables browser locale detection; no English runtime claim is made.

## Runtime and recovery

Recovery: `/Users/tariq/code/nasq-recovery-charts-20260907-222000`, including source snapshots, all-ref Git bundle, full retired worktree directories and validation logs. Main is the integration target; runtime closure is recorded below. No remote push or production deployment is part of this local correction.

## Local closure

The accepted source is integrated into canonical main at `809a0fe` (product `4c699e2`; implementation sources `6f207fb` and `264d1fb` are ancestors). Integration merges leave the verified product tree unchanged. All three temporary worktrees and branches were retired with the recovery archive above; only main remains.

Canonical services were restarted from `/Users/tariq/code/nasq`: Odoo PID 72746 on 8069 using `odoo19`, and Nuxt PID 73534 on 3000 with explicit canonical Odoo URL/database. Fresh local smoke: login HTTP 200, branding HTTP 200, protected analytics without login HTTP 403 (route present, guard intact). Dependencies were installed from the committed lockfile and Nuxt generated types prepared. Temporary Odoo9985, Nuxt3985 and prototype4398 services were stopped.

Read-only before/after canonical counts match: 153 projects, 701 tasks, 5 users, 2 employees and 62 attachments. Upstream Odoo remains clean at `34eed49d88f0f4357e1f54fe82cb0ad280939572`. No test fixtures, module upgrade or business data edits were applied to `odoo19`. Authenticated chart/browser evidence uses the isolated scratch account; canonical runtime proof is limited to process/source identity and the HTTP checks above. This is local delivery, not a production deployment.
