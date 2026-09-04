# nasq Phase 1 — My Tasks & Task Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the employee's daily screen — **مهامي** as a table and a personal-stage board — plus the task drawer (details, Tiptap description, sub-tasks, dependencies, attachments, duration metrics, merged comment/tracking timeline), server-enforced state transitions, real-time updates over Odoo's bus, and the deferred phase-0 debt (vue-query, i18n, TOTP login step).

**Architecture:** Odoo stays the engine: `nasq_pmo` (new) owns transition hooks; `nasq_api` gains task/timeline/personal-stage/people/projects endpoints (`type='json2'`, `auth='user'`, serializer-whitelisted) and bus notifications to assignees' partner channels; `packages/contracts` mirrors every shape in zod. The Nuxt app gets a vue-query data layer with optimistic field edits and pending-confirm transitions, shadcn DataTable, a drag-and-drop board, a Tiptap editor inside a `Sheet` drawer, and a `useBus` websocket composable that invalidates queries.

**Tech Stack:** Odoo 19.0 CE (Python 3.12), Nuxt 4.5 / Vue 3.5 / TS, Tailwind v4, shadcn-vue, `@tanstack/vue-query` 5.102, `@tanstack/vue-table`, `@nuxtjs/i18n` 10.6, `@tiptap/vue-3` 3.31 (+ starter-kit, extension-link), `vue-draggable-plus` 0.6, zod 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-nasq-phase-1-my-tasks-design.md` (refines `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`)

## Global Constraints

- Branch `phase-1` in `/Users/tariq/code/nasq` (created from `main` @ `v0.1.0-phase0`). Odoo checkout `/Users/tariq/code/odoo` is never modified; never run `git` there.
- Odoo commands run from `/Users/tariq/code/odoo`, subcommand-first: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_test -u nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo --http-port=8169` (first install of a new addon uses `-i`). Timeout 300000 ms. Never use `odoo19` for tests; to load Python/data changes into the dev DB: `-d odoo19 -u <addon> --no-http --stop-after-init`.
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; manifests: `'license': 'LGPL-3'`, `'version': '19.0.1.0.0'`, `'author': 'Tariq Alwalidi'`. No OCA, no Enterprise dependencies. `ruff check odoo-addons` clean (repo `ruff.toml` = Odoo's).
- API routes: `@http.route('/api/v1/...', type='json2', auth='user', methods=[...], readonly=<bool>)`. Error body shape `{"code": "<snake_case>", "message": "<human>", "field"?: "<name>"}` with a real HTTP status. Never `type='http'` for JSON, never `auth='bearer'` for browser traffic.
- Task state names on the wire: `in_progress | changes_requested | approved | waiting | done | cancelled` ↔ Odoo `01_in_progress | 02_changes_requested | 03_approved | 04_waiting_normal | 1_done | 1_canceled`.
- Transition rule: employees may set `in_progress`, `waiting`, `done`, `cancelled` on tasks they can write; `approved` and `changes_requested` require `project.group_project_manager` or `nasq_core.group_customer_admin`. Enforced in `nasq_pmo`, returned as HTTP 403 `{code:'transition_forbidden'}`.
- Writes: field edits optimistic; state transitions pending → confirmed; every write returns the full `TaskDetail` and the client replaces its cache with it.
- Frontend: Arabic default (`ar`), English secondary, `@nuxtjs/i18n` `no_prefix`; all user-facing strings via `$t()`/`t()`; Tailwind logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`); tokens unchanged; drawer not page; badges vocabulary: قيد التنفيذ · تعديلات مطلوبة · معتمد · بانتظار · منجز · ملغى.
- Dev servers: Odoo :8069 (`--dev=all`), Nuxt :3000 (`npm run dev` from repo root; restart after `nuxt.config.ts`/`server/` changes: `pkill -f "node_modules/.bin/nuxt dev"; pkill -f "@nuxt/cli/dist/dev/index.mjs"`, then `nohup npm run dev > /tmp/nuxt-dev.log 2>&1 &`, wait for `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` = 200).
- npm: the user's global `~/.npmrc` is malformed — always `--ignore-scripts` on `npm install`, and `npm_config_userconfig=/tmp/empty.npmrc npx shadcn-vue@latest add …` (create the empty file). Never edit `~/.npmrc`. After adding a shadcn component dir, restart Nuxt.
- Commit messages: `[ADD]|[IMP]|[FIX] <scope>: <summary>` + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task unless stated.
- Playwright: `cd apps/web && npm run test:e2e`; login `admin`/`admin` (role `vendor`, and a project manager). Tests that need an employee user create one through Odoo (see Task 3 fixtures) — never through the UI.

## File Structure

```
odoo-addons/
├── nasq_pmo/                              NEW — domain rules
│   ├── __init__.py · __manifest__.py       depends: ['nasq_core']
│   ├── models/__init__.py · models/project_task.py   _nasq_can_approve, _nasq_transition + hooks
│   └── tests/__init__.py · tests/test_transition.py
├── nasq_api/
│   ├── __manifest__.py                     depends += ['nasq_pmo']
│   ├── controllers/common.py               ApiError, api_handler decorator (403/404/422 → contract shape)
│   ├── controllers/tasks.py                list/create/get/patch/transition
│   ├── controllers/timeline.py             timeline + comments
│   ├── controllers/personal_stages.py      GET /me/personal-stages
│   ├── controllers/projects.py             GET /projects?minimal=1
│   ├── controllers/people.py               GET /people (minimal)
│   ├── controllers/auth.py                 POST /api/v1/auth/totp
│   ├── serializers/task.py                 dump_task, dump_task_detail, parse_task_vals, STATE maps
│   ├── serializers/timeline.py             dump_message
│   ├── models/__init__.py · models/project_task.py   bus notifications on create/write
│   └── tests/test_tasks.py · test_timeline.py · test_personal_stages.py · test_bus.py · test_totp.py
packages/contracts/src/
│   ├── task.ts · timeline.ts · personal-stage.ts · state.ts   zod schemas
│   └── __tests__/schemas.test.ts           extended
apps/web/
├── nuxt.config.ts                          i18n module, nitro devProxy ws
├── i18n/locales/ar.json · en.json          all UI strings
├── app/plugins/vue-query.ts                SSR-safe QueryClient
├── app/composables/
│   ├── useApi.ts                           $api: fetch wrapper → ApiError {status, code, message, field}
│   ├── useTasks.ts                         useTasks(params), useTask(id), mutations
│   ├── useTimeline.ts · usePersonalStages.ts · usePeople.ts · useProjects.ts
│   ├── useBus.ts                           websocket → query invalidation
│   ├── taskState.ts                        STATE_LABEL_KEYS, canTransition(), daysRemaining()
│   └── __tests__/taskState.test.ts · optimistic.test.ts
├── app/components/task/
│   ├── TaskTable.vue · TaskToolbar.vue · TaskBoard.vue · TaskCard.vue
│   ├── TaskDrawer.vue · TaskDetails.vue · TaskActivity.vue
│   ├── StateBadge.vue · StateMenu.vue · DeadlineBadge.vue · PriorityToggle.vue
│   ├── AssigneePicker.vue · TagPicker.vue · DescriptionEditor.vue
│   ├── SubtaskList.vue · Timeline.vue · CommentComposer.vue · CreateTaskDialog.vue
├── app/pages/tasks.vue                     tabs: table | board; drawer via ?task=<id>
├── app/pages/login.vue                     + TOTP step
├── server/api/auth/login.post.ts           mfa detection
├── server/api/auth/totp.post.ts            NEW
└── e2e/tasks.spec.ts · drawer.spec.ts · board.spec.ts · activity.spec.ts · realtime.spec.ts · totp.spec.ts · contracts.spec.ts
```

---

### Task 1: Frontend infrastructure — vue-query plugin, i18n, table deps, ws dev proxy

**Files:**
- Create: `apps/web/app/plugins/vue-query.ts`, `apps/web/i18n/locales/ar.json`, `apps/web/i18n/locales/en.json`
- Modify: `apps/web/nuxt.config.ts`, `apps/web/package.json`, every phase-0 component/page with an Arabic literal (`AppSidebar.vue`, `CommandMenu.vue`, `layouts/default.vue`, `pages/{index,login,tasks,projects,people,reports}.vue`, `composables/useNav.ts`, `middleware/auth.global.ts`), `apps/web/e2e/login.spec.ts` (unchanged assertions — Arabic stays default)

**Interfaces:**
- Produces: `useQueryClient()` available app-wide; `$t('nav.tasks')` etc.; locale keys listed below; `nitro.devProxy['/websocket']`.
- Consumes: nothing new.

- [ ] **Step 1: Install**

```bash
cd /Users/tariq/code/nasq && npm -w apps/web install --ignore-scripts @nuxtjs/i18n@^10.6.0 @tanstack/vue-table@^8.21.0 && npm -w apps/web run postinstall
```
(`postinstall` = `nuxt prepare`; if `npm run postinstall` is not defined, run `npx -w apps/web nuxi prepare`.)

- [ ] **Step 2: vue-query plugin (SSR-safe, per TanStack's Nuxt guide)**

`apps/web/app/plugins/vue-query.ts`:
```ts
import type { DehydratedState, VueQueryPluginOptions } from '@tanstack/vue-query'
import { VueQueryPlugin, QueryClient, hydrate, dehydrate } from '@tanstack/vue-query'

export default defineNuxtPlugin((nuxt) => {
  const vueQueryState = useState<DehydratedState | null>('vue-query')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
  })
  const options: VueQueryPluginOptions = { queryClient }
  nuxt.vueApp.use(VueQueryPlugin, options)

  if (import.meta.server) {
    nuxt.hooks.hook('app:rendered', () => { vueQueryState.value = dehydrate(queryClient) })
  }
  if (import.meta.client) {
    hydrate(queryClient, vueQueryState.value)
  }
})
```

- [ ] **Step 3: i18n module and locale files**

In `apps/web/nuxt.config.ts` add `'@nuxtjs/i18n'` to `modules` and:
```ts
  i18n: {
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', file: 'ar.json' },
      { code: 'en', language: 'en', dir: 'ltr', name: 'English', file: 'en.json' },
    ],
    defaultLocale: 'ar',
    strategy: 'no_prefix',
    lazy: true,
    detectBrowserLanguage: false,
  },
  nitro: {
    devProxy: {
      '/websocket': { target: 'ws://localhost:8069/websocket', ws: true, changeOrigin: false },
    },
  },
```
Remove `app.head.htmlAttrs` (i18n sets `lang`/`dir` from the locale; keep `title`). Keep the reka-ui `ConfigProvider dir="rtl"` in `app.vue` but bind it: `:dir="locale === 'ar' ? 'rtl' : 'ltr'"` using `const { locale } = useI18n()`.

`apps/web/i18n/locales/ar.json`:
```json
{
  "app": { "name": "nasq", "search": "بحث", "loading": "جارٍ التحميل…", "save": "حفظ", "cancel": "إلغاء", "create": "إنشاء", "close": "إغلاق", "noResults": "لا نتائج.", "loadMore": "تحميل المزيد" },
  "nav": { "today": "اليوم", "tasks": "مهامي", "projects": "المشاريع", "people": "الأشخاص", "reports": "التقارير", "console": "وحدة التحكم", "goTo": "الانتقال إلى", "typeToNavigate": "اكتب للانتقال…", "logout": "تسجيل الخروج" },
  "auth": { "username": "اسم المستخدم", "password": "كلمة المرور", "signIn": "دخول", "continue": "متابعة", "signInToContinue": "سجّل الدخول للمتابعة", "invalidCredentials": "بيانات الدخول غير صحيحة", "loginFailed": "تعذّر تسجيل الدخول", "totpTitle": "رمز التحقق", "totpHint": "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة", "totpInvalid": "رمز التحقق غير صحيح" },
  "errors": { "serverUnreachable": "تعذّر الوصول إلى الخادم", "badPayload": "استجابة غير صالحة من الخادم", "forbidden": "لا تملك صلاحية لهذا الإجراء", "notFound": "العنصر غير موجود", "generic": "حدث خطأ غير متوقع" },
  "today": { "title": "اليوم", "greeting": "مرحبًا {name} — لا شيء مستحق اليوم." },
  "pages": { "projects": "المشاريع", "people": "الأشخاص", "reports": "التقارير" },
  "tasks": {
    "title": "مهامي", "table": "جدول", "board": "لوحة", "new": "مهمة جديدة", "newTitle": "عنوان المهمة", "project": "المشروع",
    "columns": { "title": "العنوان", "project": "المشروع", "state": "الحالة", "deadline": "الموعد", "priority": "الأولوية", "stage": "المرحلة" },
    "filters": { "open": "مفتوحة", "closed": "منجزة", "allStates": "كل الحالات", "allProjects": "كل المشاريع", "search": "بحث في العناوين…" },
    "empty": { "title": "لا مهام مسندة إليك", "action": "إنشاء مهمة" },
    "state": { "in_progress": "قيد التنفيذ", "changes_requested": "تعديلات مطلوبة", "approved": "معتمد", "waiting": "بانتظار", "done": "منجز", "cancelled": "ملغى" },
    "priority": { "0": "عادية", "1": "مهمة" },
    "deadline": { "none": "بلا موعد", "today": "اليوم", "tomorrow": "غدًا", "inDays": "خلال {n} يوم", "overdueDays": "متأخرة {n} يوم" },
    "drawer": { "details": "التفاصيل", "activity": "النشاط", "assignees": "المسؤولون", "deadline": "الموعد", "priority": "الأولوية", "tags": "الوسوم", "stage": "المرحلة الشخصية", "allocatedHours": "الساعات المخصَّصة", "description": "الوصف", "subtasks": "المهام الفرعية", "addSubtask": "إضافة مهمة فرعية", "dependsOn": "تعتمد على", "attachments": "المرفقات", "metrics": "المؤشرات", "age": "العمر", "cycle": "زمن الإنجاز", "days": "{n} يوم", "created": "أُنشئت", "updated": "آخر تحديث", "unassigned": "غير مسند" },
    "transition": { "to": "تغيير الحالة", "forbidden": "هذا الانتقال يتطلب صلاحية مدير المشروع", "pending": "جارٍ التحديث…" },
    "activity": { "comment": "علّق", "changed": "غيّر {field} من «{old}» إلى «{new}»", "set": "عيّن {field}: «{new}»", "cleared": "أزال {field}", "write": "اكتب تعليقًا…", "post": "نشر", "empty": "لا نشاط بعد" },
    "board": { "moveTo": "نقل إلى…", "emptyColumn": "لا مهام" }
  }
}
```
`apps/web/i18n/locales/en.json` — the same keys in English (write every key; do not leave the file partial).

- [ ] **Step 4: Migrate phase-0 literals**

Replace every Arabic literal in the listed files with `$t(...)`/`t(...)` using the keys above (`useNav` returns `labelKey` instead of `label`; `AppSidebar`/`CommandMenu` render `$t(item.labelKey)`; the `useNav.test.ts` assertions switch to label keys `['nav.today','nav.tasks','nav.projects','nav.people','nav.reports']` and `nav.console`). `auth.global.ts` throws with `statusMessage` from `useNuxtApp().$i18n.t('errors.serverUnreachable')` (middleware has no `useI18n`; use `const { $i18n } = useNuxtApp()`). Login page and Nitro handlers keep the same Arabic strings in the JSON response `message` (server-side messages stay Arabic in phase 1).

- [ ] **Step 5: Verify**

```bash
cd /Users/tariq/code/nasq && npx -w apps/web vue-tsc --noEmit && npm -w apps/web run test && (restart Nuxt) && curl -s http://localhost:3000/login | grep -oE '<html[^>]*>' && (cd apps/web && npm run test:e2e)
```
Expected: `<html lang="ar-SA" dir="rtl">` (i18n sets `language`), unit tests green (update counts in the report), e2e 9/9 green (Arabic text unchanged), and a websocket smoke: `node -e "const ws=new WebSocket('ws://localhost:3000/websocket');ws.onopen=()=>{console.log('open');process.exit(0)};ws.onerror=e=>{console.log('err');process.exit(1)}"` prints `open`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "[ADD] web: vue-query plugin, i18n (ar default), table deps, websocket dev proxy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `nasq_pmo` — transition hooks and approval rule

**Files:**
- Create: `odoo-addons/nasq_pmo/__init__.py`, `__manifest__.py`, `models/__init__.py`, `models/project_task.py`, `tests/__init__.py`, `tests/test_transition.py`

**Interfaces:**
- Produces: `project.task._nasq_can_approve() -> bool` (current user is project manager or customer admin), `project.task._nasq_transition(state_code)` (hook-decomposed; raises `AccessError` when forbidden), constant `nasq_pmo.models.project_task.MANAGER_STATES = {'03_approved', '02_changes_requested'}`.

- [ ] **Step 1: Failing tests**

`odoo-addons/nasq_pmo/tests/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_transition
```
`odoo-addons/nasq_pmo/tests/test_transition.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestTransition(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pmo_emp', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pmo_mgr', groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'P1'})
        cls.task = cls.env['project.task'].create({
            'name': 'T1', 'project_id': cls.project.id, 'user_ids': [(4, cls.employee.id)],
        })

    def test_employee_can_close_and_reopen(self):
        task = self.task.with_user(self.employee)
        task._nasq_transition('1_done')
        self.assertEqual(task.state, '1_done')
        self.assertTrue(task.date_end)
        task._nasq_transition('01_in_progress')
        self.assertEqual(task.state, '01_in_progress')

    def test_employee_cannot_approve(self):
        task = self.task.with_user(self.employee)
        self.assertFalse(task._nasq_can_approve())
        with self.assertRaises(AccessError):
            task._nasq_transition('03_approved')
        with self.assertRaises(AccessError):
            task._nasq_transition('02_changes_requested')

    def test_manager_can_approve(self):
        task = self.task.with_user(self.manager)
        self.assertTrue(task._nasq_can_approve())
        task._nasq_transition('03_approved')
        self.assertEqual(task.state, '03_approved')

    def test_customer_admin_can_approve(self):
        admin = new_test_user(self.env, login='pmo_cadmin', groups='nasq_core.group_customer_admin')
        self.assertTrue(self.task.with_user(admin)._nasq_can_approve())

    def test_unknown_state_rejected(self):
        with self.assertRaises(ValueError):
            self.task._nasq_transition('99_nope')
```

- [ ] **Step 2: Run to fail** — `-i nasq_pmo --test-tags /nasq_pmo` → module missing.

- [ ] **Step 3: Implement**

`odoo-addons/nasq_pmo/__manifest__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq PMO',
    'summary': 'nasq platform: project & task domain rules',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['nasq_core'],
    'installable': True,
    'application': False,
}
```
`__init__.py` / `models/__init__.py`: import `models` / `project_task`.

`odoo-addons/nasq_pmo/models/project_task.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

from odoo.addons.project.models.project_task import CLOSED_STATES

MANAGER_STATES = {'03_approved', '02_changes_requested'}
ALL_STATES = {'01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', *CLOSED_STATES}


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _nasq_can_approve(self):
        """True when the current user may approve / request changes on ``self``."""
        return (
            self.env.user.has_group('project.group_project_manager')
            or self.env.user.has_group('nasq_core.group_customer_admin')
        )

    def _nasq_transition(self, state):
        """Move ``self`` to ``state`` (Odoo code) applying nasq's approval rule.

        Decomposed into hooks so customer overlays override one step.
        """
        if state not in ALL_STATES:
            raise ValueError(f"unknown task state {state!r}")
        self._nasq_check_transition_allowed(state)
        self._nasq_do_transition(state)
        self._nasq_post_transition_hook(state)
        return self

    def _nasq_check_transition_allowed(self, state):
        if state in MANAGER_STATES and not self._nasq_can_approve():
            raise AccessError(self.env._("Only a project manager can approve or request changes."))

    def _nasq_do_transition(self, state):
        vals = {'state': state}
        if state in CLOSED_STATES:
            vals['date_end'] = fields.Datetime.now()
        elif self.filtered(lambda t: t.state in CLOSED_STATES):
            vals['date_end'] = False
        self.write(vals)

    def _nasq_post_transition_hook(self, state):
        """Extension point (notifications, side effects). No-op in core."""
```

- [ ] **Step 4: Run** — `Ran 5 tests … OK`. Note: if `date_end` is already set by Odoo's `_inverse_state`/stage logic, keep our explicit write (idempotent).

- [ ] **Step 5: ruff + commit** — `[ADD] nasq_pmo: task transition hooks with manager-only approval`.

---

### Task 3: `nasq_api` — task serializers, `GET /tasks?filter=mine`, `GET /tasks/{id}`

**Files:**
- Create: `odoo-addons/nasq_api/controllers/common.py`, `controllers/tasks.py`, `serializers/task.py`, `tests/test_tasks.py`
- Modify: `nasq_api/__manifest__.py` (`depends: ['nasq_core', 'nasq_pmo']`), `controllers/__init__.py`, `serializers/__init__.py`, `tests/__init__.py`

**Interfaces:**
- Produces: `serializers.task.STATE_TO_API`, `API_TO_STATE`, `dump_task(task, today) -> dict`, `dump_task_detail(task, today) -> dict`, `parse_task_vals(payload, can_manage) -> dict` (raises `ApiError`), `controllers.common.ApiError(status, code, message, field=None)`, decorator `controllers.common.api_handler` (maps `ApiError`→its status, `AccessError`→403 `forbidden`, `MissingError`→404 `not_found`, `ValidationError`/`UserError`→422 `invalid`, all in the contract shape via `request.make_json_response`).
- Test fixtures reused by later tasks: `NasqApiCase` (HttpCase) with `employee`, `manager`, `project`, three tasks (two assigned to employee — one overdue, one closed — one unassigned).

- [ ] **Step 1: Failing tests**

`odoo-addons/nasq_api/tests/common.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import HttpCase, new_test_user


class NasqApiCase(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='api_emp', password='api_emp_pass_123',
                                     name='Sara', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='api_mgr', password='api_mgr_pass_123',
                                    name='Mona', groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Erada Portal'})
        now = fields.Datetime.now()
        cls.task_overdue = cls.env['project.task'].create({
            'name': 'Overdue task', 'project_id': cls.project.id,
            'user_ids': [(4, cls.employee.id)], 'date_deadline': now - timedelta(days=3), 'priority': '1',
        })
        cls.task_done = cls.env['project.task'].create({
            'name': 'Done task', 'project_id': cls.project.id,
            'user_ids': [(4, cls.employee.id)], 'state': '1_done',
        })
        cls.task_other = cls.env['project.task'].create({
            'name': 'Someone else', 'project_id': cls.project.id, 'user_ids': [(4, cls.manager.id)],
        })

    def api(self, method, path, json=None):
        headers = {'Content-Type': 'application/json'}
        return self.url_open(path, json=json, headers=headers, method=method)
```

`odoo-addons/nasq_api/tests/test_tasks.py` (first half — list/get):
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestTaskRead(NasqApiCase):

    def test_list_requires_mine_filter(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_list_mine_open_by_default(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['total'], 1)
        item = body['items'][0]
        self.assertEqual(item['id'], self.task_overdue.id)
        self.assertEqual(item['state'], 'in_progress')
        self.assertEqual(item['priority'], '1')
        self.assertTrue(item['is_overdue'])
        self.assertEqual(item['days_remaining'], -3)
        self.assertEqual(item['project'], {'id': self.project.id, 'name': 'Erada Portal'})
        self.assertEqual(item['assignees'], [{'id': self.employee.id, 'name': 'Sara'}])
        self.assertEqual(set(item), {'id', 'name', 'project', 'state', 'priority', 'date_deadline',
                                     'days_remaining', 'is_overdue', 'is_closed', 'personal_stage',
                                     'assignees', 'tags'})

    def test_list_mine_closed(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/tasks?filter=mine&closed=1').json()
        self.assertEqual([t['id'] for t in body['items']], [self.task_done.id])
        self.assertEqual(body['items'][0]['state'], 'done')

    def test_list_search_and_pagination(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=mine&q=overdue').json()['total'], 1)
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=mine&q=zzz').json()['total'], 0)
        body = self.api('GET', '/api/v1/tasks?filter=mine&closed=1&limit=1&offset=1').json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'], [])

    def test_get_detail(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['age_days'], 0)
        self.assertIsNone(body['cycle_days'])
        self.assertFalse(body['can_approve'])
        self.assertEqual(body['subtasks'], [])
        self.assertEqual(body['depends_on'], [])
        self.assertEqual(body['attachments'], [])
        self.assertIn('description_html', body)

    def test_get_other_users_task_is_forbidden_or_hidden(self):
        # employees may read tasks in projects they can see; a task in a private project is 403/404
        private = self.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({'name': 'Secret', 'project_id': private.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertIn(res.status_code, (403, 404))
        self.assertIn(res.json()['code'], ('forbidden', 'not_found'))

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')
```
Register `from . import common, test_tasks` in `tests/__init__.py` (keep existing imports).

- [ ] **Step 2: Run to fail** — `-u nasq_api --test-tags /nasq_api:TestTaskRead` → 404s.

- [ ] **Step 3: Implement**

`odoo-addons/nasq_api/controllers/common.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import logging

from odoo.exceptions import AccessError, MissingError, UserError, ValidationError
from odoo.http import request

_logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status, code, message, field=None):
        super().__init__(message)
        self.status, self.code, self.message, self.field = status, code, message, field


def error_response(status, code, message, field=None):
    body = {'code': code, 'message': message}
    if field:
        body['field'] = field
    return request.make_json_response(body, status=status)


def api_handler(func):
    """Map exceptions raised by an /api/v1 controller to the contract error shape."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ApiError as e:
            return error_response(e.status, e.code, e.message, e.field)
        except MissingError as e:
            return error_response(404, 'not_found', str(e))
        except AccessError as e:
            return error_response(403, 'forbidden', str(e))
        except (ValidationError, UserError) as e:
            return error_response(422, 'invalid', str(e))
    return wrapper


def get_record(model, rec_id):
    """Browse + existence/access check → MissingError/AccessError for api_handler."""
    record = request.env[model].browse(int(rec_id))
    if not record.exists():
        raise MissingError(request.env._("%(model)s %(id)s does not exist", model=model, id=rec_id))
    record.check_access('read')
    return record
```

`odoo-addons/nasq_api/serializers/task.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import fields

from odoo.addons.nasq_api.controllers.common import ApiError

STATE_TO_API = {
    '01_in_progress': 'in_progress',
    '02_changes_requested': 'changes_requested',
    '03_approved': 'approved',
    '04_waiting_normal': 'waiting',
    '1_done': 'done',
    '1_canceled': 'cancelled',
}
API_TO_STATE = {v: k for k, v in STATE_TO_API.items()}

EMPLOYEE_FIELDS = {'name', 'description', 'date_deadline', 'priority', 'user_ids', 'tag_ids', 'personal_stage_type_id'}
MANAGER_FIELDS = EMPLOYEE_FIELDS | {'allocated_hours'}


def _days_remaining(task, today):
    if not task.date_deadline:
        return None
    return (task.date_deadline.date() - today).days


def _iso(dt):
    return fields.Datetime.to_string(dt).replace(' ', 'T') + 'Z' if dt else None


def _ref(record):
    return {'id': record.id, 'name': record.display_name}


def dump_task(task, today=None):
    today = today or date.today()
    days = _days_remaining(task, today)
    stage = task.personal_stage_type_id
    return {
        'id': task.id,
        'name': task.name,
        'project': _ref(task.project_id) if task.project_id else None,
        'state': STATE_TO_API[task.state],
        'priority': task.priority,
        'date_deadline': _iso(task.date_deadline),
        'days_remaining': days,
        'is_overdue': bool(days is not None and days < 0 and not task.is_closed),
        'is_closed': task.is_closed,
        'personal_stage': _ref(stage) if stage else None,
        'assignees': [_ref(u) for u in task.user_ids],
        'tags': [{'id': t.id, 'name': t.name, 'color': t.color} for t in task.tag_ids],
    }


def dump_task_detail(task, today=None):
    today = today or date.today()
    data = dump_task(task, today)
    start = task.date_assign or task.create_date
    cycle = (task.date_end - start).days if task.is_closed and task.date_end and start else None
    data.update({
        'description_html': task.description or '',
        'allocated_hours': task.allocated_hours,
        'age_days': (today - task.create_date.date()).days,
        'cycle_days': cycle,
        'subtasks': [dump_task(t, today) for t in task.child_ids],
        'depends_on': [{'id': t.id, 'name': t.name, 'state': STATE_TO_API[t.state]} for t in task.depend_on_ids],
        'attachments': [{
            'id': a.id, 'name': a.name, 'mimetype': a.mimetype or '',
            'url': f'/web/content/{a.id}?download=true',
        } for a in task.attachment_ids],
        'can_approve': task._nasq_can_approve(),
        'created_at': _iso(task.create_date),
        'updated_at': _iso(task.write_date),
    })
    return data


def parse_task_vals(payload, can_manage):
    """Whitelist + coerce a PATCH payload into ORM vals. Raises ApiError(422)."""
    allowed = MANAGER_FIELDS if can_manage else EMPLOYEE_FIELDS
    vals = {}
    for key, value in payload.items():
        if key not in allowed:
            raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if key == 'date_deadline':
            vals[key] = fields.Datetime.to_datetime(value.replace('Z', '').replace('T', ' ')) if value else False
        elif key == 'priority':
            if value not in ('0', '1'):
                raise ApiError(422, 'invalid', "priority must be '0' or '1'", field=key)
            vals[key] = value
        elif key in ('user_ids', 'tag_ids'):
            if not isinstance(value, list) or not all(isinstance(i, int) for i in value):
                raise ApiError(422, 'invalid', f"{key} must be a list of ids", field=key)
            vals[key] = [(6, 0, value)]
        elif key == 'personal_stage_type_id':
            vals[key] = int(value) if value else False
        elif key == 'allocated_hours':
            vals[key] = float(value or 0)
        elif key == 'name':
            if not isinstance(value, str) or not value.strip():
                raise ApiError(422, 'invalid', "name must not be empty", field=key)
            vals[key] = value.strip()
        else:
            vals[key] = value
    return vals
```

`odoo-addons/nasq_api/controllers/tasks.py` (read half; Task 4 adds writes):
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request
from odoo.osv.expression import AND

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_api.serializers.task import API_TO_STATE, dump_task, dump_task_detail

SORTABLE = {'date_deadline', 'priority', 'name', 'create_date', 'write_date'}
MAX_LIMIT = 200


class TaskController(http.Controller):

    @http.route('/api/v1/tasks', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_tasks(self, filter=None, state=None, project_id=None, closed='0', q=None,
                   sort='date_deadline asc, priority desc', limit=50, offset=0, **_):
        if filter != 'mine':
            raise ApiError(400, 'unsupported_filter', "phase 1 supports filter=mine only")
        domain = [('user_ids', 'in', [request.env.uid])]
        domain = AND([domain, [('is_closed', '=', closed in ('1', 'true', True))]])
        if state:
            codes = [API_TO_STATE[s] for s in str(state).split(',') if s in API_TO_STATE]
            domain = AND([domain, [('state', 'in', codes)]])
        if project_id:
            domain = AND([domain, [('project_id', '=', int(project_id))]])
        if q:
            domain = AND([domain, [('name', 'ilike', q)]])
        order_parts = []
        for part in str(sort).split(','):
            field, _, direction = part.strip().partition(' ')
            if field in SORTABLE:
                order_parts.append(f"{field} {'desc' if direction == 'desc' else 'asc'}")
        order = ', '.join(order_parts) or 'date_deadline asc, priority desc'
        Task = request.env['project.task']
        limit = min(int(limit), MAX_LIMIT)
        tasks = Task.search(domain, order=f"{order}, id desc", limit=limit, offset=int(offset))
        return {'items': [dump_task(t) for t in tasks], 'total': Task.search_count(domain)}

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_task(self, task_id):
        task = get_record('project.task', task_id)
        return dump_task_detail(task)
```
Register in `controllers/__init__.py` (`from . import branding, me, tasks`) and `serializers/__init__.py` (`from . import company, task, user`); manifest `depends` adds `nasq_pmo`.

- [ ] **Step 4: Run** `-u nasq_api,nasq_pmo --test-tags /nasq_api:TestTaskRead` → 7 tests OK. `ruff check odoo-addons` clean.
- [ ] **Step 5: Commit** `[ADD] nasq_api: task serializers, GET /api/v1/tasks?filter=mine and GET /api/v1/tasks/{id}`.

---

### Task 4: `nasq_api` — `POST /tasks`, `PATCH /tasks/{id}`, `POST /tasks/{id}/transition`

**Files:**
- Modify: `odoo-addons/nasq_api/controllers/tasks.py`, `tests/test_tasks.py`

**Interfaces:**
- Produces: `POST /api/v1/tasks {name, project_id, parent_id?}` → 201 `TaskDetail`; `PATCH /api/v1/tasks/{id}` → 200 `TaskDetail`; `POST /api/v1/tasks/{id}/transition {state}` → 200 `TaskDetail` | 403 `transition_forbidden` | 422 `invalid_state`.

- [ ] **Step 1: Failing tests** — append to `tests/test_tasks.py`:
```python
@tagged('post_install', '-at_install', 'nasq')
class TestTaskWrite(NasqApiCase):

    def test_create(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': 'New one', 'project_id': self.project.id})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body['name'], 'New one')
        self.assertEqual(body['assignees'], [{'id': self.employee.id, 'name': 'Sara'}])
        self.assertEqual(body['state'], 'in_progress')

    def test_create_subtask(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': 'Child', 'project_id': self.project.id, 'parent_id': self.task_overdue.id})
        self.assertEqual(res.status_code, 201)
        parent = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertEqual([t['name'] for t in parent['subtasks']], ['Child'])

    def test_create_validation(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': '   ', 'project_id': self.project.id})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'name')

    def test_patch_whitelist(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'name': 'Renamed', 'priority': '0'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['name'], 'Renamed')
        self.assertEqual(res.json()['priority'], '0')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'project_id': 1})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json(), {'code': 'unknown_field', 'message': "field 'project_id' is not writable", 'field': 'project_id'})

    def test_patch_allocated_hours_needs_manager(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'allocated_hours': 4}).status_code, 422)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'allocated_hours': 4})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['allocated_hours'], 4.0)

    def test_patch_deadline_and_stage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        stages = self.api('GET', '/api/v1/me/personal-stages').json()
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}',
                       {'date_deadline': '2030-01-15T09:00:00Z', 'personal_stage_type_id': stages[1]['id']})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['date_deadline'], '2030-01-15T09:00:00Z')
        self.assertEqual(res.json()['personal_stage']['id'], stages[1]['id'])
        self.assertFalse(res.json()['is_overdue'])

    def test_transition_employee(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/transition', {'state': 'done'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['state'], 'done')
        self.assertTrue(res.json()['is_closed'])
        self.assertIsNotNone(res.json()['cycle_days'])
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/transition', {'state': 'approved'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'transition_forbidden')

    def test_transition_manager_and_invalid(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_other.id}/transition', {'state': 'approved'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['state'], 'approved')
        res = self.api('POST', f'/api/v1/tasks/{self.task_other.id}/transition', {'state': 'nope'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid_state')
```
(`test_patch_deadline_and_stage` depends on Task 5's `/me/personal-stages`; it fails until then — expected, note it in the report.)

- [ ] **Step 2: Run to fail** (405/404).

- [ ] **Step 3: Implement** — append to `controllers/tasks.py`:
```python
    @http.route('/api/v1/tasks', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_task(self, name=None, project_id=None, parent_id=None, **_):
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        if not project_id:
            raise ApiError(422, 'invalid', "project_id is required", field='project_id')
        project = get_record('project.project', project_id)
        vals = {'name': name.strip(), 'project_id': project.id, 'user_ids': [(4, request.env.uid)]}
        if parent_id:
            vals['parent_id'] = get_record('project.task', parent_id).id
        task = request.env['project.task'].create(vals)
        return request.make_json_response(dump_task_detail(task), status=201)

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_task(self, task_id, **payload):
        task = get_record('project.task', task_id)
        vals = parse_task_vals(payload, can_manage=task._nasq_can_approve())
        task.write(vals)
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/transition', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def transition_task(self, task_id, state=None, **_):
        if state not in API_TO_STATE:
            raise ApiError(422, 'invalid_state', f"unknown state {state!r}", field='state')
        task = get_record('project.task', task_id)
        try:
            task._nasq_transition(API_TO_STATE[state])
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        return dump_task_detail(task)
```
Add `from odoo.exceptions import AccessError` and `parse_task_vals` to the imports. Note: `**payload` on a json2 route receives the JSON body keys; path params (`task_id`) arrive separately — confirm by reading `Json2Dispatcher.dispatch` (`self.request.params = self.jsonrequest | args`) and make sure `payload` does not contain `task_id` (pop it if it does).

- [ ] **Step 4: Run** `/nasq_api:TestTaskWrite` → 7 of 8 pass (stage test pending Task 5). ruff clean.
- [ ] **Step 5: Commit** `[ADD] nasq_api: create/patch tasks and state transitions`.

---

### Task 5: `nasq_api` — timeline, comments, personal stages, minimal projects/people

**Files:**
- Create: `controllers/timeline.py`, `controllers/personal_stages.py`, `controllers/projects.py`, `controllers/people.py`, `serializers/timeline.py`, `tests/test_timeline.py`, `tests/test_personal_stages.py`
- Modify: `controllers/__init__.py`, `serializers/__init__.py`, `tests/__init__.py`

**Interfaces:**
- Produces: `GET /api/v1/tasks/{id}/timeline` → `TimelineEntry[]` newest first; `POST /api/v1/tasks/{id}/comments {body}` → 201 `TimelineEntry`; `GET /api/v1/me/personal-stages` → `[{id,name,sequence,fold}]` (creates Odoo's 7 defaults when the user has none); `GET /api/v1/projects?minimal=1` → `[{id,name}]`; `GET /api/v1/people?q=` → `[{id,name,user_id}]` (employees with a user, for the assignee picker).

- [ ] **Step 1: Failing tests**

`tests/test_timeline.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestTimeline(NasqApiCase):

    def test_comment_then_timeline_mixes_tracking(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        tid = self.task_overdue.id
        res = self.api('POST', f'/api/v1/tasks/{tid}/comments', {'body': '<p>مرحبًا <b>فريق</b></p>'})
        self.assertEqual(res.status_code, 201)
        entry = res.json()
        self.assertEqual(entry['kind'], 'comment')
        self.assertEqual(entry['author']['name'], 'Sara')
        self.assertIn('<b>فريق</b>', entry['body_html'])
        # a tracked change (priority is tracked in project.task)
        self.api('PATCH', f'/api/v1/tasks/{tid}', {'name': 'Renamed by test'})
        timeline = self.api('GET', f'/api/v1/tasks/{tid}/timeline').json()
        kinds = [e['kind'] for e in timeline]
        self.assertIn('comment', kinds)
        self.assertIn('tracking', kinds)
        tracking = next(e for e in timeline if e['kind'] == 'tracking')
        change = next(c for c in tracking['changes'] if c['field'] == 'name')
        self.assertEqual(change['old'], 'Overdue task')
        self.assertEqual(change['new'], 'Renamed by test')
        self.assertEqual(timeline[0]['kind'], 'tracking', 'newest first')

    def test_empty_comment_rejected(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments', {'body': '   '})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'body')

    def test_script_is_sanitised(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments', {'body': '<script>alert(1)</script>hi'})
        self.assertEqual(res.status_code, 201)
        self.assertNotIn('<script', res.json()['body_html'])
```
`tests/test_personal_stages.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestPersonalStagesAndLookups(NasqApiCase):

    def test_personal_stages_created_on_first_call(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        stages = self.api('GET', '/api/v1/me/personal-stages').json()
        self.assertEqual(len(stages), 7)
        self.assertEqual([s['sequence'] for s in stages], sorted(s['sequence'] for s in stages))
        self.assertEqual(set(stages[0]), {'id', 'name', 'sequence', 'fold'})
        self.assertEqual(self.api('GET', '/api/v1/me/personal-stages').json(), stages, 'idempotent')

    def test_projects_minimal(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
        self.assertEqual(self.api('GET', '/api/v1/projects').status_code, 400)

    def test_people_minimal(self):
        self.env['hr.employee'].create({'name': 'Sara E', 'user_id': self.employee.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/people?q=sara').json()
        self.assertEqual(items, [{'id': self.employee.id, 'name': 'Sara', 'user_id': self.employee.id}])
```
(`people` returns *users* who have an employee — id = user id — because assignees are `res.users`.)

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement**

`serializers/timeline.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.nasq_api.serializers.task import _iso


def _display(tracking, new):
    value = tracking._format_display_value(tracking.field_id.ttype, new=new)
    return value[0] if isinstance(value, (list, tuple)) else value


def dump_message(message):
    author = message.author_id
    base = {
        'id': message.id,
        'author': {'id': author.id, 'name': author.name} if author else None,
        'at': _iso(message.date),
    }
    if message.tracking_value_ids:
        base['kind'] = 'tracking'
        base['changes'] = [{
            'field': t.field_id.name,
            'label': t.field_id.field_description,
            'old': _display(t, new=False),
            'new': _display(t, new=True),
        } for t in message.tracking_value_ids]
        if message.body and message.body != '<p></p>':
            base['body_html'] = message.body
    else:
        base['kind'] = 'comment'
        base['body_html'] = message.body
    return base
```
(`_format_display_value(field_type, new)` exists on `mail.tracking.value` in 19 — verify its return shape with a quick `odoo shell`; adapt `_display` if it returns a plain value.)

`controllers/timeline.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_api.serializers.timeline import dump_message


class TimelineController(http.Controller):

    def _timeline_messages(self, task):
        comment_subtype = request.env.ref('mail.mt_comment')
        return task.message_ids.filtered(
            lambda m: (m.message_type == 'comment' and m.subtype_id == comment_subtype) or m.tracking_value_ids
        ).sorted(key=lambda m: (m.date, m.id), reverse=True)

    @http.route('/api/v1/tasks/<int:task_id>/timeline', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def timeline(self, task_id):
        task = get_record('project.task', task_id)
        return [dump_message(m) for m in self._timeline_messages(task)]

    @http.route('/api/v1/tasks/<int:task_id>/comments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def post_comment(self, task_id, body=None, **_):
        if not isinstance(body, str) or not body.strip():
            raise ApiError(422, 'invalid', "body must not be empty", field='body')
        task = get_record('project.task', task_id)
        message = task.message_post(body=body, message_type='comment', subtype_xmlid='mail.mt_comment', body_is_html=True)
        return request.make_json_response(dump_message(message), status=201)
```
(`body_is_html=True` keeps the HTML; `mail` sanitises it — the script test proves it. If the kwarg name differs in this checkout, read `message_post`'s signature at `addons/mail/models/mail_thread.py` and use the right one.)

`controllers/personal_stages.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import api_handler


class PersonalStageController(http.Controller):

    @http.route('/api/v1/me/personal-stages', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    def personal_stages(self):
        Stage = request.env['project.task.type']
        stages = Stage.search([('user_id', '=', request.env.uid)], order='sequence, id')
        if not stages:
            vals = request.env['project.task']._get_default_personal_stage_create_vals(request.env.uid)
            stages = Stage.sudo().with_context(default_project_ids=False).create(vals).with_user(request.env.uid)
        return [{'id': s.id, 'name': s.name, 'sequence': s.sequence, 'fold': s.fold} for s in stages]
```
(`readonly=False` because the first call creates rows.)

`controllers/projects.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_projects(self, minimal=None, **_):
        if minimal not in ('1', 'true', True):
            raise ApiError(400, 'unsupported_filter', "phase 1 supports minimal=1 only")
        projects = request.env['project.project'].search([], order='name')
        return [{'id': p.id, 'name': p.name} for p in projects]
```
`controllers/people.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import api_handler


class PeopleController(http.Controller):

    @http.route('/api/v1/people', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_people(self, q=None, limit=20, **_):
        domain = [('user_id', '!=', False), ('user_id.active', '=', True)]
        if q:
            domain.append(('name', 'ilike', q))
        employees = request.env['hr.employee'].search(domain, order='name', limit=min(int(limit), 50))
        return [{'id': e.user_id.id, 'name': e.user_id.name, 'user_id': e.user_id.id} for e in employees]
```
Register all controllers/serializers/tests.

- [ ] **Step 4: Run** `--test-tags /nasq_api` → all (incl. the pending stage test) OK; ruff clean.
- [ ] **Step 5: Commit** `[ADD] nasq_api: timeline, comments, personal stages, minimal projects/people lookups`.

---

### Task 6: Bus notifications on task create/write

**Files:**
- Create: `odoo-addons/nasq_api/models/__init__.py`, `models/project_task.py`, `tests/test_bus.py`
- Modify: `nasq_api/__init__.py` (`from . import controllers, models`), `tests/__init__.py`

**Interfaces:**
- Produces: on `project.task` create/write, `bus.bus._sendone(partner, 'nasq/task', {'id': task.id, 'event': 'created'|'updated'})` for the partner of every user in old ∪ new `user_ids` plus the writer.

- [ ] **Step 1: Failing test** `tests/test_bus.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestTaskBus(TransactionCase):

    def test_write_notifies_old_and_new_assignees_and_writer(self):
        a = new_test_user(self.env, login='bus_a', groups='nasq_core.group_employee')
        b = new_test_user(self.env, login='bus_b', groups='nasq_core.group_employee')
        mgr = new_test_user(self.env, login='bus_mgr', groups='nasq_core.group_employee,project.group_project_manager')
        project = self.env['project.project'].create({'name': 'Bus'})
        task = self.env['project.task'].create({'name': 'T', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task.with_user(mgr).write({'user_ids': [(6, 0, [b.id])]})
        targets = {call.args[0] for call in sendone.call_args_list}
        self.assertEqual(targets, {a.partner_id, b.partner_id, mgr.partner_id})
        for call in sendone.call_args_list:
            self.assertEqual(call.args[1], 'nasq/task')
            self.assertEqual(call.args[2], {'id': task.id, 'event': 'updated'})

    def test_create_notifies_assignees(self):
        a = new_test_user(self.env, login='bus_c', groups='nasq_core.group_employee')
        project = self.env['project.project'].create({'name': 'Bus2'})
        with patch.object(type(self.env['bus.bus']), '_sendone') as sendone:
            task = self.env['project.task'].with_user(a).create({'name': 'T2', 'project_id': project.id, 'user_ids': [(4, a.id)]})
        self.assertEqual(sendone.call_args_list[-1].args, (a.partner_id, 'nasq/task', {'id': task.id, 'event': 'created'}))
```

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** `models/project_task.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _nasq_notify(self, event, extra_partners=None):
        bus = self.env['bus.bus']
        for task in self:
            partners = task.user_ids.partner_id | self.env.user.partner_id
            if extra_partners:
                partners |= extra_partners.get(task.id, partners.browse())
            for partner in partners:
                bus._sendone(partner, 'nasq/task', {'id': task.id, 'event': event})

    @api.model_create_multi
    def create(self, vals_list):
        tasks = super().create(vals_list)
        tasks._nasq_notify('created')
        return tasks

    def write(self, vals):
        before = {task.id: task.user_ids.partner_id for task in self}
        res = super().write(vals)
        self._nasq_notify('updated', extra_partners=before)
        return res
```
- [ ] **Step 4: Run** `/nasq_api:TestTaskBus` OK; full `/nasq_api` still green; `-d odoo19 -u nasq_api,nasq_pmo --no-http --stop-after-init` (and `-i nasq_pmo` first time) so the dev server has the new code.
- [ ] **Step 5: Commit** `[ADD] nasq_api: bus notifications to assignees on task create/write`.

---

### Task 7: Contracts — zod schemas for tasks, timeline, stages; contract e2e

**Files:**
- Create: `packages/contracts/src/state.ts`, `task.ts`, `timeline.ts`, `personal-stage.ts`
- Modify: `packages/contracts/src/index.ts`, `src/__tests__/schemas.test.ts`, `apps/web/e2e/contracts.spec.ts`

**Interfaces:**
- Produces: `TaskStateSchema`/`TaskState`, `RefSchema`, `TaskSchema`/`Task`, `TaskDetailSchema`/`TaskDetail`, `TaskListSchema`, `TaskPatchSchema`/`TaskPatch`, `TaskCreateSchema`, `TimelineEntrySchema`/`TimelineEntry`, `PersonalStageSchema`/`PersonalStage`, `PersonRefSchema`, `ProjectRefSchema`, `ApiErrorSchema`.

- [ ] **Step 1: Failing tests** — add to `schemas.test.ts` cases: a `Task` literal exactly as `dump_task` emits (use the key set from Task 3's test) parses; `TaskDetail` parses with `cycle_days: null`; `TaskStateSchema` rejects `'open'`; `TaskPatchSchema` rejects `{ project_id: 1 }` (`.strict()`); `TimelineEntry` accepts both kinds; `PersonalStage` parses.
- [ ] **Step 2: Implement** (all `.strict()` — the platform's drift guard; the server's serializers are the mirror):
```ts
// state.ts
import { z } from 'zod'
export const TaskStateSchema = z.enum(['in_progress', 'changes_requested', 'approved', 'waiting', 'done', 'cancelled'])
export type TaskState = z.infer<typeof TaskStateSchema>
export const MANAGER_STATES: TaskState[] = ['approved', 'changes_requested']

// task.ts
import { z } from 'zod'
import { TaskStateSchema } from './state'
export const RefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()
export const TagSchema = z.object({ id: z.number().int().positive(), name: z.string(), color: z.number().int() }).strict()
export const TaskSchema = z.object({
  id: z.number().int().positive(), name: z.string(), project: RefSchema.nullable(), state: TaskStateSchema,
  priority: z.enum(['0', '1']), date_deadline: z.string().nullable(), days_remaining: z.number().int().nullable(),
  is_overdue: z.boolean(), is_closed: z.boolean(), personal_stage: RefSchema.nullable(),
  assignees: z.array(RefSchema), tags: z.array(TagSchema),
}).strict()
export const TaskDetailSchema = TaskSchema.extend({
  description_html: z.string(), allocated_hours: z.number(), age_days: z.number().int(), cycle_days: z.number().int().nullable(),
  subtasks: z.array(TaskSchema),
  depends_on: z.array(z.object({ id: z.number().int().positive(), name: z.string(), state: TaskStateSchema }).strict()),
  attachments: z.array(z.object({ id: z.number().int().positive(), name: z.string(), mimetype: z.string(), url: z.string() }).strict()),
  can_approve: z.boolean(), created_at: z.string(), updated_at: z.string(),
}).strict()
export const TaskListSchema = z.object({ items: z.array(TaskSchema), total: z.number().int() }).strict()
export const TaskPatchSchema = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), date_deadline: z.string().nullable().optional(),
  priority: z.enum(['0', '1']).optional(), user_ids: z.array(z.number().int()).optional(), tag_ids: z.array(z.number().int()).optional(),
  personal_stage_type_id: z.number().int().nullable().optional(), allocated_hours: z.number().optional(),
}).strict()
export const TaskCreateSchema = z.object({ name: z.string().min(1), project_id: z.number().int(), parent_id: z.number().int().optional() }).strict()
export const ApiErrorSchema = z.object({ code: z.string(), message: z.string(), field: z.string().optional() }).strict()
export type Task = z.infer<typeof TaskSchema>; export type TaskDetail = z.infer<typeof TaskDetailSchema>
export type TaskPatch = z.infer<typeof TaskPatchSchema>; export type TaskCreate = z.infer<typeof TaskCreateSchema>

// timeline.ts
import { z } from 'zod'
import { RefSchema } from './task'
export const TimelineEntrySchema = z.object({
  id: z.number().int().positive(), kind: z.enum(['comment', 'tracking']), author: RefSchema.nullable(), at: z.string(),
  body_html: z.string().optional(),
  changes: z.array(z.object({ field: z.string(), label: z.string(), old: z.any(), new: z.any() }).strict()).optional(),
}).strict()
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>

// personal-stage.ts
import { z } from 'zod'
export const PersonalStageSchema = z.object({ id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean() }).strict()
export type PersonalStage = z.infer<typeof PersonalStageSchema>
export const PersonRefSchema = z.object({ id: z.number().int(), name: z.string(), user_id: z.number().int() }).strict()
export const ProjectRefSchema = z.object({ id: z.number().int(), name: z.string() }).strict()
```
Export all from `index.ts`.
- [ ] **Step 3: contract e2e** — extend `apps/web/e2e/contracts.spec.ts` (logged in via `page.request`): `GET /api/v1/tasks?filter=mine` → `TaskListSchema.parse`; create a task via `POST /api/v1/tasks` and parse `TaskDetailSchema` on the response and on `GET /api/v1/tasks/{id}`; `POST …/comments` then `GET …/timeline` → `z.array(TimelineEntrySchema)`; `GET /api/v1/me/personal-stages` → `z.array(PersonalStageSchema)`; `GET /api/v1/projects?minimal=1` → `z.array(ProjectRefSchema)`; `GET /api/v1/people` → `z.array(PersonRefSchema)`. Use a unique task name per run (`Date.now()`) and leave the data (the dev DB is disposable).
- [ ] **Step 4: Run** `npm -w packages/contracts run test`, `tsc`, e2e contracts spec green (against the dev DB with `nasq_pmo` installed).
- [ ] **Step 5: Commit** `[ADD] contracts: task, timeline, personal-stage schemas with live contract e2e`.

---

### Task 8: Frontend data layer — `$api`, queries, mutations, pure helpers

**Files:**
- Create: `apps/web/app/composables/useApi.ts`, `useTasks.ts`, `useTimeline.ts`, `usePersonalStages.ts`, `useProjects.ts`, `usePeople.ts`, `taskState.ts`, `__tests__/taskState.test.ts`, `__tests__/useTasks.optimistic.test.ts`

**Interfaces:**
- Produces:
  - `useApi()` → `$api<T>(path, { method, body, query, schema })` that throws `ApiError { status, code, message, field }` (parsed with `ApiErrorSchema` when the body matches, else `code:'http_error'`) and validates responses with the given zod schema.
  - `taskKeys = { all: ['tasks'], list: (p) => ['tasks','list',p], detail: (id) => ['tasks','detail',id], timeline: (id) => ['tasks','timeline',id], stages: ['me','personal-stages'] }`.
  - `useTasks(params: Ref<TaskListParams>)` → `useInfiniteQuery` (pages of 50, `getNextPageParam` from `total`).
  - `useTask(id: Ref<number|null>)` → `useQuery(TaskDetail)`, `enabled: !!id`.
  - `useUpdateTask()` → `useMutation` optimistic: patches `taskKeys.detail(id)` and every cached list item; rollback on error; `onSuccess` replaces with the returned `TaskDetail`.
  - `useTransitionTask()` → `useMutation` **non-optimistic** (pending state exposed via `isPending`), `onSuccess` sets detail + invalidates lists.
  - `useCreateTask()`, `usePostComment()` (appends to timeline cache on success), `useTimeline(id)`, `usePersonalStages()`, `useProjects()`, `usePeople(q)`.
  - `taskState.ts`: `STATE_LABEL_KEY: Record<TaskState,string>` (`tasks.state.<x>`), `STATE_TONE` (badge tone), `canTransition(from, to, canApprove): boolean` (employee: any of `in_progress|waiting|done|cancelled`; `approved|changes_requested` need `canApprove`), `nextStates(from, canApprove): TaskState[]`, `daysRemaining(deadlineIso, now): number|null`, `deadlineLabel(days, t): string` (uses keys `tasks.deadline.*`).

- [ ] **Step 1: Failing unit tests** — `taskState.test.ts`: `daysRemaining('2030-01-15T09:00:00Z', new Date('2030-01-13T20:00:00Z'))` → 2; past → negative; null → null; `canTransition('in_progress','approved',false)` false / true with `canApprove`; `nextStates('done', false)` excludes `done`. `useTasks.optimistic.test.ts`: test the pure reducer `applyPatchToList(list, id, patch)` and `applyPatchToDetail(detail, patch)` exported from `useTasks.ts` (assignee ids → refs require the picker's ref list; the reducer accepts `patch` plus an optional `resolved: { assignees?: Ref[], tags?: Tag[], personal_stage?: Ref|null }`).
- [ ] **Step 2: Implement.** `useApi.ts`:
```ts
import type { ZodType } from 'zod'
import { ApiErrorSchema } from '@nasq/contracts'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message) }
}

export function useApi() {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : {}
  async function $api<T>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown>; schema?: ZodType<T> } = {}): Promise<T> {
    try {
      const data = await $fetch<unknown>(path, {
        method: (opts.method ?? 'GET') as any, body: opts.body as any, query: opts.query, headers,
      })
      return opts.schema ? opts.schema.parse(data) : (data as T)
    } catch (e: any) {
      if (e?.name === 'ZodError' || e?.cause?.name === 'ZodError') throw e
      const status: number = e?.statusCode ?? e?.response?.status ?? 0
      const parsed = ApiErrorSchema.safeParse(e?.data)
      if (parsed.success) throw new ApiError(status, parsed.data.code, parsed.data.message, parsed.data.field)
      throw new ApiError(status, 'http_error', e?.message ?? 'request failed')
    }
  }
  return { $api }
}
```
`useTasks.ts` (core shape — write it fully, including the reducers and the four mutations described above):
```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { TaskDetailSchema, TaskListSchema, type Task, type TaskDetail, type TaskPatch, type TaskState } from '@nasq/contracts'

export interface TaskListParams { closed: boolean; state?: TaskState[]; project_id?: number; q?: string; sort?: string }
export const PAGE = 50
export const taskKeys = {
  all: ['tasks'] as const,
  list: (p: TaskListParams) => ['tasks', 'list', p] as const,
  detail: (id: number) => ['tasks', 'detail', id] as const,
  timeline: (id: number) => ['tasks', 'timeline', id] as const,
}
export interface Resolved { assignees?: Task['assignees']; tags?: Task['tags']; personal_stage?: Task['personal_stage'] }
export function applyPatchToTask<T extends Task>(task: T, patch: TaskPatch, resolved: Resolved = {}): T {
  const next: any = { ...task }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.date_deadline !== undefined) next.date_deadline = patch.date_deadline
  if (patch.user_ids !== undefined && resolved.assignees) next.assignees = resolved.assignees
  if (patch.tag_ids !== undefined && resolved.tags) next.tags = resolved.tags
  if (patch.personal_stage_type_id !== undefined && resolved.personal_stage !== undefined) next.personal_stage = resolved.personal_stage
  if ('description' in patch && 'description_html' in next) next.description_html = patch.description ?? ''
  if (patch.allocated_hours !== undefined && 'allocated_hours' in next) next.allocated_hours = patch.allocated_hours
  return next
}
export function useTasks(params: Ref<TaskListParams>) {
  const { $api } = useApi()
  return useInfiniteQuery({
    queryKey: computed(() => taskKeys.list(params.value)),
    queryFn: ({ pageParam }) => $api('/api/v1/tasks', {
      query: { filter: 'mine', closed: params.value.closed ? 1 : 0, state: params.value.state?.join(','),
               project_id: params.value.project_id, q: params.value.q || undefined, sort: params.value.sort, limit: PAGE, offset: pageParam },
      schema: TaskListSchema,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => { const loaded = pages.reduce((n, p) => n + p.items.length, 0); return loaded < last.total ? loaded : undefined },
  })
}
export function useTask(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({ queryKey: computed(() => taskKeys.detail(id.value ?? 0)), enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/tasks/${id.value}`, { schema: TaskDetailSchema }) })
}
export function useUpdateTask() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch; resolved?: Resolved }) => $api(`/api/v1/tasks/${id}`, { method: 'PATCH', body: patch, schema: TaskDetailSchema }),
    onMutate: async ({ id, patch, resolved }) => {
      await qc.cancelQueries({ queryKey: taskKeys.detail(id) })
      const prevDetail = qc.getQueryData<TaskDetail>(taskKeys.detail(id))
      if (prevDetail) qc.setQueryData(taskKeys.detail(id), applyPatchToTask(prevDetail, patch, resolved))
      const prevLists = qc.getQueriesData<{ pages: { items: Task[]; total: number }[] }>({ queryKey: ['tasks', 'list'] })
      for (const [key, data] of prevLists) if (data) qc.setQueryData(key, { ...data, pages: data.pages.map(p => ({ ...p, items: p.items.map(t => t.id === id ? applyPatchToTask(t, patch, resolved) : t) })) })
      return { prevDetail, prevLists }
    },
    onError: (_e, { id }, ctx) => { if (ctx?.prevDetail) qc.setQueryData(taskKeys.detail(id), ctx.prevDetail); for (const [k, d] of ctx?.prevLists ?? []) qc.setQueryData(k, d) },
    onSuccess: (detail, { id }) => { qc.setQueryData(taskKeys.detail(id), detail) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
  })
}
export function useTransitionTask() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, state }: { id: number; state: TaskState }) => $api(`/api/v1/tasks/${id}/transition`, { method: 'POST', body: { state }, schema: TaskDetailSchema }),
    onSuccess: (detail, { id }) => { qc.setQueryData(taskKeys.detail(id), detail); qc.invalidateQueries({ queryKey: ['tasks', 'list'] }); qc.invalidateQueries({ queryKey: taskKeys.timeline(id) }) },
  })
}
export function useCreateTask() { /* POST /api/v1/tasks → TaskDetailSchema; onSuccess invalidate lists */ }
```
(Write `useCreateTask`, `useTimeline`, `usePostComment` (appends the returned entry at the head of `taskKeys.timeline(id)`), `usePersonalStages` (`['me','personal-stages']`, staleTime 5 min), `useProjects` (`['projects','minimal']`), `usePeople(q)` (`['people', q]`, `enabled: q.length >= 1 || true`) in full — the pattern is the same; no stubs.)
- [ ] **Step 3: Run** unit tests green; `vue-tsc` clean.
- [ ] **Step 4: Commit** `[ADD] web: vue-query data layer for tasks, timeline, stages, lookups`.

---

### Task 9: مهامي — table tab, toolbar, create dialog, state/deadline badges

**Files:**
- Create: `app/components/task/{TaskTable,TaskToolbar,StateBadge,StateMenu,DeadlineBadge,PriorityToggle,CreateTaskDialog}.vue`
- Modify: `app/pages/tasks.vue`
- shadcn: `npm_config_userconfig=/tmp/empty.npmrc npx shadcn-vue@latest add table badge select dialog tabs skeleton popover calendar tooltip toggle --yes --overwrite` then restart Nuxt
- Create: `apps/web/e2e/tasks.spec.ts`

**Interfaces:**
- Consumes: Task 8 composables; `useNav` unchanged.
- Produces: route `/tasks?tab=table|board&task=<id>`; `StateBadge { state, tone }`, `StateMenu { task, canApprove } emits transition(state)`, `DeadlineBadge { deadline, daysRemaining, isClosed }`, `TaskToolbar` v-model `params` + `create` event; `TaskTable` emits `open(id)` and `transition({id,state})`.

- [ ] **Step 1: Failing e2e** `e2e/tasks.spec.ts` (fixtures: use `page.request` to create a project + two tasks for `admin` via `/api/v1/tasks` — admin is in `user_ids` by the create rule; unique names):
```ts
import { test, expect } from '@playwright/test'
async function login(page) { await page.goto('/login'); await page.getByLabel('اسم المستخدم').fill('admin'); await page.getByLabel('كلمة المرور').fill('admin'); await page.getByRole('button', { name: 'دخول' }).click(); await expect(page).toHaveURL('http://localhost:3000/') }
test('my tasks table lists my open tasks, filters and opens the drawer', async ({ page }) => {
  await login(page)
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const name = `E2E table ${Date.now()}`
  await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'مهامي' })).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await expect(row.getByText('قيد التنفيذ')).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill('zzz-no-such-task')
  await expect(page.getByText('لا نتائج.')).toBeVisible()
  await page.getByPlaceholder('بحث في العناوين…').fill(name)
  await row.click()
  await expect(page).toHaveURL(new RegExp('/tasks\\?.*task=\\d+'))
  await expect(page.getByRole('dialog')).toContainText(name)
})
test('inline transition to done moves the task to the closed filter', async ({ page }) => {
  await login(page)
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const name = `E2E done ${Date.now()}`
  await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  await page.goto('/tasks')
  const row = page.getByRole('row', { name: new RegExp(name) })
  await row.getByRole('button', { name: 'قيد التنفيذ' }).click()
  await page.getByRole('menuitem', { name: 'منجز' }).click()
  await expect(row).toBeHidden()
  await page.getByRole('tab', { name: 'منجزة' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
})
```
- [ ] **Step 2: Implement.** `tasks.vue`: heading + `Tabs` (`جدول`/`لوحة`) synced to `?tab`, `TaskToolbar` (open/closed segmented control, state multi-select, project select, search input debounced 300 ms, `مهمة جديدة` button), `TaskTable` for `tab=table` (Task 12 adds the board), `TaskDrawer` placeholder mount reading `?task` (Task 10 fills it — in this task render `<Sheet>` with the task name only so the e2e passes), `CreateTaskDialog` (title + project select → `useCreateTask`, then opens the drawer). `TaskTable`: `@tanstack/vue-table` with columns per the spec; row `role="row"` accessible name includes the title (default for `<tr>`); state cell is `StateMenu` (a `DropdownMenu` whose trigger is the `StateBadge` button; items = `nextStates(task.state, canApprove)`; manager-only items disabled with tooltip `tasks.transition.forbidden` when `!canApprove` — `canApprove` for the list comes from `me.role !== 'employee' || project-manager` → simplest: fetch once from any `TaskDetail`? No: expose `can_approve` on the list too? **Ruling:** the list shows all next states; the server answers 403 for forbidden ones and the UI toasts `tasks.transition.forbidden`. Keep the contract unchanged.) Empty state per spec. Skeleton rows while loading. "تحميل المزيد" button when `hasNextPage`. Deadline cell: `DeadlineBadge` (tone: overdue red, ≤2 days amber, else muted; label from `deadlineLabel`). Priority: star toggle → `useUpdateTask`.
- [ ] **Step 3: Run** e2e `tasks.spec.ts` 2/2 + full suite; `vue-tsc`; screenshot in the Browser pane (RTL table, badges).
- [ ] **Step 4: Commit** `[ADD] web: my-tasks table with filters, inline transitions, create dialog`.

---

### Task 10: Task drawer — details tab (Tiptap, pickers, sub-tasks, metrics)

**Files:**
- Create: `app/components/task/{TaskDrawer,TaskDetails,AssigneePicker,TagPicker,DescriptionEditor,SubtaskList}.vue`
- shadcn: `add sheet combobox command separator textarea` (some already present) → restart Nuxt
- Install: `npm -w apps/web install --ignore-scripts @tiptap/vue-3@^3.31 @tiptap/starter-kit@^3.31 @tiptap/extension-link@^3.31`
- Create: `apps/web/e2e/drawer.spec.ts`

**Interfaces:**
- `TaskDrawer { taskId: number|null }` emits `close`; internally `useTask`, `useUpdateTask`, `useTransitionTask`; header = inline-editable title (`contenteditable`-free: an `Input` that looks like a heading, saves on blur/Enter), `StateMenu` (pending spinner while `isPending`), project chip, `DeadlineBadge`; tabs `التفاصيل` / `النشاط`.
- `DescriptionEditor { modelValue: string }` emits `update:modelValue` debounced 800 ms; wrapped in `<ClientOnly>`; Tiptap `StarterKit` + `Link`; toolbar: bold, italic, bullet list, ordered list, link; `dir` inherits; `prose` styles via Tailwind (`@tailwindcss/typography` is NOT installed — style the editor with a small scoped CSS block instead).
- `AssigneePicker { modelValue: Ref[] }` — `Combobox` over `usePeople(q)` (search on type), multi-select chips; emits ids + resolved refs for the optimistic reducer.
- `TagPicker` — same over `GET /api/v1/tags`? **Not in scope**: phase 1 tags are read-only chips (no endpoint). Render only.
- `SubtaskList { subtasks, parentId, projectId }` — list of `Task` rows (state badge + title, click switches the drawer to that task) + "إضافة مهمة فرعية" input → `useCreateTask({ parent_id })`.

- [ ] **Step 1: Failing e2e** `e2e/drawer.spec.ts`: create a task via API, open `/tasks?task=<id>`, edit the title (fill + Enter), reload, expect the new title in the drawer and in the row; set priority via the star, expect `مهمة`; type in the description editor (`page.getByRole('textbox', { name: /الوصف/ })` — give the editor `aria-label`), wait 1.2 s, reload, expect the text; add a sub-task, expect it listed; expect metrics block shows `العمر`.
- [ ] **Step 2: Implement** fully (all components above; `TaskDetails` lays out: assignees, deadline (`Popover` + `Calendar` + time `Input`), priority, personal stage `Select` (from `usePersonalStages`), allocated hours (`Input` shown only when `task.can_approve`), description, sub-tasks, dependencies (read-only list with `StateBadge`), attachments (links `target=_blank`), metrics (age, cycle, created, updated with `Intl.DateTimeFormat('ar-SA')`)). Every field change → `useUpdateTask` with `resolved` refs.
- [ ] **Step 3: Run** e2e drawer + full; `vue-tsc`; screenshot.
- [ ] **Step 4: Commit** `[ADD] web: task drawer details — editor, pickers, sub-tasks, duration metrics`.

---

### Task 11: Task drawer — activity tab (timeline + composer)

**Files:**
- Create: `app/components/task/{TaskActivity,Timeline,CommentComposer}.vue`, `apps/web/e2e/activity.spec.ts`
- Modify: `TaskDrawer.vue` (tab wiring)

**Interfaces:** `Timeline { entries }` renders comments (author initials avatar, relative time via `Intl.RelativeTimeFormat('ar')`, sanitised HTML — render with `v-html` ONLY after passing through a tiny allowlist sanitiser `sanitizeHtml()` in `app/utils/sanitize.ts` (strip `<script>`, `on*` attrs, `javascript:` hrefs) — the server already sanitises; this is defence in depth) and tracking entries (`$t('tasks.activity.changed', { field: label, old, new })`, `set`/`cleared` variants when old/new empty). `CommentComposer` — `Textarea`, Ctrl/⌘+Enter posts, `usePostComment`, clears on success, shows `ApiError.message` on failure.

- [ ] **Step 1: Failing e2e**: open drawer → tab `النشاط` → type a comment → post → expect it at the top with author `Administrator`; change the state via the header menu → expect a tracking entry mentioning `الحالة`.
- [ ] **Step 2: Implement**; unit test `sanitizeHtml` (script stripped, `onclick` stripped, `href="javascript:..."` removed, `<b>` kept).
- [ ] **Step 3: Run**; **Step 4: Commit** `[ADD] web: task activity timeline and comment composer`.

---

### Task 12: مهامي — board tab with drag-and-drop by personal stage

**Files:**
- Create: `app/components/task/{TaskBoard,TaskCard}.vue`, `apps/web/e2e/board.spec.ts`
- Install: `npm -w apps/web install --ignore-scripts vue-draggable-plus@^0.6`
- Modify: `app/pages/tasks.vue`

**Interfaces:** `TaskBoard { params }` builds columns from `usePersonalStages()`; tasks from `useTasks(params)` (all pages loaded lazily; the board calls `fetchNextPage` until `!hasNextPage` up to 200 tasks); each column a `VueDraggable` list with `group="tasks"`; on `@add`/`@update` to a column → `useUpdateTask({ id, patch: { personal_stage_type_id: stage.id }, resolved: { personal_stage: {id,name} } })`. Keyboard fallback: each `TaskCard` has a `⋯` menu `نقل إلى…` listing stages. Cards show title, project, `DeadlineBadge`, priority flag, assignee initials; click opens the drawer. Folded stages (`fold: true`) render collapsed with a count.

- [ ] **Step 1: Failing e2e** `board.spec.ts`: create a task, open `/tasks?tab=board`, expect the card in the first column, `dragTo` the second column, expect it there, reload and expect it persisted; keyboard path: open the card menu → `نقل إلى…` → third stage → expect moved.
- [ ] **Step 2: Implement**; **Step 3: Run**; **Step 4: Commit** `[ADD] web: personal-stage board with drag-and-drop`.

---

### Task 13: Real-time — `useBus` websocket composable

**Files:**
- Create: `app/composables/useBus.ts`, `app/plugins/bus.client.ts`, `apps/web/e2e/realtime.spec.ts`

**Interfaces:** `useBus()` (client-only plugin instantiates one connection per tab after login): opens `new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/websocket`)`; on open sends `JSON.stringify({ event_name: 'subscribe', data: { channels: [], last: 0 } })` (the server adds the user's partner channel itself — verify the exact payload against `addons/bus/static/src/workers/websocket_worker.js` `_sendToServer` and the `subscribe` handler in `addons/bus/websocket.py`; adapt if a `version`/`options` key is required); on message parses the JSON array of `{ id, message: { type, payload } }`, tracks `last = id`, and for `type === 'nasq/task'` invalidates `taskKeys.detail(payload.id)`, `taskKeys.timeline(payload.id)` and `['tasks','list']`; reconnects with exponential backoff (1 s → 30 s) resending `last`; closes on logout. Exposes `connected: Ref<boolean>` for a subtle dot in the sidebar footer (title `متصل`/`غير متصل` — add the two keys to the locale files).

- [ ] **Step 1: Failing e2e** `realtime.spec.ts`: two browser contexts both logged in as admin; context A opens `/tasks`; context B patches the task name via `page.request`; A expects the row to show the new name within 5 s **without reload**; then B posts a comment while A has the drawer's activity tab open → A sees it.
- [ ] **Step 2: Implement**; verify the dev proxy carries the upgrade (`nitro.devProxy` from Task 1; if the Nitro dev proxy does not upgrade websockets, switch the client to connect directly to `ws://localhost:8069/websocket` **in dev only** via `runtimeConfig.public.wsUrl` and document that prod uses the same origin through Caddy).
- [ ] **Step 3: Run**; **Step 4: Commit** `[ADD] web: real-time task updates over the Odoo bus`.

---

### Task 14: TOTP step in the custom login

**Files:**
- Create: `odoo-addons/nasq_api/controllers/auth.py`, `tests/test_totp.py`, `apps/web/server/api/auth/totp.post.ts`, `apps/web/e2e/totp.spec.ts`
- Modify: `apps/web/server/api/auth/login.post.ts`, `apps/web/app/pages/login.vue`, `nasq_api/__manifest__.py` (`depends` += `auth_totp`), `controllers/__init__.py`, `tests/__init__.py`

**Interfaces:**
- `POST /api/v1/auth/totp {code}` (`type='json2'`, `auth='public'`, `readonly=False`): requires `request.session.get('pre_uid')` (set by `/web/session/authenticate` when MFA is pending — it returns `{uid: null}`), verifies via `user._check_credentials({'type': 'totp', 'token': int(code)}, {'interactive': True})` inside `user._assert_can_auth(user=user.id)`, then `request.session.finalize(request.env)`, `request.update_env(user=request.session.uid)`, returns `dump_me(...)`; errors: 401 `no_pending_login`, 401 `invalid_code`, 422 `invalid_code_format`.
- Nitro `login.post.ts`: when Odoo returns `result.uid === null` **and** no error, forward the cookie and respond `200 { ok: false, mfa: 'totp' }`; `totp.post.ts` (same-site + JSON gate) proxies to `/api/v1/auth/totp` with the cookie, forwards `Set-Cookie` (session rotates on finalize), returns `{ ok: true }`.
- Login page: after `mfa: 'totp'`, show the 6-digit step (`Input` `inputmode="numeric" autocomplete="one-time-code"`, label `auth.totpTitle`, hint `auth.totpHint`, button `auth.continue`); on success `refreshNuxtData('me')` → navigate.

- [ ] **Step 1: Failing Odoo test** `tests/test_totp.py` — mirror `addons/auth_totp/tests/test_totp.py`'s `TestTOTPMixin` approach: enable TOTP on `api_emp` with `user.with_user(user)._totp_try_setting(secret, code)` (generate `secret`/`code` with `passlib.totp.TOTP` exactly like Odoo's test), then `patch.object(auth_TOTP, 'match', return_value=True)` for the verification call; assert: `/web/session/authenticate` → `result.uid is None`; `POST /api/v1/auth/totp {code: '123456'}` → 200 with `login == 'api_emp'`; then `GET /api/v1/me` → 200. Negative: without a pending login → 401 `no_pending_login`; with `match` returning False → 401 `invalid_code`; `code: 'abc'` → 422.
- [ ] **Step 2: Implement** (server + Nitro + page); e2e `totp.spec.ts` covers only the *UI branch* by intercepting `POST /api/auth/login` with `page.route` to return `{ ok: false, mfa: 'totp' }` and `POST /api/auth/totp` to return `{ ok: true }`, asserting the code step renders and submits (the real TOTP path is covered by the Odoo test).
- [ ] **Step 3: Run** Odoo `/nasq_api` + e2e + `vue-tsc`; **Step 4: Commit** `[ADD] auth: TOTP second step for the custom login`.

---

### Task 15: Acceptance, docs, spec status

- [ ] **Step 1: Full sweep** — Odoo `-u nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo` `0 failed`; `ruff check odoo-addons`; `npm test`; `vue-tsc`; e2e (all specs); browser walkthrough: `/tasks` table → drawer → activity → board → real-time (two windows).
- [ ] **Step 2: Docs** — README: phase-1 dev notes (Tiptap client-only, `nitro.devProxy` ws, TOTP flow), update the "Patched generated files" list if any new shadcn file was edited; spec Phases table row 1 → `done <date>`; note `useNav` label-key change.
- [ ] **Step 3: Commit** `[IMP] docs: phase 1 acceptance`.

---

## Self-review

**Spec coverage:** "my tasks" definition → T3 domain; table (columns/filters/sort/pagination/inline state/empty state) → T9; board + DnD + folded stages + keyboard fallback → T12; drawer header/details/editor/sub-tasks/deps/attachments/metrics → T10; activity (comments + tracking, composer) → T5 + T11; transition rule (server) → T2/T4, UI → T8/T9; duration metrics → T3 serializer + T8 helpers + T9/T10 badges; real-time (partner channels, no ir.websocket override) → T6 + T13; API additions incl. `/me/personal-stages`, `/projects?minimal=1`, `/people` → T3–T5; zod mirror + live contract e2e → T7; vue-query → T1/T8; i18n → T1; TOTP → T14; error shape → T3 `api_handler`; tests per spec → each task. Tags: read-only chips (no tag endpoint) — consistent with the spec's "tags" field being display-only in phase 1 (spec says tags are editable in PATCH; **deviation**: the picker needs a tags endpoint that the spec's API list omits — T10 renders tags read-only; ledger it and add `GET /api/v1/tags` in phase 2 or as a follow-up).

**Placeholder scan:** T8 asks the implementer to "write in full" four composables following an explicit pattern with named keys and behaviours — acceptable (interfaces are fully specified); no TBD/TODO steps elsewhere. T5 `_display` and T13 subscribe payload carry explicit "verify against file X and adapt" instructions rather than guesses.

**Type consistency:** state names identical in T2 (`ALL_STATES` codes), T3 (`STATE_TO_API`), T7 (`TaskStateSchema`), T8 (`TaskState`); `Task`/`TaskDetail` key sets identical between T3 `dump_task*`, T3's test `assertEqual(set(item), …)`, and T7 schemas; `personal_stage_type_id` name identical in T3 whitelist, T4 test, T7 `TaskPatchSchema`, T12 mutation; error codes `unsupported_filter`, `unknown_field`, `invalid`, `invalid_state`, `transition_forbidden`, `not_found`, `forbidden`, `no_pending_login`, `invalid_code`, `invalid_code_format` used consistently; `taskKeys` shapes identical between T8 and T13.
