# PMO phase 4: schedule and cost baselines

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 4 is in Launch 1, before phase 5.
Branch `codex/pmo-baselines`. Depends on phase 2 (gates) and phase 3 ([change control](2026-11-01-pmo-phase3-change-control.md), merged), both on `main`.

## Goal

The manager freezes the plan (task dates, budget) as a numbered, immutable baseline. Later the project shows variance against it, and the
phase gate planning -> executing asks for one.

## Decisions for owner review

1. **Immutable snapshots (master D5):** a baseline is never edited or deleted; a new baseline is a new number. `write` and `unlink` refuse every caller, including `sudo()`. The rows go away only with their project (database cascade).
2. **Who takes one:** the project manager (`pmo.projects.manage` on the project, the same check as every manager write). The first baseline needs an approved charter. Under change control `required`, a baseline of an **executing** project (first or later) needs a linked approved, not yet implemented change request (`change_id`, 409 `change_required` without one); in `optional` and `off` no request is needed. A request may be linked in `optional` mode if it belongs to the project and is approved or implemented; linking while the mode is `off` is 422. The phase 3 list of controlled fields (`CHANGE_CONTROLLED_FIELDS`) names fields of `project.project`; a baseline adds none, so the guard lives in the baseline's own `create()` and the list is unchanged (no duplicate rule).
3. **Company setting `baseline_gate`** (company scope; default `warning`; changed by `pmo.settings.manage`, read in the PMO settings): `off` (the gate does not mention baselines), `warning` (the planning -> executing gate shows `baseline_set` as an unmet warning the manager acknowledges, the `acknowledge_warnings` mechanism of `close_with_open_tasks`), `required` (blocks the move). A plan without the `pmo.baselines` sub-feature reads as `off`, like `change_control_mode`.
4. **Scope of a snapshot:** every active, non-cancelled task of the project (open and done) with its planned start and end (`liwan_planned_start`, the date of `date_deadline`), the budget, and the project planned start/end. Tasks without dates are kept with null dates and drop out of schedule variance. The caller needs `pmo.tasks.read` to take a baseline (403 otherwise), because the lines are read in the caller's environment.
5. **Budget of the snapshot:** the finance budget entries of the project when it has any, else the charter estimate when the charter holds one, else 0. The same rule gives the budget "now" in the variance, so the two are comparable. The actual cost is the existing finance source (`build_finance_summary`: manual expenses or the external cost center).
6. **One request, one baseline.** An approved change request authorises exactly one new baseline: `UNIQUE(change_id)` (set null on delete) and a check under the project lock; reuse answers 409 `change_already_used`, in `required` and in `optional` mode.
7. **By design: a baseline snapshots only the tasks its manager can read** (record rules and `pmo.tasks.read`); tasks hidden from them are not part of it, and the detail page says so. `task_count` is the snapshot size; a reader who cannot read some lines gets `hidden_count` (no names) and no line for them. Archived tasks stay readable (`archived: true`), a task that is archived after the baseline keeps its line.
8. **Dates are the caller's calendar day.** A task deadline is a datetime; the snapshot and the variance take its day in the caller's timezone (`fields.Date.context_today`), like the overdue logic, so a 00:30 Riyadh deadline is that day, not the UTC day before.
9. **Variance rows have a status:** `tracked` (in the baseline, still in the project), `removed` (deleted, or moved to another project) and `added` (in the project, not in the baseline); only tracked rows count as late, early or undated, and removed/added are counted apart.
10. **Concurrency:** the number is `max(number) + 1` read from the table after the project row lock (the ORM cache may predate another writer); `lock_for_update` skips a locked row, so it is tried twice before answering 409 `baseline_busy`; a unique violation on the number or the change request is mapped to the same answer; one `create()` call takes one baseline per project.
11. **The change request is looked up in the caller's environment with `search`**, so a hidden or foreign one answers the same 422 as a missing one.
12. **No idempotency key.** The finance `Idempotency-Key` helper belongs to `liwan_finance` (R3 forbids importing it) and `liwan_pmo`/`liwan_api` have no equivalent. Double submit is covered by the number lock and the web action disabling itself while pending.

## Schema (`liwan_pmo` 19.0.1.10.0, migration directory in the same commit)

`liwan.project.baseline` (company scope, ordered by `number desc`): `project_id` (cascade), `company_id` (related stored), `currency_id` (the project currency at the time, stored), `number` (per project, under a lock on the project row), `taken_by_id` (restrict), `taken_at`, `note`, `change_id` (set null), `budget_total` (monetary), `planned_start`, `planned_end`, `task_ids`; `task_count` is computed (the snapshot size), not stored.
`liwan.project.baseline.task`: `baseline_id` (cascade), related stored `project_id`/`company_id`, `task_id` (set null), `task_name` (snapshot), `planned_start`, `planned_end`, `planned_value_share` (float, default an equal share of the lines; phase 5 reads it).
Constraints: `UNIQUE(project_id, number)`, `number > 0`, `UNIQUE(change_id)`, finite non-negative budget, start <= end, share within 0..1. Lines are created only while their baseline is being created (precommit marker); no `sudo()`: the employee, reader and manager groups hold read and create ACL rows (no write, no unlink; like the other governance registers, the model enforces the manager), `create()` checks the manager and builds every value on the server, and the governance visibility mixin plus an `ir.rule` limit reads to visible active current-company projects. No new field on `project.project`; the current baseline is the highest number.
Migration: new tables and a setting that reads `warning`; `migrations/19.0.1.10.0/README.md` (no data change), and a test that an existing project starts with none.

## API (`type='json2'`, `api_handler`, list envelope `{items, total}`)

- `GET /api/v1/projects/{id}/baselines` (`can_take`, `change_required`, `coverable_changes`), `GET .../baselines/{n}` (with task lines)
- `POST .../baselines` body `{note?, change_id?}` (201, the detail)
- `GET .../baselines/variance`: against the latest baseline, computed on read, nothing stored twice. `baseline`, `schedule` and `cost` are null before the first baseline. Schedule: per task and for the project, `start_variance_days`/`end_variance_days` = current date minus baseline date (positive late, negative early, null when either date is missing), a `status` per row (`tracked`, `removed`, `added`) and `archived`, counts of late/early/undated/removed/added and `hidden_count`. Cost: baseline budget, budget now, their difference, actual, what is left of the baseline budget, `over_baseline`.
Errors: 403 `forbidden`, 404 `not_found` (other company, hidden or archived project, unknown number), 409 `charter_state`, 409 `change_required`, 409 `change_already_used`, 409 `baseline_busy` (the project row is locked by another baseline), 422 `invalid`/`unknown_field`.
Cost fields follow the visibility of `GET /projects/{id}/finance`: `pmo.projects.read` and a visible project. A reader without `pmo.tasks.read`, or whose task is hidden, gets no line of that task (the project figures stay).
Gate: `models/project_phase_baseline.py` extends `_liwan_gate_checks` through `super()` (loaded after `project_phase`): for `executing` it adds `{'key': 'baseline_set', 'ok': <a baseline exists>}` plus `'warning': True` in `warning` mode, and nothing in `off`.

## Capabilities and features (R2, R10)

Reading: `pmo.projects.read`; taking: `pmo.projects.manage` on the project. Sub-feature `pmo.baselines` is registered in `feature_registry.py` (owner `liwan_pmo`), listed in the release catalogs (`platform_v3.json`, `platform_v4.json`) and in the platform entitlement test; every route checks `pmo.enabled` and `pmo.baselines`. No `sudo()` and no documented case is added.

## Web (`apps/web`, pages are records, no new overlay)

`pages/projects/[id]/baselines.vue` (list, variance summary, per-task variance table, inline "take baseline" confirmation with a note and, where change control asks, the covering request), `baselines/[number].vue` (the snapshot with its variance table when it is the latest). A "Baselines" tab beside the other governance sub-tabs, hidden while the plan lacks `pmo.baselines`. The schedule page draws each task's baseline dates as a thin bar under its live bar (read from the variance endpoint; a failed read leaves the bars unmarked). The phase card shows the `baseline_set` check with a link to the baselines page. The PMO settings approval card gets a `baseline_gate` radio. Contracts: `packages/contracts/src/pmo/baseline.ts` (zod, recorded fixtures `pmo/project-baseline-list`, `-detail`, `-variance`). The components are page-specific (`components/pmo/projects/baselines/`), no Storybook story. Arabic and English strings in the projects, settings and common namespaces.

## Tests

Odoo (`tests/test_project_baseline.py`, plus the isolation matrix and the settings/entitlement tests): first baseline needs an approved charter, numbering and the lock (a busy project answers 409), immutability for every caller, the server-built values, `required` re-baseline needs an approved change (and an implemented one no longer covers), `optional`/`off`, gate modes `off/warning/required`, a plan without the sub-feature, variance maths (late/early/on time/undated/removed task, latest baseline, cost over and under), cost visibility and task hiding for a reader, other-company 404 on all three routes, archived project, an existing project with no baseline. Contracts: zod round trip and the recorded fixtures. Web: composable cache test, variance presentation, governance tab and phase-check tests, plus a browser pass on the isolated mock stack and the affected mock e2e specs.

## Files owned

`odoo-addons/liwan_pmo/{models/project_baseline.py,models/project_phase_baseline.py,controllers/project_baselines.py,serializers/project_baseline.py,security/*,tests/test_project_baseline.py,migrations/19.0.1.10.0,__manifest__.py}`, the settings plumbing in `models/liwan_settings.py` and `controllers/settings.py`, contracts `src/pmo/baseline.ts`, `apps/web/app/pages/projects/[id]/baselines*`, `apps/web/app/components/pmo/projects/baselines/**`, the schedule page and Gantt marker, PMO locale files, `apps/web/e2e/pmo-baseline-mock-routes.mjs`.

## Verification

Focused Odoo (`tools/odoo_test.py --addons liwan_pmo,...`), contracts, commercial-contracts and web vitest, `vue-tsc` from `apps/web`, the root policy scripts (`sudo_gate`, `arch_policy --base origin/main`, `git_policy --base origin/main`, `ui_policy`, `catalog_check`, `docs_policy`, `route_gate_policy`), the affected mock e2e specs, and the `odoo-reviewer` agent.

## Out of scope

Resource-loaded baselines, per-task cost baselines (the cost baseline is project-level budget in Launch 1), comparison between two arbitrary baselines, an idempotency-key store outside finance.
