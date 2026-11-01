# PMO phase 5: earned value (EVM)

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 5 is in Launch 1. Branch `codex/pmo-evm`. Depends on phase 4 (baseline).

## Goal

A project with a baseline shows planned value, earned value and actual cost **as of today**, with the standard indices and forecasts, without time logging (AGENTS.md: no timesheets). Historical EV/AC are not promised: percent complete is the task's current value and `_liwan_actual_totals` returns lifetime totals with no date argument, so a past date would be wrong. A later phase may add dated progress snapshots and date-filtered actuals.

## Decisions for owner review

1. **Method (master D6):** BAC = baseline budget. PV(today) = BAC x sum over tasks of `planned_value_share` x (linear 0..1 between the task's baseline start and end at today's date). The planned curve (PV over the baseline span) is the only series drawn; EV and AC are single current points. EV = BAC x sum of `planned_value_share` x task percent complete. AC = the project's actual cost from the existing finance source (`_liwan_actual_totals`). The UI states this method.
2. **Percent complete, company setting `evm_progress_method`** (company scope; default `binary`): `binary` (a done task counts 100%, anything else 0%, no schema change) or `manual` (new integer `liwan_percent_complete` 0..100 on `project.task`, edited by the task assignee/manager; default derives from done state). `binary` is the default so a project works with no extra data entry.
3. **Indices:** SV = EV - PV, CV = EV - AC, SPI = EV / PV, CPI = EV / AC, EAC = BAC / CPI, ETC = EAC - AC, VAC = BAC - EAC, TCPI = (BAC - EV) / (BAC - AC). A zero divisor returns `null`, never 0 or infinity; the UI shows "not enough data".
4. **Cost-less projects:** a project with BAC 0 or externally sourced actuals unavailable shows schedule indices only and says why.

## Schema

Only the optional `liwan_percent_complete` on `project.task` (manual method) and the one setting; version bump and migration in that commit. EVM values are computed per request, not stored (one source of truth). The planned curve is computed by the same function (weekly points over the baseline span, capped).

## API

`GET /api/v1/projects/{id}/evm` returns `{baseline_number, computed_at, bac, pv, ev, ac, sv, cv, spi, cpi, eac, etc, vac, tcpi, method, planned_curve: [...]}` (always the latest baseline, today's date); 404 `not_found` when the project is hidden, 409 `no_baseline` when there is none. `PATCH /tasks/{id}` accepts `liwan_percent_complete` only when the method is `manual`.
The maths live in one pure module (`models/project_evm_math.py`, no ORM), with the serializer thin, so the formulas are unit tested without a database.

## Capabilities and features

Same gate as `GET /projects/{id}/finance` because cost is exposed; sub-feature `pmo.evm`. No `sudo()`.

## Web

`pages/projects/[id]/evm.vue` under the project tabs: KPI cards (CPI, SPI with colour bands: below 0.9 danger, 0.9-1 warning), planned-value curve with the EV and AC points for today (use the chart component already in the Storybook catalog; if none, report it before adding one), method note. Contracts: `packages/contracts/src/pmo/evm.ts`.

## Tests

Maths: PV linear interpolation before start / inside / after end (clock frozen in tests), EV with binary and manual, every index including every null divisor, tasks without baseline dates, task removed after baseline, rounding to currency decimals. Routes: no baseline 409, hidden project 404, cost visibility, no-baseline answer. Web: card colour bands and the null display.

## Files owned

`odoo-addons/liwan_pmo/{models/project_evm_math.py,models/project_evm.py,controllers/project_evm.py,serializers/project_evm.py,tests/test_project_evm.py,tests/test_project_evm_math.py}`, a field in `models/task_schedule.py` (orchestrator, shared), contracts, `apps/web/app/pages/projects/[id]/evm.vue`, `apps/web/app/components/projects/evm/**`.

## Verification

As phase 3. Add a worked numeric example to the PR body that the maths test also asserts.

## Out of scope

Historical (as-of) EV and AC, time-logged earned schedule, per-task cost baselines, resource rates.
