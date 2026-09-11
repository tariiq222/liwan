# nasq Phase 3a — Project Administration Implementation Plan

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). ليس تعليمات واجهة.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers and `customer_admin` run projects from the Nuxt app without Odoo: create, configure, archive projects; manage per-project stages, followers, milestones and status updates; tag and archive tasks; set two company policies in the first الإعدادات page.

**Architecture:** `nasq_pmo` grows model methods on `project.project` / `project.task` (policy, archive, stages, milestones, updates, followers) behind one per-record rule `_nasq_can_manage()`, an `AbstractModel` for the two `ir.config_parameter` policies, six new json2 controllers and three new serializers. Contracts mirror every shape. The web app adds focused composable files per sub-resource, a project settings dialog, milestone/update tabs, a tag/milestone picker in the task modal, a create-project dialog, an archived filter, and `/settings/projects`.

**Tech Stack:** Odoo 19.0 CE, Nuxt 4 / Vue 3.5 / TS, Tailwind v4, shadcn-vue (Dialog, Tabs, Select, Calendar, Popover, Command, Tooltip, RadioGroup — added), `@tanstack/vue-query`, `vue-draggable-plus`, Tiptap, zod 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-nasq-phase-3a-project-admin-design.md` (refines `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`). Ownership rule: `docs/parallel-work.md` — this plan touches PMO files, `packages/contracts/src/pmo/`, the shared touchpoints named there, and exactly one new key in `common.json` (`nav.settings`, the `nav.*` exception). Never `people.vue`, never `hr.*`.

## Global Constraints

- Branch `phase-3a` in `/Users/tariq/code/nasq` (from `main` @ `217d8bc`, tag `v0.3.0-phase2`). The Odoo checkout `/Users/tariq/code/odoo` is never modified; never run `git` there. Odoo commands run from there.
- Canonical Odoo suite on a fresh scratch DB: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p3 -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo --http-port=8169 --stop-after-init` (timeout 900000 ms; 81 tests green at the start of this plan). Re-runs: `-u nasq_pmo`. Parallel tasks use their own DB/port as the dispatch says. Dev DB load: `.venv/bin/python odoo-bin -c odoo.conf -d odoo19 -u nasq_pmo --no-http --stop-after-init`.
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; manifests keep `'license': 'LGPL-3'`, `'version': '19.0.1.0.0'`, `'author': 'Tariq Alwalidi'`. `ruff check odoo-addons` clean (isort order: stdlib, third-party, `odoo`, `odoo.addons`).
- API: `@http.route('/api/v1/...', type='json2', auth='user', methods=[...], readonly=<bool>)`; json2 routes do **not** receive the query string as kwargs — read `request.httprequest.args`; JSON body keys arrive as kwargs. Errors `{"code", "message", "field"?}` with real HTTP status through `ApiError`/`api_handler`. Serializers whitelist explicitly.
- **`sudo()` policy:** exactly three documented uses in this plan — `nasq.pmo.settings` reading/writing `ir.config_parameter`, `project.project` create when the policy is `employees`, and the phase-2 display-name/stage lookups already in `serializers/task.py`. Nothing else.
- Manager rule everywhere: `project._nasq_can_manage()` = `project.group_project_manager` OR `nasq_core.group_customer_admin` OR `project.user_id == env.user`. Admin-only = `nasq_core.group_customer_admin`. No time logging anywhere.
- Wire vocabularies: project status `on_track|at_risk|off_track|on_hold|done|null`; visibility `employees|followers`; policy `managers|employees`. Calendar dates (`date_start`, `date`, milestone `deadline`) are `YYYY-MM-DD` strings or null; task deadlines stay UTC instants.
- Frontend: Arabic default, all strings via `$t()`/`t()`, PMO locale files `apps/web/i18n/locales/{ar,en}/{tasks,projects,settings}.json` (`settings.json` new), Tailwind logical properties only, no new colours, every SSR-rendered interactive control `:disabled="!hydrated"`, one primary action per screen, autosave (no Save buttons), skeletons not spinners, every empty state has a message.
- Contracts are `.strict()` zod schemas in `packages/contracts/src/pmo/`; every wire change lands there **and** in the serializer **and** in the Odoo test key sets in the same task.
- Dev servers: Odoo :8069 (`--dev=all`), Nuxt :3000. Restart Nuxt after `nuxt.config.ts` changes or a new shadcn component dir: `pkill -f "node_modules/.bin/nuxt dev"; pkill -f "@nuxt/cli/dist/dev/index.mjs"`, then `nohup npm run dev > /tmp/nuxt-dev.log 2>&1 &`, poll `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` until 200. Never restart while another agent runs e2e.
- npm: `--ignore-scripts` on installs; shadcn: `touch /tmp/empty.npmrc && npm_config_userconfig=/tmp/empty.npmrc npx shadcn-vue@latest add <name>` from `apps/web`. Never edit `~/.npmrc`.
- Checks: `npm -w packages/contracts run test`, `npm -w apps/web run test`, `npm -w apps/web run lint` (`vue-tsc --build --noEmit`), `npm -w apps/web run test:e2e` (`workers: 1`), `ruff check odoo-addons`.
- Commits: `[ADD]|[IMP]|[FIX] <scope>: <summary>` + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task. **Always commit with an explicit pathspec** (`git commit -m "…" -- <owned paths>`) — other agents share the working tree and index. Never amend/rebase/reset.
- e2e login `admin`/`admin` (role `vendor`, project manager). Fixtures via the API or Odoo `/web/dataset/call_kw` (helper in `apps/web/e2e/projects.spec.ts`), never the UI.

## File Structure

```
odoo-addons/nasq_pmo/
├── __manifest__.py                          + 'data': ['data/nasq_pmo_data.xml']                       (T1)
├── data/nasq_pmo_data.xml                   seeds the two ir.config_parameter keys, noupdate           (T1)
├── models/__init__.py · models/nasq_settings.py   nasq.pmo.settings AbstractModel                     (T1)
├── models/project_project.py                per-record can_manage, create policy, archive, stages, followers, milestones, updates (T1)
├── models/project_task.py                   _nasq_can_archive, _nasq_archive                            (T4)
├── serializers/__init__.py                  + milestone, project_update (stubs by T1, filled by T7)      (T1/T7)
├── serializers/project.py                   active/can_manage, detail fields, parse_project_vals, stage task_count (T5)
├── serializers/task.py                      milestone in detail, _parse_milestone                        (T4)
├── serializers/milestone.py · project_update.py                                                        (T7)
├── controllers/__init__.py                  + project_stages, project_followers, milestones, project_updates, tags, settings (stubs by T1) (T1)
├── controllers/projects.py                  list shape, create, patch, archive/unarchive                (T5)
├── controllers/tasks.py                     POST /tasks/{id}/archive                                    (T4)
├── controllers/tags.py                      GET/POST /tags                                              (T4)
├── controllers/project_stages.py · project_followers.py                                               (T6)
├── controllers/milestones.py · project_updates.py                                                      (T7)
├── controllers/settings.py                  GET/PATCH /settings/projects                                (T8)
└── tests/__init__.py (T1 lists all) · test_project_admin_model.py (T1) · test_projects.py (T5) · test_tasks.py + test_tags.py (T4)
    · test_project_stages.py + test_project_followers.py (T6) · test_milestones.py + test_project_updates.py (T7) · test_settings.py (T8)
packages/contracts/src/pmo/
├── project.ts                               list/detail/patch/create, stage task_count, StageBody, StageOrderBody (T2)
├── milestone.ts · project-update.ts · settings.ts · tag.ts (TagCreate)                                 (T2)
├── task.ts                                  TaskDetail.milestone, TaskPatch.milestone_id                (T2)
└── __tests__/schemas.test.ts                                                                            (T2)
apps/web/
├── i18n/locales/{ar,en}/{projects,tasks,settings}.json · common.json (nav.settings) · nuxt.config.ts  (T3)
├── app/composables/
│   ├── calendarDate.ts (pure) · stageOrder.ts (pure) · __tests__/*                                     (T9)
│   ├── useProjects.ts (list shape, create/update/archive) · useProjectStages.ts · useProjectFollowers.ts (T9)
│   ├── useMilestones.ts · useProjectUpdates.ts · useTags.ts · useProjectSettings.ts                     (T9)
│   ├── useTasks.ts (useArchiveTask, milestone in applyPatchToTask) · useNav.ts (settings entry)        (T9)
├── app/components/project/
│   ├── ProjectSettingsDialog.vue · ProjectGeneralForm.vue · StageListEditor.vue · FollowerList.vue     (T10)
│   ├── MilestoneTable.vue · MilestoneDialog.vue · ProjectUpdateList.vue · ProjectUpdateDialog.vue      (T11)
│   ├── CreateProjectDialog.vue · ProjectTable.vue (can_create, archived, row ⋯) · ProjectMenu.vue       (T13)
│   └── ProjectHeader.vue (⋯ slot)                                                                       (T14)
├── app/components/task/TagPicker.vue · MilestoneSelect.vue · TaskDetails.vue · TaskDetailPanel.vue (⋯ archive) (T12)
├── app/components/settings/ProjectSettingsForm.vue · app/components/ui/{radio-group,tooltip}          (T10 adds ui; T14 form)
├── app/pages/projects/index.vue · projects/[id].vue · settings/projects.vue                            (T14)
└── e2e/projects.spec.ts (extended) · e2e/project-admin.spec.ts · e2e/contracts.spec.ts                 (T15)
docs: README.md, CLAUDE.md, docs/parallel-work.md, spec statuses                                        (T16)
```

Waves (disjoint files): **W1** {T1, T2, T3} → **W2** {T4, T5, T6, T7, T8} (need T1) → **W3** {T9} (needs T2, T3) → **W4** {T10, T11, T12, T13} (need T9) → **W5** {T14} → {T15} → {T16}. T4 also needs T2? No — Odoo side only; T9 needs T2.

---

### Task 1: Model layer — policy, manage rule, archive, stages, followers, milestones, updates, settings

**Files:**
- Modify: `odoo-addons/nasq_pmo/models/project_project.py`
- Create: `odoo-addons/nasq_pmo/models/nasq_settings.py`
- Modify: `odoo-addons/nasq_pmo/models/__init__.py`
- Create: `odoo-addons/nasq_pmo/data/nasq_pmo_data.xml`
- Modify: `odoo-addons/nasq_pmo/__manifest__.py`
- Modify: `odoo-addons/nasq_pmo/controllers/__init__.py`, `odoo-addons/nasq_pmo/serializers/__init__.py`, `odoo-addons/nasq_pmo/tests/__init__.py` (+ header-only stub modules so later parallel tasks never edit these `__init__` files)
- Create: `odoo-addons/nasq_pmo/tests/test_project_admin_model.py`

**Interfaces:**
- Produces (all on `project.project` unless noted):
  - `PROJECT_CREATORS = ('managers', 'employees')`, `VISIBILITY_VALUES = ('employees', 'followers')` (module constants).
  - `_nasq_is_manager() -> bool` (model-level; group OR admin), `_nasq_is_admin() -> bool`.
  - `_nasq_can_manage() -> bool` — `ensure_one`; manager OR `self.user_id == env.user`.
  - `_nasq_can_create() -> bool` (model-level).
  - `_nasq_create_from_policy(name: str) -> project` (raises `AccessError` when not allowed).
  - `_nasq_archive() / _nasq_unarchive() -> self` (AccessError unless can_manage).
  - `_nasq_add_stage(name, fold=False) -> project.task.type`, `_nasq_update_stage(stage, vals) -> stage`, `_nasq_reorder_stages(ids: list[int]) -> stages` (ValueError when not a permutation), `_nasq_delete_stage(stage)` (raises `UserError` with `.nasq_count` attribute set when the stage has tasks), `_nasq_stage_task_count(stage) -> int` (active_test False).
  - `_nasq_followers() -> res.users` (internal users following), `_nasq_add_follower(user) / _nasq_remove_follower(user) -> res.users`.
  - `_nasq_create_milestone(name, deadline=None) -> project.milestone`, `_nasq_update_milestone(m, vals)`, `_nasq_delete_milestone(m)` (`UserError` with `.nasq_count` when tasks linked), `_nasq_milestone_task_counts(m) -> (total, done)`.
  - `_nasq_post_update(status, name, description='') -> project.update` (AccessError unless can_manage; ValueError on bad status).
  - `nasq.pmo.settings` (AbstractModel): `get() -> {'project_creators': str, 'default_stages': [{'name','fold'}]}`, `set_values(vals) -> dict` (AccessError unless admin; ValueError with a `.nasq_field` attribute on bad input), `_default_stage_vals() -> list[dict]` (create-ready `{'name','fold','sequence'}` list).
  - `project.update` creation goes through Odoo; `last_update_status` recomputes.
- Every method that gates on the caller is written so overlays can override one step (check → do → hook, like `_nasq_set_status`).

- [ ] **Step 1: Failing tests**

`tests/test_project_admin_model.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestProjectAdminModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pa_emp', groups='nasq_core.group_employee')
        cls.other = new_test_user(cls.env, login='pa_other', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pa_mgr',
                                    groups='nasq_core.group_employee,project.group_project_manager')
        cls.admin = new_test_user(cls.env, login='pa_admin', groups='nasq_core.group_customer_admin')
        cls.project = cls.env['project.project'].create({'name': 'Admin project', 'user_id': cls.employee.id})
        cls.Settings = cls.env['nasq.pmo.settings']

    # --- rules -------------------------------------------------------------
    def test_can_manage_assigned_user_outside_group(self):
        self.assertTrue(self.project.with_user(self.employee)._nasq_can_manage())
        self.assertFalse(self.project.with_user(self.other)._nasq_can_manage())
        self.assertTrue(self.project.with_user(self.manager)._nasq_can_manage())
        self.assertTrue(self.project.with_user(self.admin)._nasq_can_manage())

    def test_create_policy_default_managers(self):
        self.assertEqual(self.Settings.get()['project_creators'], 'managers')
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(self.other)._nasq_create_from_policy('Nope')
        p = self.env['project.project'].with_user(self.manager)._nasq_create_from_policy('Ok')
        self.assertEqual(p.user_id, self.manager)
        self.assertEqual(p.privacy_visibility, 'employees')
        self.assertTrue(p.allow_milestones)
        self.assertEqual(p.type_ids.sorted('sequence').mapped('name'), ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])
        self.assertEqual(p.type_ids.sorted('sequence').mapped('fold'), [False, False, False, True])

    def test_create_policy_employees_uses_sudo_but_keeps_creator(self):
        self.Settings.with_user(self.admin).set_values({'project_creators': 'employees'})
        p = self.env['project.project'].with_user(self.other)._nasq_create_from_policy('Mine')
        self.assertEqual(p.create_uid, self.other)
        self.assertEqual(p.user_id, self.other)
        self.assertTrue(p.with_user(self.other)._nasq_can_manage())

    def test_settings_validation_and_access(self):
        with self.assertRaises(AccessError):
            self.Settings.with_user(self.manager).set_values({'project_creators': 'employees'})
        with self.assertRaises(ValueError):
            self.Settings.with_user(self.admin).set_values({'project_creators': 'anyone'})
        with self.assertRaises(ValueError):
            self.Settings.with_user(self.admin).set_values({'default_stages': []})
        with self.assertRaises(ValueError):
            self.Settings.with_user(self.admin).set_values({'default_stages': [{'name': ' ', 'fold': False}]})
        out = self.Settings.with_user(self.admin).set_values({'default_stages': [{'name': 'A', 'fold': True}]})
        self.assertEqual(out['default_stages'], [{'name': 'A', 'fold': True}])
        self.assertEqual(json.loads(self.env['ir.config_parameter'].sudo().get_param('nasq_pmo.default_stages')),
                         [{'name': 'A', 'fold': True}])

    # --- archive -----------------------------------------------------------
    def test_archive_rules(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._nasq_archive()
        self.project.with_user(self.employee)._nasq_archive()
        self.assertFalse(self.project.active)
        self.project.with_user(self.manager)._nasq_unarchive()
        self.assertTrue(self.project.active)

    # --- stages ------------------------------------------------------------
    def test_stage_lifecycle(self):
        p = self.project.with_user(self.manager)
        a = p._nasq_add_stage('A')
        b = p._nasq_add_stage('B', fold=True)
        self.assertEqual(p.type_ids.sorted('sequence').ids, [a.id, b.id])
        self.assertTrue(b.fold)
        p._nasq_reorder_stages([b.id, a.id])
        self.assertEqual(p.type_ids.sorted(lambda s: (s.sequence, s.id)).ids, [b.id, a.id])
        with self.assertRaises(ValueError):
            p._nasq_reorder_stages([a.id])
        p._nasq_update_stage(a, {'name': 'A2', 'fold': True})
        self.assertEqual((a.name, a.fold), ('A2', True))
        task = self.env['project.task'].create({'name': 't', 'project_id': p.id, 'stage_id': a.id})
        with self.assertRaises(UserError) as cm:
            p._nasq_delete_stage(a)
        self.assertEqual(cm.exception.nasq_count, 1)
        task.write({'active': False})
        with self.assertRaises(UserError):
            p._nasq_delete_stage(a)  # archived tasks still count
        p._nasq_delete_stage(b)
        self.assertNotIn(b.id, p.type_ids.ids)
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._nasq_add_stage('X')

    # --- followers ---------------------------------------------------------
    def test_followers(self):
        p = self.project.with_user(self.manager)
        p._nasq_add_follower(self.other)
        self.assertIn(self.other, p._nasq_followers())
        p._nasq_remove_follower(self.other)
        self.assertNotIn(self.other, p._nasq_followers())
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._nasq_add_follower(self.other)

    # --- milestones --------------------------------------------------------
    def test_milestones(self):
        p = self.project.with_user(self.manager)
        m = p._nasq_create_milestone('M1', deadline='2030-01-31')
        self.assertEqual(str(m.deadline), '2030-01-31')
        task = self.env['project.task'].create({'name': 't', 'project_id': p.id, 'milestone_id': m.id})
        self.assertEqual(p._nasq_milestone_task_counts(m), (1, 0))
        task.write({'state': '1_done'})
        self.assertEqual(p._nasq_milestone_task_counts(m), (1, 1))
        with self.assertRaises(UserError) as cm:
            p._nasq_delete_milestone(m)
        self.assertEqual(cm.exception.nasq_count, 1)
        p._nasq_update_milestone(m, {'is_reached': True})
        self.assertTrue(m.is_reached)
        task.write({'milestone_id': False})
        p._nasq_delete_milestone(m)
        self.assertFalse(m.exists())

    # --- updates -----------------------------------------------------------
    def test_post_update(self):
        p = self.project.with_user(self.manager)
        u = p._nasq_post_update('at_risk', 'Week 3', '<p>late</p>')
        self.assertEqual((u.status, u.name, u.description), ('at_risk', 'Week 3', '<p>late</p>'))
        self.assertEqual(self.project.last_update_status, 'at_risk')
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._nasq_post_update('done', 'x')
        with self.assertRaises(ValueError):
            p._nasq_post_update('to_define', 'x')
```

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_p3_t1 -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_pmo:TestProjectAdminModel --http-port=8171 --stop-after-init 2>&1 | grep -E "ERROR|FAIL|odoo.tests.result"` (first run installs; later `-u nasq_pmo`).
Expected: errors — `nasq.pmo.settings` unknown model, missing methods.

- [ ] **Step 3: Settings model + data**

`models/nasq_settings.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import models
from odoo.exceptions import AccessError

PARAM_CREATORS = 'nasq_pmo.project_creators'
PARAM_STAGES = 'nasq_pmo.default_stages'
CREATORS = ('managers', 'employees')
MAX_STAGES = 20
FALLBACK_STAGES = [
    {'name': 'جديد', 'fold': False},
    {'name': 'قيد التنفيذ', 'fold': False},
    {'name': 'مراجعة', 'fold': False},
    {'name': 'منجز', 'fold': True},
]


class NasqPmoSettings(models.AbstractModel):
    """The two company-wide project policies, stored in ir.config_parameter.

    ir.config_parameter is readable only by admins, so the reads/writes below are
    the one documented ``sudo()`` for configuration in nasq_pmo: this is policy,
    not business data, and every caller of ``set_values`` is gated on
    ``nasq_core.group_customer_admin`` first.
    """
    _name = 'nasq.pmo.settings'
    _description = 'nasq project policies'

    def _params(self):
        return self.env['ir.config_parameter'].sudo()

    def get(self):
        creators = self._params().get_param(PARAM_CREATORS, 'managers')
        raw = self._params().get_param(PARAM_STAGES)
        try:
            stages = json.loads(raw) if raw else FALLBACK_STAGES
        except ValueError:
            stages = FALLBACK_STAGES
        return {
            'project_creators': creators if creators in CREATORS else 'managers',
            'default_stages': [{'name': s['name'], 'fold': bool(s.get('fold'))} for s in stages],
        }

    def _can_edit(self):
        return self.env.user.has_group('nasq_core.group_customer_admin')

    def set_values(self, vals):
        if not self._can_edit():
            raise AccessError(self.env._("Only a customer administrator can change project policies."))
        if 'project_creators' in vals:
            if vals['project_creators'] not in CREATORS:
                raise _invalid('project_creators', "project_creators must be 'managers' or 'employees'")
            self._params().set_param(PARAM_CREATORS, vals['project_creators'])
        if 'default_stages' in vals:
            stages = vals['default_stages']
            if not isinstance(stages, list) or not stages or len(stages) > MAX_STAGES:
                raise _invalid('default_stages', f"default_stages must hold 1..{MAX_STAGES} stages")
            clean = []
            for s in stages:
                name = (s.get('name') if isinstance(s, dict) else None)
                if not isinstance(name, str) or not name.strip():
                    raise _invalid('default_stages', "every default stage needs a name")
                clean.append({'name': name.strip(), 'fold': bool(s.get('fold'))})
            self._params().set_param(PARAM_STAGES, json.dumps(clean, ensure_ascii=False))
        return self.get()

    def _default_stage_vals(self):
        """Create-ready vals for a new project's stages, in policy order."""
        return [
            {'name': s['name'], 'fold': s['fold'], 'sequence': (i + 1) * 10}
            for i, s in enumerate(self.get()['default_stages'])
        ]


def _invalid(field, message):
    err = ValueError(message)
    err.nasq_field = field
    return err
```
`data/nasq_pmo_data.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo noupdate="1">
    <record id="param_project_creators" model="ir.config_parameter">
        <field name="key">nasq_pmo.project_creators</field>
        <field name="value">managers</field>
    </record>
    <record id="param_default_stages" model="ir.config_parameter">
        <field name="key">nasq_pmo.default_stages</field>
        <field name="value">[{"name": "جديد", "fold": false}, {"name": "قيد التنفيذ", "fold": false}, {"name": "مراجعة", "fold": false}, {"name": "منجز", "fold": true}]</field>
    </record>
</odoo>
```
Manifest: add `'data': ['data/nasq_pmo_data.xml'],` after `'depends'`. `models/__init__.py`: `from . import nasq_settings, project_project, project_task`.

- [ ] **Step 4: project.project methods**

Replace `models/project_project.py` with:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, UserError

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by nasq (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}
PROJECT_CREATORS = ('managers', 'employees')
VISIBILITY_VALUES = ('employees', 'followers')


def _not_empty(message, count):
    err = UserError(message)
    err.nasq_count = count
    return err


class ProjectProject(models.Model):
    _inherit = 'project.project'

    # --- rules ---------------------------------------------------------------
    def _nasq_is_admin(self):
        return self.env.user.has_group('nasq_core.group_customer_admin')

    def _nasq_is_manager(self):
        """Group-level rule: project managers and customer admins (any project)."""
        return self.env.user.has_group('project.group_project_manager') or self._nasq_is_admin()

    def _nasq_can_manage(self):
        """Per-project rule: the group rule OR being this project's assigned manager."""
        self.ensure_one()
        return self._nasq_is_manager() or self.user_id == self.env.user

    def _nasq_check_manage(self):
        if not self._nasq_can_manage():
            raise AccessError(self.env._("Only the project manager can change this project."))

    def _nasq_can_create(self):
        return self._nasq_is_manager() or self.env['nasq.pmo.settings'].get()['project_creators'] == 'employees'

    # --- create --------------------------------------------------------------
    def _nasq_create_from_policy(self, name):
        """Create a project the nasq way: policy check, defaults, default stages.

        When the company policy lets every employee create projects, the create
        itself runs in sudo (Odoo's ACL reserves project creation to managers);
        the policy is the explicit, admin-set widening of that ACL, and
        ``create_uid``/``user_id`` still record the employee. Second documented
        ``sudo()`` in nasq_pmo.
        """
        if not self._nasq_can_create():
            raise AccessError(self.env._("You are not allowed to create projects."))
        vals = self._nasq_create_vals(name)
        env = self.env if self._nasq_is_manager() else self.sudo().env
        project = env['project.project'].create(vals)
        return self.browse(project.id)

    def _nasq_create_vals(self, name):
        stages = self.env['nasq.pmo.settings']._default_stage_vals()
        return {
            'name': name,
            'user_id': self.env.uid,
            'privacy_visibility': 'employees',
            'allow_milestones': True,
            'type_ids': [(0, 0, s) for s in stages],
        }

    # --- archive -------------------------------------------------------------
    def _nasq_archive(self):
        self._nasq_check_manage()
        self.write({'active': False})
        return self

    def _nasq_unarchive(self):
        self._nasq_check_manage()
        self.write({'active': True})
        return self

    # --- status (phase 2) ----------------------------------------------------
    def _nasq_set_status(self, status):
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

    # --- updates -------------------------------------------------------------
    def _nasq_post_update(self, status, name, description=''):
        """Create a project.update (Odoo recomputes last_update_status from it)."""
        self.ensure_one()
        if status not in STATUS_VALUES:
            raise ValueError(f"unknown project status {status!r}")
        self._nasq_check_status_allowed(status)
        return self.env['project.update'].create({
            'project_id': self.id,
            'status': status,
            'name': name,
            'description': description or False,
        })

    # --- stages --------------------------------------------------------------
    def _nasq_stage_task_count(self, stage):
        return self.env['project.task'].with_context(active_test=False).search_count(
            [('project_id', '=', self.id), ('stage_id', '=', stage.id)])

    def _nasq_add_stage(self, name, fold=False):
        self._nasq_check_manage()
        last = max(self.type_ids.mapped('sequence'), default=0)
        return self.env['project.task.type'].create({
            'name': name, 'fold': fold, 'sequence': last + 10, 'project_ids': [(4, self.id)],
        })

    def _nasq_update_stage(self, stage, vals):
        self._nasq_check_manage()
        if stage not in self.type_ids:
            raise ValueError("stage does not belong to this project")
        stage.write({k: v for k, v in vals.items() if k in ('name', 'fold')})
        return stage

    def _nasq_reorder_stages(self, ids):
        self._nasq_check_manage()
        if sorted(ids) != sorted(self.type_ids.ids):
            raise ValueError("ids must be a permutation of the project's stage ids")
        for i, stage_id in enumerate(ids):
            self.env['project.task.type'].browse(stage_id).write({'sequence': (i + 1) * 10})
        return self.type_ids.sorted(lambda s: (s.sequence, s.id))

    def _nasq_delete_stage(self, stage):
        self._nasq_check_manage()
        if stage not in self.type_ids:
            raise ValueError("stage does not belong to this project")
        count = self._nasq_stage_task_count(stage)
        if count:
            raise _not_empty(self.env._("This stage still holds tasks."), count)
        if len(stage.project_ids) > 1:
            # Shared stage: detach from this project only.
            self.write({'type_ids': [(3, stage.id)]})
        else:
            stage.unlink()

    # --- followers -----------------------------------------------------------
    def _nasq_followers(self):
        partners = self.message_partner_ids
        return partners.mapped('user_ids').filtered(lambda u: not u.share and u.active)

    def _nasq_add_follower(self, user):
        self._nasq_check_manage()
        self.message_subscribe(partner_ids=[user.partner_id.id])
        return self._nasq_followers()

    def _nasq_remove_follower(self, user):
        self._nasq_check_manage()
        self.message_unsubscribe(partner_ids=[user.partner_id.id])
        return self._nasq_followers()

    # --- milestones ----------------------------------------------------------
    def _nasq_milestone_task_counts(self, milestone):
        Task = self.env['project.task']
        domain = [('project_id', '=', self.id), ('milestone_id', '=', milestone.id)]
        return Task.search_count(domain), Task.search_count(domain + [('state', 'in', ('1_done', '1_canceled'))])

    def _nasq_create_milestone(self, name, deadline=None):
        self._nasq_check_manage()
        if not self.allow_milestones:
            self.write({'allow_milestones': True})
        return self.env['project.milestone'].create({
            'project_id': self.id, 'name': name, 'deadline': fields.Date.to_date(deadline) if deadline else False,
        })

    def _nasq_update_milestone(self, milestone, vals):
        self._nasq_check_manage()
        if milestone.project_id != self:
            raise ValueError("milestone does not belong to this project")
        clean = {}
        if 'name' in vals:
            clean['name'] = vals['name']
        if 'deadline' in vals:
            clean['deadline'] = fields.Date.to_date(vals['deadline']) if vals['deadline'] else False
        if 'is_reached' in vals:
            clean['is_reached'] = bool(vals['is_reached'])
        milestone.write(clean)
        return milestone

    def _nasq_delete_milestone(self, milestone):
        self._nasq_check_manage()
        if milestone.project_id != self:
            raise ValueError("milestone does not belong to this project")
        total, _done = self._nasq_milestone_task_counts(milestone)
        if total:
            raise _not_empty(self.env._("Tasks are still linked to this milestone."), total)
        milestone.unlink()
```

- [ ] **Step 5: Stub the modules later tasks fill, so `__init__` files are touched once**

Create header-only files (one comment line each): `controllers/project_stages.py`, `controllers/project_followers.py`, `controllers/milestones.py`, `controllers/project_updates.py`, `controllers/tags.py`, `controllers/settings.py`, `serializers/milestone.py`, `serializers/project_update.py`, `tests/test_project_stages.py`, `tests/test_project_followers.py`, `tests/test_milestones.py`, `tests/test_project_updates.py`, `tests/test_tags.py`, `tests/test_settings.py` — each containing only `# Part of Odoo. See LICENSE file for full copyright and licensing details.`. Then:
- Also create `serializers/dates.py` (a real module, shared by Tasks 5 and 7):
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.nasq_api.controllers.common import ApiError


def parse_date(value, key):
    """YYYY-MM-DD or null → date/False. Calendar dates, not instants."""
    if value in (None, False, ''):
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f"{key} must be a YYYY-MM-DD date", field=key)
    try:
        return fields.Date.to_date(value)
    except ValueError as e:
        raise ApiError(422, 'invalid', f"{key} must be a YYYY-MM-DD date", field=key) from e
```
- `controllers/__init__.py`: `from . import milestones, people, personal_stages, project_followers, project_stages, project_updates, projects, settings, tags, tasks, timeline`
- `serializers/__init__.py`: `from . import dates, milestone, project, project_update, task, timeline`
- `tests/__init__.py`: add `test_milestones, test_project_admin_model, test_project_followers, test_project_stages, test_project_updates, test_settings, test_tags` to the alphabetical list.

- [ ] **Step 6: Run**

Step 2 command → `TestProjectAdminModel` green (10 tests). Then `--test-tags /nasq_pmo` → all green (phase-2 tests untouched). `ruff check odoo-addons/nasq_pmo` clean. `test_project_status.py`'s `test_can_manage` still passes (`ensure_one` on a single record).

- [ ] **Step 7: Commit**

```bash
git commit -m "[ADD] nasq_pmo: project admin model layer — policy, manage rule, archive, stages, followers, milestones, updates, settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- odoo-addons/nasq_pmo/models odoo-addons/nasq_pmo/data odoo-addons/nasq_pmo/__manifest__.py odoo-addons/nasq_pmo/controllers odoo-addons/nasq_pmo/serializers/__init__.py odoo-addons/nasq_pmo/serializers/milestone.py odoo-addons/nasq_pmo/serializers/project_update.py odoo-addons/nasq_pmo/serializers/dates.py odoo-addons/nasq_pmo/tests
```

---

### Task 2: Contracts

**Files:**
- Modify: `packages/contracts/src/pmo/project.ts`, `task.ts`, `index.ts`
- Create: `packages/contracts/src/pmo/milestone.ts`, `project-update.ts`, `settings.ts`, `tag.ts`
- Test: `packages/contracts/src/pmo/__tests__/schemas.test.ts`

**Interfaces (all exported from `@nasq/contracts`):**
- `UserRefSchema {id, name}`; `ProjectStageSchema` + `task_count: int`; `ProjectSchema` + `active: boolean, can_manage: boolean`; `ProjectDetailSchema` + `description_html: string, manager: UserRef|null, privacy_visibility: 'employees'|'followers', date_start: string|null, date_end: string|null, tags: Tag[], followers_count: int, milestone_count: int`; `ProjectListSchema {items: Project[], can_create: boolean}`; `ProjectCreateSchema {name}`; `ProjectPatchSchema {name?, description?, user_id?: int|null, privacy_visibility?, date_start?: string|null, date?: string|null, tag_ids?: int[]}`; `VisibilitySchema`; `StageBodySchema {name, fold?}`; `StagePatchSchema {name?, fold?}`; `StageOrderBodySchema {ids: int[]}`.
- `MilestoneSchema {id, name, deadline: string|null, is_reached, reached_date: string|null, task_count, done_task_count}`; `MilestoneBodySchema {name, deadline?: string|null}`; `MilestonePatchSchema {name?, deadline?: string|null, is_reached?}`.
- `ProjectUpdateSchema {id, name, status: ProjectStatus, description_html, date: string, author: UserRef}`; `ProjectUpdateBodySchema {status, name, description?}`.
- `ProjectSettingsSchema {project_creators: 'managers'|'employees', default_stages: {name, fold}[]}`; `ProjectSettingsPatchSchema` (both optional); `PROJECT_CREATORS`.
- `TagCreateSchema {name}` (`TagSchema` already exists in task.ts); `TaskDetailSchema` + `milestone: RefSchema.nullable()`; `TaskPatchSchema` + `milestone_id?: int|null`.
- Types for each.

- [ ] **Step 1: Failing tests** — append to `schemas.test.ts` (imports as needed):
```ts
const STAGE = { id: 1, name: 'A', sequence: 10, fold: false, task_count: 2 }
const PROJECT = { id: 3, name: 'P', status: null, progress: 0, task_count: 0, closed_task_count: 0, active: true, can_manage: true }

describe('ProjectListSchema', () => {
  it('is an object with items and can_create, not the phase-2 bare array', () => {
    expect(ProjectListSchema.parse({ items: [PROJECT], can_create: false }).can_create).toBe(false)
    expect(() => ProjectListSchema.parse([PROJECT])).toThrow()
  })
})
describe('ProjectDetailSchema (3a)', () => {
  it('carries settings fields', () => {
    const d = ProjectDetailSchema.parse({
      ...PROJECT, stages: [STAGE], description_html: '', manager: { id: 2, name: 'M' }, privacy_visibility: 'followers',
      date_start: '2030-01-01', date_end: null, tags: [], followers_count: 1, milestone_count: 0,
    })
    expect(d.stages[0]!.task_count).toBe(2)
  })
  it('rejects portal visibility', () => {
    expect(() => VisibilitySchema.parse('portal')).toThrow()
  })
})
describe('ProjectPatchSchema', () => {
  it('accepts nullable dates and manager, rejects unknown keys', () => {
    expect(ProjectPatchSchema.parse({ date_start: null, user_id: null, tag_ids: [1] })).toEqual({ date_start: null, user_id: null, tag_ids: [1] })
    expect(() => ProjectPatchSchema.parse({ active: false })).toThrow()
  })
})
describe('Milestone / ProjectUpdate / Settings', () => {
  it('parse their fixtures', () => {
    MilestoneSchema.parse({ id: 1, name: 'M', deadline: null, is_reached: false, reached_date: null, task_count: 0, done_task_count: 0 })
    ProjectUpdateSchema.parse({ id: 1, name: 'W1', status: 'on_track', description_html: '<p>x</p>', date: '2030-01-01', author: { id: 2, name: 'M' } })
    expect(ProjectSettingsSchema.parse({ project_creators: 'managers', default_stages: [{ name: 'A', fold: true }] }).default_stages).toHaveLength(1)
    expect(() => ProjectSettingsSchema.parse({ project_creators: 'anyone', default_stages: [] })).toThrow()
    expect(StageOrderBodySchema.parse({ ids: [2, 1] }).ids).toEqual([2, 1])
  })
})
describe('Task milestone', () => {
  it('detail carries milestone and patch accepts milestone_id null', () => {
    expect(TaskPatchSchema.parse({ milestone_id: null })).toEqual({ milestone_id: null })
  })
})
```
Also add `milestone: null` to the existing `TaskDetailSchema` fixture in that file.

- [ ] **Step 2: Run to see it fail** — `npm -w packages/contracts run test` → imports missing.

- [ ] **Step 3: Implement**

`project.ts` — replace with:
```ts
import { z } from 'zod'
import { TagSchema } from './task'

export const ProjectRefSchema = z.object({ id: z.number().int(), name: z.string() }).strict()
export const UserRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const ProjectStatusSchema = z.enum(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
export const PROJECT_STATUSES = ProjectStatusSchema.options
export const VisibilitySchema = z.enum(['employees', 'followers'])

export const ProjectStageSchema = z.object({
  id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean(), task_count: z.number().int(),
}).strict()

export const ProjectSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema.nullable(),
  progress: z.number().int().min(0).max(100), task_count: z.number().int(), closed_task_count: z.number().int(),
  active: z.boolean(), can_manage: z.boolean(),
}).strict()

export const ProjectDetailSchema = ProjectSchema.extend({
  stages: z.array(ProjectStageSchema), description_html: z.string(), manager: UserRefSchema.nullable(),
  privacy_visibility: VisibilitySchema, date_start: z.string().nullable(), date_end: z.string().nullable(),
  tags: z.array(TagSchema), followers_count: z.number().int(), milestone_count: z.number().int(),
}).strict()

export const ProjectListSchema = z.object({ items: z.array(ProjectSchema), can_create: z.boolean() }).strict()
export const ProjectCreateSchema = z.object({ name: z.string().min(1) }).strict()
export const ProjectPatchSchema = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), user_id: z.number().int().nullable().optional(),
  privacy_visibility: VisibilitySchema.optional(), date_start: z.string().nullable().optional(), date: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int()).optional(),
}).strict()
export const ProjectStatusBodySchema = z.object({ status: ProjectStatusSchema }).strict()
export const StageBodySchema = z.object({ name: z.string().min(1), fold: z.boolean().optional() }).strict()
export const StagePatchSchema = z.object({ name: z.string().min(1).optional(), fold: z.boolean().optional() }).strict()
export const StageOrderBodySchema = z.object({ ids: z.array(z.number().int().positive()) }).strict()

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type Visibility = z.infer<typeof VisibilitySchema>
export type UserRef = z.infer<typeof UserRefSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectStage = z.infer<typeof ProjectStageSchema>
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
export type ProjectList = z.infer<typeof ProjectListSchema>
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>
```
`milestone.ts`:
```ts
import { z } from 'zod'
export const MilestoneSchema = z.object({
  id: z.number().int().positive(), name: z.string(), deadline: z.string().nullable(), is_reached: z.boolean(),
  reached_date: z.string().nullable(), task_count: z.number().int(), done_task_count: z.number().int(),
}).strict()
export const MilestoneBodySchema = z.object({ name: z.string().min(1), deadline: z.string().nullable().optional() }).strict()
export const MilestonePatchSchema = z.object({ name: z.string().min(1).optional(), deadline: z.string().nullable().optional(), is_reached: z.boolean().optional() }).strict()
export type Milestone = z.infer<typeof MilestoneSchema>
export type MilestonePatch = z.infer<typeof MilestonePatchSchema>
```
`project-update.ts`:
```ts
import { z } from 'zod'
import { ProjectStatusSchema, UserRefSchema } from './project'
export const ProjectUpdateSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema, description_html: z.string(),
  date: z.string(), author: UserRefSchema,
}).strict()
export const ProjectUpdateBodySchema = z.object({ status: ProjectStatusSchema, name: z.string().min(1), description: z.string().optional() }).strict()
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>
export type ProjectUpdateBody = z.infer<typeof ProjectUpdateBodySchema>
```
`settings.ts`:
```ts
import { z } from 'zod'
export const ProjectCreatorsSchema = z.enum(['managers', 'employees'])
export const PROJECT_CREATORS = ProjectCreatorsSchema.options
export const DefaultStageSchema = z.object({ name: z.string().min(1), fold: z.boolean() }).strict()
export const ProjectSettingsSchema = z.object({ project_creators: ProjectCreatorsSchema, default_stages: z.array(DefaultStageSchema).min(1).max(20) }).strict()
export const ProjectSettingsPatchSchema = ProjectSettingsSchema.partial().strict()
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type DefaultStage = z.infer<typeof DefaultStageSchema>
```
`tag.ts`: `export const TagCreateSchema = z.object({ name: z.string().min(1) }).strict()`.
`task.ts`: `TaskDetailSchema` gains `milestone: RefSchema.nullable(),` (after `can_approve`); `TaskPatchSchema` gains `milestone_id: z.number().int().nullable().optional(),`. `index.ts` adds `export * from './milestone'`, `'./project-update'`, `'./settings'`, `'./tag'`. Check the import cycle: `project.ts` imports `TagSchema` from `./task`, and `task.ts` must not import from `./project` (it doesn't).

- [ ] **Step 4: Run** — `npm -w packages/contracts run test` → 21 + new all pass. `npm -w apps/web run lint` now fails on fixtures (`useTasks.optimistic.test.ts` needs `milestone`, `ProjectTable` uses the bare array) — Task 9's job; record the exact errors in the report.

- [ ] **Step 5: Commit** — `git commit -m "[ADD] contracts: project admin, milestones, updates, settings, tags; task.milestone" -- packages/contracts`.

---

### Task 3: i18n — every key of 3a

**Files:** `apps/web/i18n/locales/{ar,en}/projects.json`, `{ar,en}/tasks.json`, `{ar,en}/settings.json` (new), `{ar,en}/common.json` (only `nav.settings`), `apps/web/nuxt.config.ts` (`files` += `settings.json`).

- [ ] **Step 1: Add keys** — merge into `projects.json` under `projects`:
```json
"new": "مشروع جديد", "newName": "اسم المشروع", "created": "تم إنشاء المشروع", "createForbidden": "لا تملك صلاحية إنشاء مشاريع",
"filters": { "active": "النشطة", "archived": "المؤرشفة" }, "archivedEmpty": "لا مشاريع مؤرشفة",
"menu": { "settings": "إعدادات المشروع", "archive": "أرشفة المشروع", "unarchive": "إلغاء الأرشفة" },
"archiveConfirmTitle": "أرشفة المشروع؟", "archiveConfirmText": "يختفي المشروع ومهامه من القوائم. يمكنك إلغاء الأرشفة لاحقًا من فلتر المؤرشفة.", "archived": "تمت أرشفة المشروع", "unarchived": "تم إلغاء أرشفة المشروع",
"settings": { "title": "إعدادات المشروع", "tabs": { "general": "عام", "stages": "المراحل", "followers": "المتابعون" }, "name": "الاسم", "description": "الوصف", "manager": "المدير", "noManager": "بلا مدير", "visibility": "الرؤية", "visibilityEmployees": "كل الموظفين", "visibilityFollowers": "المتابعون فقط", "dateStart": "تاريخ البدء", "dateEnd": "تاريخ الانتهاء", "noDate": "بلا تاريخ", "tags": "الوسوم", "saved": "تم الحفظ" },
"stages": { "add": "مرحلة جديدة", "addPlaceholder": "اسم المرحلة", "rename": "إعادة تسمية", "fold": "مطوية", "delete": "حذف", "notEmpty": "المرحلة تحتوي {count} مهمة", "deleted": "تم حذف المرحلة", "empty": "لا مراحل بعد" },
"followers": { "add": "إضافة متابع", "remove": "إزالة", "empty": "لا متابعين بعد", "hint": "عند اختيار \"المتابعون فقط\" لا يرى المشروع إلا من في هذه القائمة." },
"tabs": { "list": "قائمة", "board": "لوحة", "milestones": "المعالم", "updates": "التحديثات" },
"milestones": { "new": "معلم جديد", "edit": "تعديل المعلم", "name": "الاسم", "deadline": "الموعد", "tasks": "المهام", "state": "الحالة", "reached": "تم", "notReached": "لم يتم", "markReached": "تحديد كمنجز", "reopen": "إعادة فتح", "delete": "حذف", "hasTasks": "المعلم مرتبط بـ {count} مهمة", "empty": "لا معالم بعد", "tasksOf": "{done} من {total}" },
"updates": { "new": "تحديث جديد", "title": "العنوان", "body": "النص", "status": "الحالة", "empty": "لا تحديثات بعد", "by": "بواسطة {name}", "posted": "تم نشر التحديث" }
```
(the existing `tabs` object is replaced by the four-key one). English equivalents: New project / Project name / Project created / You may not create projects / Active / Archived / No archived projects / Project settings / Archive project / Unarchive / Archive this project? / The project and its tasks leave the lists. You can unarchive it later from the Archived filter. / Project archived / Project unarchived / General / Stages / Followers / Name / Description / Manager / No manager / Visibility / All employees / Followers only / Start date / End date / No date / Tags / Saved / New stage / Stage name / Rename / Folded / Delete / This stage holds {count} tasks / Stage deleted / No stages yet / Add follower / Remove / No followers yet / With "Followers only", only people on this list see the project. / List / Board / Milestones / Updates / New milestone / Edit milestone / Name / Deadline / Tasks / State / Reached / Not reached / Mark reached / Reopen / Delete / {count} tasks are linked to this milestone / No milestones yet / {done} of {total} / New update / Title / Body / Status / No updates yet / by {name} / Update posted.

`tasks.json` under `tasks.drawer`: `"milestone": "المعلم"`, `"noMilestone": "بلا معلم"`, `"addTag": "إضافة وسم"`, `"createTag": "إنشاء \"{name}\""`, `"archive": "أرشفة المهمة"`, `"archiveConfirm": "تختفي المهمة من كل القوائم. متابعة؟"`, `"archived": "تمت أرشفة المهمة"` (en: Milestone / No milestone / Add tag / Create "{name}" / Archive task / The task leaves every list. Continue? / Task archived).

`settings.json` (new, both locales):
```json
{ "settings": { "title": "الإعدادات", "forbidden": "هذه الصفحة لمدير النظام فقط", "projects": { "title": "المشاريع", "creators": { "label": "من يستطيع إنشاء المشاريع", "managers": "مديرو المشاريع ومدير النظام", "employees": "كل الموظفين" }, "defaultStages": { "label": "المراحل الافتراضية للمشاريع الجديدة", "hint": "تُنسخ إلى كل مشروع جديد. المشاريع الحالية لا تتأثر." }, "saved": "تم حفظ الإعدادات" } } }
```
(en: Settings / This page is for administrators only / Projects / Who can create projects / Project managers and administrators / All employees / Default stages for new projects / Copied into every new project. Existing projects are not affected. / Settings saved). `common.json` both locales: `nav.settings` = "الإعدادات" / "Settings". `nuxt.config.ts`: append `'ar/settings.json'` / `'en/settings.json'`.

- [ ] **Step 2: Verify** — JSON valid (`python3 -m json.tool`), key parity ar/en for `projects.json`, `tasks.json`, `settings.json` (script from the phase-2 plan), restart Nuxt, `/login` → 200.
- [ ] **Step 3: Commit** — `git commit -m "[ADD] web: phase-3a locale keys (projects admin, milestones, updates, settings)" -- apps/web/i18n apps/web/nuxt.config.ts`.

---

### Task 4: Task archive, milestone on the wire, tags endpoints

**Files:**
- Modify: `odoo-addons/nasq_pmo/models/project_task.py`, `serializers/task.py`, `controllers/tasks.py`, `controllers/tags.py` (stub → real), `tests/test_tasks.py`, `tests/test_tags.py` (stub → real)

**Interfaces:**
- `project.task._nasq_can_archive() -> bool` (project `_nasq_can_manage()` OR `create_uid == env.user`), `_nasq_archive()` (AccessError otherwise; writes `active=False`).
- `dump_task_detail` + `'milestone': {id, name} | None`; `parse_task_vals` accepts `milestone_id` (int belonging to `task.project_id`, or null; 422 `invalid` field `milestone_id` otherwise).
- `POST /api/v1/tasks/<id>/archive` → `TaskDetail` (403 `forbidden`). `GET /api/v1/tags?q=` → `Tag[]` (name asc, limit 100). `POST /api/v1/tags {name}` → `Tag` 201; 403 `forbidden` for non-managers (`_nasq_is_manager()`), 422 `invalid` field `name` on blank/duplicate (case-insensitive).

- [ ] **Step 1: Failing tests** — in `test_tasks.py` add `'milestone'` to the detail assertions where the key set is checked (search for `set(body)` on a detail) and append:
```python
@tagged('post_install', '-at_install', 'nasq')
class TestTaskArchiveAndMilestone(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.milestone = cls.env['project.milestone'].create({'name': 'M', 'project_id': cls.project.id})
        cls.other_project = cls.env['project.project'].create({'name': 'Other'})
        cls.foreign_milestone = cls.env['project.milestone'].create({'name': 'F', 'project_id': cls.other_project.id})
        cls.mine = cls.env['project.task'].with_user(cls.employee).create({'name': 'Mine', 'project_id': cls.project.id})

    def test_patch_milestone(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': self.milestone.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['milestone'], {'id': self.milestone.id, 'name': 'M'})
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': self.foreign_milestone.id})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'milestone_id'))
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': None})
        self.assertIsNone(res.json()['milestone'])

    def test_archive_rules(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        # creator may archive their own task
        res = self.api('POST', f'/api/v1/tasks/{self.mine.id}/archive')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(self.mine.active)
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=mine').json()['total'], 1)
        # not creator, not manager → 403
        res = self.api('POST', f'/api/v1/tasks/{self.task_other.id}/archive')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_other.id}/archive').status_code, 200)
```
`test_tags.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestTags(NasqPmoCase):

    def test_list_and_create(self):
        self.env['project.tags'].create({'name': 'urgent'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/tags?q=urg').json()
        self.assertEqual([t['name'] for t in items], ['urgent'])
        self.assertEqual(set(items[0]), {'id', 'name', 'color'})
        res = self.api('POST', '/api/v1/tags', {'name': 'design'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', '/api/v1/tags', {'name': 'design'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['name'], 'design')
        res = self.api('POST', '/api/v1/tags', {'name': 'Design'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'name'))
        res = self.api('POST', '/api/v1/tags', {'name': ' '})
        self.assertEqual(res.status_code, 422)
```

- [ ] **Step 2: Run to fail** — `-d nasq_p3_t4 --http-port=8174`, tags `/nasq_pmo:TestTaskArchiveAndMilestone,/nasq_pmo:TestTags` (first run `-i`).

- [ ] **Step 3: Implement**

`models/project_task.py` — add to the class:
```python
    def _nasq_can_archive(self):
        self.ensure_one()
        return self.project_id._nasq_can_manage() or self.create_uid == self.env.user

    def _nasq_archive(self):
        self.ensure_one()
        if not self._nasq_can_archive():
            raise AccessError(self.env._("Only the project manager or the task's creator can archive it."))
        self.write({'active': False})
        return self
```
`serializers/task.py`: in `dump_task_detail` add `'milestone': _ref(task.milestone_id) if task.milestone_id else None,`; `EMPLOYEE_FIELDS` += `'milestone_id'`; add
```python
def _parse_milestone(task, value, key):
    if value is None or value is False:
        return False
    try:
        milestone_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "milestone_id must be one of the project's milestones", field=key) from e
    milestone = request.env['project.milestone'].browse(milestone_id).exists()
    if not milestone or milestone.project_id != task.project_id:
        raise ApiError(422, 'invalid', "milestone_id must be one of the project's milestones", field=key)
    return milestone.id
```
and the dispatch branch `elif key == 'milestone_id': vals[key] = _parse_milestone(task, value, key)`.
`controllers/tasks.py`:
```python
    @http.route('/api/v1/tasks/<int:task_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def archive_task(self, task_id, **_):
        task = get_record('project.task', task_id)
        task._nasq_archive()  # AccessError → 403 forbidden via api_handler
        return dump_task_detail(task)
```
`controllers/tags.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler

MAX_TAGS = 100


def dump_tag(tag):
    return {'id': tag.id, 'name': tag.name, 'color': tag.color}


class TagController(http.Controller):

    @http.route('/api/v1/tags', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_tags(self, **_):
        q = request.httprequest.args.get('q')
        domain = [('name', 'ilike', q)] if q else []
        return [dump_tag(t) for t in request.env['project.tags'].search(domain, order='name, id', limit=MAX_TAGS)]

    @http.route('/api/v1/tags', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_tag(self, name=None, **_):
        if not request.env['project.project']._nasq_is_manager():
            raise AccessError(request.env._("Only a project manager can create tags."))
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        name = name.strip()
        if request.env['project.tags'].search_count([('name', '=ilike', name)]):
            raise ApiError(422, 'invalid', "a tag with this name already exists", field='name')
        tag = request.env['project.tags'].create({'name': name})
        return request.make_json_response(dump_tag(tag), status=201)
```

- [ ] **Step 4: Run** — both classes green; `/nasq_pmo` green; ruff clean.
- [ ] **Step 5: Commit** — `git commit -m "[ADD] nasq_pmo: task archive, milestone on tasks, tags endpoints" -- odoo-addons/nasq_pmo/models/project_task.py odoo-addons/nasq_pmo/serializers/task.py odoo-addons/nasq_pmo/controllers/tasks.py odoo-addons/nasq_pmo/controllers/tags.py odoo-addons/nasq_pmo/tests/test_tasks.py odoo-addons/nasq_pmo/tests/test_tags.py`.

---

### Task 5: Projects controller — list shape, create, patch, archive

**Files:** `odoo-addons/nasq_pmo/serializers/project.py`, `controllers/projects.py`, `tests/test_projects.py`

**Interfaces:**
- `dump_stage(project, stage)` (now needs the project for `task_count`), `dump_project` (+ `active`, `can_manage`), `dump_project_detail` (+ fields per Task 2), `parse_project_vals(payload) -> vals` (whitelist `name, description, user_id, privacy_visibility, date_start, date, tag_ids`; 422 per field; `privacy_visibility` in `VISIBILITY_VALUES`; dates via `_parse_date`; `user_id` int|null validated as an active internal user).
- `GET /api/v1/projects` → `{items, can_create}` (full) or bare refs (`minimal=1`); `archived=1` → archived projects, managers only (403 `forbidden`), query keys allowed: `minimal`, `archived`.
- `POST /api/v1/projects {name}` → 201 detail; 403 `create_forbidden`; 422 field `name`.
- `PATCH /api/v1/projects/<id>` → detail; 403 `forbidden`.
- `POST /api/v1/projects/<id>/archive|unarchive` → detail.

- [ ] **Step 1: Failing tests** — update `PROJECT_KEYS`/`DETAIL_KEYS`:
```python
PROJECT_KEYS = {'id', 'name', 'status', 'progress', 'task_count', 'closed_task_count', 'active', 'can_manage'}
DETAIL_KEYS = PROJECT_KEYS | {'stages', 'description_html', 'manager', 'privacy_visibility', 'date_start', 'date_end', 'tags', 'followers_count', 'milestone_count'}
```
Fix existing tests: `test_list_full_shape_and_progress` reads `self.api(...).json()['items']`; `test_list_unknown_query_is_400` uses `?foo=1` (archived is now valid); `test_detail_stages_and_can_manage` expects `task_count` on each stage (`'task_count': 0` for A and B since fixtures sit on other stages — verify by reading the fixture; the three fixture tasks were created before A/B existed and Odoo assigned them no stage or the first stage; assert with the counts the run shows and explain in the report). Append:
```python
    def test_create_policy_and_shape(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertFalse(self.api('GET', '/api/v1/projects').json()['can_create'])
        res = self.api('POST', '/api/v1/projects', {'name': 'Nope'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'create_forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertTrue(self.api('GET', '/api/v1/projects').json()['can_create'])
        res = self.api('POST', '/api/v1/projects', {'name': 'Fresh'})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual([s['name'] for s in body['stages']], ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])
        self.assertEqual(body['manager']['id'], self.manager.id)
        self.assertEqual(body['privacy_visibility'], 'employees')
        self.assertEqual(self.api('POST', '/api/v1/projects', {'name': ' '}).status_code, 422)

    def test_patch_whitelist(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        tag = self.env['project.tags'].create({'name': 't1'})
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {
            'name': 'Renamed', 'description': '<p>d</p>', 'user_id': self.employee.id, 'privacy_visibility': 'followers',
            'date_start': '2030-01-01', 'date': None, 'tag_ids': [tag.id],
        })
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual((body['name'], body['description_html'], body['manager']['id'], body['privacy_visibility'], body['date_start'], body['date_end']),
                         ('Renamed', '<p>d</p>', self.employee.id, 'followers', '2030-01-01', None))
        self.assertEqual([t['name'] for t in body['tags']], ['t1'])
        for bad in ({'active': False}, {'privacy_visibility': 'portal'}, {'date_start': 'x'}, {'user_id': 999999}, {'name': ''}):
            self.assertEqual(self.api('PATCH', f'/api/v1/projects/{self.project.id}', bad).status_code, 422, bad)
        self.authenticate('api_emp', 'api_emp_pass_123')
        # api_emp is now the assigned manager (user_id) → allowed even outside the group
        self.assertEqual(self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'name': 'Mine'}).status_code, 200)
        other = self.env['project.project'].create({'name': 'Not mine'})
        res = self.api('PATCH', f'/api/v1/projects/{other.id}', {'name': 'x'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_archive_and_archived_filter(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', f'/api/v1/projects/{self.project.id}/archive')
        self.assertEqual((res.status_code, res.json()['active']), (200, False))
        self.assertNotIn(self.project.id, [p['id'] for p in self.api('GET', '/api/v1/projects').json()['items']])
        archived = self.api('GET', '/api/v1/projects?archived=1').json()['items']
        self.assertIn(self.project.id, [p['id'] for p in archived])
        self.assertEqual(self.api('POST', f'/api/v1/projects/{self.project.id}/unarchive').json()['active'], True)
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?archived=1')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
```

- [ ] **Step 2: Run to fail** — `-d nasq_p3_t5 --http-port=8175`, `/nasq_pmo:TestProjects`.

- [ ] **Step 3: Serializer**

`serializers/project.py` — replace with:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_pmo.models.project_project import VISIBILITY_VALUES
from odoo.addons.nasq_pmo.serializers.dates import parse_date

STATUS_TO_API = {'on_track': 'on_track', 'at_risk': 'at_risk', 'off_track': 'off_track', 'on_hold': 'on_hold', 'done': 'done', 'to_define': None}
# Odoo's 'portal' (its default) means "all internal users" for nasq: there are no portal users.
VISIBILITY_TO_API = {'followers': 'followers', 'employees': 'employees', 'portal': 'employees', 'invited_users': 'followers'}
PROJECT_FIELDS = {'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date', 'tag_ids'}


def _user_ref(user):
    return {'id': user.id, 'name': user.name} if user else None


def dump_stage(project, stage):
    return {'id': stage.id, 'name': stage.name, 'sequence': stage.sequence, 'fold': stage.fold,
            'task_count': project._nasq_stage_task_count(stage)}


def dump_project(project):
    return {
        'id': project.id,
        'name': project.name,
        'status': STATUS_TO_API.get(project.last_update_status),
        'progress': round(project.task_completion_percentage * 100),
        'task_count': project.task_count,
        'closed_task_count': project.closed_task_count,
        'active': project.active,
        'can_manage': project._nasq_can_manage(),
    }


def dump_project_detail(project):
    data = dump_project(project)
    data.update({
        'stages': [dump_stage(project, s) for s in project.type_ids.sorted(lambda s: (s.sequence, s.id))],
        'description_html': project.description or '',
        'manager': _user_ref(project.user_id),
        'privacy_visibility': VISIBILITY_TO_API.get(project.privacy_visibility, 'employees'),
        'date_start': fields.Date.to_string(project.date_start) if project.date_start else None,
        'date_end': fields.Date.to_string(project.date) if project.date else None,
        'tags': [{'id': t.id, 'name': t.name, 'color': t.color} for t in project.tag_ids],
        'followers_count': len(project._nasq_followers()),
        'milestone_count': len(project.milestone_ids),
    })
    return data


def parse_project_vals(payload):
    vals = {}
    for key, value in payload.items():
        if key not in PROJECT_FIELDS:
            raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if key == 'name':
            if not isinstance(value, str) or not value.strip():
                raise ApiError(422, 'invalid', "name must not be empty", field=key)
            vals[key] = value.strip()
        elif key == 'description':
            vals[key] = value if isinstance(value, str) else ''
        elif key == 'user_id':
            if value is None:
                vals[key] = False
            else:
                user = request.env['res.users'].browse(int(value)).exists() if isinstance(value, int) else None
                if not user or user.share or not user.active:
                    raise ApiError(422, 'invalid', "user_id must be an active internal user", field=key)
                vals[key] = user.id
        elif key == 'privacy_visibility':
            if value not in VISIBILITY_VALUES:
                raise ApiError(422, 'invalid', "privacy_visibility must be 'employees' or 'followers'", field=key)
            vals[key] = value
        elif key in ('date_start', 'date'):
            vals[key] = parse_date(value, key)
        elif key == 'tag_ids':
            if not isinstance(value, list) or not all(isinstance(i, int) for i in value):
                raise ApiError(422, 'invalid', "tag_ids must be a list of ids", field=key)
            vals[key] = [(6, 0, value)]
    return vals
```

- [ ] **Step 4: Controller** — replace `controllers/projects.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project import dump_project, dump_project_detail, parse_project_vals

MAX_PROJECTS = 200


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_projects(self, **_):
        args = request.httprequest.args
        unknown = set(args) - {'minimal', 'archived'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        Project = request.env['project.project']
        archived = args.get('archived') in ('1', 'true')
        if archived and not Project._nasq_is_manager():
            raise AccessError(request.env._("Only a project manager can list archived projects."))
        domain = [('active', '=', False)] if archived else []
        projects = Project.with_context(active_test=not archived).search(domain, order='name, id', limit=MAX_PROJECTS)
        if args.get('minimal') in ('1', 'true'):
            return [{'id': p.id, 'name': p.name} for p in projects]
        return {'items': [dump_project(p) for p in projects], 'can_create': Project._nasq_can_create()}

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_project(self, name=None, **_):
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        try:
            project = request.env['project.project']._nasq_create_from_policy(name.strip())
        except AccessError as e:
            raise ApiError(403, 'create_forbidden', str(e)) from e
        return request.make_json_response(dump_project_detail(project), status=201)

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_project(self, project_id):
        return dump_project_detail(get_record('project.project', project_id))

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_project(self, project_id, **payload):
        payload.pop('project_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        project = get_record('project.project', project_id)
        project._nasq_check_manage()
        project.write(parse_project_vals(payload))
        return dump_project_detail(project)

    @http.route('/api/v1/projects/<int:project_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def archive_project(self, project_id, **_):
        project = get_record('project.project', project_id)
        return dump_project_detail(project._nasq_archive())

    @http.route('/api/v1/projects/<int:project_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def unarchive_project(self, project_id, **_):
        project = request.env['project.project'].with_context(active_test=False).browse(int(project_id)).exists()
        if not project:
            raise ApiError(404, 'not_found', "project not found")
        project.check_access('read')
        return dump_project_detail(project._nasq_unarchive())

    @http.route('/api/v1/projects/<int:project_id>/status', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def set_status(self, project_id, status=None, **_):
        if not isinstance(status, str) or status not in STATUS_VALUES:
            raise ApiError(422, 'invalid_status', f"status must be one of {sorted(STATUS_VALUES)}", field='status')
        project = get_record('project.project', project_id)
        try:
            project._nasq_set_status(status)
        except AccessError as e:
            raise ApiError(403, 'status_forbidden', str(e)) from e
        return dump_project_detail(project)
```
`get_record` on an archived project: `browse().exists()` is true for archived records, so `GET /projects/<archived id>` still works for the unarchive path; `dump_project` reports `active: false`.

- [ ] **Step 5: Run** — `TestProjects` green; `/nasq_pmo` green; `test_personal_stages.py::test_projects_minimal` still passes (minimal shape unchanged). ruff clean.
- [ ] **Step 6: Commit** — `-- odoo-addons/nasq_pmo/serializers/project.py odoo-addons/nasq_pmo/controllers/projects.py odoo-addons/nasq_pmo/tests/test_projects.py`, message `[IMP] nasq_pmo: projects list shape, create by policy, patch, archive`.

---

### Task 6: Stages and followers controllers

**Files:** `controllers/project_stages.py`, `controllers/project_followers.py`, `tests/test_project_stages.py`, `tests/test_project_followers.py` (stubs → real)

**Interfaces:**
- `POST /api/v1/projects/<id>/stages {name, fold?}` → stage (201); `PATCH …/stages/<sid> {name?, fold?}` → stage; `PUT …/stages/order {ids}` → `ProjectStage[]` (422 `invalid` field `ids` when not a permutation); `DELETE …/stages/<sid>` → 204 empty body; 422 `stage_not_empty` with `{code, message, field: null?}` — put the count in the message and add `'count'` to the body via `request.make_json_response({'code': 'stage_not_empty', 'message': ..., 'count': n}, status=422)` (the contract error schema allows extra keys? It is `.strict()` with `field` optional — extend `ApiErrorSchema` in Task 2? **Decision:** encode the count in `message` only: "This stage still holds 3 tasks." and keep the standard error shape; the UI disables deletion up front using `stage.task_count`, so the message is a fallback). All 403 `forbidden` unless `can_manage`.
- `GET /api/v1/projects/<id>/followers` → `[{id, name}]` (user ids); `POST …/followers {user_id}` → list; `DELETE …/followers/<uid>` → list. 422 `invalid` field `user_id` for a non-user.

- [ ] **Step 1: Failing tests** — `test_project_stages.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

STAGE_KEYS = {'id', 'name', 'sequence', 'fold', 'task_count'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjectStages(NasqPmoCase):

    def _url(self, suffix=''):
        return f'/api/v1/projects/{self.project.id}/stages{suffix}'

    def test_employee_forbidden(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', self._url(), {'name': 'X'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_lifecycle(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        a = self.api('POST', self._url(), {'name': 'A'})
        self.assertEqual(a.status_code, 201)
        self.assertEqual(set(a.json()), STAGE_KEYS)
        b = self.api('POST', self._url(), {'name': 'B', 'fold': True}).json()
        self.assertTrue(b['fold'])
        ids = [s['id'] for s in self.api('GET', f'/api/v1/projects/{self.project.id}').json()['stages']]
        self.assertEqual(ids[-2:], [a.json()['id'], b['id']])
        res = self.api('PUT', self._url('/order'), {'ids': list(reversed(ids))})
        self.assertEqual(res.status_code, 200)
        self.assertEqual([s['id'] for s in res.json()], list(reversed(ids)))
        res = self.api('PUT', self._url('/order'), {'ids': ids[:1]})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'ids'))
        res = self.api('PATCH', self._url(f"/{a.json()['id']}"), {'name': 'A2', 'fold': True})
        self.assertEqual((res.json()['name'], res.json()['fold']), ('A2', True))
        self.assertEqual(self.api('POST', self._url(), {'name': ''}).status_code, 422)

    def test_delete_rules(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        s = self.api('POST', self._url(), {'name': 'S'}).json()
        self.env['project.task'].create({'name': 't', 'project_id': self.project.id, 'stage_id': s['id']})
        res = self.api('DELETE', self._url(f"/{s['id']}"))
        self.assertEqual((res.status_code, res.json()['code']), (422, 'stage_not_empty'))
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['stages'][-1]['task_count'], 1)
        empty = self.api('POST', self._url(), {'name': 'E'}).json()
        res = self.api('DELETE', self._url(f"/{empty['id']}"))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(self.env['project.task.type'].browse(empty['id']).exists())
        other = self.env['project.project'].create({'name': 'O'})
        foreign = self.env['project.task.type'].create({'name': 'F', 'project_ids': [(4, other.id)]})
        self.assertEqual(self.api('DELETE', self._url(f'/{foreign.id}')).status_code, 422)
```
`test_project_followers.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestProjectFollowers(NasqPmoCase):

    def test_followers_and_visibility(self):
        url = f'/api/v1/projects/{self.project.id}/followers'
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'privacy_visibility': 'followers'})
        before = {u['id'] for u in self.api('GET', url).json()}
        self.assertNotIn(self.employee.id, before)
        # employee (assigned to a task but not a follower) cannot open the project
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', url, {'user_id': self.employee.id})
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.employee.id, {u['id'] for u in res.json()})
        self.assertEqual(set(res.json()[0]), {'id', 'name'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').status_code, 200)
        self.assertEqual(self.api('POST', url, {'user_id': self.manager.id}).status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('DELETE', f'{url}/{self.employee.id}')
        self.assertNotIn(self.employee.id, {u['id'] for u in res.json()})
        self.assertEqual(self.api('POST', url, {'user_id': 999999}).status_code, 422)
```

- [ ] **Step 2: Run to fail** — `-d nasq_p3_t6 --http-port=8176`.

- [ ] **Step 3: Implement**

`controllers/project_stages.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.serializers.project import dump_stage


def _stage_of(project, stage_id):
    stage = request.env['project.task.type'].browse(int(stage_id)).exists()
    if not stage or stage not in project.type_ids:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stages", field='stage_id')
    return stage


def _parse_stage_body(name=None, fold=None, require_name=True):
    vals = {}
    if name is not None or require_name:
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        vals['name'] = name.strip()
    if fold is not None:
        if not isinstance(fold, bool):
            raise ApiError(422, 'invalid', "fold must be a boolean", field='fold')
        vals['fold'] = fold
    return vals


class ProjectStageController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/stages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def add_stage(self, project_id, name=None, fold=None, **_):
        project = get_record('project.project', project_id)
        vals = _parse_stage_body(name, fold)
        stage = project._nasq_add_stage(vals['name'], vals.get('fold', False))
        return request.make_json_response(dump_stage(project, stage), status=201)

    @http.route('/api/v1/projects/<int:project_id>/stages/<int:stage_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_stage(self, project_id, stage_id, name=None, fold=None, **_):
        project = get_record('project.project', project_id)
        stage = _stage_of(project, stage_id)
        vals = _parse_stage_body(name, fold, require_name=False)
        if not vals:
            raise ApiError(422, 'invalid', "no fields to update")
        return dump_stage(project, project._nasq_update_stage(stage, vals))

    @http.route('/api/v1/projects/<int:project_id>/stages/order', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    def reorder_stages(self, project_id, ids=None, **_):
        project = get_record('project.project', project_id)
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise ApiError(422, 'invalid', "ids must be a list of stage ids", field='ids')
        try:
            stages = project._nasq_reorder_stages(ids)
        except ValueError as e:
            raise ApiError(422, 'invalid', str(e), field='ids') from e
        return [dump_stage(project, s) for s in stages]

    @http.route('/api/v1/projects/<int:project_id>/stages/<int:stage_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def delete_stage(self, project_id, stage_id, **_):
        project = get_record('project.project', project_id)
        stage = _stage_of(project, stage_id)
        try:
            project._nasq_delete_stage(stage)
        except UserError as e:
            count = getattr(e, 'nasq_count', None)
            if count is None:
                raise
            raise ApiError(422, 'stage_not_empty', f"This stage still holds {count} task(s).") from e
        return request.make_json_response('', status=204)
```
Check `api_handler`: it maps `UserError` to 422 `invalid` generically; the explicit branch above must run first (it does — the `except UserError` is inside the handler body). Route ordering: Werkzeug matches `/stages/order` (PUT) and `/stages/<int>` (PATCH/DELETE) by method + converter, no conflict.

`controllers/project_followers.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record


def _dump_users(users):
    return [{'id': u.id, 'name': u.name} for u in users.sorted('name')]


def _user(value):
    user = request.env['res.users'].browse(int(value)).exists() if isinstance(value, int) else None
    if not user or user.share or not user.active:
        raise ApiError(422, 'invalid', "user_id must be an active internal user", field='user_id')
    return user


class ProjectFollowerController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/followers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_followers(self, project_id):
        return _dump_users(get_record('project.project', project_id)._nasq_followers())

    @http.route('/api/v1/projects/<int:project_id>/followers', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def add_follower(self, project_id, user_id=None, **_):
        project = get_record('project.project', project_id)
        return _dump_users(project._nasq_add_follower(_user(user_id)))

    @http.route('/api/v1/projects/<int:project_id>/followers/<int:user_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def remove_follower(self, project_id, user_id, **_):
        project = get_record('project.project', project_id)
        return _dump_users(project._nasq_remove_follower(_user(user_id)))
```
Note `AccessError` from `_nasq_check_manage` → 403 `forbidden` via `api_handler`.

- [ ] **Step 4: Run** — both classes green; `/nasq_pmo` green; ruff clean.
- [ ] **Step 5: Commit** — `-- odoo-addons/nasq_pmo/controllers/project_stages.py odoo-addons/nasq_pmo/controllers/project_followers.py odoo-addons/nasq_pmo/tests/test_project_stages.py odoo-addons/nasq_pmo/tests/test_project_followers.py`, message `[ADD] nasq_pmo: project stages and followers endpoints`.

---

### Task 7: Milestones and project updates

**Files:** `serializers/milestone.py`, `serializers/project_update.py`, `controllers/milestones.py`, `controllers/project_updates.py`, `tests/test_milestones.py`, `tests/test_project_updates.py`

**Interfaces:**
- `dump_milestone(project, m)` → `{id, name, deadline, is_reached, reached_date, task_count, done_task_count}`; `dump_update(u)` → `{id, name, status, description_html, date, author: {id, name}}`.
- `GET /api/v1/projects/<id>/milestones` → list (deadline asc nulls last, then id); `POST {name, deadline?}` 201; `PATCH …/<mid> {name?, deadline?, is_reached?}`; `DELETE …/<mid>` 204 / 422 `milestone_has_tasks`. Readers: anyone who can read the project; writers: `can_manage` (403 `forbidden`).
- `GET /api/v1/projects/<id>/updates` → newest first, limit 50; `POST {status, name, description?}` 201 (403 `status_forbidden`, 422 `invalid_status`/`invalid` name).

- [ ] **Step 1: Failing tests** — `test_milestones.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

KEYS = {'id', 'name', 'deadline', 'is_reached', 'reached_date', 'task_count', 'done_task_count'}


@tagged('post_install', '-at_install', 'nasq')
class TestMilestones(NasqPmoCase):

    def test_crud_and_rules(self):
        url = f'/api/v1/projects/{self.project.id}/milestones'
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', url).json(), [])
        self.assertEqual(self.api('POST', url, {'name': 'M'}).status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', url, {'name': 'M1', 'deadline': '2030-02-01'})
        self.assertEqual(res.status_code, 201)
        m1 = res.json()
        self.assertEqual(set(m1), KEYS)
        self.assertEqual((m1['deadline'], m1['is_reached'], m1['task_count']), ('2030-02-01', False, 0))
        m0 = self.api('POST', url, {'name': 'M0', 'deadline': '2030-01-01'}).json()
        mx = self.api('POST', url, {'name': 'MX'}).json()
        self.assertEqual([m['name'] for m in self.api('GET', url).json()], ['M0', 'M1', 'MX'])
        self.assertEqual(self.api('POST', url, {'name': 'bad', 'deadline': 'x'}).status_code, 422)
        self.env['project.task'].create({'name': 't', 'project_id': self.project.id, 'milestone_id': m1['id'], 'state': '1_done'})
        got = next(m for m in self.api('GET', url).json() if m['id'] == m1['id'])
        self.assertEqual((got['task_count'], got['done_task_count']), (1, 1))
        res = self.api('PATCH', f"{url}/{m1['id']}", {'is_reached': True, 'name': 'M1r', 'deadline': None})
        self.assertEqual((res.json()['is_reached'], res.json()['name'], res.json()['deadline']), (True, 'M1r', None))
        self.assertIsNotNone(res.json()['reached_date'])
        res = self.api('DELETE', f"{url}/{m1['id']}")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'milestone_has_tasks'))
        self.assertEqual(self.api('DELETE', f"{url}/{m0['id']}").status_code, 204)
        self.assertEqual(self.api('DELETE', f"{url}/{mx['id']}").status_code, 204)
        other = self.env['project.project'].create({'name': 'O'})
        foreign = self.env['project.milestone'].create({'name': 'F', 'project_id': other.id})
        self.assertEqual(self.api('PATCH', f'{url}/{foreign.id}', {'name': 'x'}).status_code, 422)
```
`test_project_updates.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

KEYS = {'id', 'name', 'status', 'description_html', 'date', 'author'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjectUpdates(NasqPmoCase):

    def test_post_and_list(self):
        url = f'/api/v1/projects/{self.project.id}/updates'
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', url, {'status': 'on_track', 'name': 'x'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'status_forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', url, {'status': 'at_risk', 'name': 'Week 1', 'description': '<p>late</p>'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(set(res.json()), KEYS)
        self.assertEqual(res.json()['author']['id'], self.manager.id)
        self.api('POST', url, {'status': 'on_track', 'name': 'Week 2'})
        items = self.api('GET', url).json()
        self.assertEqual([u['name'] for u in items], ['Week 2', 'Week 1'])
        self.assertEqual(items[1]['description_html'], '<p>late</p>')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['status'], 'on_track')
        self.assertEqual(self.api('POST', url, {'status': 'to_define', 'name': 'x'}).status_code, 422)
        self.assertEqual(self.api('POST', url, {'status': 'done', 'name': ' '}).status_code, 422)
        # the phase-2 quick status still works and lands in the list
        self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'on_hold'})
        self.assertEqual(self.api('GET', url).json()[0]['status'], 'on_hold')
```

- [ ] **Step 2: Run to fail** — `-d nasq_p3_t7 --http-port=8177`.

- [ ] **Step 3: Implement**

`serializers/milestone.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


def _date(value):
    return fields.Date.to_string(value) if value else None


def dump_milestone(project, milestone):
    total, done = project._nasq_milestone_task_counts(milestone)
    return {
        'id': milestone.id, 'name': milestone.name, 'deadline': _date(milestone.deadline),
        'is_reached': milestone.is_reached, 'reached_date': _date(milestone.reached_date),
        'task_count': total, 'done_task_count': done,
    }
```
`serializers/project_update.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.nasq_pmo.serializers.project import STATUS_TO_API


def dump_update(update):
    return {
        'id': update.id, 'name': update.name, 'status': STATUS_TO_API.get(update.status) or 'on_track',
        'description_html': update.description or '', 'date': fields.Date.to_string(update.date),
        'author': {'id': update.user_id.id, 'name': update.user_id.name},
    }
```
`controllers/milestones.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.serializers.dates import parse_date
from odoo.addons.nasq_pmo.serializers.milestone import dump_milestone


def _milestone_of(project, mid):
    m = request.env['project.milestone'].browse(int(mid)).exists()
    if not m or m.project_id != project:
        raise ApiError(422, 'invalid', "milestone must belong to this project", field='milestone_id')
    return m


def _sorted(milestones):
    return milestones.sorted(lambda m: (m.deadline is False, m.deadline or '', m.id))


class MilestoneController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/milestones', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_milestones(self, project_id):
        project = get_record('project.project', project_id)
        return [dump_milestone(project, m) for m in _sorted(project.milestone_ids)]

    @http.route('/api/v1/projects/<int:project_id>/milestones', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_milestone(self, project_id, name=None, deadline=None, **_):
        project = get_record('project.project', project_id)
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        day = parse_date(deadline, 'deadline')
        m = project._nasq_create_milestone(name.strip(), deadline=day or None)
        return request.make_json_response(dump_milestone(project, m), status=201)

    @http.route('/api/v1/projects/<int:project_id>/milestones/<int:mid>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_milestone(self, project_id, mid, **payload):
        payload.pop('project_id', None)
        payload.pop('mid', None)
        project = get_record('project.project', project_id)
        m = _milestone_of(project, mid)
        vals = {}
        for key, value in payload.items():
            if key == 'name':
                if not isinstance(value, str) or not value.strip():
                    raise ApiError(422, 'invalid', "name must not be empty", field=key)
                vals[key] = value.strip()
            elif key == 'deadline':
                vals[key] = parse_date(value, key)
            elif key == 'is_reached':
                if not isinstance(value, bool):
                    raise ApiError(422, 'invalid', "is_reached must be a boolean", field=key)
                vals[key] = value
            else:
                raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if not vals:
            raise ApiError(422, 'invalid', "no fields to update")
        return dump_milestone(project, project._nasq_update_milestone(m, vals))

    @http.route('/api/v1/projects/<int:project_id>/milestones/<int:mid>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def delete_milestone(self, project_id, mid, **_):
        project = get_record('project.project', project_id)
        m = _milestone_of(project, mid)
        try:
            project._nasq_delete_milestone(m)
        except UserError as e:
            count = getattr(e, 'nasq_count', None)
            if count is None:
                raise
            raise ApiError(422, 'milestone_has_tasks', f"{count} task(s) are linked to this milestone.") from e
        return request.make_json_response('', status=204)
```
Note on `_nasq_update_milestone`: it receives `deadline` already parsed to a date/False; adjust the model's `fields.Date.to_date(vals['deadline'])` to accept a date object too (it does: `to_date` returns a date unchanged). `reached_date` is computed by Odoo when `is_reached` flips.

`controllers/project_updates.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project_update import dump_update

MAX_UPDATES = 50


class ProjectUpdateController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/updates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_updates(self, project_id):
        project = get_record('project.project', project_id)
        updates = request.env['project.update'].search([('project_id', '=', project.id)], order='date desc, id desc', limit=MAX_UPDATES)
        return [dump_update(u) for u in updates]

    @http.route('/api/v1/projects/<int:project_id>/updates', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_update(self, project_id, status=None, name=None, description=None, **_):
        if not isinstance(status, str) or status not in STATUS_VALUES:
            raise ApiError(422, 'invalid_status', f"status must be one of {sorted(STATUS_VALUES)}", field='status')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        project = get_record('project.project', project_id)
        try:
            update = project._nasq_post_update(status, name.strip(), description if isinstance(description, str) else '')
        except AccessError as e:
            raise ApiError(403, 'status_forbidden', str(e)) from e
        return request.make_json_response(dump_update(update), status=201)
```

- [ ] **Step 4: Run** — green; ruff clean.
- [ ] **Step 5: Commit** — `-- odoo-addons/nasq_pmo/serializers/milestone.py odoo-addons/nasq_pmo/serializers/project_update.py odoo-addons/nasq_pmo/controllers/milestones.py odoo-addons/nasq_pmo/controllers/project_updates.py odoo-addons/nasq_pmo/tests/test_milestones.py odoo-addons/nasq_pmo/tests/test_project_updates.py`, message `[ADD] nasq_pmo: milestones and project updates endpoints`.

---

### Task 8: Settings endpoint

**Files:** `controllers/settings.py`, `tests/test_settings.py`

**Interfaces:** `GET /api/v1/settings/projects` → `ProjectSettings` (admin only, 403 `forbidden`); `PATCH` body `{project_creators?, default_stages?}` → `ProjectSettings`; 422 `invalid` with `field` from the model's `ValueError.nasq_field`.

- [ ] **Step 1: Failing test**
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestSettings(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(cls.env, login='api_admin', password='api_admin_pass_123', groups='nasq_core.group_customer_admin')

    def test_admin_only(self):
        for login, pwd in (('api_emp', 'api_emp_pass_123'), ('api_mgr', 'api_mgr_pass_123')):
            self.authenticate(login, pwd)
            self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 403)
            self.assertEqual(self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'employees'}).status_code, 403)

    def test_get_and_patch(self):
        self.authenticate('api_admin', 'api_admin_pass_123')
        body = self.api('GET', '/api/v1/settings/projects').json()
        self.assertEqual(set(body), {'project_creators', 'default_stages'})
        self.assertEqual(body['project_creators'], 'managers')
        self.assertEqual(len(body['default_stages']), 4)
        res = self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'employees', 'default_stages': [{'name': 'Only', 'fold': False}]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'project_creators': 'employees', 'default_stages': [{'name': 'Only', 'fold': False}]})
        res = self.api('PATCH', '/api/v1/settings/projects', {'default_stages': []})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'default_stages'))
        res = self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'project_creators'))
        self.assertEqual(self.api('PATCH', '/api/v1/settings/projects', {'other': 1}).status_code, 422)
        # the new policy is live: the employee may now create
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertTrue(self.api('GET', '/api/v1/projects').json()['can_create'])
```
Note: `test_get_and_patch` relies on Task 5's list shape; if Task 5 has not landed yet in your tree, keep the assertion and expect that one line to fail until it does — say so in the report.

- [ ] **Step 2: Run to fail** — `-d nasq_p3_t8 --http-port=8178`.
- [ ] **Step 3: Implement** `controllers/settings.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler

ALLOWED = {'project_creators', 'default_stages'}


class SettingsController(http.Controller):

    @http.route('/api/v1/settings/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_project_settings(self):
        settings = request.env['nasq.pmo.settings']
        if not settings._can_edit():
            raise AccessError(request.env._("Only a customer administrator can read project policies."))
        return settings.get()

    @http.route('/api/v1/settings/projects', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_project_settings(self, **payload):
        unknown = set(payload) - ALLOWED
        if unknown:
            raise ApiError(422, 'unknown_field', f"field {sorted(unknown)[0]!r} is not writable", field=sorted(unknown)[0])
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        try:
            return request.env['nasq.pmo.settings'].set_values(payload)
        except ValueError as e:
            raise ApiError(422, 'invalid', str(e), field=getattr(e, 'nasq_field', None)) from e
```
- [ ] **Step 4: Run** — green; ruff clean.
- [ ] **Step 5: Commit** — `-- odoo-addons/nasq_pmo/controllers/settings.py odoo-addons/nasq_pmo/tests/test_settings.py`, `[ADD] nasq_pmo: /api/v1/settings/projects`.

---

### Task 9: Web data layer

**Files:**
- Create: `apps/web/app/composables/calendarDate.ts`, `stageOrder.ts`, `useProjectStages.ts`, `useProjectFollowers.ts`, `useMilestones.ts`, `useProjectUpdates.ts`, `useTags.ts`, `useProjectSettings.ts`, `__tests__/calendarDate.test.ts`, `__tests__/stageOrder.test.ts`
- Modify: `useProjects.ts`, `useTasks.ts`, `useNav.ts`, `__tests__/useTasks.optimistic.test.ts`, `__tests__/useNav.test.ts`, `apps/web/app/components/project/ProjectTable.vue` (only the two lines that read the list: `data.value?.items ?? []` and the capped check — to keep lint green; Task 13 rewrites the file anyway)

**Interfaces:**
- `calendarDate.ts`: `toCalendarDate(iso: string | null): CalendarDate | undefined`, `fromCalendarDate(d: CalendarDate | undefined): string | null` (`YYYY-MM-DD`), `formatCalendarDate(iso: string | null, locale: string): string` (Gregorian, `dateStyle: 'medium'`, '' for null).
- `stageOrder.ts`: `moveId(ids: number[], from: number, to: number): number[]` (pure reorder).
- `useProjects.ts`: `projectKeys` + `stages(id)`, `followers(id)`, `milestones(id)`, `updates(id)`; `useProjectList(archived: Ref<boolean>)` → `ProjectList` (`{items, can_create}`, key `['projects','list', archived]`); `useCreateProject()` (`{name}` → detail; onSuccess invalidates `['projects']`); `useUpdateProject()` (`{id, patch: ProjectPatch}`; optimistic for `name`/`description` on the detail cache, rollback on error, replace with the response); `useArchiveProject()`, `useUnarchiveProject()` (invalidate `['projects']`, set detail).
- `useProjectStages.ts`: `useAddStage()`, `useUpdateStage()`, `useReorderStages()`, `useDeleteStage()` — each takes `projectId` in variables and on success invalidates `projectKeys.detail(projectId)` (stages live on the detail).
- `useProjectFollowers.ts`: `useFollowers(projectId: Ref<number|null>)`, `useAddFollower()`, `useRemoveFollower()` (set the followers cache from the response, invalidate detail).
- `useMilestones.ts`: `useMilestones(projectId)`, `useCreateMilestone()`, `useUpdateMilestone()`, `useDeleteMilestone()`.
- `useProjectUpdates.ts`: `useProjectUpdates(projectId)`, `useCreateProjectUpdate()` (on success: set list, invalidate detail + `['projects']`).
- `useTags.ts`: `useTags(q: Ref<string>)`, `useCreateTag()` (invalidates `['tags']`).
- `useProjectSettings.ts`: `useProjectSettings()`, `useUpdateProjectSettings()`.
- `useTasks.ts`: `useArchiveTask()` (`{id}` → detail; on success invalidate `['tasks','list']`, `['projects']`, `['project']`), `Resolved.milestone?`, `applyPatchToTask` handles `milestone_id` + `resolved.milestone` (detail only).
- `useNav.ts`: `admin` and `vendor` get `{ to: '/settings/projects', labelKey: 'nav.settings', icon: Settings, shortcut: '6' }` after reports; vendor console stays last with shortcut `s`.

- [ ] **Step 1: Failing tests**

`calendarDate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fromCalendarDate, toCalendarDate } from '../calendarDate'
describe('calendarDate', () => {
  it('round-trips YYYY-MM-DD without timezone drift', () => {
    const d = toCalendarDate('2030-02-01')!
    expect([d.year, d.month, d.day]).toEqual([2030, 2, 1])
    expect(fromCalendarDate(d)).toBe('2030-02-01')
    expect(toCalendarDate(null)).toBeUndefined()
    expect(fromCalendarDate(undefined)).toBeNull()
  })
})
```
`stageOrder.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { moveId } from '../stageOrder'
describe('moveId', () => {
  it('moves an element and leaves the input untouched', () => {
    const ids = [1, 2, 3, 4]
    expect(moveId(ids, 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveId(ids, 3, 0)).toEqual([4, 1, 2, 3])
    expect(ids).toEqual([1, 2, 3, 4])
  })
})
```
`useNav.test.ts`: change the `admin` expectation to `[...PRODUCT_SECTIONS, 'nav.settings']` and vendor to `[...PRODUCT_SECTIONS, 'nav.settings', 'nav.console']`; employee unchanged. `useTasks.optimistic.test.ts`: add `milestone: null` to `baseDetail` and a test `applies milestone_id with the resolved milestone on a detail`.

- [ ] **Step 2: Run to fail** — `npm -w apps/web run test`.

- [ ] **Step 3: Implement** (code for the pure helpers and the two existing files; the new composables follow `useProjects.ts`'s exact pattern — `useApi()`, `useQuery`/`useMutation`, schemas from `@nasq/contracts`, keys as listed):

`calendarDate.ts`:
```ts
import { CalendarDate, parseDate } from '@internationalized/date'

// Calendar dates (project start/end, milestone deadline) are YYYY-MM-DD
// strings on the wire — not instants, unlike task deadlines. Never go through
// `new Date(...)`: that parses as UTC midnight and shifts the day in any
// timezone west of Greenwich.
export function toCalendarDate(iso: string | null): CalendarDate | undefined {
  if (!iso) return undefined
  try { return parseDate(iso.slice(0, 10)) } catch { return undefined }
}
export function fromCalendarDate(d: CalendarDate | undefined): string | null {
  return d ? d.toString() : null
}
export function formatCalendarDate(iso: string | null, locale: string): string {
  const d = toCalendarDate(iso)
  if (!d) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', calendar: 'gregory', timeZone: 'UTC' }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)))
}
```
`stageOrder.ts`:
```ts
export function moveId(ids: number[], from: number, to: number): number[] {
  const next = [...ids]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}
```
`useProjects.ts` — replace `useProjectList` and add:
```ts
export function useProjectList(archived: Ref<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...projectKeys.list, archived.value] as const),
    queryFn: () => $api('/api/v1/projects', { query: { archived: archived.value ? 1 : undefined }, schema: ProjectListSchema }),
  })
}
export function useCreateProject() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: (body: { name: string }) => $api('/api/v1/projects', { method: 'POST', body, schema: ProjectDetailSchema }),
    onSuccess: (detail) => { qc.setQueryData(projectKeys.detail(detail.id), detail); qc.invalidateQueries({ queryKey: projectKeys.all }) },
  })
}
export function useUpdateProject() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ProjectPatch }) => $api(`/api/v1/projects/${id}`, { method: 'PATCH', body: patch, schema: ProjectDetailSchema }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: projectKeys.detail(id) })
      const prev = qc.getQueryData<ProjectDetail>(projectKeys.detail(id))
      if (prev) qc.setQueryData(projectKeys.detail(id), { ...prev, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.description !== undefined ? { description_html: patch.description } : {}) })
      return { prev }
    },
    onError: (_e, { id }, ctx) => { if (ctx?.prev) qc.setQueryData(projectKeys.detail(id), ctx.prev) },
    onSuccess: (detail, { id }) => { qc.setQueryData(projectKeys.detail(id), detail); qc.invalidateQueries({ queryKey: projectKeys.all }) },
  })
}
function useProjectAction(path: 'archive' | 'unarchive') {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id }: { id: number }) => $api(`/api/v1/projects/${id}/${path}`, { method: 'POST', body: {}, schema: ProjectDetailSchema }),
    onSuccess: (detail, { id }) => { qc.setQueryData(projectKeys.detail(id), detail); qc.invalidateQueries({ queryKey: projectKeys.all }) },
  })
}
export const useArchiveProject = () => useProjectAction('archive')
export const useUnarchiveProject = () => useProjectAction('unarchive')
```
with `projectKeys` extended: `stages: (id) => ['project', id, 'stages']`, `followers: (id) => ['project', id, 'followers']`, `milestones: (id) => ['project', id, 'milestones']`, `updates: (id) => ['project', id, 'updates']`. Note `['project', id]` invalidation (prefix) also refreshes sub-resources — intended.

`useNav.ts`:
```ts
const settings: NavItem = { to: '/settings/projects', labelKey: 'nav.settings', icon: Settings, shortcut: '6' }
const vendorConsole: NavItem = { to: '/odoo', labelKey: 'nav.console', icon: Wrench, shortcut: 's' }
export function useNav(role: Role | null | undefined): NavItem[] {
  if (role === 'vendor') return [...base, settings, vendorConsole]
  if (role === 'admin') return [...base, settings]
  return base
}
```
(`Wrench` from lucide for the console so the two icons differ.) The remaining composables: write them with one mutation per endpoint exactly as listed in Interfaces, each `mutationFn` calling `$api` with `method`, `body` and the matching schema (`ProjectStageSchema`, `ProjectStageSchema.array()`, `UserRefSchema.array()`, `MilestoneSchema`, `ProjectUpdateSchema`, `TagSchema`, `ProjectSettingsSchema`); DELETE calls use `schema: z.undefined()`? — `$api` expects JSON; check `useApi.ts` for how a 204 is handled and add `{ expectEmpty: true }` support only if it does not already exist (read the file first; if a 204 already resolves to `undefined`, pass no schema).

- [ ] **Step 4: Run** — `npm -w apps/web run test` green; `npm -w apps/web run lint` clean (ProjectTable's two lines updated).
- [ ] **Step 5: Commit** — `-- apps/web/app/composables apps/web/app/components/project/ProjectTable.vue`, `[ADD] web: phase-3a data layer (projects admin, stages, followers, milestones, updates, tags, settings, nav)`.

---

### Task 10: Project settings dialog

**Files:** `apps/web/app/components/project/ProjectSettingsDialog.vue`, `ProjectGeneralForm.vue`, `StageListEditor.vue`, `FollowerList.vue`; shadcn `tooltip` exists, add `radio-group` and `alert-dialog` via the CLI (`npx shadcn-vue@latest add radio-group alert-dialog` with the npmrc workaround; import them explicitly from `@/components/ui/radio-group` / `@/components/ui/alert-dialog` — no Nuxt restart during the wave).

**Interfaces:**
- `ProjectSettingsDialog {open: boolean; project: ProjectDetail}` emits `update:open`; hosts three tabs.
- `ProjectGeneralForm {project: ProjectDetail}` — autosaves via `useUpdateProject`: name (blur/Enter), description (Tiptap `DescriptionEditor` reused: it needs `taskId` — pass `project.id`; its emitted `{html}` goes to `patch.description`), manager (`AssigneePicker`-like single select built on `usePeople`: a Popover + Command list, "بلا مدير" option → `user_id: null`), visibility (Select), dates (Popover + Calendar, `calendarDate.ts`), tags (`TagPicker` from Task 12 — to avoid a cross-task dependency, T10 renders tags as read-only badges and T14 swaps in `TagPicker`).
- `StageListEditor {stages: {id: number|string; name: string; fold: boolean; task_count?: number}[]; busy?: boolean}` emits `add: [name]`, `rename: [id, name]`, `fold: [id, fold]`, `reorder: [ids]`, `delete: [id]`. Presentational; drag via `VueDraggable` on a local copy; inline rename on double-click/Enter; delete button disabled with `Tooltip` text `projects.stages.notEmpty` when `task_count > 0`; add row with Input + Enter.
- `FollowerList {project: ProjectDetail}` — `useFollowers`, add via people picker (Popover+Command like `AssigneePicker`), remove icon; hint text when visibility is `followers`.

- [ ] Steps: write the four components (Vue SFC, `<script setup lang="ts">`, all strings via `t()`, `:disabled="!hydrated"` on triggers, logical properties). Wire the stage editor in the dialog: `@add` → `useAddStage`, `@rename` → `useUpdateStage`, `@fold` → `useUpdateStage`, `@reorder` → `useReorderStages`, `@delete` → `useDeleteStage` with `toast.error(e.message)` on `ApiError`. Verify `npm -w apps/web run lint` clean and mount-check via the Browser: temporarily nothing renders it until Task 14 — so lint is the gate here, plus a Vitest smoke test for `StageListEditor` using `@vue/test-utils` if it is installed (check `apps/web/package.json`; if absent, skip and say so).
- [ ] Commit — `-- apps/web/app/components/project/ProjectSettingsDialog.vue apps/web/app/components/project/ProjectGeneralForm.vue apps/web/app/components/project/StageListEditor.vue apps/web/app/components/project/FollowerList.vue apps/web/app/components/ui/radio-group apps/web/app/components/ui/alert-dialog`, `[ADD] web: project settings dialog (general, stages, followers)`.

---

### Task 11: Milestones and updates components

**Files:** `apps/web/app/components/project/MilestoneTable.vue`, `MilestoneDialog.vue`, `ProjectUpdateList.vue`, `ProjectUpdateDialog.vue`

**Interfaces:**
- `MilestoneTable {projectId: number; canManage: boolean}` — `useMilestones`; columns name · deadline (`formatCalendarDate`, tone `destructive` when past and not reached) · tasks (`projects.milestones.tasksOf`) · state badge; row `⋯` (managers): edit (opens `MilestoneDialog` in edit mode), mark reached / reopen (`useUpdateMilestone`), delete (disabled with tooltip when `task_count > 0`; `AlertDialog` confirm). Primary action **معلم جديد** (managers) emits nothing — the table owns the dialog. Empty state `projects.milestones.empty`. `data-testid="milestone-row"`.
- `MilestoneDialog {open; projectId; milestone?: Milestone}` — name + Calendar deadline; create or patch.
- `ProjectUpdateList {projectId: number; canManage: boolean}` — `useProjectUpdates`; cards with `ProjectStatusBadge`, title, `projects.updates.by`, date, `v-html` body sanitised with `app/utils/sanitize.ts` (read it; same as comments). Primary action **تحديث جديد** (managers) → `ProjectUpdateDialog`. `data-testid="project-update"`.
- `ProjectUpdateDialog {open; projectId}` — status Select (`PROJECT_STATUSES`), title Input, `DescriptionEditor` (pass `taskId: projectId`), submit → `useCreateProjectUpdate`; toast on success.

- [ ] Steps: implement; lint clean; commit `-- apps/web/app/components/project/MilestoneTable.vue apps/web/app/components/project/MilestoneDialog.vue apps/web/app/components/project/ProjectUpdateList.vue apps/web/app/components/project/ProjectUpdateDialog.vue`, `[ADD] web: milestones and project updates components`.

---

### Task 12: Task modal — tags, milestone, archive

**Files:** `apps/web/app/components/task/TagPicker.vue`, `MilestoneSelect.vue`, `TaskDetails.vue`, `TaskDetailPanel.vue`

**Interfaces:**
- `TagPicker {modelValue: Tag[]; canCreate: boolean}` emits `update:modelValue: [{ ids: number[]; resolved: Tag[] }]` — Popover + Command over `useTags(q)`; when `canCreate` and `q` matches no tag, a `CommandItem` `tasks.drawer.createTag` calls `useCreateTag` then selects it.
- `MilestoneSelect {task: TaskDetail}` — `useMilestones(task.project.id)`; Select with `tasks.drawer.noMilestone`; patch `{ milestone_id }` with `resolved.milestone`.
- `TaskDetails.vue`: replace the read-only tags section with `TagPicker` (`:can-create="task.can_approve"`, `@update:modelValue` → `patch({ tag_ids: ids }, { tags: resolved })`); add the milestone select next to the personal stage (only when `task.project`).
- `TaskDetailPanel.vue`: a `⋯` `DropdownMenu` in the header (before the close button) with **أرشفة المهمة** (`AlertDialog` confirm → `useArchiveTask`; on success `emit('close')` + toast). Shown always; the server decides (403 → toast).

- [ ] Steps: implement; `npm -w apps/web run lint`; `npm -w apps/web run test:e2e -- e2e/detail.spec.ts e2e/activity.spec.ts` still green; commit `-- apps/web/app/components/task/TagPicker.vue apps/web/app/components/task/MilestoneSelect.vue apps/web/app/components/task/TaskDetails.vue apps/web/app/components/task/TaskDetailPanel.vue`, `[IMP] web: task modal gains tag picker, milestone select, archive`.

---

### Task 13: Create project, archived filter, row menu

**Files:** `apps/web/app/components/project/CreateProjectDialog.vue`, `ProjectMenu.vue`, `ProjectTable.vue`

**Interfaces:**
- `CreateProjectDialog {open}` emits `update:open`, `created: [id]` — name Input, `useCreateProject`, `ApiError` message shown (403 `create_forbidden` → `projects.createForbidden`).
- `ProjectMenu {project: Project | ProjectDetail}` — `⋯` DropdownMenu: **إعدادات المشروع** (emits `settings`), **أرشفة المشروع** / **إلغاء الأرشفة** depending on `project.active` (`AlertDialog` confirm for archive; `useArchiveProject`/`useUnarchiveProject`; emits `archived`). Rendered only when `project.can_manage`.
- `ProjectTable {archived: boolean}` emits `open`, `create` — `useProjectList(archived)`; header row with the **مشروع جديد** button when `data.can_create` (primary action of `/projects`; hidden when false); a fourth column with `ProjectMenu` (settings hidden in the table — `hide-settings` prop; only archive/unarchive); empty states `projects.empty` / `projects.archivedEmpty`; the filter chips live in the page (Task 14), not here.

- [ ] Steps: implement; lint; commit `-- apps/web/app/components/project/CreateProjectDialog.vue apps/web/app/components/project/ProjectMenu.vue apps/web/app/components/project/ProjectTable.vue`, `[ADD] web: create project, archived filter table, project row menu`.

---

### Task 14: Pages and header

**Files:** `apps/web/app/pages/projects/index.vue`, `pages/projects/[id].vue`, `pages/settings/projects.vue` (new), `app/components/project/ProjectHeader.vue`, `app/components/settings/ProjectSettingsForm.vue` (new)

- [ ] `index.vue`: filter `Tabs` النشطة / المؤرشفة (`?archived=1`, chips shown only when the list says any item `can_manage` or the user role is admin/vendor — simpler: show for role `admin`/`vendor` and for any user whose list contains a `can_manage` project), `ProjectTable :archived`, `CreateProjectDialog` (`@created` → `/projects/{id}`).
- [ ] `ProjectHeader.vue`: replace the create Button with a group: create Button (primary) + `ProjectMenu` (`@settings` → emit `settings`, `@archived` → emit `archived`).
- [ ] `[id].vue`: `?tab=list|board|milestones|updates`; mount `ProjectSettingsDialog` (`v-model:open`), `@archived` → `router.push('/projects')` + toast; `MilestoneTable`/`ProjectUpdateList` in their tabs with `:can-manage="project.can_manage"`. Swap `ProjectGeneralForm`'s read-only tags for `TagPicker` (pass `:can-create="project.can_manage"`).
- [ ] `settings/projects.vue`: `useMe()` role gate → `settings.forbidden` empty state for `employee`; `ProjectSettingsForm` (RadioGroup for `project_creators`, `StageListEditor` over a local copy of `default_stages` with synthetic ids, every change → `useUpdateProjectSettings` with the full list; toast `settings.projects.saved`). Page title `settings.title` › `settings.projects.title`.
- [ ] Verify: lint; dev DB updated (`-u nasq_pmo`), Nuxt restarted (new `ui/*` dirs), hand-check in the Browser: create a project, open settings, add/reorder/delete a stage, add a milestone, post an update, archive a task, `/settings/projects` as admin; screenshots described in the report.
- [ ] Commit `-- apps/web/app/pages/projects apps/web/app/pages/settings apps/web/app/components/project/ProjectHeader.vue apps/web/app/components/settings`, `[ADD] web: project admin pages — header menu, tabs, create/archive, settings › projects`.

---

### Task 15: e2e

**Files:** `apps/web/e2e/contracts.spec.ts` (+ project admin round trips), `apps/web/e2e/project-admin.spec.ts` (new), `apps/web/e2e/projects.spec.ts` (list shape)

- [ ] Contract e2e: `POST /projects`, `PATCH`, stages add/order/delete, followers, milestones, updates, tags, settings GET/PATCH (as admin), each parsed with its schema; `GET /projects` now `ProjectListSchema`.
- [ ] Screens (each creating its own project through `POST /api/v1/projects` now — replace the `call_kw` fixture in `projects.spec.ts` with the API, keeping stages by patching `/settings/projects` once at the start of the file to the four defaults): create from the table → lands on `/projects/{id}` with the default stage columns; settings dialog rename + visibility followers + add follower; add a stage → board shows it; reorder → columns follow; delete empty stage; delete non-empty stage is disabled; milestone create → link from task modal → count 1; post an update → header badge; archive a task → gone from قائمة; archive the project → `/projects` → المؤرشفة shows it → unarchive; `/settings/projects` as admin changes default stages and the next project gets them; an employee user (create via `call_kw` `res.users` with `nasq_core.group_employee`, or reuse `api_emp` if the dev DB has it — create one named `e2e_emp` once, idempotently) sees no "مشروع جديد" and no الإعدادات entry.
- [ ] Run full e2e → all passed (30 + new). Commit `-- apps/web/e2e`, `[ADD] web e2e: project administration`.

---

### Task 16: Docs and final gate

- [ ] `README.md` (API list, routes, settings page, archive semantics, the three `sudo()` cases), `CLAUDE.md` (new files, manager rule, settings model), `docs/parallel-work.md` (`settings.json` in the PMO column; `nav.settings` noted as the one `common.json` key), spec Status → Delivered, platform spec Phase 3 row → "3a delivered <date>; 3b–3e pending".
- [ ] Gate: Odoo fresh `-i` (expect 81 + new ≈ 100), ruff, contracts, web unit, vue-tsc, e2e. Paste every summary line.
- [ ] Commit `-- README.md CLAUDE.md docs`, `[IMP] docs: phase 3a delivered — project administration`.

---

## Self-review

- **Spec coverage:** policy + manage rule → T1/T5/T8; create with default stages → T1/T5/T13; settings dialog (general/stages/followers) → T5/T6/T10/T14; archive project/task → T1/T4/T5/T13/T12; stages CRUD/reorder/delete rule → T1/T6/T10; milestones + task link → T1/T7/T11/T12; updates → T1/T7/T11; tags picker + create → T4/T12; `/settings/projects` + nav → T3/T8/T9/T14; contracts → T2; i18n → T3; tests → each Odoo task, T2, T9, T15; docs → T16. Spec's "unarchive task via vendor console" needs no task.
- **Placeholders:** T10/T11/T13/T14 describe components by interface + behaviour rather than full SFC listings (they are UI compositions of already-shipped patterns: `AssigneePicker`, `TaskTable`, `ProjectStatusSelect`, phase-2 dialogs); every prop, emit, key and composable they use is named exactly. No TBDs.
- **Type consistency:** `_nasq_check_manage` (T1) used by T5/T6/T7; `parse_date` lives in `serializers/dates.py` (T1) and is imported by both T5 and T7, so the two stay independent. `dump_stage(project, stage)` signature (T5) used by T6. `STATUS_TO_API` (T5, unchanged name) used by T7. `UserRefSchema` (T2) used by T9. `ProjectListSchema` (T2) used by T9/T13/T15. `moveId` (T9) used by T10. `useNav` shortcut `6` unique.
