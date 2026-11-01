# PMO phase 5: earned value (EVM)

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 5 is in Launch 1. Branch `codex/pmo-evm`, stacked on `codex/pmo-baselines` (phase 4).

## Goal

A project with a baseline shows planned value, earned value and actual cost **as of today**, with the standard indices and forecasts, without time logging (AGENTS.md: no timesheets). Historical EV/AC are not promised: percent complete is the task's current value and `_liwan_actual_totals` returns lifetime totals with no date argument, so a past date would be wrong. A later phase may add dated progress snapshots and date-filtered actuals.

## Decisions for owner review

1. **Method (master D6):** BAC = baseline budget. A baseline line holds a `planned_value_share` (phase 4; the shares add up to 1). The planned fraction of a line at today grows linearly from its baseline start to its baseline end (0 before, 1 from the end day on; a line with an end but no start is a step at its end). PV = BAC x sum(share x planned fraction). EV = BAC x sum(share x percent complete / 100). AC = the project's actual cost from the existing finance summary (`build_finance_summary`, the same figure `GET /projects/{id}/finance` shows). The UI states this method.
2. **Percent complete, company setting `evm_progress_method`** (company scope; default `binary`; changed with `pmo.settings.manage`; reads `binary` while the plan lacks `pmo.evm`): `binary` (a done task is 100%, any other 0%, no data entry) or `manual` (new integer `liwan_percent_complete` 0..100 on `project.task`, written through the task `PATCH` by the assignee or the manager). Under both methods a done task is 100% and a cancelled one 0%; an open task is 0% under `binary` and its stored value under `manual`. The stored value is never derived or copied (`copy=False`).
3. **Indices:** SV = EV - PV, CV = EV - AC, SPI = EV / PV, CPI = EV / AC, EAC = BAC / CPI, ETC = EAC - AC, VAC = BAC - EAC, TCPI = (BAC - EV) / (BAC - AC). A ratio whose divisor is **not positive** (zero, or negative when the actual cost is below zero or above BAC) is `null`, never 0 or infinity; the UI shows "not enough data". EAC is also `null` when CPI is 0. Money is rounded half-up to the currency decimals, indices to two decimals (the colour bands judge the rounded value the user reads).
4. **Cost-less projects:** SPI is the ratio of the two fractions, so it does not depend on BAC. With BAC 0 the answer keeps SPI and every cost index (`cv`, `cpi`, `eac`, `etc`, `vac`, `tcpi`) is `null`; the page says the baseline has no budget. (An external actual source still supplies AC through the finance summary.)
5. **Lines the maths cannot place:** a line **without an end date** takes part in neither PV nor EV (its schedule cannot be judged) and is counted in `undated_count`. A line whose task was deleted, moved to another project or cancelled keeps its planned value (the baseline is the plan) and earns nothing; a new baseline is how the plan is corrected.
6. **Task visibility:** the lines are the ones the caller may read (`readable_lines` of the baseline serializer: needs `pmo.tasks.read`, hides tasks a record rule hides). A reader who cannot see some tasks gets a partial figure and `hidden_count` says how many lines are missing; no names or per-task figures are sent.

## Schema (`liwan_pmo` 19.0.1.11.0, migration directory in the same commit)

`liwan_percent_complete` (integer, `copy=False`, check 0..100) on `project.task`, and the one setting. EVM values are computed per request, not stored (one source of truth).

## API

`GET /api/v1/projects/{id}/evm` returns `{project_id, baseline_number, computed_at, as_of, currency, method, hidden_count, undated_count, bac, pv, ev, ac, sv, cv, spi, cpi, eac, etc, vac, tcpi, planned_curve: [{date, pv}]}` for the latest baseline, as of the caller's calendar day (`fields.Date.context_today`). 404 `not_found` when the project is hidden or archived, 409 `no_baseline` when there is none, 403 without `pmo.projects.read`. `planned_curve` has a point every week from the first planned date to the last (the last point is always the final date), widened in whole weeks to at most 60 points.
Task `GET` detail adds `progress_method` and `percent_complete` (the effective value under the method). `PATCH /api/v1/tasks/{id}` accepts `percent_complete` (the API name, like `planned_start` and `deliverables` it drops the `liwan_` prefix) only when the method is `manual` (422 `invalid`, field `percent_complete`, otherwise), as a whole number 0..100; the assignee and the manager may write it, as any other task field.
The maths live in one pure module (`models/project_evm_math.py`, no ORM, no clock), with the serializer thin, so the formulas are unit tested without a database.

## Capabilities and features

Same gate as `GET /projects/{id}/finance` because cost is exposed: `pmo.projects.read` on a visible, active project; sub-feature `pmo.evm` (registered in `feature_registry.py`, listed in the release catalogs and the platform entitlement test). The route checks `pmo.enabled` and `pmo.evm`. No `sudo()`.

## Web

`pages/projects/[id]/evm.vue`, a tab of the project governance strip (hidden while the plan lacks `pmo.evm`). KPI tiles for SPI and CPI with colour bands (below 0.9 danger, 0.9 to under 1 warning, 1 or more success; null neutral "not enough data"), a figures panel (BAC, PV, EV, AC, SV, CV, EAC, ETC, VAC, TCPI), the method note, and the planned-value curve with today's EV and AC as two marks. **The Storybook catalog has no line chart** (`DashboardChart` draws donuts and bars), so the curve is a page-specific `EvmCurve.vue` on the same Unovis library, wrapped in the shared `ChartContainer`; it has no story, like the baseline components. The task detail shows a percent-complete field only when the method is `manual`. The PMO settings approval card gets an `evm_progress_method` radio. Contracts: `packages/contracts/src/pmo/evm.ts` (zod, recorded fixture `pmo/project-evm`; the task detail and settings fixtures are re-recorded).

## Tests

Maths (`tests/test_project_evm_math.py`, no database): planned fraction before / inside / after, incomplete dates, every index and every null divisor, a project without budget, undated and removed lines, rounding, the curve and its cap, and the worked example below. Routes (`tests/test_project_evm.py`): binary and manual figures, cancelled / moved / deleted tasks, the caller's calendar day, no baseline 409, hidden 404, the finance gate, a reader without task access, a plan without the feature, the percent-complete PATCH rules, the setting. Isolation matrix entry. Web: band colours and the null display, governance tab list, optimistic patch, settings form; a browser pass on the isolated mock stack and the affected mock specs.

### Worked example (asserted by the maths test and the route test)

Four tasks with equal shares (0.25) in a baseline of 120 000, read on 2026-03-15, with 48 000 spent:

| task | planned dates | planned fraction | percent complete |
| --- | --- | --- | --- |
| A (done) | 03-01 to 03-11 | 1 | 100 |
| B | 03-05 to 03-25 | 10/20 = 0.5 | 40 |
| C | 03-10 to 03-20 | 5/10 = 0.5 | 0 |
| D | 03-20 to 03-30 | 0 | 0 |

PV = 120 000 x 0.25 x (1 + 0.5 + 0.5 + 0) = 60 000; EV = 120 000 x 0.25 x (1 + 0.4) = 42 000; AC = 48 000.
SV = -18 000, CV = -6 000, SPI = 0.35 / 0.5 = 0.70, CPI = 42 000 / 48 000 = 0.875, shown 0.88 (half-up), EAC = 120 000 / 0.875 = 137 142.86, ETC = 89 142.86, VAC = -17 142.86, TCPI = 78 000 / 72 000 = 1.08. Under `binary` only task A is earned: EV = 30 000, SPI 0.50, CPI 0.63.

## Files owned

`odoo-addons/liwan_pmo/{models/project_evm_math.py,serializers/project_evm.py,controllers/project_evm.py,tests/test_project_evm.py,tests/test_project_evm_math.py,migrations/19.0.1.11.0}`, the field in `models/project_task.py`, the setting plumbing in `models/liwan_settings.py` and `controllers/settings.py`, the task serializer, contracts `src/pmo/evm.ts`, `apps/web/app/pages/projects/[id]/evm.vue`, `apps/web/app/components/pmo/projects/evm/**`, `apps/web/app/composables/useProjectEvm.ts`, the PMO locale files, `apps/web/e2e/pmo-evm-mock-routes.mjs`.

## Verification

As phase 4: focused Odoo (`tools/odoo_test.py --addons liwan_pmo,...`), contracts, commercial-contracts and web vitest, `vue-tsc` from `apps/web`, the root policy scripts, the affected mock e2e specs on a production build.

## Out of scope

Historical (as-of) EV and AC, time-logged earned schedule, per-task cost baselines, resource rates.
