# Schedule package delivery

## Changed files

- `odoo-addons/nasq_pmo/models/project_task.py`: adds `nasq_planned_start`, the checked private `_nasq_set_schedule(start, end)` mutation, schedule capability/current-company guards, direct-write protection, context-default/copy/batch protection, and date-order validation.
- `odoo-addons/nasq_pmo/controllers/project_schedule.py`: adds the project schedule GET and manager-only task PATCH endpoints with strict date and project/task validation.
- `odoo-addons/nasq_pmo/serializers/project_schedule.py`: whitelisted schedule task and milestone shapes with dependency visibility filtering.
- `odoo-addons/nasq_pmo/tests/test_project_schedule.py`: focused Odoo coverage for explicit current-company fixtures, date round trips, clearing, invalid ranges, manager HTTP success, ordinary-user/direct ORM denial, private/foreign/companyless projects, project mismatch, hidden dependencies, context-default/batch/copy protection, and generic deadline invariants.
- `packages/contracts/src/pmo/schedule.ts` and `packages/contracts/src/pmo/__tests__/schedule.test.ts`: strict schedule response/patch contracts and calendar-date tests, including legacy end-only tasks on reads.
- `apps/web/app/utils/projectSchedule.ts` and `apps/web/app/utils/__tests__/projectSchedule.test.ts`: timezone-safe calendar math, bounded full-span axis sampling, one elapsed-day coordinate system for ticks/bars/markers, and geometry assertions.
- `apps/web/app/composables/useProjectSchedule.ts`: schedule query and guarded task update mutation.
- `apps/web/app/components/project/schedule/ScheduleGantt.vue`: week/month Gantt view with dated/undated tasks, UTC-stable labels, date-positioned milestone markers, visible predecessor connectors, and keyboard-navigable internal task links.
- `apps/web/app/components/project/schedule/ScheduleTaskForm.vue`: internal date-edit page form with hydration gating, URL return handling, and `SharedUnsavedChanges`.
- `apps/web/app/pages/projects/[id]/schedule.vue` and `apps/web/app/pages/projects/[id]/schedule/tasks/[taskId].vue`: schedule and nested task-edit routes.
- `delivery/schedule-ar.json` and `delivery/schedule-en.json`: locale fragments to merge under the existing `projects.schedule` namespace.

## API and type registrations for coordinator

The package deliberately leaves shared registration files untouched. The coordinator must register:

- `project_schedule` in `odoo-addons/nasq_pmo/controllers/__init__.py` and `odoo-addons/nasq_pmo/serializers/__init__.py`.
- `test_project_schedule` in `odoo-addons/nasq_pmo/tests/__init__.py`.
- `schedule` from `packages/contracts/src/pmo/index.ts`.
- `delivery/schedule-ar.json` and `delivery/schedule-en.json` under the existing `projects` locale objects.
- The schedule link in the shared project navigation/page files and route-aware project UI owned by the coordinator.

No new model or security object is introduced: schedule records are existing `project.task` and `project.milestone` records and inherit their existing ACL/record-rule surface. The addon manifest does not need a new data registration for this package.

## Endpoints and wire types

- `GET /api/v1/projects/{project_id}/schedule` returns `{ project_id, tasks, milestones, can_manage, total }`.
- `PATCH /api/v1/projects/{project_id}/schedule/tasks/{task_id}` accepts exactly `{ start, end }`, where each value is a valid `YYYY-MM-DD` string or `null`, and returns the full schedule task shape.
- Schedule tasks contain `id`, `name`, `start`, `end`, `state`, `dependency_ids`, and `milestone_id`.
- Schedule milestones contain `id`, `name`, and `deadline`.

## Focused verification

- `npm -w packages/contracts run test -- --run src/pmo/__tests__/schedule.test.ts` — 2 tests passed.
- `npm -w apps/web run test -- --run app/utils/__tests__/projectSchedule.test.ts` — 2 tests passed.
- `python3 -m py_compile odoo-addons/nasq_pmo/models/project_task.py odoo-addons/nasq_pmo/controllers/project_schedule.py odoo-addons/nasq_pmo/serializers/project_schedule.py odoo-addons/nasq_pmo/tests/test_project_schedule.py` — passed.
- `git diff --check` — passed.
- Locale JSON parsing — passed.
- Targeted Ruff was unavailable in the isolated worktree; the coordinator owns the full Ruff gate.

The Odoo tests were added but not run because shared addon registration and the coordinator’s isolated scratch runtime are required. The supplied scratch Odoo run was not rerun here; its earlier 3/4 errors were fixture company-state failures, addressed by the feature-local current-company fixture and expanded HTTP/security tests. No broad web lint, build, Odoo suite, browser suite, service start, database mutation, commit, merge, push, or deployment was performed.

## Known issues and residual risk

- Coordinator registration and locale merge remain required before the addon/API and Nuxt app can discover the new files.
- Full TypeScript/lint/build, scratch Odoo tests, and authenticated browser checks remain coordinator gates.
- Existing tasks with only `date_deadline` are intentionally represented as end-only schedule tasks; the edit API requires both dates or clears both.
