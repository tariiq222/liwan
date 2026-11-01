# PMO phase 4: schedule and cost baselines

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 4 is in Launch 1, before phase 5.
Branch `codex/pmo-baselines`. Depends on phase 2 (gates, merged) and phase 3 (change control, for re-baselining).

## Goal

The manager freezes the plan (task dates, budget) as a numbered, immutable baseline. Later the project shows variance against it, and the
phase gate planning -> executing asks for one.

## Decisions for owner review

1. **Immutable snapshots (master D5):** a baseline is never edited or deleted; a new baseline is a new number.
2. **First baseline** needs an approved charter. **Later baselines:** when `change_control_mode = required` (phase 3) and the project is `executing`, an approved change request must be linked (`change_id`); otherwise the manager may re-baseline with a note.
3. **Company setting `baseline_gate`** (company scope; default `warning`; changed by `pmo.settings.manage`): `off`, `warning` (the gate shows "no baseline" as a warning the manager can acknowledge, same mechanism as `close_with_open_tasks`), `required` (blocks planning -> executing). Default `warning` keeps small teams unblocked.
4. **Scope of a snapshot:** open and done tasks with planned start/end (`date_deadline` and the planned start the task schedule already uses), the budget total, and the project planned start/end. Tasks without dates are included with null dates and excluded from schedule variance.

## Schema (version bump + migration in the same commit)

`liwan.project.baseline`: `project_id` (cascade), `number` (per project, under project row lock), `taken_by_id`, `taken_at`, `note`, `change_id` (nullable, set null),
`budget_total` (monetary), `planned_start`, `planned_end`, `task_count`.
`liwan.project.baseline.task`: `baseline_id` (cascade), `task_id` (set null), `task_name` (snapshot), `planned_start`, `planned_end`, `planned_value_share` (float, default equal share; phase 5 reads it).
`write` and `unlink` raise on both models except through the creating service. `UNIQUE(project_id, number)`. No new field on `project.project`; the current baseline is the highest number.

## API

- `GET /api/v1/projects/{id}/baselines`, `GET .../baselines/{n}` (with task lines, `{items, total}`)
- `POST .../baselines` (take a baseline; optional `change_id`, `note`; idempotency key like the finance create routes)
- `GET .../baselines/variance` : schedule variance per task and for the project (days late/early against the latest baseline end), cost variance (budget now vs baseline budget, actual cost from the existing finance source); read-only, computed, nothing stored twice.
Gate: `_liwan_gate_checks('executing')` returns `{'key': 'baseline_set', 'ok': ..., 'warning': baseline_gate == 'warning'}` (`off` returns no check) by extending the registry with `super()`.

## Capabilities and features

Reading: `pmo.projects.read`; taking: `pmo.projects.manage`; cost fields in variance follow the same visibility as `GET /projects/{id}/finance`. Sub-feature `pmo.baselines` registered in `feature_registry.py`. No `sudo()`: the manager creates the rows through ACL rows for the two models.

## Web

`pages/projects/[id]/baselines.vue` (list + variance summary), `baselines/[n].vue` (snapshot detail with the variance table), "Take baseline" inline action with confirmation on the list page. The schedule page shows a baseline bar/marker per task if one exists (read from the variance endpoint). Phase card on the project shows the new gate check. Contracts: `packages/contracts/src/pmo/baseline.ts`.

## Tests

Immutability (write/unlink refused), numbering under concurrent creates, first baseline needs approved charter, `required` re-baseline needs an approved change, gate modes `off/warning/required`, variance maths with late/early/undated tasks, other-company 404, cost visibility, migration. Web unit tests for the variance table and gate message.

## Files owned

`odoo-addons/liwan_pmo/{models/project_baseline.py,controllers/project_baselines.py,serializers/project_baseline.py,security/*,tests/test_project_baseline.py,migrations/*}`, the gate override in `models/project_phase.py` (orchestrator), contracts, `apps/web/app/pages/projects/[id]/baselines*`, `apps/web/app/components/projects/baselines/**`, `serializers/project_schedule.py` read of the baseline marker (orchestrator: shared with the deferred phase 7).

## Verification

As phase 3: focused Odoo and web checks one at a time through the test slot, `npm test`, git and arch policy, `odoo-reviewer`.

## Out of scope

Resource-loaded baselines, per-task cost baselines (cost baseline is project-level budget in Launch 1), baseline comparison between two arbitrary numbers.
