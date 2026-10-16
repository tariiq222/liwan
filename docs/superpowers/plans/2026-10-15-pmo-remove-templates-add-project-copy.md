# PMO: remove project templates, add "copy project"

Date: 2026-10-15. Status: plan, awaiting owner approval. Branch: `codex/pmo-project-copy`.

## Goal

Remove the `webvue.project.template` feature end to end (model, API, contracts, web pages, tests,
docs references) and replace it with one action: create a new project by copying the
**structure** of an existing project the caller can see.

No live tenants exist yet, so no data carry-over from templates is planned; the table is dropped.

## Decisions (defaults; owner may change before implementation)

1. **Do not use stock `project.project.copy()`.** It copies followers, assignees, chatter
   subscriptions, all charter fields, and shares the source's `type_ids` stages (many2many),
   while WebVue gives each project its own stages and per-project governance. Overriding it to
   strip all of that would fight stock behaviour (R9). Instead, a WebVue method
   `project.project._webvue_copy_structure()` builds the new project through the existing
   `_webvue_create_from_policy` path (policy check, code sequence, quota claim, default
   completion approval) and then populates it — the same proven path template apply used.
2. **What is copied:** stages (name, fold, order), milestones (name, deadline shifted),
   tasks (name, description, stage, milestone, planned start/end shifted, dependencies,
   tags), `webvue_type_id`, `webvue_owning_unit_id`, `allow_task_dependencies`.
3. **What is not copied:** assignees, followers, chatter, attachments, task state/completion
   (all tasks start `01_in_progress`), sub-tasks, archived tasks, finance entries,
   stakeholders, RACI, register, updates, meetings links, project status, charter text and
   charter state, sponsor. The caller becomes manager.
4. **Date shift:** the caller supplies `start_date`; every date moves by
   `start_date - source.date_start`. If the source has no `date_start`, the earliest task
   start or milestone deadline is the anchor; if there is none, dates are not copied.
5. **Who may copy:** the source project is visible in the current company **and** the caller
   has `pmo.tasks.read` **and** may create projects (`_webvue_can_create`). Task creation inside
   the fresh project keeps the existing cursor-local population scope (renamed from
   `TEMPLATE_APPLY_MARKER` to `PROJECT_COPY_MARKER`), so no new `sudo()` is added (R7).
6. **Limits:** at most 500 active top-level tasks and 100 milestones in the source; above that
   the API returns 422 `invalid` (keeps the request bounded, as templates did with 100 items).
7. **UI entry points:** a "Copy project" action on the project summary page (header actions),
   opening the route-backed create panel at `/projects/new?copyFrom=<id>`. The create form
   shows the source name, a new name (default "<source> (copy)") and a start date. No new
   page family, no dialog (DESIGN.md: `/new` routes open `SharedCreatePanel`).

## Tasks

### Task 1 — Backend: add copy (TDD) — `odoo-addons/webvue_pmo`

- `models/project_project.py`: add `_webvue_copy_structure(name, start_date, *, serialize=None)`
  following the template `_webvue_apply` shape (savepoint, context stripped of `default_*`,
  `tracking_disable`, `mail_create_nosubscribe`, scope marker set/cleared in `finally`).
- `models/project_task.py`: rename `TEMPLATE_APPLY_MARKER` → `PROJECT_COPY_MARKER`,
  `_webvue_template_population_domain` → `_webvue_copy_population_domain`,
  `_webvue_create_for_template` → `_webvue_create_for_copy`; update docstrings and error texts.
- `controllers/projects.py`: `POST /api/v1/projects/<int:project_id>/copy`
  (`type='json2'`, `auth='user'`, `api_handler`, `requires_feature('pmo.enabled', operation='write')`),
  body `{name, start_date}`; 201 with the same shape as project create; 403 `forbidden`,
  404 `not_found`, 422 `invalid`.
- `serializers/`: `parse_project_copy` (strict keys, ISO date).
- `tests/test_project_copy.py` (imported in `tests/__init__.py`), extending `WebVuePmoCase`:
  copies stages/milestones/tasks/dependencies with shifted dates; no assignees, followers,
  governance or finance rows; caller is manager; quota claim counts the new project;
  forbidden without `pmo.tasks.read`, without create policy, for another company's project,
  for an invisible project; 422 for bad date, empty name, oversized source; failure rolls
  back with no partial project; the population scope is cleared after success and failure.

### Task 2 — Backend: remove templates — `odoo-addons/webvue_pmo`

- Delete `models/project_template.py`, `controllers/project_templates.py`,
  `serializers/project_template.py`, `security/ir.model.access-templates.csv`,
  `security/project_template_rules.xml`, `tests/test_project_templates.py`; update the three
  `__init__.py` files and `__manifest__.py` `data`.
- Bump version to `19.0.1.5.0`; add `migrations/19.0.1.5.0/post-migrate.py` that drops
  `webvue_project_template` if it exists (stock `-u` removes the `ir.model` rows, not the table).
- `models/entitlement_service.py`: remove `nav.projectTemplates` from terminology keys;
  update `webvue_platform/tests/test_terminology_keys.py`.

### Task 3 — Contracts — `packages/contracts/src/pmo`

- Delete `project-template.ts` and its test; drop its export from `index.ts`.
- Add `ProjectCopyInputSchema` (`name`, `start_date`) with a test.
- Regenerate `docs/api/openapi.json` with `python3 tools/api_surface.py`.

### Task 4 — Web: remove templates — `apps/web`

- Delete `pages/project-templates.vue`, `pages/project-templates/**`,
  `components/project/templates/**`, `composables/useProjectTemplates.ts`,
  `pages/__tests__/tasmim6-templates.test.ts`, `pages/__tests__/tasmim6aTemplates.test.ts`,
  `components/project/__tests__/templateDesign.test.ts`, `e2e/tasmim6-templates.spec.ts`.
- `modules/pmo/manifest.ts`: remove `/project-templates` from `routePrefixes`, `nav`,
  `contextLinks`, `landing`, `routeCapabilities`.
- `pages/projects/index.vue`: remove the templates header button.
- `components/project/ProjectCreateForm.vue`: remove the "from template" link.
- `components/shared/PageContainer.vue`: drop `project-templates` from `projectArea`.
- i18n `ar`/`en` `common.json` + `projects.json`: remove template keys.
- Update the tests that list templates routes/links: `manifests.test.ts`,
  `shellModules.test.ts`, `activeRoute.test.ts`, `legacyListDeparture.test.ts`,
  `projectContextNavigation.test.ts`, `recordBackTargets.test.ts`, `accessPolicy.test.ts`,
  `pmoPreviewFixtures.test.ts`, `ProjectCreateForm.test.ts`, `requiredFeedback.test.ts`, and
  the e2e specs/preview data that reference `/project-templates`.
- Tools: `tools/ui_policy.py` (drop `project-templates.vue`), `tools/test_new_app.py`
  (drop `project_templates`), `tools/arch_layers.json` (drop the `project-templates` page
  folder). The arch_layers edit removes a folder, it does not move or widen anything; if
  `git_policy.py --base main` still flags it, stop and ask the owner for the
  `Architecture-approved-by:` trailer — agents never add it.

### Task 5 — Web: copy project — `apps/web`

- `composables/useProjects.ts`: `copyProject(id, input)` → `POST /api/v1/projects/{id}/copy`.
- `pages/projects/[id]/index.vue` (summary): "Copy project" header action, shown when the
  caller has `pmo.projects.create` and `pmo.tasks.read`, linking to
  `/projects/new?copyFrom=<id>&returnTo=…`.
- `ProjectCreateForm.vue`: when `copyFrom` is present, show the source (read-only), name
  (prefilled), start date; submit calls `copyProject`, then navigates to the new project.
  Errors use the existing inline feedback; draft protection kept.
- i18n `ar` (default) and `en` keys under `projects.copy.*`.
- Unit tests for the composable and the form's copy mode; one mock-stack Playwright check.

### Task 6 — Docs

- Update `docs/design-system/components.md` and live (non-archive, non-dated) references.
  Dated plans/reports keep their history unchanged.

## Verification

- Odoo (scratch DB, never `odoo19`): `npm run test:odoo` for `webvue_pmo`, `webvue_platform`.
- `npm test`; from `apps/web`: `npm run lint`; mock-stack Playwright for the copy flow.
- `python3 -B tools/arch_policy.py --base main` and `python3 -B tools/git_policy.py --base main`.
- `rg -i "project[-_ ]?template|projectTemplates"` outside `docs/archive`, dated docs → no hits.
- `odoo-reviewer` agent on the addon + contract diff.

## Commits (one logical change each)

1. `feat(pmo): copy a project's structure into a new project`
2. `refactor(pmo): remove project templates` (includes version bump + migration)
3. `feat(web): copy a project from its summary page`
4. `refactor(web): remove project template pages`
5. `docs(docs): drop project templates from the live docs`

Merging into `main` and pushing need the owner's separate authorization.
