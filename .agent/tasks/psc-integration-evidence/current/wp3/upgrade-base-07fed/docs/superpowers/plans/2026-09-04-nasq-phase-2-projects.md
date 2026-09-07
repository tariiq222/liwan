# nasq Phase 2 — Projects List & Project Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship **المشاريع** (projects table with status + progress) and **المشروع** (header with manager-settable status, قائمة / لوحة of the project's tasks by *project* stage, إنشاء مهمة, the phase-1 task modal on a nested route), and remove time logging from the product.

**Architecture:** Odoo stays the engine. `nasq_pmo` gains a `project.project` `_inherit` (status rule + hooks), a project serializer, three project endpoints, a `project_id` scope on the task list and `stage_id` on task PATCH; `nasq_core` drops `hr_timesheet`. `packages/contracts` mirrors the new shapes in zod. The Nuxt app gets `useProjectList/useProject/useSetProjectStatus`, a stage-source abstraction so the phase-1 board/table/toolbar/dialog/modal work for both مهامي (personal stages, localStorage filters) and a project (project stages, URL filters), five small `project/*` components, and three pages under `pages/projects/`.

**Tech Stack:** Odoo 19.0 CE (Python 3.12), Nuxt 4 / Vue 3.5 / TS, Tailwind v4, shadcn-vue (`Progress` added), `@tanstack/vue-query` 5, `@tanstack/vue-table`, `@nuxtjs/i18n` 10, `vue-draggable-plus`, `vue-sonner`, zod 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-nasq-phase-2-projects-design.md` (refines `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`). Ownership rule between pillars: `docs/parallel-work.md` (this plan touches only PMO-owned and shared-touchpoint files; never `people.vue`, never `hr.*` keys).

## Global Constraints

- Branch `phase-2` in `/Users/tariq/code/nasq` (created from `main` @ `48017fa`). The Odoo checkout `/Users/tariq/code/odoo` is never modified; never run `git` there.
- Odoo commands run from `/Users/tariq/code/odoo`. Canonical suite on a fresh scratch DB (proves manifest deps are real): `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo --http-port=8169 --stop-after-init` (timeout 900000 ms). Re-runs on the same DB use `-u nasq_core,nasq_api,nasq_pmo` instead of `-i`. Never use `odoo19` for tests. To load Python changes into the dev DB for e2e: `.venv/bin/python odoo-bin -c odoo.conf -d odoo19 -u nasq_core,nasq_pmo --no-http --stop-after-init` (the dev server on :8069 runs `--dev=all` and autoreloads Python, but data/security changes need the `-u`).
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; manifests keep `'license': 'LGPL-3'`, `'version': '19.0.1.0.0'`, `'author': 'Tariq Alwalidi'`. `ruff check odoo-addons` clean.
- API routes: `@http.route('/api/v1/...', type='json2', auth='user', methods=[...], readonly=<bool>)`; json2 routes do **not** receive the query string as kwargs — read `request.httprequest.args`. Errors `{"code", "message", "field"?}` with a real HTTP status. No `sudo()` to dodge access errors. Serializers whitelist explicitly.
- Wire vocabularies: task states `in_progress|changes_requested|approved|waiting|done|cancelled`; project status `on_track|at_risk|off_track|on_hold|done|null` (Odoo `to_define` → `null`). Manager rule: `project.group_project_manager` or `nasq_core.group_customer_admin`.
- **No time logging anywhere.** No timesheet fields, tabs, reports or dependencies. `allocated_hours` (an estimate) stays.
- Frontend: Arabic default, English secondary, all strings via `$t()`/`t()`; PMO locale files are `apps/web/i18n/locales/{ar,en}/{tasks,projects}.json` (`projects.json` is new; `common.json` is shared — only the `nav.*` exception may touch it, and this phase needs no new nav key); Tailwind logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`); no new colours; every SSR-rendered interactive control is `:disabled="!hydrated"` via `useHydrated()`.
- Contracts are `.strict()` zod schemas in `packages/contracts/src/pmo/`; every wire change lands there **and** in the Odoo serializer **and** in the Odoo test key sets in the same task.
- Dev servers: Odoo :8069, Nuxt :3000 (`npm run dev` from repo root). Restart Nuxt after `nuxt.config.ts`/`server/` changes or after adding a shadcn component dir: `pkill -f "node_modules/.bin/nuxt dev"; pkill -f "@nuxt/cli/dist/dev/index.mjs"`, then `nohup npm run dev > /tmp/nuxt-dev.log 2>&1 &`, wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` prints 200.
- npm: the user's global `~/.npmrc` is malformed — always `--ignore-scripts` on `npm install`; shadcn: `touch /tmp/empty.npmrc && npm_config_userconfig=/tmp/empty.npmrc npx shadcn-vue@latest add <name>` run from `apps/web`. Never edit `~/.npmrc`.
- Checks: `npm -w packages/contracts run test`, `npm -w apps/web run test` (Vitest), `npm -w apps/web run lint` (`vue-tsc --build --noEmit`), `npm -w apps/web run test:e2e` (Playwright, `workers: 1`, needs both dev servers and the dev DB updated), `ruff check odoo-addons`.
- Commit messages: `[ADD]|[IMP]|[FIX] <scope>: <summary>` + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task. Never amend, rebase or reset — other agents may be committing to the same branch concurrently; commit only the files your task owns.
- e2e login is `admin`/`admin` (role `vendor`, a project manager). Fixtures are created through the API or Odoo's `/web/dataset/call_kw` with the session cookie, never through the UI.

## File Structure

```
odoo-addons/
├── nasq_core/
│   ├── __manifest__.py                         depends -= hr_timesheet                        (Task 1)
│   ├── security/nasq_core_security.xml         group_employee no longer implies hr_timesheet  (Task 1)
│   └── tests/test_groups.py                    asserts the new implied set                    (Task 1)
└── nasq_pmo/
    ├── models/__init__.py · models/project_project.py   _nasq_can_manage, _nasq_set_status + hooks (Task 2)
    ├── tests/test_project_status.py            TransactionCase for the model rule             (Task 2)
    ├── serializers/task.py                     'stage' in dump_task; stage_id parse           (Task 3)
    ├── controllers/tasks.py                    filter=mine OR project_id; int-safe project_id (Task 3)
    ├── tests/test_tasks.py                     TASK_KEYS + scope + stage tests                (Task 3)
    ├── serializers/__init__.py · serializers/project.py  dump_project(_detail), dump_stage    (Task 4)
    ├── controllers/projects.py                 list (full/minimal), detail, status            (Task 4)
    ├── tests/__init__.py · tests/test_projects.py       HttpCase for the three endpoints      (Task 4)
    └── __manifest__.py                         summary mentions project status                (Task 4)
packages/contracts/src/pmo/
    ├── project.ts                              ProjectRef/Status/Project/Stage/Detail/StatusBody (Task 5)
    ├── personal-stage.ts                       ProjectRefSchema removed (moved)               (Task 5)
    ├── task.ts                                 stage, stage_id                                (Task 5)
    ├── index.ts                                export './project'                             (Task 5)
    └── __tests__/schemas.test.ts               fixtures gain stage; project schema tests      (Task 5)
apps/web/
├── i18n/locales/{ar,en}/projects.json          projects.* namespace                           (Task 6)
├── i18n/locales/{ar,en}/tasks.json             tasks.columns.assignees, tasks.kanban.noStages (Task 6)
├── nuxt.config.ts                              + 'ar/projects.json', 'en/projects.json'       (Task 6)
├── app/composables/
│   ├── projectStatus.ts                        label/tone maps, progressLabel (pure)          (Task 7)
│   ├── boardStages.ts                          StageSource, stageOf, movePatch (pure)         (Task 7)
│   ├── projectTaskParams.ts                    query ↔ TaskListParams (pure)                  (Task 7)
│   ├── taskState.ts                            + TONE_CLASS export                            (Task 7)
│   ├── useTasks.ts                             mine?, stage_id in applyPatchToTask            (Task 7)
│   ├── useProjects.ts                          projectKeys, useProjectList/useProject/useSetProjectStatus (Task 7)
│   ├── useBus.ts                               also invalidates ['projects'] and ['project']  (Task 7)
│   └── __tests__/{projectStatus,boardStages,projectTaskParams}.test.ts + useTasks.optimistic/useBus updated (Task 7)
├── app/components/task/
│   ├── StateBadge.vue                          imports TONE_CLASS                             (Task 7)
│   ├── TaskBoard.vue · TaskCard.vue            stageSource prop                               (Task 8)
│   ├── TaskTable.vue · TaskToolbar.vue · CreateTaskDialog.vue   variant / hideProjectFilter / projectId (Task 9)
│   └── TaskDetailModal.vue · TaskDetailPanel.vue   basePath, closeTo, siblingParams           (Task 10)
├── app/components/project/
│   ├── ProjectStatusBadge.vue · ProjectProgress.vue · ProjectStatusSelect.vue · ProjectHeader.vue · ProjectTable.vue (Task 11)
│   └── (ui/progress via shadcn)                                                               (Task 11)
├── app/components/CommandMenu.vue              projects group                                 (Task 12)
├── app/pages/projects.vue                      DELETED                                        (Task 12)
├── app/pages/projects/index.vue · [id].vue · [id]/tasks/[taskId].vue                          (Task 12)
└── e2e/contracts.spec.ts · e2e/projects.spec.ts                                              (Task 13)
docs: README.md, CLAUDE.md, docs/parallel-work.md, spec Status                                 (Task 14)
```

Parallelism: Tasks 1, 2, 3, 5, 6 are independent of each other. Task 4 needs 2. Task 7 needs 5 and 6. Tasks 8, 9, 10 need 7 and are mutually independent (disjoint files). Task 11 needs 7. Task 12 needs 8–11. Task 13 needs 4 and 12 and the dev DB updated. Task 14 last.

---

### Task 1: nasq_core — drop time logging

**Files:**
- Modify: `odoo-addons/nasq_core/__manifest__.py`
- Modify: `odoo-addons/nasq_core/security/nasq_core_security.xml`
- Test: `odoo-addons/nasq_core/tests/test_groups.py`

**Interfaces:**
- Produces: `nasq_core` depends `['base', 'project', 'hr']`; `group_employee` implies `base.group_user` + `project.group_project_user` only.

- [ ] **Step 1: Change the test to assert the new implied set**

In `test_groups.py`, replace
```python
        self.assertIn(self.env.ref('hr_timesheet.group_hr_timesheet_user'), employee.all_implied_ids)
```
with
```python
        # nasq has no time logging (spec 2026-09-04): the employee role must not
        # carry the timesheet group even on a database where hr_timesheet happens
        # to be installed.
        timesheet_group = self.env.ref('hr_timesheet.group_hr_timesheet_user', raise_if_not_found=False)
        if timesheet_group:
            self.assertNotIn(timesheet_group, employee.all_implied_ids)
        self.assertNotIn('hr_timesheet', self.env['ir.module.module']._get('nasq_core').dependencies_id.mapped('name'))
```

- [ ] **Step 2: Run it to see it fail**

Run from `/Users/tariq/code/odoo`: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core --http-port=8169 --stop-after-init 2>&1 | grep -E "FAIL|ERROR|tests? .*failed|nasq_core"`
Expected: `test_groups_imply_odoo_groups` FAILS (the group is still implied / the dependency is still declared).

- [ ] **Step 3: Drop the dependency and the implied group**

`__manifest__.py`:
```python
    # project / hr: security/nasq_core_security.xml's groups imply
    # project.group_project_user + _manager and hr.group_hr_manager; res.company.font /
    # primary_color are base fields. No hr_timesheet: nasq has no time logging.
    'depends': ['base', 'project', 'hr'],
```
`security/nasq_core_security.xml`, `group_employee`:
```xml
        <field name="comment">Uses the nasq app: projects and tasks.</field>
        ...
        <field name="implied_ids" eval="[
            (4, ref('base.group_user')),
            (4, ref('project.group_project_user')),
        ]"/>
```
Note: `(4, ...)` links only add, so on an *existing* database (the dev DB `odoo19`) the old timesheet link survives a `-u`. That is accepted: provisioning always installs on a fresh database, and the Step 1 test runs on a fresh database. Do not add a migration or a `post_init_hook` for it.

- [ ] **Step 4: Run the suite on a fresh DB**

Run: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo --http-port=8169 --stop-after-init 2>&1 | tail -5` (drop the DB first if it exists: `dropdb nasq_p2`).
Expected: `0 failed, 0 error(s) of 57 tests`. Also `ruff check odoo-addons` → `All checks passed!`.

- [ ] **Step 5: Commit**

```bash
git add odoo-addons/nasq_core
git commit -m "[IMP] nasq_core: drop hr_timesheet — nasq has no time logging

Existing databases keep hr_timesheet installed and the old implied link;
provisioning always installs on a fresh database so new customers never get it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: nasq_pmo — project status rule on the model

**Files:**
- Create: `odoo-addons/nasq_pmo/models/project_project.py`
- Modify: `odoo-addons/nasq_pmo/models/__init__.py`
- Create: `odoo-addons/nasq_pmo/tests/test_project_status.py`
- Modify: `odoo-addons/nasq_pmo/tests/__init__.py` (add `test_project_status`)

**Interfaces:**
- Produces: `STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}` (module constant), `project.project._nasq_can_manage() -> bool`, `project.project._nasq_set_status(status: str) -> project` raising `ValueError` for unknown values and `AccessError` when the user may not manage.

- [ ] **Step 1: Write the failing test**

`tests/test_project_status.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestProjectStatus(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pmo_emp', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pmo_mgr',
                                    groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Status project'})

    def test_manager_sets_status_and_odoo_records_an_update(self):
        project = self.project.with_user(self.manager)
        self.assertEqual(project.last_update_status, 'to_define')
        project._nasq_set_status('at_risk')
        self.assertEqual(project.last_update_status, 'at_risk')
        update = self.env['project.update'].search([('project_id', '=', self.project.id)])
        self.assertEqual(len(update), 1)
        self.assertEqual(update.status, 'at_risk')

    def test_employee_cannot_set_status(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.employee)._nasq_set_status('on_track')
        self.assertEqual(self.project.last_update_status, 'to_define')

    def test_unknown_value_is_a_value_error(self):
        with self.assertRaises(ValueError):
            self.project.with_user(self.manager)._nasq_set_status('to_define')

    def test_can_manage(self):
        self.assertFalse(self.project.with_user(self.employee)._nasq_can_manage())
        self.assertTrue(self.project.with_user(self.manager)._nasq_can_manage())
```
Add `test_project_status,` to `tests/__init__.py` (keep the alphabetical order of the import list).

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -u nasq_pmo --test-tags /nasq_pmo:TestProjectStatus --http-port=8169 --stop-after-init 2>&1 | grep -E "ERROR|FAIL|tests"`
Expected: 4 errors — `AttributeError: 'project.project' object has no attribute '_nasq_set_status'`.

- [ ] **Step 3: Implement the model**

`models/project_project.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by nasq (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}


class ProjectProject(models.Model):
    _inherit = 'project.project'

    def _nasq_can_manage(self):
        """True when the current user may set project status (same rule as task approval)."""
        return (
            self.env.user.has_group('project.group_project_manager')
            or self.env.user.has_group('nasq_core.group_customer_admin')
        )

    def _nasq_set_status(self, status):
        """Set ``last_update_status`` on ``self`` applying nasq's manager rule.

        Odoo's ``project.project.write`` turns a ``last_update_status`` write into a
        new ``project.update`` record, so the project's update history stays intact.
        Decomposed into hooks so a customer overlay can override one step.
        """
        if status not in STATUS_VALUES:
            raise ValueError(f"unknown project status {status!r}")
        self._nasq_check_status_allowed(status)
        self._nasq_do_set_status(status)
        self._nasq_post_status_hook(status)
        return self

    def _nasq_check_status_allowed(self, status):
        if not self._nasq_can_manage():
            raise AccessError(self.env._("Only a project manager can set the project status."))

    def _nasq_do_set_status(self, status):
        self.write({'last_update_status': status})

    def _nasq_post_status_hook(self, status):
        """Extension point; nothing in core."""
```
`models/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import project_project, project_task
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command. Expected: `0 failed, 0 error(s)` for the 4 tests. Then the full suite (`-u nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo`) → 61 tests green, `ruff check odoo-addons` clean.

- [ ] **Step 5: Commit**

```bash
git add odoo-addons/nasq_pmo/models odoo-addons/nasq_pmo/tests/__init__.py odoo-addons/nasq_pmo/tests/test_project_status.py
git commit -m "[ADD] nasq_pmo: project status rule (_nasq_set_status) with overlay hooks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: nasq_pmo — task list scoped by project, `stage` on the wire, `stage_id` PATCH

**Files:**
- Modify: `odoo-addons/nasq_pmo/serializers/task.py`
- Modify: `odoo-addons/nasq_pmo/controllers/tasks.py`
- Test: `odoo-addons/nasq_pmo/tests/test_tasks.py`

**Interfaces:**
- Consumes: `NasqPmoCase` fixtures (`cls.project`, `cls.employee`, `cls.manager`, `cls.task_overdue/done/other`).
- Produces: `dump_task()` includes `'stage': {'id', 'name'} | None` (`task.stage_id`); `parse_task_vals(payload, can_manage, task)` — new required `task` argument, accepts `stage_id`; `GET /api/v1/tasks` accepts `filter=mine` and/or `project_id=<int>`.

- [ ] **Step 1: Write the failing tests**

In `test_tasks.py`, change `TASK_KEYS` to include `'stage'`:
```python
TASK_KEYS = {'id', 'name', 'project', 'state', 'priority', 'date_deadline',
             'days_remaining', 'is_overdue', 'is_closed', 'personal_stage', 'stage',
             'assignees', 'tags'}
```
Append a new class at the end of the file:
```python
@tagged('post_install', '-at_install', 'nasq')
class TestTaskProjectScope(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Stage = cls.env['project.task.type']
        cls.stage_todo = Stage.create({'name': 'To Do', 'sequence': 1, 'project_ids': [(4, cls.project.id)]})
        cls.stage_doing = Stage.create({'name': 'Doing', 'sequence': 2, 'project_ids': [(4, cls.project.id)]})
        cls.other_project = cls.env['project.project'].create({'name': 'Other'})
        cls.stage_elsewhere = Stage.create({'name': 'Elsewhere', 'project_ids': [(4, cls.other_project.id)]})
        # Force the fixture tasks onto the new first stage (they were created before it existed).
        (cls.task_overdue + cls.task_done + cls.task_other).write({'stage_id': cls.stage_todo.id})

    def test_list_project_id_alone_lists_every_readable_task(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks?project_id={self.project.id}').json()
        self.assertEqual({t['id'] for t in body['items']}, {self.task_overdue.id, self.task_other.id})
        self.assertEqual(body['items'][0]['stage'], {'id': self.stage_todo.id, 'name': 'To Do'})

    def test_list_mine_and_project_id_is_the_intersection(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks?filter=mine&project_id={self.project.id}').json()
        self.assertEqual([t['id'] for t in body['items']], [self.task_overdue.id])
        body = self.api('GET', f'/api/v1/tasks?filter=mine&project_id={self.other_project.id}').json()
        self.assertEqual(body['items'], [])

    def test_list_project_id_must_be_an_int(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?project_id=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'project_id')

    def test_list_unknown_filter_is_400(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks?filter=theirs&project_id={self.project.id}')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_list_unreadable_project_is_empty_not_404(self):
        self.project.write({'privacy_visibility': 'followers'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks?project_id={self.project.id}').json()
        self.assertEqual(body, {'items': [], 'total': 0})

    def test_detail_includes_stage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertEqual(body['stage'], {'id': self.stage_todo.id, 'name': 'To Do'})

    def test_patch_stage_id_moves_the_task(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': self.stage_doing.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['stage'], {'id': self.stage_doing.id, 'name': 'Doing'})
        self.assertEqual(self.task_overdue.stage_id, self.stage_doing)

    def test_patch_stage_of_another_project_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': self.stage_elsewhere.id})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'stage_id')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': None})
        self.assertEqual(res.status_code, 422)
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': 'x'})
        self.assertEqual(res.status_code, 422)
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -u nasq_pmo --test-tags /nasq_pmo:TestTaskProjectScope,/nasq_pmo:TestTaskRead --http-port=8169 --stop-after-init 2>&1 | grep -E "ERROR|FAIL|tests"`
Expected: the key-set assertions in `TestTaskRead` fail (`stage` missing) and every `TestTaskProjectScope` test fails (400 where 200 expected, 422 `unknown_field` for `stage_id`).

- [ ] **Step 3: Serializer**

In `serializers/task.py`:
```python
EMPLOYEE_FIELDS = {'name', 'description', 'date_deadline', 'priority', 'user_ids', 'tag_ids',
                   'personal_stage_type_id', 'stage_id'}
```
In `dump_task`, after `'personal_stage': ...`:
```python
        # The *project* stage (kanban column on the project screen); personal_stage
        # is the user's private column on مهامي.
        'stage': _ref(task.stage_id) if task.stage_id else None,
```
Add:
```python
def _parse_stage(task, value, key):
    """Coerce + authorise a project stage id: it must be one of the task's project's stages."""
    try:
        stage_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stage ids", field=key) from e
    stage = request.env['project.task.type'].browse(stage_id).exists()
    if not stage or task.project_id not in stage.project_ids:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stage ids", field=key)
    return stage.id
```
Change the signature and the dispatch:
```python
def parse_task_vals(payload, can_manage, task):
    """Whitelist + coerce a PATCH payload for ``task`` into ORM vals. Raises ApiError(422)."""
    ...
        elif key == 'personal_stage_type_id':
            vals[key] = _parse_personal_stage(value, key)
        elif key == 'stage_id':
            vals[key] = _parse_stage(task, value, key)
```
`_ref` uses `display_name`; for `project.task.type` that is the stage name, which is what the tests assert.

- [ ] **Step 4: Controller**

In `controllers/tasks.py::list_tasks`, replace the block from `if filter_ != 'mine':` down to `domain = (...)` and the later `if project_id:` with:
```python
        if filter_ not in (None, 'mine'):
            raise ApiError(400, 'unsupported_filter', "filter must be 'mine'")
        if project_id is not None:
            try:
                project_id = int(project_id)
            except ValueError:
                raise ApiError(422, 'invalid', "project_id must be an integer", field='project_id') from None
        if filter_ != 'mine' and not project_id:
            raise ApiError(400, 'unsupported_filter', "pass filter=mine and/or project_id")
        limit = parse_nonneg_int(limit, 'limit')
        offset = parse_nonneg_int(offset, 'offset')
        # project_todo (auto-installed alongside project) gives every new internal user a
        # personal "Welcome" project.task with no project_id; the nasq task list is about
        # project work, so exclude those to-dos rather than surfacing them as "mine".
        domain = Domain('project_id', '!=', False) & Domain('is_closed', '=', closed in ('1', 'true', True))
        if filter_ == 'mine':
            domain &= Domain('user_ids', 'in', [request.env.uid])
        if project_id:
            # ACL/ir.rule decide readability; an unreadable project simply yields nothing.
            domain &= Domain('project_id', '=', project_id)
```
(Delete the old `if project_id: domain &= Domain('project_id', '=', int(project_id))` further down.) In `patch_task`: `vals = parse_task_vals(payload, can_manage=task._nasq_can_approve(), task=task)`.

- [ ] **Step 5: Run the suite**

Run the Step 2 command → all green. Then the full suite → 69 tests, `0 failed`; `ruff check odoo-addons` clean. Also grep for other callers of `parse_task_vals` (`grep -rn parse_task_vals odoo-addons`) — only `controllers/tasks.py` should call it.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/nasq_pmo/serializers/task.py odoo-addons/nasq_pmo/controllers/tasks.py odoo-addons/nasq_pmo/tests/test_tasks.py
git commit -m "[IMP] nasq_pmo: task list scoped by project_id; project stage on the wire and in PATCH

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: nasq_pmo — project endpoints

**Files:**
- Create: `odoo-addons/nasq_pmo/serializers/project.py`
- Modify: `odoo-addons/nasq_pmo/serializers/__init__.py`
- Modify: `odoo-addons/nasq_pmo/controllers/projects.py`
- Modify: `odoo-addons/nasq_pmo/__manifest__.py` (summary)
- Create: `odoo-addons/nasq_pmo/tests/test_projects.py`
- Modify: `odoo-addons/nasq_pmo/tests/__init__.py`

**Interfaces:**
- Consumes: `STATUS_VALUES`, `_nasq_set_status`, `_nasq_can_manage` (Task 2); `ApiError`, `api_handler`, `get_record` from `nasq_api.controllers.common`.
- Produces:
  - `GET /api/v1/projects` → `[{id, name, status, progress, task_count, closed_task_count}]` (name asc, max 200); `?minimal=1` → `[{id, name}]`; any other query key → 400 `unsupported_filter`.
  - `GET /api/v1/projects/<id>` → the list shape + `stages: [{id, name, sequence, fold}]` (sequence, id order) + `can_manage: bool`.
  - `POST /api/v1/projects/<id>/status` body `{status}` → detail shape; 422 `invalid_status` (field `status`); 403 `status_forbidden`.

- [ ] **Step 1: Write the failing tests**

`tests/test_projects.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

PROJECT_KEYS = {'id', 'name', 'status', 'progress', 'task_count', 'closed_task_count'}
DETAIL_KEYS = PROJECT_KEYS | {'stages', 'can_manage'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjects(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Stage = cls.env['project.task.type']
        cls.stage_b = Stage.create({'name': 'B', 'sequence': 20, 'project_ids': [(4, cls.project.id)]})
        cls.stage_a = Stage.create({'name': 'A', 'sequence': 10, 'fold': True, 'project_ids': [(4, cls.project.id)]})
        cls.private = cls.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})

    def test_minimal_unchanged(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
        self.assertEqual(set(items[0]), {'id', 'name'})

    def test_list_full_shape_and_progress(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects').json()
        mine = next(p for p in items if p['id'] == self.project.id)
        self.assertEqual(set(mine), PROJECT_KEYS)
        self.assertIsNone(mine['status'], 'to_define is null on the wire')
        # Fixtures: task_overdue (open), task_done (closed), task_other (open) → 1 of 3.
        self.assertEqual((mine['task_count'], mine['closed_task_count'], mine['progress']), (3, 1, 33))
        self.assertNotIn(self.private.id, [p['id'] for p in items])
        self.assertEqual([p['name'] for p in items], sorted(p['name'] for p in items))

    def test_list_unknown_query_is_400(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?archived=1')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_detail_stages_and_can_manage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/projects/{self.project.id}').json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertFalse(body['can_manage'])
        self.assertEqual(body['stages'], [
            {'id': self.stage_a.id, 'name': 'A', 'sequence': 10, 'fold': True},
            {'id': self.stage_b.id, 'name': 'B', 'sequence': 20, 'fold': False},
        ])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertTrue(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['can_manage'])

    def test_detail_missing_and_unreadable(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/projects/999999').status_code, 404)
        res = self.api('GET', f'/api/v1/projects/{self.private.id}')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_status_manager_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'on_track'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'status_forbidden')

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'at_risk'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['status'], 'at_risk')
        self.assertEqual(set(res.json()), DETAIL_KEYS)
        self.assertEqual(self.env['project.update'].search([('project_id', '=', self.project.id)]).status, 'at_risk')

    def test_status_invalid_value(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        for bad in ('to_define', 'purple', None):
            res = self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': bad})
            self.assertEqual(res.status_code, 422, bad)
            self.assertEqual(res.json()['code'], 'invalid_status')
            self.assertEqual(res.json()['field'], 'status')
```
Add `test_projects,` to `tests/__init__.py` (alphabetical: after `test_personal_stages`, before `test_project_status`).

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -u nasq_pmo --test-tags /nasq_pmo:TestProjects --http-port=8169 --stop-after-init 2>&1 | grep -E "ERROR|FAIL|tests"`
Expected: every test but `test_minimal_unchanged` fails (400s / 404s).

- [ ] **Step 3: Serializer**

`serializers/project.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.

# Odoo's 'to_define' means "no status yet"; it is null on the wire, never a badge.
STATUS_TO_API = {
    'on_track': 'on_track',
    'at_risk': 'at_risk',
    'off_track': 'off_track',
    'on_hold': 'on_hold',
    'done': 'done',
    'to_define': None,
}


def dump_stage(stage):
    return {'id': stage.id, 'name': stage.name, 'sequence': stage.sequence, 'fold': stage.fold}


def dump_project(project):
    return {
        'id': project.id,
        'name': project.name,
        'status': STATUS_TO_API.get(project.last_update_status),
        # task_completion_percentage is a 0..1 ratio (0 when there are no tasks).
        'progress': round(project.task_completion_percentage * 100),
        'task_count': project.task_count,
        'closed_task_count': project.closed_task_count,
    }


def dump_project_detail(project):
    data = dump_project(project)
    data.update({
        'stages': [dump_stage(s) for s in project.type_ids.sorted(lambda s: (s.sequence, s.id))],
        'can_manage': project._nasq_can_manage(),
    })
    return data
```
`serializers/__init__.py`: `from . import project, task, timeline`.

- [ ] **Step 4: Controller**

Replace `controllers/projects.py` with:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project import dump_project, dump_project_detail

MAX_PROJECTS = 200


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_projects(self, **_):
        # json2 routes do not receive query-string params as kwargs — read them from the
        # raw request (see the same note in controllers/tasks.py::list_tasks).
        args = request.httprequest.args
        unknown = set(args) - {'minimal'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        projects = request.env['project.project'].search([], order='name, id', limit=MAX_PROJECTS)
        if args.get('minimal') in ('1', 'true'):
            return [{'id': p.id, 'name': p.name} for p in projects]
        return [dump_project(p) for p in projects]

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_project(self, project_id):
        return dump_project_detail(get_record('project.project', project_id))

    @http.route('/api/v1/projects/<int:project_id>/status', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def set_status(self, project_id, status=None, **_):
        if status not in STATUS_VALUES:
            raise ApiError(422, 'invalid_status', f"status must be one of {sorted(STATUS_VALUES)}", field='status')
        project = get_record('project.project', project_id)
        try:
            project._nasq_set_status(status)
        except AccessError as e:
            raise ApiError(403, 'status_forbidden', str(e)) from e
        return dump_project_detail(project)
```
Manifest summary: `'summary': 'nasq platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages), people',`.

- [ ] **Step 5: Run the suite**

Step 2 command → 8 green. Full suite → 77 tests, `0 failed`; `ruff check odoo-addons` clean. If `test_list_full_shape_and_progress` fails on the counts, print the fixture tasks' `is_closed`/`state` and adjust nothing but the expected numbers **only if** Odoo counts sub-tasks differently — the three fixture tasks have no children, so `(3, 1, 33)` is expected.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/nasq_pmo/serializers odoo-addons/nasq_pmo/controllers/projects.py odoo-addons/nasq_pmo/__manifest__.py odoo-addons/nasq_pmo/tests/__init__.py odoo-addons/nasq_pmo/tests/test_projects.py
git commit -m "[ADD] nasq_pmo: /api/v1/projects list, detail with stages, and status endpoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: contracts — project schemas, `stage` on tasks

**Files:**
- Create: `packages/contracts/src/pmo/project.ts`
- Modify: `packages/contracts/src/pmo/personal-stage.ts` (remove `ProjectRefSchema`)
- Modify: `packages/contracts/src/pmo/task.ts`
- Modify: `packages/contracts/src/pmo/index.ts`
- Test: `packages/contracts/src/pmo/__tests__/schemas.test.ts`

**Interfaces:**
- Produces (all exported from `@nasq/contracts`): `ProjectRefSchema`, `ProjectStatusSchema` (enum of the five), `PROJECT_STATUSES: readonly ProjectStatus[]`, `ProjectSchema`, `ProjectStageSchema`, `ProjectDetailSchema`, `ProjectStatusBodySchema`, types `ProjectStatus`, `Project`, `ProjectStage`, `ProjectDetail`; `TaskSchema.stage: RefSchema.nullable()`; `TaskPatchSchema.stage_id?: number`.

- [ ] **Step 1: Write the failing tests**

In `schemas.test.ts` add `stage: { id: 9, name: 'To Do' }` to `TASK_JSON` (after `personal_stage`), extend the imports with `ProjectSchema, ProjectDetailSchema, ProjectStatusBodySchema, PROJECT_STATUSES`, and append:
```ts
const PROJECT_JSON = { id: 3, name: 'Erada Portal', status: null, progress: 33, task_count: 3, closed_task_count: 1 }

describe('ProjectSchema', () => {
  it('accepts the list shape with a null (unset) status', () => {
    expect(ProjectSchema.parse(PROJECT_JSON).status).toBeNull()
  })
  it('rejects to_define — it is never on the wire', () => {
    expect(() => ProjectSchema.parse({ ...PROJECT_JSON, status: 'to_define' })).toThrow()
  })
  it('rejects a progress outside 0..100', () => {
    expect(() => ProjectSchema.parse({ ...PROJECT_JSON, progress: 101 })).toThrow()
  })
})

describe('ProjectDetailSchema', () => {
  it('accepts stages and can_manage', () => {
    const parsed = ProjectDetailSchema.parse({
      ...PROJECT_JSON, status: 'at_risk', can_manage: true,
      stages: [{ id: 1, name: 'A', sequence: 10, fold: true }],
    })
    expect(parsed.stages[0]!.fold).toBe(true)
  })
})

describe('ProjectStatusBodySchema', () => {
  it('lists exactly the five writable statuses and rejects to_define', () => {
    expect(PROJECT_STATUSES).toEqual(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
    expect(() => ProjectStatusBodySchema.parse({ status: 'to_define' })).toThrow()
  })
})

describe('TaskPatchSchema stage_id', () => {
  it('accepts stage_id', () => {
    expect(TaskPatchSchema.parse({ stage_id: 4 })).toEqual({ stage_id: 4 })
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npm -w packages/contracts run test`
Expected: FAIL — `ProjectSchema` not exported; `TaskSchema` rejects the `stage` key.

- [ ] **Step 3: Implement**

`project.ts`:
```ts
import { z } from 'zod'

export const ProjectRefSchema = z.object({ id: z.number().int(), name: z.string() }).strict()

// The five statuses a manager may set. Odoo's 'to_define' ("unset") is null on
// the wire and never a member of this enum.
export const ProjectStatusSchema = z.enum(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
export const PROJECT_STATUSES = ProjectStatusSchema.options

export const ProjectSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema.nullable(),
  progress: z.number().int().min(0).max(100), task_count: z.number().int(), closed_task_count: z.number().int(),
}).strict()

export const ProjectStageSchema = z.object({ id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean() }).strict()

export const ProjectDetailSchema = ProjectSchema.extend({ stages: z.array(ProjectStageSchema), can_manage: z.boolean() }).strict()

export const ProjectStatusBodySchema = z.object({ status: ProjectStatusSchema }).strict()

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectStage = z.infer<typeof ProjectStageSchema>
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
```
`personal-stage.ts`: delete the `ProjectRefSchema` line. `task.ts`: in `TaskSchema` after `personal_stage: RefSchema.nullable(),` add `stage: RefSchema.nullable(),`; in `TaskPatchSchema` after `personal_stage_type_id...` add `stage_id: z.number().int().optional(),`. `index.ts`: add `export * from './project'`.

- [ ] **Step 4: Run tests + downstream type check**

`npm -w packages/contracts run test` → 20 passed. `npm -w apps/web run lint` → it will now FAIL in `apps/web/app/composables/__tests__/useTasks.optimistic.test.ts` (fixture lacks `stage`) — that is Task 7's file; do not fix it here. Record the exact error in your report.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "[ADD] contracts: project schemas; task.stage and TaskPatch.stage_id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: i18n — `projects.*` namespace and the new task keys

**Files:**
- Create: `apps/web/i18n/locales/ar/projects.json`, `apps/web/i18n/locales/en/projects.json`
- Modify: `apps/web/i18n/locales/ar/tasks.json`, `apps/web/i18n/locales/en/tasks.json`
- Modify: `apps/web/nuxt.config.ts` (`files` arrays)

**Interfaces:**
- Produces the keys below; later tasks use them verbatim and add no others.

- [ ] **Step 1: Write the locale files**

`ar/projects.json`:
```json
{
  "projects": {
    "title": "المشاريع",
    "empty": "لا مشاريع بعد",
    "capped": "يعرض الجدول أول 200 مشروع فقط",
    "notFound": "المشروع غير موجود أو لا تملك صلاحية عرضه",
    "backToProjects": "العودة إلى المشاريع",
    "columns": { "name": "الاسم", "status": "الحالة", "progress": "التقدم" },
    "status": {
      "on_track": "على المسار",
      "at_risk": "معرض للخطر",
      "off_track": "خارج المسار",
      "on_hold": "معلّق",
      "done": "منجز",
      "unset": "غير محدد"
    },
    "setStatus": "حالة المشروع",
    "statusUpdated": "تم تحديث حالة المشروع",
    "progressOf": "{closed} من {total} مهمة",
    "tabs": { "list": "قائمة", "board": "لوحة" }
  }
}
```
`en/projects.json`:
```json
{
  "projects": {
    "title": "Projects",
    "empty": "No projects yet",
    "capped": "Showing the first 200 projects only",
    "notFound": "This project does not exist or you cannot view it",
    "backToProjects": "Back to projects",
    "columns": { "name": "Name", "status": "Status", "progress": "Progress" },
    "status": {
      "on_track": "On track",
      "at_risk": "At risk",
      "off_track": "Off track",
      "on_hold": "On hold",
      "done": "Done",
      "unset": "Not set"
    },
    "setStatus": "Project status",
    "statusUpdated": "Project status updated",
    "progressOf": "{closed} of {total} tasks",
    "tabs": { "list": "List", "board": "Board" }
  }
}
```
In both `tasks.json` files add, inside `tasks.columns`, `"assignees": "المكلّفون"` / `"assignees": "Assignees"`, and inside `tasks.kanban`, `"noStages": "لا مراحل لهذا المشروع بعد. تُدار المراحل من الإعدادات لاحقًا."` / `"noStages": "This project has no stages yet. Stages are managed in Settings later."`. Keep the files valid JSON (`python3 -m json.tool` on each).

- [ ] **Step 2: Register the files**

`nuxt.config.ts`:
```ts
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', files: ['ar/common.json', 'ar/tasks.json', 'ar/projects.json'] },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', files: ['en/common.json', 'en/tasks.json', 'en/projects.json'] },
```

- [ ] **Step 3: Verify**

`for f in apps/web/i18n/locales/*/*.json; do python3 -m json.tool "$f" >/dev/null && echo "ok $f"; done` — all ok. Key parity: `python3 -c "import json;a=json.load(open('apps/web/i18n/locales/ar/projects.json'));e=json.load(open('apps/web/i18n/locales/en/projects.json'));f=lambda d,p='':{p+k if not isinstance(v,dict) else None for k,v in d.items()}|{x for k,v in d.items() if isinstance(v,dict) for x in f(v,p+k+'.')};print(f(a)==f(e))"` → `True`. Restart Nuxt (Global Constraints) and confirm `curl -s http://localhost:3000/login` returns 200.

- [ ] **Step 4: Commit**

```bash
git add apps/web/i18n apps/web/nuxt.config.ts
git commit -m "[ADD] web: projects.* locale namespace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: web data layer — projects queries, stage source, URL params, bus

**Files:**
- Create: `apps/web/app/composables/projectStatus.ts`, `boardStages.ts`, `projectTaskParams.ts`
- Modify: `apps/web/app/composables/taskState.ts`, `useTasks.ts`, `useProjects.ts`, `useBus.ts`
- Modify: `apps/web/app/components/task/StateBadge.vue`
- Test: `apps/web/app/composables/__tests__/projectStatus.test.ts`, `boardStages.test.ts`, `projectTaskParams.test.ts`; update `useTasks.optimistic.test.ts`, `useBus.test.ts`

**Interfaces:**
- Consumes: Task 5 schemas; Task 6 keys.
- Produces:
  - `taskState.ts`: `export const TONE_CLASS: Record<StateTone, string>` (moved from `StateBadge.vue`).
  - `projectStatus.ts`: `PROJECT_STATUS_LABEL_KEY: Record<ProjectStatus, string>`, `PROJECT_STATUS_UNSET_KEY = 'projects.status.unset'`, `PROJECT_STATUS_TONE: Record<ProjectStatus, StateTone>`, `projectStatusLabelKey(status: ProjectStatus | null): string`.
  - `boardStages.ts`: `type BoardStage = { id: number; name: string; sequence: number; fold: boolean }`, `type StageSource = { kind: 'personal' } | { kind: 'project'; stages: BoardStage[] }`, `stageOf(task: Task, kind: StageSource['kind']): Task['stage']`, `moveTo(kind, stage: BoardStage | null): { patch: TaskPatch; resolved: Resolved } | null` (null when the move is not allowed — a project task cannot go to "no stage").
  - `projectTaskParams.ts`: `projectTaskParams(projectId: number, query: Record<string, unknown>): TaskListParams` and `projectTaskQuery(params: TaskListParams): Record<string, string | undefined>` (inverse, drops `mine`/`project_id`).
  - `useTasks.ts`: `TaskListParams.mine?: boolean` (undefined = true); `Resolved.stage?: Task['stage']`; `applyPatchToTask` honours `stage_id` + `resolved.stage`.
  - `useProjects.ts`: `projectKeys = { all: ['projects'], list: ['projects','list'], minimal: ['projects','minimal'], detail: (id) => ['project', id] }`, `useProjects()` (unchanged: minimal refs), `useProjectList()` → `Project[]`, `useProject(id: Ref<number | null>)` → `ProjectDetail`, `useSetProjectStatus()` mutation `{ id, status }` → `ProjectDetail`.
  - `useBus.ts`: on `nasq/task` frames also invalidates `['projects']` and `['project']`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/projectStatus.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { PROJECT_STATUSES } from '@nasq/contracts'
import { PROJECT_STATUS_LABEL_KEY, PROJECT_STATUS_TONE, PROJECT_STATUS_UNSET_KEY, projectStatusLabelKey } from '../projectStatus'

describe('projectStatus', () => {
  it('maps every writable status to a label key and a tone', () => {
    for (const s of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_LABEL_KEY[s]).toBe(`projects.status.${s}`)
      expect(PROJECT_STATUS_TONE[s]).toBeTruthy()
    }
  })
  it('null (unset) gets the muted "unset" label', () => {
    expect(projectStatusLabelKey(null)).toBe(PROJECT_STATUS_UNSET_KEY)
    expect(projectStatusLabelKey('at_risk')).toBe('projects.status.at_risk')
  })
})
```
`__tests__/boardStages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Task } from '@nasq/contracts'
import { moveTo, stageOf } from '../boardStages'

const task = {
  id: 1, name: 't', project: { id: 1, name: 'p' }, state: 'in_progress', priority: '0', date_deadline: null,
  days_remaining: null, is_overdue: false, is_closed: false,
  personal_stage: { id: 5, name: 'Doing' }, stage: { id: 9, name: 'To Do' }, assignees: [], tags: [],
} satisfies Task

describe('stageOf', () => {
  it('reads the personal or the project stage', () => {
    expect(stageOf(task, 'personal')).toEqual({ id: 5, name: 'Doing' })
    expect(stageOf(task, 'project')).toEqual({ id: 9, name: 'To Do' })
  })
})

describe('moveTo', () => {
  const stage = { id: 7, name: 'Review', sequence: 3, fold: false }
  it('personal boards patch personal_stage_type_id and resolve personal_stage', () => {
    expect(moveTo('personal', stage)).toEqual({ patch: { personal_stage_type_id: 7 }, resolved: { personal_stage: { id: 7, name: 'Review' } } })
    expect(moveTo('personal', null)).toEqual({ patch: { personal_stage_type_id: null }, resolved: { personal_stage: null } })
  })
  it('project boards patch stage_id and never allow "no stage"', () => {
    expect(moveTo('project', stage)).toEqual({ patch: { stage_id: 7 }, resolved: { stage: { id: 7, name: 'Review' } } })
    expect(moveTo('project', null)).toBeNull()
  })
})
```
`__tests__/projectTaskParams.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { projectTaskParams, projectTaskQuery } from '../projectTaskParams'

describe('projectTaskParams', () => {
  it('defaults to every open task of the project', () => {
    expect(projectTaskParams(3, {})).toEqual({ mine: false, project_id: 3, closed: false, state: undefined, q: undefined })
  })
  it('reads closed, state and q from the query', () => {
    expect(projectTaskParams(3, { closed: '1', state: 'waiting,done', q: 'x', tab: 'board' })).toEqual({
      mine: false, project_id: 3, closed: true, state: ['waiting', 'done'], q: 'x',
    })
  })
  it('round-trips through projectTaskQuery without mine/project_id', () => {
    const params = projectTaskParams(3, { closed: '1', state: 'waiting', q: 'x' })
    expect(projectTaskQuery(params)).toEqual({ closed: '1', state: 'waiting', q: 'x' })
    expect(projectTaskQuery(projectTaskParams(3, {}))).toEqual({ closed: undefined, state: undefined, q: undefined })
  })
})
```
In `useTasks.optimistic.test.ts` add `stage: { id: 9, name: 'To Do' },` to `baseTask` (after `personal_stage`) and a test:
```ts
  it('applies stage_id with the resolved project stage', () => {
    const next = applyPatchToTask(baseTask, { stage_id: 7 }, { stage: { id: 7, name: 'Review' } })
    expect(next.stage).toEqual({ id: 7, name: 'Review' })
    expect(next.personal_stage).toEqual(baseTask.personal_stage)
  })
```
In `useBus.test.ts`, find the test that asserts which query keys a `nasq/task` frame invalidates and extend its expectation with `['projects']` and `['project']` (read the file first; if it asserts an exact call list, add the two calls in the order below).

- [ ] **Step 2: Run to see them fail**

`npm -w apps/web run test` → the three new files fail to import; the optimistic test fails on `stage`; the bus test fails on the missing invalidations.

- [ ] **Step 3: Implement the pure helpers**

`taskState.ts` — append:
```ts
// Badge classes per tone, shared by task-state and project-status badges.
export const TONE_CLASS: Record<StateTone, string> = {
  neutral: 'border-transparent bg-muted text-muted-foreground',
  info: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  success: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  destructive: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}
```
`StateBadge.vue`: delete its local `TONE_CLASS` and import it: `import { STATE_LABEL_KEY, STATE_TONE, TONE_CLASS } from '@/composables/taskState'`.

`projectStatus.ts`:
```ts
import type { ProjectStatus } from '@nasq/contracts'
import type { StateTone } from './taskState'

// Pure project-status helpers (no Nuxt imports) — see __tests__/projectStatus.test.ts.
export const PROJECT_STATUS_LABEL_KEY: Record<ProjectStatus, string> = {
  on_track: 'projects.status.on_track',
  at_risk: 'projects.status.at_risk',
  off_track: 'projects.status.off_track',
  on_hold: 'projects.status.on_hold',
  done: 'projects.status.done',
}
export const PROJECT_STATUS_UNSET_KEY = 'projects.status.unset'

export const PROJECT_STATUS_TONE: Record<ProjectStatus, StateTone> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'destructive',
  on_hold: 'neutral',
  done: 'info',
}

export function projectStatusLabelKey(status: ProjectStatus | null): string {
  return status ? PROJECT_STATUS_LABEL_KEY[status] : PROJECT_STATUS_UNSET_KEY
}
```
`boardStages.ts`:
```ts
import type { Task, TaskPatch } from '@nasq/contracts'
import type { Resolved } from './useTasks'

// A board column source. مهامي groups by the user's personal stages
// (personal_stage_type_id); a project groups by the project's own stages
// (stage_id). Everything the board does differently between the two lives here.
export interface BoardStage { id: number; name: string; sequence: number; fold: boolean }
export type StageSource = { kind: 'personal' } | { kind: 'project'; stages: BoardStage[] }

export function stageOf(task: Task, kind: StageSource['kind']): Task['stage'] {
  return kind === 'personal' ? task.personal_stage : task.stage
}

// The PATCH (and the display object for the optimistic cache update) that moves
// a task into `stage`. `null` stage = the "no stage" column, which only a
// personal board allows: a project task always has a project stage.
export function moveTo(kind: StageSource['kind'], stage: BoardStage | null): { patch: TaskPatch; resolved: Resolved } | null {
  const ref = stage ? { id: stage.id, name: stage.name } : null
  if (kind === 'personal') return { patch: { personal_stage_type_id: stage?.id ?? null }, resolved: { personal_stage: ref } }
  if (!stage) return null
  return { patch: { stage_id: stage.id }, resolved: { stage: ref } }
}
```
`projectTaskParams.ts`:
```ts
import type { TaskState } from '@nasq/contracts'
import type { TaskListParams } from './useTasks'

// The project screen keeps its task filters in the URL query (not localStorage
// like مهامي) so closing the task modal restores exactly the list that was
// behind it. These two pure functions are the only translation between the
// query and TaskListParams; both the page and the nested modal use them so
// they hit the same vue-query cache key.
export function projectTaskParams(projectId: number, query: Record<string, unknown>): TaskListParams {
  const state = typeof query.state === 'string' && query.state ? (query.state.split(',') as TaskState[]) : undefined
  const q = typeof query.q === 'string' && query.q ? query.q : undefined
  return { mine: false, project_id: projectId, closed: query.closed === '1', state, q }
}

export function projectTaskQuery(params: TaskListParams): Record<string, string | undefined> {
  return {
    closed: params.closed ? '1' : undefined,
    state: params.state?.length ? params.state.join(',') : undefined,
    q: params.q || undefined,
  }
}
```

- [ ] **Step 4: Implement the query layer**

`useTasks.ts`: add `mine?: boolean` to `TaskListParams` with the comment `// undefined = true: مهامي. false = every task of `project_id` the user can read (project screen).`; in `useTasks` query: `filter: params.value.mine === false ? undefined : 'mine',`; add `stage?: Task['stage']` to `Resolved`; in `applyPatchToTask` after the personal stage line: `if (patch.stage_id !== undefined && resolved.stage !== undefined) next.stage = resolved.stage`.

`useProjects.ts` — replace the file:
```ts
import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectDetailSchema, ProjectRefSchema, ProjectSchema, type ProjectDetail, type ProjectStatus } from '@nasq/contracts'

export const projectKeys = {
  all: ['projects'] as const,
  list: ['projects', 'list'] as const,
  minimal: ['projects', 'minimal'] as const,
  detail: (id: number) => ['project', id] as const,
}

const ProjectRefListSchema = ProjectRefSchema.array()
const ProjectListSchema = ProjectSchema.array()

// Minimal {id, name} refs for pickers (create-task dialog, مهامي project filter, ⌘K).
export function useProjects() {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectKeys.minimal,
    queryFn: () => $api('/api/v1/projects', { query: { minimal: 1 }, schema: ProjectRefListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}

// The projects table: status + progress per project.
export function useProjectList() {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectKeys.list,
    queryFn: () => $api('/api/v1/projects', { schema: ProjectListSchema }),
  })
}

export function useProject(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.detail(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/projects/${id.value}`, { schema: ProjectDetailSchema }),
  })
}

// Non-optimistic on purpose (same rule as task transitions): the server may
// refuse (403 status_forbidden), so the control shows a pending state and the
// cache is replaced with whatever the server returns.
export function useSetProjectStatus() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: ProjectStatus }) =>
      $api(`/api/v1/projects/${id}/status`, { method: 'POST', body: { status }, schema: ProjectDetailSchema }),
    onSuccess: (detail: ProjectDetail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: projectKeys.list })
    },
  })
}
```
`useBus.ts::invalidateForFrame` — after the `['tasks', 'list']` line:
```ts
  // Task changes move project progress/counts; the project list and any open
  // project header must catch up too.
  queryClient.invalidateQueries({ queryKey: ['projects'] })
  queryClient.invalidateQueries({ queryKey: ['project'] })
```

- [ ] **Step 5: Run tests, lint**

`npm -w apps/web run test` → 118 + new tests all green. `npm -w apps/web run lint` → clean (this also clears the Task-5 fixture error). `npm -w packages/contracts run test` still 20.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/composables apps/web/app/components/task/StateBadge.vue
git commit -m "[ADD] web: project queries, stage source helpers, URL task params, bus invalidation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: TaskBoard / TaskCard — stage source

**Files:**
- Modify: `apps/web/app/components/task/TaskBoard.vue`
- Modify: `apps/web/app/components/task/TaskCard.vue`

**Interfaces:**
- Consumes: `StageSource`, `BoardStage`, `stageOf`, `moveTo` (Task 7); `usePersonalStages`; `useUpdateTask`.
- Produces: `TaskBoard` props `{ params: TaskListParams; stageSource?: StageSource }` (default `{ kind: 'personal' }`), emits `open`. `TaskCard` props `{ task: Task; stages: BoardStage[]; currentStageId: number | null; showProject?: boolean }` (default `showProject: true`), emits `open`, `move: [stage: BoardStage]`. All `data-testid`s unchanged (`board-column`, `board-column-title`, `board-column-folded`, `board-column-count`, `board-card-<id>`).

- [ ] **Step 1: TaskCard**

Replace the props/emits and the menu's disabled check:
```ts
import type { Task } from '@nasq/contracts'
import type { BoardStage } from '@/composables/boardStages'

const props = withDefaults(defineProps<{ task: Task; stages: BoardStage[]; currentStageId: number | null; showProject?: boolean }>(), { showProject: true })
const emit = defineEmits<{ open: [id: number]; move: [stage: BoardStage] }>()
```
`:disabled="currentStageId === stage.id"` on the menu items; wrap the project chip: `<p v-if="showProject && task.project" ...>`.

- [ ] **Step 2: TaskBoard**

- Props: `const props = withDefaults(defineProps<{ params: TaskListParams; stageSource?: StageSource }>(), { stageSource: () => ({ kind: 'personal' }) })`.
- Stages: `const { data: personalStages } = usePersonalStages()` stays, but the column source becomes
```ts
const kind = computed(() => props.stageSource.kind)
const sortedStages = computed<BoardStage[]>(() => {
  const src = props.stageSource.kind === 'project' ? props.stageSource.stages : (personalStages.value ?? [])
  return [...src].sort((a, b) => a.sequence - b.sequence || a.id - b.id)
})
```
  (`usePersonalStages` still runs for a project board — acceptable, it is cached; if you prefer, pass `enabled: computed(() => kind.value === 'personal')` only if `usePersonalStages` already accepts options; do not change its signature.)
- Column bucketing uses `stageOf(task, kind.value)` instead of `task.personal_stage`.
- `applyMove(task, stage: BoardStage | null)`: `const move = moveTo(kind.value, stage); if (!move) return; if ((stageOf(task, kind.value)?.id ?? null) === (stage?.id ?? null)) return; updateTask({ id: task.id, ...move })`.
- The "unstaged" column: render it when `kind === 'personal' || (columns[UNSTAGED]?.length ?? 0) > 0`. For a project board its `VueDraggable` gets `:group="{ name: 'tasks', put: false }"` so nothing can be dropped there (a project task always has a stage) while cards can still be dragged out of it. Below the board, when `kind === 'project' && sortedStages.length === 0`, show `<p class="text-sm text-muted-foreground">{{ t('tasks.kanban.noStages') }}</p>`.
- `TaskCard` bindings: `:stages="sortedStages" :current-stage-id="stageOf(task, kind)?.id ?? null" :show-project="kind === 'personal'"`.
- Keep the fold/collapse behaviour and the 200 cap untouched.

- [ ] **Step 3: Verify**

`npm -w apps/web run lint` clean. Dev servers up → `npm -w apps/web run test:e2e -- e2e/board.spec.ts` → 2 passed (the personal board must behave exactly as before).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/task/TaskBoard.vue apps/web/app/components/task/TaskCard.vue
git commit -m "[IMP] web: TaskBoard/TaskCard take a stage source (personal or project stages)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: TaskTable / TaskToolbar / CreateTaskDialog — project variant

**Files:**
- Modify: `apps/web/app/components/task/TaskTable.vue`
- Modify: `apps/web/app/components/task/TaskToolbar.vue`
- Modify: `apps/web/app/components/task/CreateTaskDialog.vue`

**Interfaces:**
- Produces: `TaskTable` props `{ params: TaskListParams; variant?: 'mine' | 'project' }` (default `'mine'`); `TaskToolbar` props `{ modelValue: TaskListParams; hideProjectFilter?: boolean }`; `CreateTaskDialog` props `{ open: boolean; projectId?: number }` — when `projectId` is given the picker is replaced by the project name (from `useProjects()` refs) and the mutation uses it.

- [ ] **Step 1: TaskTable**

- `const props = withDefaults(defineProps<{ params: TaskListParams; variant?: 'mine' | 'project' }>(), { variant: 'mine' })`.
- Build `columns` as a computed over the variant. `'mine'` = today's six columns unchanged (title, project, state, deadline, priority, stage-from-`personal_stage`). `'project'` = title, state, stage-from-`task.stage`, deadline, priority, assignees, where the assignees cell renders `h('span', { class: 'truncate text-xs text-muted-foreground' }, info.row.original.assignees.map((a) => a.name).join('، '))` (Arabic comma; fine for both locales) and stage: `cell: (info) => info.row.original.stage?.name ?? '—'`.
- `colgroup` per variant: mine unchanged; project `['w-[46%]','w-[12%]','w-[12%]','w-[10%]','w-[8%]','w-[12%]']`.
- `hasActiveFilters` ignores `project_id` when `variant === 'project'` (the project scope is not a user filter): `const hasActiveFilters = computed(() => !!props.params.q || (props.variant === 'mine' && !!props.params.project_id) || !!props.params.state?.length)`.
- `useVueTable({ get columns() { return columns.value }, ... })`.

- [ ] **Step 2: TaskToolbar**

`const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean }>()`; wrap the project `<Select>` in `<template v-if="!hideProjectFilter">`; call `useProjects()` regardless (cheap, cached).

- [ ] **Step 3: CreateTaskDialog**

```ts
const props = defineProps<{ open: boolean; projectId?: number }>()
...
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  name.value = ''
  projectId.value = props.projectId ?? projects.value?.[0]?.id
  error.value = null
})
const lockedProjectName = computed(() => projects.value?.find((p) => p.id === props.projectId)?.name ?? '')
```
Template: keep the `<Label>` and render `<p v-if="props.projectId" id="new-task-project" class="text-sm">{{ lockedProjectName }}</p>` instead of the `<Select>` when locked (`v-else` on the Select).

- [ ] **Step 4: Verify**

`npm -w apps/web run lint` clean; `npm -w apps/web run test:e2e -- e2e/tasks.spec.ts e2e/hydration.spec.ts` → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/task/TaskTable.vue apps/web/app/components/task/TaskToolbar.vue apps/web/app/components/task/CreateTaskDialog.vue
git commit -m "[IMP] web: table/toolbar/create-dialog project variants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: TaskDetailModal / TaskDetailPanel — host-aware close and siblings

**Files:**
- Modify: `apps/web/app/components/task/TaskDetailModal.vue`
- Modify: `apps/web/app/components/task/TaskDetailPanel.vue`

**Interfaces:**
- Produces: both components accept `{ taskId: number; basePath?: string; closeTo?: RouteLocationRaw; siblingParams?: TaskListParams }`. Defaults reproduce phase 1: `basePath = '/tasks'`, `closeTo = { path: '/tasks', query: route.query }`, siblings from `useTaskFilters()`.

- [ ] **Step 1: TaskDetailModal**

```ts
import type { RouteLocationRaw } from 'vue-router'
import type { TaskListParams } from '@/composables/useTasks'
const props = defineProps<{ taskId: number; basePath?: string; closeTo?: RouteLocationRaw; siblingParams?: TaskListParams }>()
function close() { router.push(props.closeTo ?? { path: '/tasks', query: route.query }) }
```
Pass through: `<TaskDetailPanel :task-id="props.taskId" :base-path="props.basePath" :sibling-params="props.siblingParams" @close="close" />`.

- [ ] **Step 2: TaskDetailPanel**

```ts
const props = withDefaults(defineProps<{ taskId: number; basePath?: string; siblingParams?: TaskListParams }>(), { basePath: '/tasks' })
// A host that keeps its filters in the URL (the project screen) passes them
// in; مهامي's host passes nothing and the localStorage-backed filters apply.
// Decided once per instance: the two branches are different composables.
const localFilters = props.siblingParams ? null : useTaskFilters()
const filterParams = computed<TaskListParams>(() => props.siblingParams ?? localFilters!.value)
const siblings = useTaskSiblings(idRef, filterParams)
function goTo(id: number | null) {
  if (id === null) return
  router.push({ path: `${props.basePath}/${id}`, query: route.query })
}
```
Nothing else changes.

- [ ] **Step 3: Verify**

`npm -w apps/web run lint` clean; `npm -w apps/web run test:e2e -- e2e/detail.spec.ts e2e/activity.spec.ts` → all passed (phase-1 behaviour intact).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/task/TaskDetailModal.vue apps/web/app/components/task/TaskDetailPanel.vue
git commit -m "[IMP] web: task modal accepts basePath/closeTo/siblingParams for other hosts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: project components

**Files:**
- Create: `apps/web/app/components/project/ProjectStatusBadge.vue`, `ProjectProgress.vue`, `ProjectStatusSelect.vue`, `ProjectHeader.vue`, `ProjectTable.vue`
- Create (via shadcn CLI): `apps/web/app/components/ui/progress/*`

**Interfaces:**
- Consumes: Task 7 helpers/queries, Task 6 keys, `TONE_CLASS`.
- Produces: `ProjectStatusBadge` `{ status: ProjectStatus | null }`; `ProjectProgress` `{ progress: number; taskCount: number; closedTaskCount: number; compact?: boolean }`; `ProjectStatusSelect` `{ project: ProjectDetail }`; `ProjectHeader` `{ project: ProjectDetail }` emits `create`; `ProjectTable` (no props) emits `open: [id: number]`.

- [ ] **Step 1: Add the shadcn Progress component**

From `apps/web`: `touch /tmp/empty.npmrc && npm_config_userconfig=/tmp/empty.npmrc npx shadcn-vue@latest add progress` → `app/components/ui/progress/{Progress.vue,index.ts}`. Restart Nuxt (Global Constraints) so the new dir is auto-imported.

- [ ] **Step 2: Components**

`ProjectStatusBadge.vue`:
```vue
<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUS_TONE, projectStatusLabelKey } from '@/composables/projectStatus'
import { TONE_CLASS } from '@/composables/taskState'

const props = defineProps<{ status: ProjectStatus | null }>()
const { t } = useI18n()
const cls = computed(() => (props.status ? TONE_CLASS[PROJECT_STATUS_TONE[props.status]] : TONE_CLASS.neutral))
</script>

<template>
  <Badge variant="outline" :class="cls" data-testid="project-status">{{ t(projectStatusLabelKey(status)) }}</Badge>
</template>
```
`ProjectProgress.vue`:
```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{ progress: number; taskCount: number; closedTaskCount: number; compact?: boolean }>(), { compact: false })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2" :title="t('projects.progressOf', { closed: closedTaskCount, total: taskCount })">
    <Progress :model-value="progress" class="h-2 w-24" />
    <span class="text-xs tabular-nums text-muted-foreground" data-testid="project-progress">{{ progress }}%</span>
    <span v-if="!compact" class="text-xs text-muted-foreground">{{ t('projects.progressOf', { closed: closedTaskCount, total: taskCount }) }}</span>
  </div>
</template>
```
`ProjectStatusSelect.vue`:
```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'
import { PROJECT_STATUSES, type ProjectDetail, type ProjectStatus } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { PROJECT_STATUS_LABEL_KEY, PROJECT_STATUS_UNSET_KEY } from '@/composables/projectStatus'
import { useSetProjectStatus } from '@/composables/useProjects'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useSetProjectStatus()

// Pending → confirmed: the Select shows the server's value, never a guessed one.
async function onChange(v: unknown) {
  const status = v as ProjectStatus
  if (!status || status === props.project.status) return
  try {
    await mutateAsync({ id: props.project.id, status })
    toast.success(t('projects.statusUpdated'))
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <Select :model-value="project.status ?? undefined" :disabled="!hydrated || isPending" @update:model-value="onChange">
    <SelectTrigger size="sm" class="w-44" data-testid="project-status-select" :aria-label="t('projects.setStatus')">
      <SelectValue :placeholder="t(PROJECT_STATUS_UNSET_KEY)" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="s in PROJECT_STATUSES" :key="s" :value="s">{{ t(PROJECT_STATUS_LABEL_KEY[s]) }}</SelectItem>
    </SelectContent>
  </Select>
</template>
```
`ProjectHeader.vue`:
```vue
<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import type { ProjectDetail } from '@nasq/contracts'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'

defineProps<{ project: ProjectDetail }>()
const emit = defineEmits<{ create: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <header class="flex flex-wrap items-center gap-3">
    <h1 class="text-2xl font-semibold">{{ project.name }}</h1>
    <ProjectStatusSelect v-if="project.can_manage" :project="project" />
    <ProjectStatusBadge v-else :status="project.status" />
    <ProjectProgress :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" />
    <Button size="sm" class="ms-auto gap-1.5" :disabled="!hydrated" @click="emit('create')">
      <Plus class="size-4" />{{ t('tasks.new') }}
    </Button>
  </header>
</template>
```
`ProjectTable.vue` — same DataTable pattern as `TaskTable.vue` (FlexRender, colgroup `w-[50%] w-[20%] w-[30%]`, skeleton rows while loading, `TableEmpty` with `t('projects.empty')`, row `@click="hydrated && emit('open', row.original.id)"`, `data-testid="project-row"` on each row), columns: name (`accessor('name')`), status (`h(ProjectStatusBadge, { status })`), progress (`h(ProjectProgress, { progress, taskCount, closedTaskCount, compact: true })`). Data from `useProjectList()`; show `<p v-if="(data?.length ?? 0) >= 200" class="text-xs text-muted-foreground">{{ t('projects.capped') }}</p>`.

- [ ] **Step 3: Verify**

`npm -w apps/web run lint` clean; `npm -w apps/web run test` green (no new unit tests here; the components are exercised end-to-end in Task 13).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/project apps/web/app/components/ui/progress
git commit -m "[ADD] web: project header, status badge/select, progress and table components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: pages `/projects`, `/projects/{id}`, nested task modal, ⌘K projects

**Files:**
- Delete: `apps/web/app/pages/projects.vue`
- Create: `apps/web/app/pages/projects/index.vue`, `apps/web/app/pages/projects/[id].vue`, `apps/web/app/pages/projects/[id]/tasks/[taskId].vue`
- Modify: `apps/web/app/components/CommandMenu.vue`

**Interfaces:**
- Consumes: Tasks 7–11.
- Produces: routes `/projects`, `/projects/:id`, `/projects/:id/tasks/:taskId`.

- [ ] **Step 1: `pages/projects/index.vue`**

```vue
<script setup lang="ts">
import ProjectTable from '@/components/project/ProjectTable.vue'
const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('projects.title') }}</h1>
    <ProjectTable @open="(id) => router.push(`/projects/${id}`)" />
  </div>
</template>
```

- [ ] **Step 2: `pages/projects/[id].vue`**

```vue
<script setup lang="ts">
import CreateTaskDialog from '@/components/task/CreateTaskDialog.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import { ApiError } from '@/composables/useApi'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()

const projectId = computed(() => Number(route.params.id))
const { data: project, isLoading, error } = useProject(projectId)
// 404 (missing) and 403 (exists, unreadable) both mean "not yours to see".
const notFound = computed(() => error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403))

const tab = computed(() => (route.query.tab === 'board' ? 'board' : 'list'))
function onTabChange(v: unknown) {
  router.replace({ query: { ...route.query, tab: v === 'board' ? 'board' : undefined } })
}

// Filters live in the URL (see projectTaskParams.ts) so the nested task modal
// and this page query the same cache key and closing the modal restores them.
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value, route.query))
function onParams(p: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(p) } })
}

function openTask(taskId: number) {
  router.push({ path: `/projects/${projectId.value}/tasks/${taskId}`, query: route.query })
}

const createOpen = ref(false)
const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
</script>

<template>
  <div class="space-y-4">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <NuxtLink to="/projects" class="text-sm underline">{{ t('projects.backToProjects') }}</NuxtLink>
    </div>

    <template v-else>
      <ProjectHeader v-if="project" :project="project" @create="createOpen = true" />
      <Skeleton v-else-if="isLoading" class="h-9 w-1/2" />

      <Tabs :model-value="tab" @update:model-value="onTabChange">
        <TabsList>
          <TabsTrigger value="list" :disabled="!hydrated">{{ t('projects.tabs.list') }}</TabsTrigger>
          <TabsTrigger value="board" :disabled="!hydrated">{{ t('projects.tabs.board') }}</TabsTrigger>
        </TabsList>
        <TabsContent value="list" class="space-y-4">
          <TaskToolbar :model-value="params" hide-project-filter @update:model-value="onParams" @create="createOpen = true" />
          <TaskTable :params="params" variant="project" @open="openTask" @create="createOpen = true" />
        </TabsContent>
        <TabsContent value="board" class="space-y-4">
          <TaskToolbar :model-value="params" hide-project-filter @update:model-value="onParams" @create="createOpen = true" />
          <TaskBoard v-if="project" :params="params" :stage-source="stageSource" @open="openTask" />
        </TabsContent>
      </Tabs>

      <CreateTaskDialog v-model:open="createOpen" :project-id="projectId" @created="openTask" />
      <NuxtPage />
    </template>
  </div>
</template>
```
If `ApiError` does not expose `status`, read `apps/web/app/composables/useApi.ts` and use whatever field carries the HTTP status (it does: `{status, code, message, field}` per phase 1).

- [ ] **Step 3: `pages/projects/[id]/tasks/[taskId].vue`**

```vue
<script setup lang="ts">
import TaskDetailModal from '@/components/task/TaskDetailModal.vue'
import { projectTaskParams } from '@/composables/projectTaskParams'

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const taskId = computed(() => Number(route.params.taskId))
const siblingParams = computed(() => projectTaskParams(projectId.value, route.query))
const closeTo = computed(() => ({ path: `/projects/${projectId.value}`, query: route.query }))
</script>

<template>
  <TaskDetailModal :task-id="taskId" :base-path="`/projects/${projectId}/tasks`" :close-to="closeTo" :sibling-params="siblingParams" />
</template>
```
Delete `pages/projects.vue` (`git rm apps/web/app/pages/projects.vue`) — with `pages/projects/index.vue` present it would otherwise become a parent layout for every `/projects/*` route.

- [ ] **Step 4: ⌘K projects group**

In `CommandMenu.vue`: `import { useProjects } from '@/composables/useProjects'`, `const { data: projects } = useProjects()`, and after the nav `CommandGroup`:
```vue
      <CommandGroup v-if="projects?.length" :heading="$t('nav.projects')">
        <CommandItem v-for="p in projects" :key="p.id" :value="p.name" @select="go(`/projects/${p.id}`)">
          <span>{{ p.name }}</span>
        </CommandItem>
      </CommandGroup>
```

- [ ] **Step 5: Verify by hand**

`npm -w apps/web run lint` clean. With both dev servers up and the dev DB updated (`.venv/bin/python odoo-bin -c odoo.conf -d odoo19 -u nasq_core,nasq_pmo --no-http --stop-after-init` from the Odoo checkout), open `http://localhost:3000/projects` in the Browser pane: table renders with badges; click a row → header + tabs; switch to لوحة → columns are the project's stages; open a task → modal; Escape → back on `/projects/{id}?tab=board`. `npm -w apps/web run test:e2e -- e2e/command-menu.spec.ts` still passes.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/app/pages/projects apps/web/app/pages/projects.vue apps/web/app/components/CommandMenu.vue
git commit -m "[ADD] web: /projects table, /projects/{id} screen with nested task modal, ⌘K projects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: e2e — contract round trips and the project screens

**Files:**
- Modify: `apps/web/e2e/contracts.spec.ts`
- Create: `apps/web/e2e/projects.spec.ts`

**Interfaces:**
- Consumes: the live API (Tasks 3–4 loaded into `odoo19`) and the pages (Task 12).

- [ ] **Step 1: Contract e2e**

In `contracts.spec.ts` import `ProjectSchema, ProjectDetailSchema` and add a test:
```ts
test('projects: list, detail, status and the project-scoped task list match their schemas', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)

  const listRes = await page.request.get('/api/v1/projects')
  expect(listRes.status()).toBe(200)
  const projects = ProjectSchema.array().parse(await listRes.json())
  expect(projects.length).toBeGreaterThan(0)

  const detailRes = await page.request.get(`/api/v1/projects/${projects[0]!.id}`)
  expect(detailRes.status()).toBe(200)
  const detail = ProjectDetailSchema.parse(await detailRes.json())
  expect(detail.can_manage).toBe(true)

  const statusRes = await page.request.post(`/api/v1/projects/${detail.id}/status`, { data: { status: 'on_track' } })
  expect(statusRes.status()).toBe(200)
  expect(ProjectDetailSchema.parse(await statusRes.json()).status).toBe('on_track')

  const tasksRes = await page.request.get(`/api/v1/tasks?project_id=${detail.id}`)
  expect(tasksRes.status()).toBe(200)
  TaskListSchema.parse(await tasksRes.json())
})
```

- [ ] **Step 2: Project screens e2e**

`projects.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
}

// There is no create-project endpoint in phase 2; fixtures go through Odoo's
// own RPC with the same session cookie (same origin, /web/* is proxied).
async function callKw(page, model: string, method: string, args: unknown[]) {
  const res = await page.request.post(`/web/dataset/call_kw/${model}/${method}`, {
    data: { jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs: {} } },
  })
  const body = await res.json()
  if (body.error) throw new Error(JSON.stringify(body.error.data?.message ?? body.error))
  return body.result
}

async function createProjectWithStages(page, name: string) {
  const id = await callKw(page, 'project.project', 'create', [{
    name,
    type_ids: [[0, 0, { name: 'To Do', sequence: 1 }], [0, 0, { name: 'Doing', sequence: 2 }], [0, 0, { name: 'Done', sequence: 3, fold: true }]],
  }])
  return id as number
}

async function dragCard(page, fromLocator, toLocator) {
  await fromLocator.scrollIntoViewIfNeeded()
  const from = await fromLocator.boundingBox()
  const to = await toLocator.boundingBox()
  if (!from || !to) throw new Error('missing bounding box for drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const targetX = to.x + to.width / 2
  const targetY = to.y + Math.min(40, to.height / 2)
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + from.width / 2 + ((targetX - (from.x + from.width / 2)) * i) / 10, from.y + from.height / 2 + ((targetY - (from.y + from.height / 2)) * i) / 10)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
}

test('projects table shows status and progress, and a row opens the project', async ({ page }) => {
  await login(page)
  const name = `E2E project ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  await page.request.post(`/api/v1/projects/${id}/status`, { data: { status: 'at_risk' } })
  const a = (await (await page.request.post('/api/v1/tasks', { data: { name: `${name} a`, project_id: id } })).json()).id
  await page.request.post('/api/v1/tasks', { data: { name: `${name} b`, project_id: id } })
  await page.request.post(`/api/v1/tasks/${a}/transition`, { data: { state: 'done' } })

  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'المشاريع' })).toBeVisible()
  const row = page.getByTestId('project-row').filter({ hasText: name })
  await expect(row.getByTestId('project-status')).toHaveText('معرض للخطر')
  await expect(row.getByTestId('project-progress')).toHaveText('50%')
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
})

test('project list shows every task of the project (not only mine), the modal closes back to the project', async ({ page }) => {
  await login(page)
  const name = `E2E plist ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  const t = (await (await page.request.post('/api/v1/tasks', { data: { name: `${name} task`, project_id: id } })).json()).id
  // Unassign admin: the task must still be listed on the project screen.
  await page.request.patch(`/api/v1/tasks/${t}`, { data: { user_ids: [] } })

  await page.goto(`/projects/${id}?tab=list&q=${encodeURIComponent(name)}`)
  const row = page.getByRole('row', { name: new RegExp(`${name} task`) })
  await expect(row).toBeVisible()
  await expect(row.getByText('To Do')).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/${t}\\?`))
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'عنوان المهمة' })).toHaveValue(`${name} task`)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?tab=list&q=`))
})

test('project board groups by project stage, and a drag persists', async ({ page }) => {
  await login(page)
  const name = `E2E pboard ${Date.now()}`
  const id = await createProjectWithStages(page, name)
  const t = (await (await page.request.post('/api/v1/tasks', { data: { name: `${name} card`, project_id: id } })).json()).id

  await page.goto(`/projects/${id}?tab=board`)
  const columns = page.getByTestId('board-column')
  await expect(columns.filter({ hasText: 'To Do' })).toBeVisible()
  await expect(columns.filter({ hasText: 'To Do' }).getByTestId(`board-card-${t}`)).toBeVisible()
  const doing = columns.filter({ hasText: 'Doing' })
  await dragCard(page, page.getByTestId(`board-card-${t}`), doing)
  await expect(doing.getByTestId(`board-card-${t}`)).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(page.getByTestId('board-column').filter({ hasText: 'Doing' }).getByTestId(`board-card-${t}`)).toBeVisible({ timeout: 10_000 })
  // Folded "Done" renders collapsed.
  await expect(page.getByTestId('board-column-folded')).toBeVisible()
})

test('create task from the project locks the project, and a manager sets the status', async ({ page }) => {
  await login(page)
  const name = `E2E pcreate ${Date.now()}`
  const id = await createProjectWithStages(page, name)

  await page.goto(`/projects/${id}`)
  await page.getByRole('button', { name: 'مهمة جديدة' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(name)).toBeVisible()
  await dialog.getByLabel('عنوان المهمة').fill(`${name} new`)
  await dialog.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/tasks/\\d+`))
  await page.keyboard.press('Escape')

  await page.getByTestId('project-status-select').click()
  await page.getByRole('option', { name: 'خارج المسار' }).click()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
  await page.reload()
  await expect(page.getByTestId('project-status-select')).toContainText('خارج المسار')
})
```
Adjust the two button names (`مهمة جديدة`, `إنشاء`) to the actual `tasks.new` / `app.create` Arabic strings in `ar/tasks.json` and `ar/common.json` — read them; do not guess.

- [ ] **Step 3: Run**

Dev DB updated (Task 12 Step 5), both servers up: `npm -w apps/web run test:e2e` → 25 + 5 = 30 passed. If the Odoo RPC helper fails with a CSRF or session error, read `apps/web/server/routes/` to see how `/web/*` is proxied in dev and use the proxied path that works — do not weaken the test.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/contracts.spec.ts apps/web/e2e/projects.spec.ts
git commit -m "[ADD] web e2e: project contracts and screens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: docs and final gate

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/parallel-work.md`, `docs/superpowers/specs/2026-09-04-nasq-phase-2-projects-design.md` (Status), `docs/superpowers/specs/2026-09-03-nasq-platform-design.md` (Phase 2 row → Delivered)

- [ ] **Step 1: Update the docs to match the shipped code**

- `README.md`: the Layout/API sections list the three project endpoints, the `project_id` task scope, `stage_id` PATCH, the routes `/projects`, `/projects/{id}`, `/projects/{id}/tasks/{taskId}`, the `projects.json` locale file, and state plainly that nasq has no time logging.
- `CLAUDE.md`: `nasq_pmo` file list gains `models/project_project.py`, `serializers/project.py`, `tests/test_projects.py`, `tests/test_project_status.py`; locale files `{common,tasks,projects}.json`; contracts `pmo/project.ts`; the "no time logging" rule under conventions; `nasq_core` depends line.
- `docs/parallel-work.md`: the PMO column lists `projects.json` next to `tasks.json`.
- Phase-2 spec `**Status:** Delivered 2026-09-04`; platform spec Phase 2 row `Delivered 2026-09-04`.

- [ ] **Step 2: Final gate**

From `/Users/tariq/code/odoo`: `dropdb nasq_p2; .venv/bin/python odoo-bin -c odoo.conf -d nasq_p2 -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo --http-port=8169 --stop-after-init 2>&1 | tail -3` → 77 tests, `0 failed`. From `/Users/tariq/code/nasq`: `ruff check odoo-addons`, `npm -w packages/contracts run test` (20), `npm -w apps/web run test` (≥125), `npm -w apps/web run lint`, `npm -w apps/web run test:e2e` (30). Paste every summary line in the report.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md docs
git commit -m "[IMP] docs: phase 2 delivered — projects screens, no time logging

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** time logging removal → T1; status rule/hook → T2; `stage`, `stage_id`, `project_id` scope, int-safe parse → T3; three project endpoints, whitelist, 200 cap, 400 on unknown query, 403/404 → T4; zod shapes incl. `ProjectRefSchema` move → T5; `projects.*` vocabulary, `noStages`, `assignees` → T6; queries/keys, bus invalidation of `['projects']`/`['project', id]`, URL-backed filters, `TONE_CLASS` → T7; board by project stage, unstaged rules, menu → T8; table columns/variant, hidden project filter, locked create → T9; nested modal close/siblings → T10; header with manager Select + pending/toast, badge, progress, table + empty/capped → T11; routes, 404 state, ⌘K → T12; tests listed in the spec → T2/T3/T4 (Odoo), T5 (contracts), T7 (web unit), T13 (contract e2e + screens); docs → T14. Open items (default stage on create; no project filters) need no task.
- **Placeholders:** none; every code step carries the code.
- **Type consistency:** `StageSource`/`BoardStage`/`stageOf`/`moveTo` (T7) used by T8; `TaskListParams.mine`, `projectKeys`, `useProjectList`, `useProject`, `useSetProjectStatus` (T7) used by T11/T12; `projectTaskParams`/`projectTaskQuery` (T7) used by T12; `basePath`/`closeTo`/`siblingParams` (T10) used by T12; `variant`/`hideProjectFilter`/`projectId` (T9) used by T12; `parse_task_vals(payload, can_manage, task)` (T3) is called only from `controllers/tasks.py`; `STATUS_VALUES` (T2) imported by T4; test counts: 57 → 61 (T2) → 69 (T3) → 77 (T4).
