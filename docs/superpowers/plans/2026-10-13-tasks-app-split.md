# Tasks Application Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `nasq_tasks` (personal and team tasks with no project, in the base bundle) and the `nasq_tasks_pmo` bridge, plus the `/my-tasks` web module, without either application importing the other.

**Architecture:** A personal task is a `project.task` row with `project_id = False`, flagged by a stored `nasq_personal` boolean. `nasq_tasks` (rank 4) owns the capabilities, record rules, `/api/v1/my-tasks/*`, the `nasq.task.links` hook (defaults answer "no project") and the `tasks.assigned` bell kind. `nasq_tasks_pmo` (rank 5, `auto_install`) overrides the hook to add project rows to the unified list and adds the convert routes. The web module `modules/tasks` serves `/my-tasks`.

**Tech Stack:** Odoo 19 (Python, `type='json2'`), Zod contracts, Nuxt 4 + Nuxt UI + `@tanstack/vue-query`, Vitest, Playwright (mock-backed), Storybook.

**Spec:** `docs/superpowers/specs/2026-10-13-tasks-app-split-design.md` (section numbers below, "§N", refer to it). Binding context: `CLAUDE.md`, `DESIGN.md`.

## Global Constraints

- Branch `codex/platform-tasks-app`, worktree `.worktrees/tasks-app`. No merge, no push, no deletion of anything.
- Never touch `:3000`, `:8069` or the `odoo19` database. Odoo runs only against a fresh scratch DB with `--addons-path` pointing at this worktree, cleaned up afterwards (skill `nasq-odoo-test`).
- `nasq_tasks` never imports `nasq_pmo` (R3). `nasq_pmo` changes are limited to §6.3 (web manifest `nav` and `landing` entries only).
- `sudo()` only in the two cases of §7: `tasks.assigned` bell delivery and the recipient-owned bell candidate lookup.
- Do not edit `tools/arch_baseline.json` by hand. Run `--write-baseline` only if a count shrinks. Agents never add an `Architecture-approved-by:` trailer.
- No change to `/api/v1/tasks`, `/api/v1/people` or any existing contract. `PersonRef` is reused, never redefined.
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.` Manifests: `'license': 'LGPL-3'`, version `19.0.1.0.0`, author `Tariq Alwalidi`.
- Routes: `@http.route('/api/v1/...', type='json2', auth='user', methods=[...], readonly=<bool>)`, then `@api_handler`, then `@requires_feature('tasks.enabled', ...)`. Errors: 403 `forbidden`/`feature_not_included`, 404 `not_found`, 422 `invalid` with `field`.
- Wire states: `open | done | cancelled` ↔ `01_in_progress | 1_done | 1_canceled`.
- Web: Arabic default, logical Tailwind properties only (`ms- me- ps- pe- start- end- text-start`), `$t()`/`t()` with the `myTasks` namespace, `useHydrated()` on first-click controls, explicit inline confirmation for cancel, no stacked dialogs, no import from `components/task` or `components/project`.
- Commits: `type(scope): subject` (≤72 chars), scope `platform` for addons/catalog/contracts, `web` for the web module. One logical change each, ending with the attribution line from the session. A schema change carries its version bump in the same commit.
- Each Odoo test file is imported in its addon `tests/__init__.py`. `ruff check odoo-addons` stays clean.

## Decisions that deviate from, or complete, the spec (owner to confirm)

1. **Scaffold route slug (permanent tooling fix, no workaround).** `python3 -B tools/new_app.py tasks ...` is refused today because the scaffold ties the web route to the app id and `pages/tasks` belongs to PMO. Task 0 gives `tools/new_app.py` a `--route <slug>` option (default: the app id, so every existing invocation behaves exactly as before). The slug drives the page folder, route prefix, nav/landing paths and the `web_apps` entry of `tools/arch_layers.json`; the app id still drives the addon, capabilities, feature and contracts namespace. `tasks` stops being a reserved *app id* and stays a reserved *route*. Task 1 then runs the real command `python3 -B tools/new_app.py tasks --route my-tasks --name-ar المهام --name-en Tasks`. This is a `tools` change outside the spec's file list; it is the owner's call and is committed on its own as `feat(tools): ...`.
2. **Record rule is global, not group-scoped.** Odoo's `task_visibility_rule` (group `base.group_user`, i.e. every employee) lets anyone read a task they *follow* (`message_partner_ids`); group rules are OR-ed, so a group-scoped Nasq rule cannot make a personal task stricter. `rule_personal_task_visible` is therefore a global rule (no `groups`), AND-ed with Odoo's rules: non-personal rows pass untouched, personal rows need creator-or-assignee in the current company. The capability groups still gate access through ACLs. This satisfies §7 "a stranger must get 404 even when Odoo's rule would read it".
3. **Reviewer.** The `odoo-reviewer` agent is not available in this session. The final review uses the `reviewer` agent with the `odoo-code-review` skill and the R1–R10 checklist from `CLAUDE.md`, unless the owner restores `odoo-reviewer`.
4. **Contract names** are prefixed (`PersonalTask*`, `MyTask*`) so `export *` in `packages/contracts/src/index.ts` cannot collide with PMO exports.

## Review Focus

Failure modes the spec implies but section 12 does not list; each is pinned by a test in the owning task.

1. A user who only *follows* a personal task (comment subscriber) must get 404 on detail and no list row (Task 1, rule test).
2. Welcome to-do created by `project_todo` as superuser and assigned to the user must never appear (Task 2).
3. `PATCH`/`POST` with empty `name`, a name over 255 chars, an unknown assignee id, or an inactive/other-company user id answers 422 with `field` (Task 5).
4. A project task id on `/api/v1/my-tasks/<id>` answers 404 for every method, including `done`, `comments`, `attachments` (Task 5).
5. Converting twice, or converting a done/cancelled task, answers 422 and changes nothing (Task 8).
6. `closed=0|1` and pagination: `limit` above 100 is clamped, `offset` beyond total returns an empty page with the real `total` (Task 5).

## File Structure

```
odoo-addons/nasq_tasks/
  __init__.py, __manifest__.py
  models/{__init__,access_service,feature_registry,directory,notification_types,project_task,task_links,my_task_service}.py
  serializers/{__init__,personal_task}.py
  controllers/{__init__,my_tasks,my_task_comments,my_task_attachments}.py
  security/{tasks_capability_groups.xml,tasks_rules.xml,ir.model.access.csv}
  data/tasks_access_permissions.xml
  tests/{__init__,common,test_access,test_rules,test_service,test_routes,test_comments_attachments,test_notifications,test_feature_gate}.py
odoo-addons/nasq_tasks_pmo/
  __init__.py, __manifest__.py
  models/{__init__,task_links_pmo}.py
  controllers/{__init__,my_task_convert}.py
  tests/{__init__,test_links,test_convert}.py
packages/contracts/src/tasks/{index.ts,__tests__/schemas.test.ts}
apps/web/app/modules/tasks/manifest.ts
apps/web/app/pages/my-tasks/{index,new,[id]}.vue
apps/web/app/components/my-tasks/*.vue      (+ apps/web/stories/my-tasks/*.stories.ts)
apps/web/app/composables/useMyTasks.ts, myTaskKeys.ts
apps/web/i18n/locales/{ar,en}/my-tasks.json  (namespace myTasks)
apps/web/e2e/my-tasks.spec.ts
```

Registration edits (only these outside the new folders, plus the Task 0 tooling change in `tools/new_app.py`, its templates and tests, the §6.3 PMO manifest trim and `common.json` `nav.myTasks`): `tools/arch_layers.json`, `deploy/catalog/solutions/platform_v3.json` (+ `catalog_check.py --sync-release-copies`), `packages/contracts/src/index.ts`, `tools/ui_policy.py` (`STORYBOOK_COMPONENTS`), `docs/design-system/components.md`.

Reference implementations to copy (read first): `odoo-addons/nasq_meetings` (models, security, data, controllers, tests), `odoo-addons/nasq_meetings_pmo` (bridge, hook override, convert route), `nasq_api/controllers/common.py` (`requires_feature`, `api_handler`, `get_record`), `nasq_api/serializers/attachment.py`, `nasq_notify/models/notify_service.py:43` (`_nasq_deliver`), `apps/web/app/modules/meetings/manifest.ts`, `apps/web/app/pages/projects/new.vue`, `apps/web/app/composables/useMeetings.ts`, `apps/web/e2e/hydration.spec.ts`.

---

### Task 0: Give `tools/new_app.py` a `--route` option (permanent fix)

**Files:**
- Modify: `tools/new_app.py`, `tools/new_app_templates/apps/web/app/modules/__app__/manifest.ts.tmpl`, `tools/new_app_templates/apps/web/app/pages/__app__/index.vue.tmpl` (moved to a `__route__` folder), the locale templates if they embed the route, and `tools/test_new_app.py`
- Test: `tools/test_new_app.py` (run with `python3 -B -m unittest tools.test_new_app` or the command `.woodpecker.yml` uses for the tools tests; read it first)

**Interfaces:**
- Produces: CLI `new_app.py <app> --route <slug> --name-ar … --name-en …`; `scaffold(root, app, name_ar, name_en, dry_run=False, route=None)`; template token `{{route}}` (slug, kebab-case allowed) next to `{{app}}`. `route=None` means `route = app`, so every existing call and test behaves exactly as today.
- Validation: the route slug must match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, may not be in the shell-owned route set, and may not equal an existing `apps/web/app/pages/` entry. The static `RESERVED` set is split into ids (git areas, foundation, shared services; stays reserved as app ids) and shell routes (`tasks`, `projects`, `search`, … stay reserved as routes only). An app id that is a shell route is accepted only when `--route` is given and differs from it. The contracts-namespace and addon-name collision checks stay on the app id.
- The slug drives: the page folder (`apps/web/app/pages/<route>/`), `routePrefixes`, `rail.to`, nav/landing/context-link paths, `routeCapabilities` patterns and the `web_apps` entry written to `tools/arch_layers.json` (`{"components": [<route>], "pages": [<route>]}`). The app id keeps driving the addon, capability keys, feature key, contracts folder, module folder and locale namespace.

- [ ] **Step 1: Failing tests** added to `tools/test_new_app.py` (follow the existing fixture style that builds a scratch root):
  - `test_route_defaults_to_the_app_id` (existing output byte-identical when `--route` is omitted).
  - `test_route_drives_pages_manifest_and_arch_layers`: scaffold `sales --route my-sales`; assert `apps/web/app/pages/my-sales/index.vue` exists, no `pages/sales`, the manifest contains `routePrefixes: ['/my-sales']`, `arch_layers.json` `web_apps.sales == {"components": ["my-sales"], "pages": ["my-sales"]}`, and the addon is still `nasq_sales`.
  - `test_reserved_route_id_needs_a_distinct_route`: `tasks` without `--route` is refused; `tasks --route tasks` is refused; `tasks --route my-tasks` succeeds and creates `modules/tasks`, `nasq_tasks`, `pages/my-tasks`.
  - `test_route_colliding_with_an_existing_page_is_refused` (`--route projects`) and `test_invalid_route_slug_is_refused` (`My_Tasks`, `-x`, empty).
  - `test_the_new_application_with_a_route_passes_the_policies` (runs `arch_policy` and `ui_policy` against the scratch root like the existing test does).
  - `test_locale_files_define_every_key_the_web_files_use` still passes with a route.
- [ ] **Step 2:** run the tools tests → the new ones FAIL.
- [ ] **Step 3:** implement. Keep `scaffold()` atomic (rollback) exactly as today; extend `planned_files` to render `__route__` in template paths and `{{route}}` in contents; extend `registration_edits` so the `web_apps` entry uses the route.
- [ ] **Step 4:** the whole tools test suite passes (`python3 -B -m unittest discover -s tools -p 'test_new_app.py'` and the other tools tests that touch `arch_layers`): PASS. Also `python3 -B tools/arch_policy.py` and `python3 -B tools/ui_policy.py` stay green.
- [ ] **Step 5: Commit** `feat(tools): let new_app take a web route separate from the app id`

---

### Task 0b: Move terminology keys out of `nasq_platform` (R2 root-cause fix, owner-approved)

Why: `odoo-addons/nasq_platform/models/entitlement_service.py` hardcodes the 20-key `TERMINOLOGY_KEYS` allowlist of application i18n keys (`tasks.title`, `hr.*`, `chat.title`, nav keys). Registering `nasq_tasks` would add an R2 hit (`tasks.title`) and `new_app.py` refuses it; the baseline never grows. The owner chose the root-cause fix: each application registers its own keys. The owner thereby approves touching `nasq_pmo`, `nasq_meetings`, `nasq_hr`, `nasq_chat` for this hook only (beyond spec §6.3).

**Files:**
- Modify: `odoo-addons/nasq_platform/models/entitlement_service.py` (remove `TERMINOLOGY_KEYS`; add `@api.model _nasq_terminology_keys(self) -> frozenset[str]` returning `frozenset()`; `_nasq_validate_terminology` at line ~491/515 checks `key in self._nasq_terminology_keys()`)
- Modify/Create: one `_inherit = 'nasq.entitlement.service'` model per owning addon overriding `_nasq_terminology_keys` as `return super()._nasq_terminology_keys() | frozenset({...})`: `nasq_pmo` (`nav.projects`, `nav.allProjects`, `nav.myProjects`, `nav.projectTemplates`, `nav.projectTasks`, `nav.tasks`, `projects.title`, `tasks.title`; the file `nasq_pmo/models/entitlement_service.py` already exists, extend it), `nasq_meetings` (`nav.meetings`, `nav.meetingCalendar`, `nav.meetingSeries`), `nasq_hr` (`nav.organization`, `nav.employees`, `nav.departments`, `nav.documents`, `hr.directory.title`, `hr.depts.title`, `hr.docs.title`), `nasq_chat` (`nav.chat`, `chat.title`). Register each new model file in its `models/__init__.py`.
- Modify: `odoo-addons/nasq_api/controllers/common.py` docstring near line 170: reword "in tasks.py" so it no longer contains the token `tasks.` followed by a letter (e.g. "in the PMO task controller module").
- Modify: `tools/arch_baseline.json` ONLY via `python3 -B tools/arch_policy.py --write-baseline` (the R2 count for `entitlement_service.py` shrinks from 4 to 0).
- Test: `odoo-addons/nasq_platform/tests/` (new `test_terminology_keys.py`, imported in `tests/__init__.py`), plus one assertion per owning addon in its existing tests.

**Interfaces:** produces `nasq.entitlement.service._nasq_terminology_keys()`; the 20-key union with all four applications installed is byte-equal to the old constant (test asserts the exact set). Validation behaviour, limits (`TERMINOLOGY_MAX_KEYS`, `TERMINOLOGY_MAX_CHARS`, forbidden chars/segments) and the `/api/v1/me` shape are unchanged.

- [ ] **Step 1: Failing tests:** `test_base_hook_returns_empty_set` (platform alone), `test_union_equals_legacy_set_with_all_apps` (assert the exact 20 keys), `test_each_app_registers_only_its_keys` (per addon), `test_unknown_key_still_rejected_422`, `test_registered_key_accepted` (validator via `_nasq_validate_terminology`, as the existing tenant-profile tests call it).
- [ ] **Step 2:** scratch Odoo run (skill `nasq-odoo-test`, release module set) → FAIL.
- [ ] **Step 3:** implement. **Step 4:** the same run → PASS, including existing `nasq_platform`, `nasq_pmo`, `nasq_hr`, `nasq_meetings`, `nasq_chat`, `nasq_api` terminology/me tests. `ruff check odoo-addons`, `python3 -B tools/arch_policy.py --base main` pass; run `--write-baseline` and commit the shrunk baseline in the same commit.
- [ ] **Step 5: Commit** `refactor(platform): let applications register their terminology keys`

---

### Task 1: Scaffold `nasq_tasks`, capabilities, groups, global record rule, `nasq_personal`

**Files:**
- Create: whole `odoo-addons/nasq_tasks/` skeleton (see File Structure); the spec and plan are committed first.
- Modify (by the scaffold): `tools/arch_layers.json` (`"nasq_tasks": 4`, web app `"tasks": {"components": ["my-tasks"], "pages": ["my-tasks"]}`), `packages/contracts/src/index.ts` (placeholder export is replaced in Task 3).
- Test: `odoo-addons/nasq_tasks/tests/test_access.py`, `tests/test_rules.py`

**Interfaces:**
- Produces: capability keys `tasks.tasks.read|create|write`; feature `tasks.enabled`; field `project.task.nasq_personal` (Boolean, stored, indexed, `compute='_compute_nasq_personal'`, depends `project_id`); xml ids `nasq_tasks.group_cap_tasks_tasks_read|create|write`, `nasq_tasks.rule_personal_task_visible`.

- [ ] **Step 1: Commit the spec**

```bash
git add docs/superpowers/specs/2026-10-13-tasks-app-split-design.md docs/superpowers/plans/2026-10-13-tasks-app-split.md
git commit -m "docs(docs): add the tasks app split spec and plan"
```

- [ ] **Step 2: Scaffold with the real command (needs Task 0)**

```bash
python3 -B tools/new_app.py tasks --route my-tasks --name-ar المهام --name-en Tasks
```

Expected: creates `odoo-addons/nasq_tasks/**`, `packages/contracts/src/tasks/**`, `apps/web/app/modules/tasks/manifest.ts`, `apps/web/app/pages/my-tasks/index.vue`, the locale files, and edits only `tools/arch_layers.json`, `deploy/catalog/solutions/platform_v3.json`, `packages/contracts/src/index.ts` (+ release copies). Then make these hand edits the spec requires: set the catalog tier to the §8 literal `{"id":"tasks","name":"Tasks","modules":["nasq_tasks"],"features":["boolean:tasks.enabled"]}` if the generated one differs, and run `python3 -B tools/catalog_check.py --sync-release-copies`. Commit the generated skeleton together with the edits after the tests below pass.

- [ ] **Step 3: Write failing access tests**

`tests/test_access.py` (model it on `nasq_meetings/tests/test_meeting_access.py`):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests.common import TransactionCase, new_test_user, tagged


@tagged('nasq', 'nasq_access', 'nasq_tasks')
class TestTasksAccess(TransactionCase):
    def test_capabilities_registered(self):
        keys = {c['key'] for c in self.env['nasq.access.service']._nasq_capability_definitions()}
        self.assertTrue({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'} <= keys)

    def test_dependencies(self):
        deps = self.env['nasq.access.service']._nasq_permission_dependencies()
        self.assertEqual(deps['tasks.tasks.create'], {'tasks.tasks.read'})
        self.assertEqual(deps['tasks.tasks.write'], {'tasks.tasks.read'})

    def test_employee_role_has_all_three_and_admin_none(self):
        grants = self.env['nasq.access.service']._nasq_builtin_role_grants()
        self.assertTrue({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'}
                        <= set(grants['nasq_core.role_employee']))
        self.assertFalse({k for k in grants.get('nasq_core.role_system_admin', ())
                          if k.startswith('tasks.')})

    def test_feature_registered(self):
        keys = {f['key'] for f in self.env['nasq.feature.registry']._nasq_feature_definitions()}
        self.assertIn('tasks.enabled', keys)
```

(Adjust the exact return shapes to what `nasq_meetings/tests` assert; the scaffold's `test_tasks_access_composition.py` already contains the working pattern, keep it and rename.)

- [ ] **Step 4: Write failing rule tests** (`tests/common.py` extends `NasqApiCase`; add helper `make_personal_task(self, user, name='t', assignees=None)` creating the row as `user` through `self.env['project.task'].with_user(user).create({...})`)

```python
@tagged('nasq', 'nasq_tasks')
class TestPersonalTaskRules(NasqTasksCase):
    def test_creator_and_assignee_read(self):
        task = self.make_personal_task(self.alice, assignees=[self.bob.id])
        self.assertTrue(task.with_user(self.alice).has_access('read'))
        self.assertTrue(task.with_user(self.bob).has_access('read'))

    def test_stranger_cannot_read_or_search(self):
        task = self.make_personal_task(self.alice)
        self.assertFalse(task.with_user(self.carol).has_access('read'))
        found = self.env['project.task'].with_user(self.carol).search([('id', '=', task.id)])
        self.assertFalse(found)

    def test_follower_who_is_not_assignee_cannot_read(self):
        task = self.make_personal_task(self.alice)
        task.sudo().message_subscribe(partner_ids=[self.carol.partner_id.id])
        self.assertFalse(task.with_user(self.carol).has_access('read'))

    def test_other_company_creator_cannot_read(self):
        task = self.make_personal_task(self.alice)
        self.assertFalse(task.with_user(self.other_company_user).has_access('read'))

    def test_project_task_unaffected(self):
        project = self.env['project.project'].create({'name': 'p'})
        task = self.env['project.task'].create({'name': 'x', 'project_id': project.id})
        self.assertFalse(task.nasq_personal)
        self.assertTrue(task.with_user(self.carol).has_access('read'))  # Odoo/PMO rules decide, ours passes
```

`NasqTasksCase.setUpClass` creates alice/bob/carol with the employee role via the `NasqApiCase` helpers and `other_company_user` in a second company.

- [ ] **Step 5: Run to confirm failure**, via the `nasq-odoo-test` skill: fresh scratch DB, `-i nasq_tasks --test-tags /nasq_tasks`. Expected: install or tests FAIL (model/rule missing).

- [ ] **Step 6: Implement**

`models/project_task.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ProjectTask(models.Model):
    _inherit = 'project.task'

    nasq_personal = fields.Boolean(compute='_compute_nasq_personal', store=True, index=True)

    @api.depends('project_id')
    def _compute_nasq_personal(self):
        for task in self:
            task.nasq_personal = not task.project_id
```

`security/tasks_rules.xml` (global rule, no `groups` field):

```xml
<odoo>
  <record id="rule_personal_task_visible" model="ir.rule">
    <field name="name">Tasks: personal tasks are private to creator and assignees</field>
    <field name="model_id" ref="project.model_project_task"/>
    <field name="domain_force">['|', ('nasq_personal', '=', False),
      '&amp;', ('company_id', '=', company_id),
      '|', ('create_uid', '=', user.id), ('user_ids', 'in', [user.id])]</field>
  </record>
</odoo>
```

`security/ir.model.access.csv`: three rows on `project.model_project_task` (read for `group_cap_tasks_tasks_read`, create+read for `create`, write+read for `write`, never unlink). Add the minimum extra rows Odoo needs to create a private task as an employee (expected: `project.model_project_task_stage_personal` and read on `project.model_project_task_type`); discover them from the first failing create and keep the list minimal. Groups file, permissions data file, `access_service.py`, `feature_registry.py` follow `nasq_meetings` 1:1: capabilities with `owner='nasq_tasks'`, dependencies, `nasq_core.role_employee` gets all three, none for `role_system_admin`/`role_vendor_support`. Manifest `depends`: `project, mail, nasq_core, nasq_api, nasq_platform, nasq_notify, nasq_directory`; data order: groups, permissions, ACL csv, rules. Do not list `nasq_pmo`.

- [ ] **Step 7: Run tests to green**, same command. Expected: install OK, `nasq_tasks` tests PASS.

- [ ] **Step 8: Static checks and commit**

```bash
ruff check odoo-addons && python3 -B tools/arch_policy.py --base main && python3 -B tools/catalog_check.py
git add -A && git commit -m "feat(platform): add the nasq_tasks addon with access and rules"
```

---

### Task 1b: PMO create hook and the bridge skeleton (controller ruling, see ledger)

Why: with `nasq_pmo` installed, `project.task.create` (`odoo-addons/nasq_pmo/models/project_task.py` ~line 565-590) rejects any non-admin create without a project ("Task fields are not allowed." / "A visible current-company project is required."), so employees could not create personal tasks. A `sudo()` create would add an undocumented sudo case (R7, spec §7) and make PMO treat the call as superuser. Ruling: one minimal, behaviour-neutral extension point in `nasq_pmo`, implemented by the bridge (cross-application code lives only in bridges, R3). This is the only `nasq_pmo` Python change besides spec §6.3's web manifest trim.

**Files:**
- Modify: `odoo-addons/nasq_pmo/models/project_task.py`: add `@api.model def _nasq_projectless_create_allowed(self, vals_list): return False` next to `_nasq_extra_create_fields` (line ~75) and, inside the `if not trusted:` loop of `create`, when `not project` (after the parent lookup) and `self._nasq_projectless_create_allowed(vals_list)` is true, skip only the project requirement and the project-scoped checks for that vals (the field whitelist check `set(vals) - allowed` stays and still raises; stock ORM ACLs and record rules still run in the caller's environment). Default `False` keeps PMO behaviour byte-identical.
- Create: `odoo-addons/nasq_tasks_pmo/` skeleton: `__init__.py`, `__manifest__.py` (`depends: ['nasq_tasks', 'nasq_pmo']`, `auto_install: True`, `application: False`, `installable: True`, license/version/author per Global Constraints), `models/__init__.py`, `models/project_task_personal.py`, `tests/__init__.py`, `tests/test_personal_create.py`. Register `"nasq_tasks_pmo": 5` in `tools/arch_layers.json`.
- Test: `odoo-addons/nasq_pmo/tests/` gets one test `test_projectless_create_still_rejected_by_default` (employee without the bridge hook, i.e. calling with the hook patched to the base implementation, gets AccessError exactly as before); `nasq_tasks_pmo/tests/test_personal_create.py`.

**Interfaces:**
- Produces `project.task._nasq_projectless_create_allowed(vals_list) -> bool` (PMO default `False`).
- Bridge override `ProjectTask._nasq_projectless_create_allowed(self, vals_list)`: returns `True` only when the caller holds `tasks.tasks.create` (use `self.env['nasq.access.service']._nasq_require_capability`-style check without raising: reuse the access service's boolean check, copy what `nasq_meetings` does), every vals has no `project_id`, and any `parent_id` points to a `nasq_personal` task; otherwise `super()`.
- Bridge override `_nasq_extra_create_fields(self)`: `super() | {'user_ids', 'date_deadline', 'priority', 'description', 'company_id', 'parent_id'}` limited to what the service of Task 2 writes (keep the set exactly the personal-task create fields; read `TASK_CREATE_FIELDS` first and add only what is missing).

- [ ] **Step 1: Failing tests:** `test_employee_creates_personal_task_with_pmo_installed` (employee with `tasks.tasks.create` creates a project-less task with name, user_ids, date_deadline, priority, description, company_id; succeeds; `nasq_personal` true), `test_user_without_capability_cannot_create_projectless_task` (AccessError), `test_projectless_create_with_foreign_field_rejected` (e.g. `{'name': 'x', 'stage_id': 1}`-style unlisted field still raises "Task fields are not allowed."), `test_subtask_of_project_task_rejected` (parent in a project and no project_id → AccessError), PMO default-rejection test above. Plus the 4 previously erroring `TestPersonalTaskRules` tests of Task 1 must now pass in the full-release run.
- [ ] **Step 2:** scratch Odoo, full release set → FAIL. **Step 3:** implement. **Step 4:** full release run: PASS (`/nasq_tasks,/nasq_tasks_pmo,/nasq_pmo`), standalone `-i nasq_tasks` run (no PMO) still PASS; `ruff`, `arch_policy --base main`, `catalog_check`.
- [ ] **Step 5: Commits:** `feat(pmo): add the project-less create hook to project tasks`, `feat(platform): add the nasq_tasks_pmo bridge skeleton`

---

### Task 2: Links hook and personal task service

**Files:**
- Create: `odoo-addons/nasq_tasks/models/task_links.py`, `models/my_task_service.py`; extend `models/__init__.py`
- Modify: `odoo-addons/nasq_tasks/models/project_task.py` (new fields `nasq_parent_id`, `nasq_child_ids`); `odoo-addons/nasq_tasks_pmo/models/project_task_personal.py` and its tests (switch `parent_id` handling to `nasq_parent_id`); `odoo-addons/nasq_tasks/tests/test_rules.py` (reword the header comment at ~line 37: only the read tests guard one clause each; the write tests check combined behaviour)
- Test: `odoo-addons/nasq_tasks/tests/test_service.py`

**Controller rulings that bind this task (from the ledger):**
1. Odoo 19 forbids `parent_id` on a project-less task (`project_task_private_task_has_no_parent`). Personal sub-tasks therefore use OWN fields on `project.task`: `nasq_parent_id = fields.Many2one('project.task', index=True, ondelete='cascade', copy=False)` and `nasq_child_ids = fields.One2many('project.task', 'nasq_parent_id')`. A personal sub-task is a full personal task row (same rule, same `nasq_personal`), depth 1. The wire contract is unchanged: the API field is still `parent_id`, stored into `nasq_parent_id`; `parent`/`subtasks` come from `nasq_parent_id`/`nasq_child_ids`. Sub-task rows (`nasq_parent_id != False`) are excluded from the unified list (they show inside their parent). Never write Odoo's `parent_id` on a personal task.
2. The `project_todo` module gives `base.group_user` full CRUD on `project.task`, so the ORM does not enforce `tasks.tasks.*`: EVERY service method must first call the capability check (`tasks.tasks.read` for reads, `.create` for create, `.write` for update/transition) with the same access-service helper the meetings controllers use, and raise 403 `forbidden`.
3. Every create path sets `company_id = self.env.company.id` explicitly (the global rule is fail-closed on a company-less task and the bridge hook rejects a missing `company_id`).
4. Assignees must be in the `/api/v1/people` population (the PMO bridge hook does not validate `user_ids`).
5. Bridge: in `nasq_tasks_pmo`, the hook and the create whitelist must use `nasq_parent_id` instead of `parent_id` (parent must be a `nasq_personal` task; add `nasq_parent_id` to the personal create fields and drop `parent_id`); update its tests accordingly, including one proving a sub-task can be created with PMO installed.

**Interfaces:**
- Produces `nasq.task.links` (AbstractModel, copy the `_nasq_scope` and style of `nasq_meetings/models/meeting_links.py`):
  - `_nasq_project_task_domain(self, uid) -> Domain` default `Domain.FALSE`
  - `_nasq_project_ref(self, task) -> dict | None` default `None` (bridge returns `{'id', 'name', 'href'}`)
  - `_nasq_can_convert(self, task) -> bool` default `False`
- Produces `nasq.my.task.service` (AbstractModel):
  - `_search_list(self, *, closed: bool, q: str | None, assigned: bool, created: bool, sort: str, limit: int, offset: int) -> tuple[recordset, int]`
  - `_create_task(self, vals: dict) -> project.task`
  - `_update_task(self, task, vals: dict) -> project.task`
  - `_transition(self, task, action: str) -> project.task` (`action` in `done|reopen|cancel`)
  - `_allowed_actions(self, task) -> dict` keys `write, done, reopen, cancel, convert`
  - `_get_personal(self, task_id) -> project.task` raises `ApiError(404, 'not_found')` for project tasks, missing ids, and unreadable rows.
- Constants: `STATE_TO_WIRE = {'01_in_progress': 'open', '1_done': 'done', '1_canceled': 'cancelled'}` and inverse.

- [ ] **Step 1: Failing tests** (`test_service.py`, class `NasqTasksCase`)

```python
def test_create_sets_company_and_state(self):
    task = self.service(self.alice)._create_task({'name': 'Buy milk'})
    self.assertTrue(task.nasq_personal)
    self.assertEqual(task.company_id, self.alice.company_id)
    self.assertEqual(task.state, '01_in_progress')

def test_subtask_depth_limit(self):
    parent = self.service(self.alice)._create_task({'name': 'p'})
    child = self.service(self.alice)._create_task({'name': 'c', 'parent_id': parent.id})
    self.assertEqual(child.nasq_parent_id, parent)
    self.assertFalse(child.parent_id)   # Odoo's own parent_id is never used
    with self.assertRaises(ApiError) as cm:
        self.service(self.alice)._create_task({'name': 'gc', 'parent_id': child.id})
    self.assertEqual((cm.exception.status, cm.exception.code), (422, 'invalid'))

def test_subtask_parent_must_be_readable_personal(self):
    other = self.service(self.alice)._create_task({'name': 'a'})
    with self.assertRaises(ApiError):
        self.service(self.carol)._create_task({'name': 'x', 'parent_id': other.id})

def test_transitions_and_allowed_actions(self):
    t = self.service(self.alice)._create_task({'name': 'a'})
    self.assertEqual(self.service(self.alice)._allowed_actions(t),
                     {'write': True, 'done': True, 'reopen': False, 'cancel': True, 'convert': False})
    t = self.service(self.alice)._transition(t, 'done')
    self.assertEqual(t.state, '1_done')
    self.assertTrue(self.service(self.alice)._allowed_actions(t)['reopen'])
    with self.assertRaises(ApiError):
        self.service(self.alice)._transition(t, 'done')   # 422 transition_forbidden

def test_assignee_must_be_directory_person(self):
    inactive = new_test_user(self.env, login='gone', active=False)
    with self.assertRaises(ApiError) as cm:
        self.service(self.alice)._create_task({'name': 'a', 'assignees': [inactive.id]})
    self.assertEqual(cm.exception.field, 'assignees')

def test_welcome_todo_excluded(self):
    self.env['project.task'].with_user(SUPERUSER_ID).create(
        {'name': 'Welcome!', 'user_ids': [(6, 0, [self.alice.id])]})
    rows, total = self.service(self.alice)._search_list(
        closed=False, q=None, assigned=True, created=True, sort='deadline', limit=50, offset=0)
    self.assertNotIn('Welcome!', rows.mapped('name'))

def test_list_scopes_and_closed_split(self): ...  # created-by-me vs assigned-to-me vs both; closed=1 shows done+cancelled only
def test_list_default_hook_lists_personal_only(self): ...  # a project task assigned to alice is absent without the bridge
```

(`test_list_scopes_and_closed_split` and `test_list_default_hook_lists_personal_only` must be written out in full by the implementer using the same fixture; assert row ids, not just counts. The last one is skipped via `@skipIf` on `nasq_tasks_pmo` being installed, and is covered with the bridge installed in Task 8.)

Additional tests to write in full (same fixture): `test_every_service_method_checks_its_capability` (a user without `tasks.tasks.write` gets 403 on `_update_task` and `_transition`; without `create` on `_create_task`; without `read` on `_search_list`/`_get_personal`), `test_subtask_creator_and_assignee_can_toggle_done` (creator and assignee of the sub-task can move it to done through the service), `test_subtasks_excluded_from_the_list_and_listed_on_the_parent`, `test_subtask_parent_in_other_company_rejected`, `test_create_without_pmo_and_with_pmo_both_work` (the same test runs in both configs).

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Key rules:
  - `_create_task`: `vals` whitelist `name, description, date_deadline, priority, assignees, parent_id` (stored as `nasq_parent_id`); `name` stripped, 1–255 chars else 422 on `name`; `priority` maps `normal→'0'`, `high→'1'`; `description` plain text escaped into `<p>` (use `odoo.tools.html_escape`/`plaintext2html`); `company_id = self.env.company.id`; `project_id=False`; assignees validated against `self.env['nasq.directory']` population (use the same domain nasq_directory exposes; read `odoo-addons/nasq_directory/models` for the public method, do not copy its SQL); caller's own env, no `sudo()`.
  - `_search_list` domain: `Domain.OR([personal_domain, links._nasq_project_task_domain(uid)])` where `personal_domain = [('nasq_personal','=',True), ('nasq_parent_id','=',False), ('create_uid','!=', self.env.ref('base.user_root').id)]`; `assigned`/`created` flags AND-ed with `('user_ids','in',[uid])` / `('create_uid','=',uid)`, OR-ed when both are set; `closed` → `state in (1_done, 1_canceled)`; `q` → `name ilike`; sort keys `deadline` (default, nulls last), `created`, `name`; `limit = min(limit, 100)`.
  - `_transition`: allowed matrix open→done|cancel, done|cancelled→reopen; any other → `ApiError(403, 'transition_forbidden', ...)` is for capability failures, so use 422 `invalid` here (match `nasq_pmo` convention after reading its transition helper; pick whichever it uses for invalid-state transitions).
  - `_get_personal`: `task = env['project.task'].browse(id).exists()`; if not `task` or not `task.nasq_personal` or `not task.has_access('read')` → 404.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "feat(platform): add the my-task service and links hook"`

---

### Task 3: Contracts and serializers

**Files:**
- Create/replace: `packages/contracts/src/tasks/index.ts`, `packages/contracts/src/tasks/__tests__/schemas.test.ts`, `odoo-addons/nasq_tasks/serializers/personal_task.py`
- Modify: `packages/contracts/src/index.ts` (the single `export * from './tasks'` line the scaffold wrote)
- Test: contracts vitest; `odoo-addons/nasq_tasks/tests/test_service.py` gets `test_serializer_shape`.

**Interfaces:**
- Produces TS: `PersonalTaskStateSchema`, `PersonalTaskSchema`, `MyTaskListItemSchema`, `MyTaskListPageSchema` (`{items, total}`), `PersonalTaskCommentSchema`, `PersonalTaskAttachmentSchema`, `ConvertTargetSchema` (`{id, name}`), `ConvertResultSchema` (`{href}`), plus inferred types. Use `.strict()`. Person fields reuse the schema `/api/v1/people` returns (find it with `rg "people" packages/contracts/src`; import it, do not redefine).
- Produces Python: `dump_personal_task(task) -> dict`, `dump_list_item(task) -> dict`, `dump_comment(message) -> dict` with exactly the §4 field names. `attachment_count` = count of `ir.attachment` with `res_model='project.task'`, `res_id=task.id`. `description` is plain text (`html2plaintext`). `created_at`/`updated_at` ISO 8601 UTC.

- [ ] **Step 1: Failing contracts test**

```ts
import { describe, expect, it } from 'vitest'
import { PersonalTaskSchema, MyTaskListItemSchema } from '..'

describe('tasks contracts', () => {
  it('accepts a personal task detail', () => {
    expect(PersonalTaskSchema.parse({
      id: 1, name: 'a', description: '', state: 'open', priority: 'normal', date_deadline: null,
      assignees: [], creator: { id: 2, name: 'x' }, parent: null, subtasks: [], attachment_count: 0,
      created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
      allowed_actions: { write: true, done: true, reopen: false, cancel: true, convert: false },
    }).state).toBe('open')
  })
  it('rejects unknown state and extra keys', () => {
    expect(() => PersonalTaskSchema.parse({ state: 'in_progress' })).toThrow()
  })
  it('requires href on list rows and project only for project rows', () => {
    expect(() => MyTaskListItemSchema.parse({ id: 1, name: 'a', state: 'open', priority: 'normal',
      date_deadline: null, assignees: [], source: 'project', project: null, href: '/x' })).toThrow()
  })
})
```

(Person shape in the sample must match the reused schema.)

- [ ] **Step 2:** `npm test -w packages/contracts` → FAIL. **Step 3:** implement schemas (the `source: 'project'` ⇒ `project` non-null rule via `.superRefine`). **Step 4:** PASS, plus the serializer test in Odoo.
- [ ] **Step 5: Commit** `feat(platform): add the tasks wire contracts and serializers`

---

### Task 4: Routes — list, CRUD, transitions, feature gate

**Files:**
- Create: `odoo-addons/nasq_tasks/controllers/my_tasks.py`
- Test: `odoo-addons/nasq_tasks/tests/test_routes.py`, `tests/test_feature_gate.py`

**Interfaces:** routes of §5 rows 1–5. All decorated `@requires_feature('tasks.enabled', operation='read'|'write')`; each handler first calls `request.env['nasq.access.service']._nasq_require_capability('tasks.tasks.<read|create|write>')`, then the service. Route order: define `/api/v1/my-tasks/convert-targets` only in the bridge (Task 8); in this addon the `<int:task_id>` converter keeps it unambiguous.
- Query parsing: `closed` ∈ `{0,1}`, `assigned`/`created` ∈ `{me}` (default both when neither given), `limit` int ≥1 (clamped to 100), `offset` int ≥0; bad values → 422 `invalid` with `field`.
- Response list: `{'items': [dump_list_item...], 'total': int}`; writes return `dump_personal_task`.

- [ ] **Step 1: Failing tests** (full, using `NasqApiCase` request helpers; read `nasq_meetings/tests/test_meetings_routes*.py` for the call style):
  - `test_create_then_get_detail`, `test_assignee_can_patch`, `test_stranger_gets_404_on_detail_and_patch_and_done`, `test_project_task_id_is_404_for_all_methods` (create a project task, call GET/PATCH/done/comments/attachments → 404), `test_validation_errors_have_field` (empty name, 300-char name, unknown assignee, bad `closed`), `test_limit_clamped_and_offset_past_total`, `test_done_reopen_cancel_return_detail`, `test_feature_gate_403_when_disabled` (set `tasks.enabled` false through the entitlement helper used in `nasq_meetings/tests/test_meeting_feature_gates.py`; expect 403 `feature_not_included` for GET and POST), `test_missing_capability_403` (user without `tasks.tasks.create`).
- [ ] **Step 2:** run, FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(platform): add the my-tasks API routes`

---

### Task 5: Comments and attachments

**Files:**
- Create: `controllers/my_task_comments.py`, `controllers/my_task_attachments.py`
- Test: `tests/test_comments_attachments.py`

**Interfaces:** §5 rows 6–7. Comments: `GET` returns `{'items': [dump_comment]}` ordered oldest first; `POST {body}` plain text, 1–5000 chars, stored with `task.message_post(body=plaintext2html(body), message_type='comment', subtype_xmlid='mail.mt_comment')` in the caller's env; no mentions, no `task_refs`. Attachments: reuse `parse_attachment_upload` and `dump_attachment` from `nasq_api/serializers/attachment.py`; create `ir.attachment` in the caller env linked `res_model='project.task'`, `res_id=task.id`; DELETE only attachments linked to this task (404 otherwise). Storage accounting runs through the existing `ir.attachment` create/unlink hook in `nasq_platform/models/ir_attachment.py`; do not call `_nasq_claim_storage` directly and do not add `sudo()`.

- [ ] **Step 1: Failing tests:** `test_comment_roundtrip_plain_text` (HTML in `body` is escaped on read), `test_comment_requires_write_capability`, `test_comment_stranger_404`, `test_attachment_upload_list_delete`, `test_attachment_rejects_bad_mimetype_and_over_10mib`, `test_attachment_quota_exceeded_returns_422_or_403` (assert whatever `ir_attachment.py` raises today; read it first and assert that exact status), `test_delete_attachment_of_other_task_404`.
- [ ] **Step 2–4:** red, implement, green. **Step 5: Commit** `feat(platform): add my-task comments and attachments`

---

### Task 6: `tasks.assigned` notification and directory keys

**Files:**
- Create: `models/notification_types.py`, `models/directory.py`; hook into `my_task_service.py` (`_create_task`, `_update_task`)
- Test: `tests/test_notifications.py`

**Interfaces:** `_nasq_notification_types` returns `{'kind': 'tasks.assigned', 'owner': 'nasq_tasks', 'model': 'project.task', 'feature_key': 'tasks.enabled'}` (copy `meeting_notification_types.py` incl. `_nasq_notify_visible_domain`, restricted to `nasq_personal` tasks the recipient can read). `_nasq_directory_feature_keys` returns `(*super()._nasq_directory_feature_keys(), 'tasks.enabled')`. Delivery: for every user newly added to `user_ids` other than the actor, `nasq.notify.service._nasq_deliver('project.task', task.id, 'tasks.assigned', partner, body, key=f'tasks.assigned:{task.id}:{partner.id}', values={'task_id': task.id, 'task_name': task.name})`. The `sudo()` use stays inside `nasq_notify` plus the visibility lookup, documented in a comment citing §7.

- [ ] **Step 1: Failing tests:** `test_assignment_notifies_other_user_once`, `test_self_assignment_sends_nothing`, `test_reassignment_replaces_the_row` (count of `mail.message` with that key stays 1), `test_removed_assignee_row_not_visible_in_bell` (after unassigning, the bell list for that user does not return it), `test_bell_row_for_unreadable_task_hidden`, `test_people_picker_lists_for_tasks_feature` (directory feature keys include `tasks.enabled`; `/api/v1/people` response unchanged).
- [ ] **Step 2–4:** red, implement, green. **Step 5: Commit** `feat(platform): notify assignees of personal tasks`

---

### Task 7: Bridge `nasq_tasks_pmo`

**Controller rulings that bind this task (ledger):**
- Personal sub-tasks are rows linked by `nasq_parent_id` (Odoo forbids `parent_id` on project-less tasks) and `_check_nasq_parent` forbids a project task from having `nasq_parent_id`. Convert must, in ONE write in the caller's env, set `project_id` on the parent and re-home every child: set the child's `project_id` to the same project, clear its `nasq_parent_id` and set Odoo's `parent_id` to the converted task (the constraint must not fire mid-way: write children first clearing `nasq_parent_id`, or write all in a single `write` per recordset — pick what the ORM allows and prove with the test).
- The bridge already exists from Task 1b/2 (`models/project_task_personal.py` with the create hook); this task only adds the links implementation and the convert routes. No `sudo()`.
- `_nasq_project_task_domain(uid)` for project rows must keep PMO's visibility (ordinary ACL/record rules); `_nasq_can_convert` must also be False for sub-tasks (`nasq_parent_id` set) and non-open tasks.
- Every service-style check is explicit: capability `tasks.tasks.write` on the task via the access service, `pmo.tasks.create` on the target project.

**Files:**
- Create: the rest of `odoo-addons/nasq_tasks_pmo/` (the skeleton, manifest, arch rank and `models/project_task_personal.py` already exist from Task 1b; add `models/task_links_pmo.py`, controllers, tests)
- Test: `tests/test_links.py`, `tests/test_convert.py`

**Interfaces:**
- Manifest: `depends: ['nasq_tasks', 'nasq_pmo']`, `auto_install: True`, `application: False`.
- `models/task_links_pmo.py`: `_inherit = 'nasq.task.links'`:
  - `_nasq_project_task_domain(uid)` → `Domain.AND([[('project_id','!=',False), ('user_ids','in',[uid]), ('project_id.active','=',True)], super()...])` combined per hook contract (OR-ed by the service); no `sudo()`.
  - `_nasq_project_ref(task)` → `{'id': task.project_id.id, 'name': task.project_id.name, 'href': f'/projects/{task.project_id.id}/tasks/{task.id}'}` or `None` for personal tasks.
  - `_nasq_can_convert(task)` → true iff `nasq_personal` and the caller holds `pmo.tasks.create` on at least one active project (reuse the capability check helper `nasq_pmo` uses for project-scoped capabilities; read `nasq_pmo` for its public method and use it, do not import models by Python name from `nasq_pmo` in `nasq_tasks`, only here).
- `controllers/my_task_convert.py`, both gated `@requires_feature('tasks.enabled', 'pmo.enabled', ...)`:
  - `GET /api/v1/my-tasks/convert-targets?q=` → up to 20 `{id, name}` active projects where the caller holds `pmo.tasks.create`; requires `pmo.projects.read`.
  - `POST /api/v1/my-tasks/<int:task_id>/convert` body `{project_id}`: requires `tasks.tasks.write` on the task and `pmo.tasks.create` on the project; 422 `invalid` if the task is not open or already has a project; writes `project_id` and `state='01_in_progress'` in the caller env, keeps `user_ids`, deadline, description, sub-tasks (children get the same `project_id`) and attachments; returns `{'href': ...}`.

- [ ] **Step 1: Failing tests:**
  - `test_links.py`: `test_list_shows_assigned_project_task_with_source_project_and_href`, `test_project_task_not_assigned_to_me_is_absent`, `test_archived_project_task_absent`, `test_without_bridge_defaults` (assert `_nasq_project_task_domain` returns FALSE on the base model by calling `nasq_tasks`'s own class method via a context without the bridge is impossible, so assert in `nasq_tasks` Task 2 and here only the override).
  - `test_convert.py`: `test_convert_requires_pmo_tasks_create_on_target_403`, `test_convert_moves_subtasks_and_attachments`, `test_after_convert_my_tasks_detail_404_and_pmo_detail_200` (`/api/v1/my-tasks/<id>` → 404, `/api/v1/tasks/<id>` → 200), `test_convert_twice_422`, `test_convert_done_task_422`, `test_convert_targets_only_eligible_projects`, `test_convert_targets_feature_gate_pmo_disabled_403`, `test_allowed_actions_convert_flag_true_only_with_bridge_and_capability`.
- [ ] **Step 2–4:** red, implement, green; also run the whole `nasq_tasks` suite with the bridge installed and with only `nasq_tasks` installed (second scratch DB, `-i nasq_tasks` without `nasq_pmo`; `nasq_pmo` must not be pulled in; assert it by `SELECT state FROM ir_module_module WHERE name='nasq_pmo'` → `uninstalled`).
- [ ] **Step 5: Commit** `feat(platform): add the nasq_tasks_pmo bridge`

---

### Task 8: Web module — manifest, locale, composable, tests

**Files:**
- Create: `apps/web/app/modules/tasks/manifest.ts`, `apps/web/app/composables/useMyTasks.ts`, `apps/web/app/composables/myTaskKeys.ts`, `apps/web/i18n/locales/{ar,en}/my-tasks.json`, tests `apps/web/app/modules/tasks/__tests__/manifest.test.ts`, `apps/web/app/composables/__tests__/useMyTasks.test.ts`
- Modify: `apps/web/i18n/locales/{ar,en}/common.json` (`nav.myTasks`: «مهامي» / "My tasks"), `apps/web/app/modules/pmo/manifest.ts` (remove the `tasks` nav entry at line 19 and landing entry at line 35 only; keep `routePrefixes`, `contextLinks`, `routeCapabilities`, bell, search, `isNavActive`)

**Interfaces:**
- `manifest.ts` (shape from `modules/meetings/manifest.ts`): `id: 'tasks'`, `feature: 'tasks.enabled'`, `routePrefixes: ['/my-tasks']`, rail entry label key `nav.myTasks`, `order: 15`, nav `/my-tasks` capability `tasks.tasks.read`, `contextLinks` `new-task` → `/my-tasks/new` (`tasks.tasks.create`, `pinned: true`), `landing: [{ path: '/my-tasks', capability: 'tasks.tasks.read' }]`, `routeCapabilities: [{ pattern: /^\/my-tasks\/new$/, capability: 'tasks.tasks.create' }]`, `bell: { capabilities: ['tasks.tasks.read'], kinds: [{ kind: 'tasks.assigned', href: row => `/my-tasks/${row.task_id}`, title: row => String(row.task_name) }] }`.
- `myTaskKeys`: `all: ['my-tasks']`, `list: p => ['my-tasks', 'list', p]`, `detail: id => ['my-tasks', 'detail', id]`, `comments: id => ['my-tasks','comments',id]`, `attachments: id => [...]`, `convertTargets: q => [...]`.
- `useMyTasks.ts` exports `useMyTaskList(params)`, `useMyTask(id)`, `useCreateMyTask()`, `useUpdateMyTask()`, `useMyTaskTransition()` (`done|reopen|cancel`, stays pending until the server answers), `useMyTaskComments(id)`, `usePostMyTaskComment()`, `useMyTaskAttachments(id)`, `useUploadMyTaskAttachment()`, `useDeleteMyTaskAttachment()`, `useConvertTargets(q)`, `useConvertMyTask()`. Every write does `qc.setQueryData(myTaskKeys.detail(id), serverShape)` then invalidates only `myTaskKeys.list` (the list rows are a different shape); `useCreateMyTask` seeds the detail cache from the response.

- [ ] **Step 1: Failing vitest:** manifest test asserts id, feature, prefixes, rail order 15, landing, `/my-tasks/new` capability, `tasks.assigned` href/title, and that no other manifest contains `/my-tasks`; a PMO manifest test asserts nav/landing no longer contain `/tasks` and `routePrefixes` still does; composable test (mock `useApi`) asserts query key shapes, cache replacement on PATCH, and that a failed transition leaves the cached detail unchanged.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implement; write both locale files with the same key set (list tabs, filters, empty states, fields, actions, cancel confirmation, convert, errors), Arabic first. **Step 4:** `npm test` PASS, `npm -w apps/web run lint` PASS.
- [ ] **Step 5: Commit** `feat(web): add the tasks module manifest and data layer`

---

### Task 9: Web pages, components, stories, e2e

**Files:**
- Create: `apps/web/app/pages/my-tasks/{index,new,[id]}.vue`, `apps/web/app/components/my-tasks/{MyTaskRow,MyTaskForm,MyTaskSubtasks,MyTaskComments,MyTaskAttachments,ConvertToProject}.vue`, one story per shared component in `apps/web/stories/my-tasks/`, `apps/web/e2e/my-tasks.spec.ts`
- Modify: `tools/ui_policy.py` (`STORYBOOK_COMPONENTS` gets `my-tasks/…` entries only for components used by a second page; the form is used by `new.vue` and `[id].vue`, so `MyTaskForm.vue` is listed), `docs/design-system/components.md` (one Arabic row), `apps/web/e2e/ci-mock-specs.txt` if the spec should run in CI mock mode (follow the file's existing format)

**Behaviour:** `index.vue`: open/done tabs (`closed=0|1` kept in `?tab=`), assigned/created filter and `q` kept in the URL via `router.replace`, project rows show the project name and link to the row's `href`; back navigation preserves the query. `new.vue`: `SharedCreatePanel` with `back-to` from `safeReturnTo`, create button `:disabled="!hydrated || pending"`, redirects to `/my-tasks/{id}` after success. `[id].vue`: inline edit of name/description/deadline/priority/assignees (`PersonPicker`), done/reopen buttons, cancel with explicit inline confirmation, sub-task list (add, toggle done), comments, attachments, and the convert panel only when `allowed_actions.convert`. No import from `components/task` or `components/project` (arch policy checks).

- [ ] **Step 1: Failing e2e** (`my-tasks.spec.ts`, mock routes via `page.route('**/api/v1/my-tasks**', …)` as in `project-popups.spec.ts`): list renders open rows → click «+» (disabled until hydrated, asserted with the pattern from `hydration.spec.ts`) → fill and save → redirected to detail → mark done → returns to list with `?tab=` preserved and the row under the done tab. A second test: cancel shows inline confirmation and nothing is sent before confirming. A third: a project row links to its `href`.
- [ ] **Step 2:** `cd apps/web && npx playwright test e2e/my-tasks.spec.ts` → FAIL. **Step 3:** implement pages and components with Nuxt UI, logical Tailwind classes, `$t('myTasks.…')`. **Step 4:** the spec passes; then `npm test`, `npm -w apps/web run lint`, `python3 -B tools/ui_policy.py` (or whatever `npm test` runs for it) all pass. Verify the pages in the mock stack (skill `isolated-ui-mock-stack` memory): screenshots of list, new, detail in RTL, on free ports only.
- [ ] **Step 5: Commit** (two commits): `feat(web): add the my-tasks pages and components`, `test(web): cover the my-tasks flow end to end`

---

### Task 10: Gates, review, report

- [ ] **Step 1: Static gates, from the worktree**

```bash
ruff check odoo-addons
npm test
npm -w apps/web run lint
python3 -B tools/catalog_check.py
python3 -B tools/arch_policy.py --base main
python3 -B tools/git_policy.py --base main
```

Expected: all exit 0. If `arch_policy` reports a new violation, fix the code; never touch `arch_baseline.json`. Run `--write-baseline` only when a count shrank (not expected).

- [ ] **Step 2: Scratch Odoo, full release set** per `CLAUDE.md` "Check commands": fresh DB, `-i "$MODULES"` (the catalog's release modules, which now include `nasq_tasks` and the auto-installed bridge) with `--test-tags "/nasq_tasks,/nasq_tasks_pmo,/nasq_pmo,/nasq_meetings"`; a second run installs only `nasq_tasks` to prove it works without `nasq_pmo`. Remove the scratch DBs, data dirs, logs and config afterwards and confirm with `psql -l`.
- [ ] **Step 3: Review pass** with the `reviewer` agent (skill `odoo-code-review`) on `git diff main...HEAD`: R1–R10, the `sudo()` list, contract parity (Zod vs serializer fields), the global rule, ACL minimality. Fix every finding, re-run the affected tests, commit as `fix(platform): …` / `fix(web): …`.
- [ ] **Step 4: Report** (Arabic, simple): changed files, fresh command output, residual risks (the four decisions above, the `new_app.py --route` tooling change, `odoo-reviewer` unavailable, PMO manifest trim hides the `/tasks` nav entry for PMO-only tenants whose base bundle lacks `tasks.enabled`).

---

## Self-review

- **Spec coverage:** §2 → T0 (scaffold tooling), T1, T7; §3 → T1, T2; §4 → T3; §5 → T4, T5; §6.1/6.2 → T2, T7; §6.3 → T8; §7 → T1 (rule, ACL), T6 (sudo cases); §8 → T1 (feature, catalog, arch layers); §9 → T6, T8; §10 → T8, T9; §11 → T1 (compute on install); §12 tests → T1, T2, T4–T7, T8, T9; §13 order preserved (steps 1–2 = T1–T6, step 3 = T7, step 4 = T8–T9, step 5 = T10).
- **Open items the owner decides** are the four listed under "Decisions". Nothing else is deferred.
- **Names used across tasks** (`nasq.my.task.service`, `nasq.task.links`, `dump_personal_task`, `dump_list_item`, `dump_comment`, `myTaskKeys`, `useMyTask*`) are defined once in the task that produces them.
