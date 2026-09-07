# Project templates delivery

## Changed files

- `odoo-addons/nasq_pmo/models/project_template.py`: company-scoped `nasq.project.template`, strict structured definition validation, capability/ORM guards, and atomic application through the existing project, stage, milestone, task and dependency helpers.
- `odoo-addons/nasq_pmo/controllers/project_templates.py`: list/detail/create/update/delete/apply JSON2 routes with `items`/`total`, whitelisted payloads, and real error statuses.
- `odoo-addons/nasq_pmo/serializers/project_template.py`: whitelisted template and application serialization/parsing.
- `odoo-addons/nasq_pmo/security/ir.model.access-templates.csv` and `security/project_template_rules.xml`: template ACLs and current-company record rule.
- `odoo-addons/nasq_pmo/tests/test_project_templates.py`: validation, capability/company, repeat-application and date/application behavior tests.
- `packages/contracts/src/pmo/project-template.ts` and its focused test: strict Zod definitions, graph reference/cycle checks, bounds, and request/response schemas.
- `apps/web/app/composables/useProjectTemplates.ts`: query and mutation composables.
- `apps/web/app/components/project/templates/ProjectTemplateEditor.vue`: structured stage, milestone, task and predecessor editor with hydration and unsaved-change guards.
- `apps/web/app/pages/project-templates/**`: routed catalog, create, detail, edit and apply pages.
- `delivery/templates-ar.json` and `delivery/templates-en.json`: locale fragments to merge under the existing `projects.templates` namespace.

## Contract and behavior

Endpoints are `GET/POST /api/v1/project-templates`, `GET/PATCH/DELETE /api/v1/project-templates/{id}`, and `POST /api/v1/project-templates/{id}/apply` with `{name,start_date}`. Template management requires `pmo.settings.manage`; catalog read and apply require readable current-company catalog access plus the existing project create policy. Every response includes `can_manage` and `can_apply` on template records, and list responses include the same capability flags.

Definitions use exact `stages`, `milestones`, and `tasks` arrays. Stage, milestone and task keys are unique bounded graph keys; task stage/milestone/dependency references, duplicate keys and cycles are rejected in both Zod and Python. Calendar offsets are bounded and task durations are positive. A one-day task ends on its start day (`start + duration_days - 1`); project end is derived from the latest milestone/task day.

Application creates a new project owned by the caller, uses `_nasq_create_from_policy`, creates fresh stages/milestones/tasks, sets all tasks unfinished, applies dates through the schedule worker's private `_nasq_set_schedule(start, end)` method, then sets dependencies through `_nasq_set_dependencies`. It carries no assignees, followers, activity, cost or issue data. The private method has its own database savepoint so direct ORM callers receive all-or-nothing behavior. It intentionally does not implement or edit the schedule worker's task model.

## Coordinator registrations required

The coordinator must register the owned files by adding `project_template` to `models/__init__.py` and `serializers/__init__.py`, `project_templates` to `controllers/__init__.py`, `security/ir.model.access-templates.csv` and `security/project_template_rules.xml` to the addon manifest, and `project-template` to `packages/contracts/src/pmo/index.ts`. Merge the two locale fragments into the existing `projects.json` files, add the `/project-templates` navigation entry, and ensure the feature routes are included in the normal app layout. The security CSV is intentionally named `ir.model.access-templates.csv` because Odoo derives the access model from the prefix before the first hyphen.

## Verification

- `npm -w packages/contracts test -- --run src/pmo/__tests__/project-template.test.ts` — 3 tests passed.
- `npm -w packages/contracts run build` — passed.
- `ruff check` on all owned Python files — passed.
- Odoo `.venv/bin/python -m py_compile` on all owned Python files — passed.

The Odoo behavioral suite was written but not run in this source worktree because feature registration and the schedule worker are coordinator/integration prerequisites. No full web lint/build, Odoo suite, browser run, commit, runtime change or deployment was performed here.

## Residual risk

The integrated addon must load the registration and manifest entries above and include the schedule worker's `_nasq_set_schedule` implementation before template application can pass end-to-end. The coordinator should run the isolated scratch-database Odoo tests and authenticated browser flow after integration.
