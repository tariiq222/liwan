# nasq HR-1 — Directory, Dept Admin & Documents Implementation Plan

> تاريخي. السياسة: [DESIGN.md](../../DESIGN.md). ليس تعليمات واجهة.

> **STOP — isolation banner.** Execute this plan **AFTER** nasq phase-1 is merged to `main`. Until that merge, work is **new-files-only**. **NEVER** edit `odoo-addons/nasq_api/controllers/people.py`, `odoo-addons/nasq_api/controllers/tasks.py`, `apps/web/app/composables/useTasks.ts`, `apps/web/app/composables/usePeople.ts`, or anything under `/Users/tariq/code/nasq` while the other team owns phase-1. Do not check out `phase-1`. Do not reuse the `docs/phase-2-projects` worktree. Prefer new files. After merge: wire imports / `depends` as Task 2 says; still never change the people picker.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship HR-1 — **الأشخاص** as a company directory (employee table + read-only card), a customer-admin department panel, and free-title **department** documents (required `department_id`, HTML body, attachments, search by name, no tags) — without touching `GET /api/v1/people?q=` (user id ≠ employee id).

**Architecture:** New addon `nasq_hr` owns `nasq.hr.document` (required `department_id` → `hr.department`) and document ACL/rules. Stock `hr.department` / `hr.employee` stay the org models. New `nasq_api` controllers (`hr_departments.py`, `hr_employees.py`, `hr_documents.py`) expose `/api/v1/hr/*` (`type='json2'`, `auth='user'`, serializer-whitelisted, no `sudo()`). `packages/contracts/src/hr.ts` mirrors the wire. Nuxt gets new `useHr*` composables and `app/components/hr/*`; `people.vue` is a shell only — documents live on the department panel / when a department is selected. Assignee picker (`usePeople` / `PersonRefSchema`) is out of scope.

**Tech Stack:** Odoo 19.0 CE (Python 3.12), Nuxt 4.5 / Vue 3.5 / TS, Tailwind v4, shadcn-vue, `@tanstack/vue-query`, `@tiptap/vue-3`, `@nuxtjs/i18n` (`ar` default), zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-nasq-hr-design.md` (refines `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`)

## Global Constraints

- Branch from `main` **after** phase-1 merge (tag `v0.1.0-phase1` or the merge commit). Until then, only add files that cannot collide. Odoo checkout `/Users/tariq/code/odoo` is never modified; never run `git` there.
- Odoo commands from `/Users/tariq/code/odoo`: `.venv/bin/python odoo-bin -c odoo.conf -d nasq_test -u nasq_core,nasq_pmo,nasq_api,nasq_hr --test-tags /nasq_core,/nasq_pmo,/nasq_api,/nasq_hr --http-port=8169` (first install of `nasq_hr` uses `-i`). Timeout 300000 ms. Never use `odoo19` for tests.
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; manifests: `'license': 'LGPL-3'`, `'version': '19.0.1.0.0'`, `'author': 'Tariq Alwalidi'`. No OCA, no Enterprise. `ruff check odoo-addons` clean.
- API: `@http.route('/api/v1/hr/...', type='json2', auth='user', methods=[...], readonly=<bool>)` + `@api_handler`. Errors `{"code":"<snake_case>","message":"<human>","field"?}`. Never `type='http'` for JSON, never `auth='bearer'` for browser traffic, never `sudo()`.
- **Keep** `GET /api/v1/people?q=` unchanged. Directory ids are `hr.employee` ids. Picker ids are `res.users` ids. Do not change `PersonRefSchema`.
- ACL: `nasq_core.group_employee` reads company-wide; `nasq_core.group_customer_admin` writes departments + documents; department manager gets **no** extra publish; fix groups/rules instead of sudo.
- Frontend: Arabic default, `$t()`/`t()` only, Tailwind logical properties (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`), tokens unchanged. Documents: Tiptap for admin, sanitised HTML for employees. No document tags.
- npm: `--ignore-scripts` on install; never edit `~/.npmrc`.
- Commit messages: `[ADD]|[IMP]|[FIX] <scope>: <summary>` + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task.
- Playwright: `cd apps/web && npm run test:e2e`; login `admin`/`admin`. Employee users are created through Odoo, never the UI.

## File Structure

Prefer **new** files. Italics = touch only **after** phase-1 merge.

```
odoo-addons/nasq_hr/                          NEW
├── __init__.py · __manifest__.py             depends: ['nasq_core', 'hr', 'mail']
├── models/__init__.py · models/hr_document.py
├── security/ir.model.access.csv · security/hr_document_rules.xml
└── tests/__init__.py · tests/test_hr_document_acl.py

odoo-addons/nasq_api/
├── controllers/hr_departments.py             NEW
├── controllers/hr_employees.py               NEW
├── controllers/hr_documents.py               NEW
├── serializers/hr_department.py · hr_employee.py · hr_document.py   NEW
├── tests/test_hr_departments.py · test_hr_employees.py · test_hr_documents.py  NEW
├── controllers/__init__.py                   AFTER MERGE: import the three hr_* modules
├── tests/__init__.py                         AFTER MERGE: import the three test modules
└── __manifest__.py                           AFTER MERGE: depends += ['nasq_hr']

packages/contracts/src/
├── hr.ts · __tests__/hr.test.ts              NEW
└── personal-stage.ts                         DO NOT CHANGE PersonRefSchema

apps/web/
├── app/composables/useHrDepartments.ts · useHrEmployees.ts · useHrDocuments.ts  NEW
├── app/composables/__tests__/hrKeys.test.ts  NEW (query-key helpers only)
├── app/components/hr/                        NEW — DirectoryTable, DeptPanel, EmployeeCard,
│                                               DocumentList, DocumentReader, DocumentEditor
├── app/pages/people.vue                      SHELL ONLY (mount the new components)
├── i18n/locales/ar.json · en.json            AFTER MERGE: add `hr.*` keys; do not rewrite others
└── e2e/hr-directory.spec.ts · hr-documents.spec.ts · contracts-hr.spec.ts  NEW
```

**Do not create or edit:** `people.py`, `tasks.py`, `usePeople.ts`, `useTasks.ts`.

---

### Task 1: `nasq_hr` scaffold + `nasq.hr.document` + ACL/rules

**Files:**
- Create: `odoo-addons/nasq_hr/__init__.py`, `__manifest__.py`, `models/__init__.py`, `models/hr_document.py`, `security/ir.model.access.csv`, `security/hr_document_rules.xml`, `tests/__init__.py`, `tests/test_hr_document_acl.py`

**Interfaces:**
- Model `nasq.hr.document`: `name` (Char, required), `body` (Html), `attachment_ids` (Many2many `ir.attachment`), `department_id` (Many2one `hr.department`, required, indexed), `company_id` (Many2one `res.company`, required, default user company, indexed). No `tag_ids`. No `employee_id`. Documents are department documents, not personnel files.
- ACL: `nasq_core.group_employee` read; `nasq_core.group_customer_admin` read/write/create/unlink. `ir.rule` company-scoped for both. Department manager is not a group and gets no extra access.
- Manifest depends `nasq_core`, `hr`, `mail`. Version `19.0.1.0.0`, LGPL-3, author Tariq Alwalidi.

- [ ] **Step 1:** Write failing `TransactionCase` tests: document without `department_id` is invalid; employee can `search`/`read` a document in their company (including a document on **another** department) and cannot `create`; customer_admin can `create`/`write` on any department; a second-company document is invisible; no test uses `sudo()` to pass.
- [ ] **Step 2:** Implement model, CSV access, XML rules. No `sudo` in the addon.
- [ ] **Step 3: Verify**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_hr --test-tags /nasq_hr --http-port=8169 --stop-after-init
```

Expected: 0 failed. Then `ruff check odoo-addons/nasq_hr`.

- [ ] **Step 4: Commit** `[ADD] nasq_hr: document model and company-wide ACL`

---

### Task 2: NEW `nasq_api` HR controllers + serializers + HttpCase

**Files:**
- Create: `odoo-addons/nasq_api/controllers/hr_departments.py`, `hr_employees.py`, `hr_documents.py`, `serializers/hr_department.py`, `hr_employee.py`, `hr_document.py`, `tests/test_hr_departments.py`, `test_hr_employees.py`, `test_hr_documents.py`
- After phase-1 merge only: import those modules from `controllers/__init__.py`, `serializers/__init__.py` (if it lists modules), `tests/__init__.py`; add `'nasq_hr'` to `nasq_api/__manifest__.py` `depends`.
- **Never** edit `people.py` or `tasks.py`.

**Interfaces:**
- All routes `type='json2'`, `auth='user'`, `@api_handler`, whitelist dump/parse. Query strings from `request.httprequest.args` (json2 does not pass them as kwargs).
- `GET/POST /api/v1/hr/departments`, `GET/PATCH /api/v1/hr/departments/{id}` — dump `id, name, parent_id, manager {id,name}|null, child_ids`; parse `name, parent_id, manager_id`. Writes: customer_admin; else 403 `forbidden`.
- `GET /api/v1/hr/employees?q=&department_id=&limit=&offset=`, `GET /api/v1/hr/employees/{id}` — dump `id` (**employee** id), `name`, `job_title`, `department {id,name}|null`, `work_email`, `work_phone`, `user_id` (nullable). No PATCH in HR-1. Search `name ilike`. Read via `hr.employee.public` for employees if that is what ACL allows; still serialize **employee** id, not `user_id` as `id`.
- `GET/POST /api/v1/hr/documents?q=&department_id=`, `GET/PATCH /api/v1/hr/documents/{id}` — dump `id, name, department {id,name}, body, attachment_ids [{id,name,mimetype,file_size}], write_date`; parse on create `name, body, department_id` (required); parse on PATCH `name, body` only (no reparent). `q` filters `name ilike`; `department_id` filters the list. No tags. Writes: customer_admin on any department.
- 404 `not_found`, 422 `invalid` (empty name, missing `department_id` on create, bad ints). Every write returns full detail.
- Regression in the employees HttpCase (after merge, when `people.py` exists): `GET /api/v1/people?q=` still returns user ids and must not equal the employee id for the same person.

- [ ] **Step 1:** Write failing `NasqApiCase` tests for the three files (employee read vs admin write; 403/404/422; document without `department_id` is 422; list by `department_id`; employee can read another department's doc; document search by name; employee id ≠ user id).
- [ ] **Step 2:** Implement controllers + serializers. No `sudo()`. Do not import from `people.py`.
- [ ] **Step 3:** After phase-1 merge, add the `__init__.py` imports and `depends: nasq_hr`. Until merge, leave those existing files untouched.
- [ ] **Step 4: Verify**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -u nasq_api,nasq_hr --test-tags /nasq_api,/nasq_hr --http-port=8169 --stop-after-init
```

Expected: new HR cases green; existing `/nasq_api` cases still green.

- [ ] **Step 5: Commit** `[ADD] nasq_api: /api/v1/hr departments, employees, documents`

---

### Task 3: `packages/contracts/src/hr.ts` + tests

**Files:**
- Create: `packages/contracts/src/hr.ts`, `packages/contracts/src/__tests__/hr.test.ts`
- Modify (after merge, one line): `packages/contracts/src/index.ts` — `export * from './hr'`
- **Do not change** `PersonRefSchema` (lives in `personal-stage.ts` after phase-1).

**Interfaces:**
- `HrDepartmentSchema`, `HrEmployeeSchema`, `HrDocumentAttachmentSchema`, `HrDocumentSchema`, `HrDocumentDetailSchema` — `.strict()` objects matching Task 2 dump keys. `HrEmployeeSchema.id` is employee id; optional nullable `user_id` is not the record id.
- List wrappers if other contracts use them; otherwise tests parse arrays of the item schema.
- No tags field. Do not reuse `PersonRefSchema` for employees.

- [ ] **Step 1:** Failing schema tests: valid fixtures parse; extra keys fail; employee `id` vs `user_id` both present and different in a fixture; document has `name`+`department {id,name}`+`body`+`attachment_ids` and rejects `tags`.
- [ ] **Step 2:** Implement `hr.ts` and export it.
- [ ] **Step 3: Verify** `npm test` (repo root) — new tests pass; existing PersonRef tests unchanged.
- [ ] **Step 4: Commit** `[ADD] contracts: HR department, employee, document schemas`

---

### Task 4: NEW Vue composables/components; `people.vue` shell; Tiptap; i18n

**Files:**
- Create: `apps/web/app/composables/useHrDepartments.ts`, `useHrEmployees.ts`, `useHrDocuments.ts`, `apps/web/app/components/hr/DirectoryTable.vue`, `DeptPanel.vue`, `EmployeeCard.vue`, `DocumentList.vue`, `DocumentReader.vue`, `DocumentEditor.vue`
- Modify: `apps/web/app/pages/people.vue` (**shell only** — compose the new components; do not inline API calls)
- After merge: add `hr.*` keys to `apps/web/i18n/locales/ar.json` and `en.json` (do not rewrite existing keys)
- **Never** edit `usePeople.ts` or `useTasks.ts`

**Interfaces:**
- Composables call `useApi()` → `/api/v1/hr/*`. Query keys `['hr','departments']`, `['hr','employees', params]`, `['hr','employee', id]`, `['hr','documents', params]`, `['hr','document', id]`. Document/department writes replace cache with the server body.
- `people.vue`: title `$t('hr.directory.title')` (العربية: الدليل / الأشخاص). Hosts directory table, admin dept panel trigger, employee `Sheet` overlay. Documents live on the department panel / when a department is selected — not a company-wide dump as the only view. Company-wide search by title is an extra. No assignee-picker behaviour.
- `EmployeeCard`: read-only. `DeptPanel` and `DocumentEditor`: `customer_admin` only (hide write UI for employees; server still 403s).
- `DocumentEditor`: Tiptap (bold, italic, lists, links), RTL, stores HTML. Employees use `DocumentReader` (sanitised HTML).
- i18n (ar): `hr.directory.title` الأشخاص; columns الاسم · المسمى الوظيفي · القسم; `hr.card.title` بطاقة الموظف; `hr.depts.title` الأقسام; `hr.depts.new` قسم جديد; `hr.depts.manager` مدير القسم; `hr.docs.title` المستندات; `hr.docs.new` مستند جديد; `hr.docs.empty` لا مستندات; `hr.directory.empty` لا موظفون بعد; `hr.docs.search` بحث بالعنوان…. English mirrors every key.

- [ ] **Step 1:** Composables + query keys. Unit-test key shapes if a small helper is extracted.
- [ ] **Step 2:** Components + shell `people.vue`. Logical Tailwind only. `$t()` only.
- [ ] **Step 3:** Add `hr.*` locale keys (after i18n exists from phase-1).
- [ ] **Step 4: Verify** `npx -w apps/web vue-tsc --noEmit` and `npm -w apps/web run test`.
- [ ] **Step 5: Commit** `[ADD] web: HR directory, dept panel, documents on /people`

---

### Task 5: Playwright + contract e2e on `/api/v1/hr/*`

**Files:**
- Create: `apps/web/e2e/hr-directory.spec.ts`, `apps/web/e2e/hr-documents.spec.ts`, `apps/web/e2e/contracts-hr.spec.ts`

**Interfaces:**
- Directory e2e: login admin → `/people` shows table; search; open card (read-only, no save). Employee user (created in Odoo) sees the table and card, does **not** see قسم جديد / مستند جديد.
- Documents e2e: admin selects a department, creates a document with title + body on that department, finds it by name search, opens it. Employee can read a document on another department, cannot edit. No tag UI.
- Contract e2e: authenticated `GET /api/v1/hr/departments`, `/api/v1/hr/employees`, `/api/v1/hr/documents` bodies parse with the zod schemas. Also `GET /api/v1/people?q=` still parses as `PersonRefSchema` (user id), proving the picker is untouched.

- [ ] **Step 1:** Write the three spec files (failing).
- [ ] **Step 2:** Fix only HR-1 UI/API gaps inside the allowed new files / shell.
- [ ] **Step 3: Verify** `cd apps/web && npm run test:e2e` — new specs green; existing specs still green.
- [ ] **Step 4: Commit** `[ADD] web: HR directory and document e2e + live contracts`

---

### Task 6: lint / tests gate

**Files:** none new. Do not drive-by refactor phase-1 files.

- [ ] **Step 1:** `ruff check odoo-addons`
- [ ] **Step 2:** Odoo `nasq_test` with `--test-tags /nasq_core,/nasq_pmo,/nasq_api,/nasq_hr` — 0 failed
- [ ] **Step 3:** `npm test` (repo root) and `npx -w apps/web vue-tsc --noEmit`
- [ ] **Step 4:** `cd apps/web && npm run test:e2e`
- [ ] **Step 5:** Confirm `git grep -n sudo odoo-addons/nasq_hr odoo-addons/nasq_api/controllers/hr_*.py` is empty; `people.py` / `usePeople.ts` / `PersonRefSchema` diffs are empty.
- [ ] **Step 6: Commit** only if a gate fix is required: `[FIX] hr: lint and test gate`

---

## Self-review

**Spec coverage:** phases HR-1/2/3 + payroll out → this plan implements HR-1 only. Directory `/people`, dept panel, read-only card, department documents (required `department_id`, free title, Html, attachments, search by name, no tags; primary view when a department is selected) → T4/T5. `/api/v1/hr/*` + unchanged `GET /api/v1/people?q=` → T2/T3/T5. ACL employee read company-wide (including other departments' docs) / admin write on any department / no dept-manager publish / no sudo → T1/T2/T6. `nasq.hr.document` with required `department_id` → T1. Testing future-only in the spec → T5/T6 here.

**Collision:** banner + file list forbid `people.py`, `tasks.py`, `useTasks.ts`, `usePeople.ts`, `PersonRefSchema`. Controllers are new files; `__init__.py` / `depends` wait for phase-1 merge.

**No huge dumps:** tasks specify files, interfaces, checkbox steps, verify command, commit message — implementers follow existing `nasq_api` / vue-query / Tiptap patterns rather than pasted source.
