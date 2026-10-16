> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# webvue Phase 3b — People Access, Branding, and Account Implementation Plan

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). ليس تعليمات واجهة.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extend the delivered `/hr` directory with employee/access administration, add company branding settings and self-service password change, while preserving the shipped HR document system and PMO people picker.

**Architecture:** Extend the existing `webvue_hr` controllers, serializers, models, contracts, composables, components, and tests in place. Keep list envelopes and `Hr*` exports compatible; shared branding/account behavior stays in `webvue_api` and `packages/contracts/src/common`. Implement in dependency waves and run the complete gate once after the feature tasks.

**Tech Stack:** Odoo 19.0 CE, Python 3.12, Nuxt 4/Vue 3/TypeScript, Tailwind v4, shadcn-vue, `@tanstack/vue-query`, zod 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-webvue-phase-3b-people-branding-design.md`

**Status:** Completed locally on `codex/phase-3b` on 2026-09-05. Final evidence:
Odoo aggregate 182, contracts 52, web unit 152, and Playwright 47 green;
`ruff`, `vue-tsc`, production build, and preservation checks passed. Canonical
`main` remains the pre-Phase-3b baseline; no merge, push, or deployment is
claimed. See `2026-09-05-webvue-phase-3b-delivery.md`.

## Global Constraints

- After workspace reorganization is merged, create a fresh Codex task worktree
  from canonical `/Users/tariq/code/nasq` `main`. Do not execute phase 3b in the
  temporary integration worktree. HR-1 must be present on that main; do not
  recreate `webvue_hr` or replace its manifest, barrels, or locale files.
- Treat `archive/pre-reorganization-20260905` at `e4e8e9b` and the recovery bundle as quarantined WIP. Consult individual hunks only after comparing them to current code; never merge or copy the old plan or whole files.
- `/hr` is canonical. The heading-only `apps/web/app/pages/people.vue` is retired by workspace integration; do not recreate it. Do not change `odoo-addons/webvue_pmo/controllers/people.py`, `apps/web/app/composables/usePeople.ts`, or PMO `PersonRefSchema`.
- Preserve all `webvue.hr.document` model/security/controller/serializer/composable/component/test behavior and all `HrDocument*` exports and `hr.docs.*` messages.
- HR list responses remain `{items, total}`. All HR contract additions keep an `Hr` prefix; never export another root `RefSchema`.
- Every API write is serializer-whitelisted and returns the full resource except successful department delete, which returns 204.
- Add no `sudo()`. The existing anonymous `GET /api/v1/branding` retains its established `sudo()`; authenticated admin operations run as the caller.
- Passwords are never logged, returned, placed in query keys, or cached. Minimum length is 8.
- Arabic is default. Additive locale edits only; use logical Tailwind
  properties, current design tokens, one primary action per surface, explicit
  Save actions, and hydration guards on SSR-rendered interactive controls.
- Preserve unrelated work. Each task commits only its explicit paths; the integration lead runs the final gate and resolves cross-task conflicts.
- Fresh Odoo gate uses a disposable DB and `-i webvue_core,webvue_api,webvue_pmo,webvue_hr`; never use the development DB for tests.

---

## Compatibility contract locked before implementation

```ts
type HrRef = { id: number; name: string }
type HrEmployeeAccess = {
  user_id: number
  login: string
  role: 'employee' | 'admin' | 'vendor'
  active: boolean
}
type HrEmployee = {
  id: number
  name: string
  job_title: string
  department: HrRef | null
  work_email: string
  work_phone: string
  user_id: number | null
  manager: HrRef | null
  active: boolean
  access: HrEmployeeAccess | null
}
type HrEmployeeList = { items: HrEmployee[]; total: number }
type HrDepartment = {
  id: number
  name: string
  parent_id: number | null
  manager: HrRef | null
  child_ids: number[]
  employee_count: number
}
type HrDepartmentList = { items: HrDepartment[]; total: number }
type DepartmentInUseDetails = { employees: number; children: number; documents: number }
```

The following existing exports remain: `HrDepartmentSchema`,
`HrEmployeeSchema`, `HrDocumentAttachmentSchema`, `HrDocumentSchema`,
`HrDocumentDetailSchema`, and all three `Hr*ListSchema` exports.

## File map and waves

| Wave | Task | Ownership | Dependency |
|---|---|---|---|
| W1 | T1 HR contracts/error details | contracts HR + shared error contract | none |
| W1 | T2 HR model rules | `webvue_hr` employee/department models and model tests | none |
| W1 | T3 branding/password contracts | common branding/password contracts | none |
| W2 | T4 HR API | existing HR serializers/controllers/HttpCase tests | T1, T2 |
| W2 | T5 branding API | `webvue_api` branding files | T3 |
| W2 | T6 password API | `webvue_api` me files | T2 password constant, T3 |
| W3 | T7 `/hr` data and UI | HR composables/components/page/locales | T1, T4 |
| W3 | T8 branding UI | settings branding files/locales | T3, T5 |
| W3 | T9 account UI | account/sidebar/common locales | T3, T6 |
| W4 | T10 live acceptance and documentation | e2e + repository docs/gate | T4–T9 |

Tasks inside a wave have disjoint mutable files. T4 and T6 both consume the
password constant produced by T2 but do not modify its file.

### Task 1: Reconcile HR contracts and structured error details

**Files:**
- Modify: `packages/contracts/src/hr/index.ts`
- Modify: `packages/contracts/src/hr/__tests__/schemas.test.ts`
- Modify: `packages/contracts/src/common/error.ts`
- Create: `packages/contracts/src/common/__tests__/error-details.test.ts`
- Modify: `apps/web/app/composables/useApi.ts`
- Create: `apps/web/app/composables/__tests__/useApi.test.ts`

**Interfaces:**
- Preserve every existing `HrDocument*` declaration and list wrapper.
- Produce `HrRefSchema`, `HrAccessRoleSchema`, `HrWritableRoleSchema`,
  `HrEmployeeAccessSchema`, `HrEmployeeCreateSchema`, `HrEmployeePatchSchema`,
  `HrAccessGrantSchema`, `HrAccessPatchSchema`, `HrDepartmentCreateSchema`, and
  `HrDepartmentPatchSchema`.
- Extend `ApiErrorSchema` with optional strict numeric `details`; extend web
  `ApiError` with `details?: Record<string, number>`.

- [x] **Step 1: Write contract failures before changing schemas.** Add fixtures
  that parse the exact compatibility block above, a `{items,total}` employee
  list, and the existing document fixture in the same run. Assert extra keys,
  `role: 'vendor'` on a write, blank names, passwords shorter than 8, and a
  top-level employee array all fail. Assert
  `{code:'department_in_use',message:'x',details:{employees:1,children:0,documents:2}}`
  parses.

```ts
expect(HrEmployeeListSchema.parse({ items: [employee], total: 1 }).items[0]?.work_phone).toBe('+9665')
expect(() => HrEmployeeListSchema.parse([employee])).toThrow()
expect(() => HrAccessGrantSchema.parse({ password: '12345678', role: 'vendor' })).toThrow()
expect(ApiErrorSchema.parse(inUse).details?.documents).toBe(2)
```

- [x] **Step 2: Run focused tests** from `packages/contracts` with
  `npx vitest run src/hr/__tests__/schemas.test.ts src/common/__tests__/error-details.test.ts`.
  Expected: failures for missing additive fields/schemas and `details`; the HR
  file's existing document tests must still execute.
- [x] **Step 3: Implement the schemas.** Use `HrRefSchema` internally. Keep
  `HrEmployeeSchema`/`HrDepartmentSchema` names, add the new fields, and keep
  existing list/document exports. Write schemas are `.strict()` and accept
  nullable relation ids where the API clears a relation.
- [x] **Step 4: Thread error details through `useApi`.** Parse the additive
  field and pass it to `new ApiError(status, code, message, field, details)`.
  Add a unit test that mocks a 422 response and observes all three counts.
- [x] **Step 5: Run the two focused contract files and**
  `npx vitest run app/composables/__tests__/useApi.test.ts` from `apps/web`.
  Expected: green;
  `rg -n "export const RefSchema" packages/contracts/src` still reports only
  the PMO declaration.
- [x] **Step 6: Commit** only the listed paths with
  `[IMP] contracts: extend compatible HR people and API error shapes`.

### Task 2: Add employee access and safe department lifecycle model rules

**Files:**
- Create: `odoo-addons/webvue_hr/rules.py`
- Create: `odoo-addons/webvue_hr/models/hr_employee.py`
- Create: `odoo-addons/webvue_hr/models/hr_department.py`
- Modify: `odoo-addons/webvue_hr/models/__init__.py`
- Create: `odoo-addons/webvue_hr/tests/test_employee_model.py`
- Create: `odoo-addons/webvue_hr/tests/test_department_model.py`
- Modify: `odoo-addons/webvue_hr/tests/__init__.py`
- Modify: `odoo-addons/webvue_api/controllers/common.py` (add `MIN_PASSWORD_LENGTH = 8` and optional error `details` support)

**Interfaces:**
- `WebVueHrRule(code, message, field=None, status=422, details=None)`.
- `ApiError(status, code, message, field=None, details=None)` and
  `error_response(..., details=None)` preserve the existing envelope when
  details are absent and add `{details}` only for structured refusals.
- Employee helpers:
  `_webvue_create(vals)`, `_webvue_write(vals)`, `_webvue_archive()`,
  `_webvue_unarchive()`, `_webvue_grant_access(password, role)`,
  `_webvue_update_access(role=None, password=None)`, `_webvue_revoke_access()`.
- Department helpers: `_webvue_create(vals)`, `_webvue_write(vals)`,
  `_webvue_usage() -> dict`, `_webvue_delete()`.

- [x] **Step 1: Write employee model tests.** Cover employee 403-equivalent
  `AccessError`; grant with normalized email; missing/duplicate email; weak
  password; invalid role; grant on archived employee; re-grant same inactive
  user id; exact role change in both directions while preserving unrelated
  groups; password-only reset; no-op access patch; self role/deactivation;
  vendor protection; archive deactivates both records; unarchive keeps access
  off; work-email edit leaves login unchanged.
- [x] **Step 2: Write department model tests.** `_webvue_usage()` counts active
  and archived employees, direct children, and `webvue.hr.document` rows. Delete
  succeeds only when all counts are zero and otherwise raises
  `department_in_use` with all three counts. Include a parent-cycle rejection.
- [x] **Step 3: Run focused Odoo model tests on a disposable DB** with tags
  `/webvue_hr:TestEmployeeModel,/webvue_hr:TestDepartmentModel,/webvue_hr:TestHrDocumentAcl`.
  Expected: missing helper failures while the existing document ACL tests pass.
- [x] **Step 4: Implement the rules and shared error extension.** Add the
  password constant and optional `details` plumbing to the existing common
  handler; all old callers keep working unchanged. Admin checks use
  `webvue_core.group_customer_admin`. Vendor-linked employees reject archive and
  access writes with status 403. Role updates remove only the competing webvue
  role and preserve unrelated explicit groups. User creation uses normalized
  work email and `no_reset_password=True`; passwords never leave ORM writes.
- [x] **Step 5: Implement archive/delete semantics.** Use `active_test=False`
  when counting employees. Do not bypass the existing document restriction;
  surface it before unlink as structured `department_in_use`.
- [x] **Step 6: Re-run those focused model/document ACL classes.** The
  orchestrator owns ruff in T10.
- [x] **Step 7: Commit** with
  `[ADD] webvue_hr: employee access and safe department lifecycle rules`.

### Task 3: Add shared branding and password contracts

**Files:**
- Modify: `packages/contracts/src/common/branding.ts`
- Create: `packages/contracts/src/common/password.ts`
- Modify: `packages/contracts/src/common/index.ts`
- Create: `packages/contracts/src/common/__tests__/branding-admin.test.ts`
- Create: `packages/contracts/src/common/__tests__/password.test.ts`

**Interfaces:**
- `BrandingPatchSchema`: strict non-empty partial of trimmed `name` (1–100),
  `primary_color` matching `#rrggbb`, and raw-base64 `logo` without `data:`.
- `PasswordChangeSchema`: strict `{current: nonempty string, new: min(8)}`;
  export `MIN_PASSWORD_LENGTH = 8`.

- [x] **Step 1:** Add tests for valid partial branding patches and password
  changes; reject empty patch, blank/long name, bad colour, `data:` logo,
  missing current, short new password, and extra keys.
- [x] **Step 2:** From `packages/contracts`, run
  `npx vitest run src/common/__tests__/branding-admin.test.ts src/common/__tests__/password.test.ts`;
  expect missing-schema failures.
- [x] **Step 3:** Implement and export the schemas without changing the
  four-field `BrandingSchema` or `MeSchema`.
- [x] **Step 4:** Re-run those two focused files and commit
  `[ADD] contracts: branding patch and password change inputs`.

### Task 4: Extend the existing HR API without duplicating routes

**Files:**
- Modify: `odoo-addons/webvue_hr/serializers/hr_employee.py`
- Modify: `odoo-addons/webvue_hr/serializers/hr_department.py`
- Modify: `odoo-addons/webvue_hr/controllers/hr_employees.py`
- Modify: `odoo-addons/webvue_hr/controllers/hr_departments.py`
- Create: `odoo-addons/webvue_hr/controllers/common.py`
- Modify: `odoo-addons/webvue_hr/tests/common.py`
- Modify: `odoo-addons/webvue_hr/tests/test_hr_employees.py`
- Create: `odoo-addons/webvue_hr/tests/test_hr_access.py`
- Modify: `odoo-addons/webvue_hr/tests/test_hr_departments.py`
- Modify: `odoo-addons/webvue_hr/tests/__init__.py`

**Interfaces:**
- Extend the existing controller classes; do not create `employees.py` or
  `departments.py`, and do not alter `hr_documents.py`.
- `dump_employee(record)` returns the locked additive shape.
- `parse_employee_create(payload)` and `parse_employee_patch(payload)` return
  whitelisted ORM values. `parse_access_grant/patch` validate bodies.
- `dump_department()` keeps `parent_id`/`child_ids` and adds
  `employee_count`.
- `hr_rule_handler(func)` converts `WebVueHrRule` into `ApiError` with status,
  code, field, and details; place it inside `@api_handler` on mutation routes.

- [x] **Step 1: Expand endpoint key-set tests.** Existing active list/get tests
  must now expect the additive fields and the paginated wrapper. Add POST/PATCH,
  archived-only list, archive/unarchive, cross-company invisibility, and
  login-not-renamed cases. Assert a
  plain employee gets 403 before any referenced-record lookup.
- [x] **Step 2: Add access/session HttpCase tests.** Prove every business error,
  grant/re-grant, role changes, password reset, revoke, self guards, and vendor
  protection. Open a target session before admin reset/revoke and prove its
  next `/api/v1/me` fails; prove an untouched session remains valid.
- [x] **Step 3: Extend department tests.** Assert `employee_count` includes an
  archived employee. DELETE returns 204 when unused and 422 with exact
  `{employees,children,documents}` counts for each blocking reference.
- [x] **Step 4: Run focused endpoint tests** with tags
  `/webvue_hr:TestHrEmployees,/webvue_hr:TestHrAccess,/webvue_hr:TestHrDepartments,/webvue_hr:TestHrDocuments`.
  Expected failures are missing routes/keys only; existing document endpoint
  tests must remain green.
- [x] **Step 5: Implement serializers first, then extend the existing routes.**
  Preserve `q`, `department_id`, `limit`, `offset`, ordering, and total count.
  `archived=1|true` is archived-only/admin-only. Active non-admin reads use
  `hr.employee.public`; archived reads and all writes use `hr.employee` after
  the admin check, with `active_test=False`.
- [x] **Step 6: Map `WebVueHrRule` to `ApiError`, including `details`.** Return
  full employee bodies for every mutation and 204 for department deletion.
- [x] **Step 7: Re-run those four focused HR classes.** Cross-pillar PMO people
  regression belongs to the orchestrator's T10 contract gate.
- [x] **Step 8: Commit** `[IMP] webvue_hr: employee administration and department delete API`.

### Task 5: Add authenticated branding administration

**Files:**
- Modify: `odoo-addons/webvue_api/serializers/company.py`
- Modify: `odoo-addons/webvue_api/controllers/branding.py`
- Modify: `odoo-addons/webvue_api/tests/test_branding.py`

**Interfaces:**
- `parse_branding_vals(payload)` accepts the exact contract from T3.
- `dump_branding(company)` retains four keys and versions `logo_url`.
- `GET/PATCH /api/v1/admin/branding` requires customer admin; vendor qualifies
  through the implied group.

- [x] **Step 1:** Add tests for employee GET/PATCH 403, admin GET, partial
  name/colour PATCH, 1px PNG/JPEG acceptance, malformed base64/GIF/over-1-MiB
  rejection, unknown fields, empty patch, and a changed versioned logo URL.
- [x] **Step 2:** Run focused Odoo classes
  `/webvue_api:TestBrandingEndpoint,/webvue_api:TestAdminBranding`; expect
  404/validation failures.
- [x] **Step 3:** Implement parser and routes. Keep the public cache header and
  its existing anonymous-read `sudo()`; use caller rights on admin routes.
- [x] **Step 4:** Re-run those focused classes; the orchestrator owns ruff.
  Commit
  `[ADD] webvue_api: authenticated company branding updates`.

### Task 6: Add self-service password change with session continuity

**Files:**
- Modify: `odoo-addons/webvue_api/controllers/me.py`
- Modify: `odoo-addons/webvue_api/tests/test_me.py`

**Interfaces:**
- `POST /api/v1/me/password {current,new} -> Me`.
- The current session token is recomputed after success; other existing
  sessions naturally fail after the password hash changes.

- [x] **Step 1:** Add tests for anonymous 403, missing/wrong current password,
  weak new password, exact error fields, successful `Me` response, same-cookie
  `/me` success after change, new credential success, old credential failure,
  and a separately opened old session failing.
- [x] **Step 2:** Run focused Odoo classes
  `/webvue_api:TestMeEndpoint,/webvue_api:TestChangePassword`; expect route 404.
- [x] **Step 3:** Implement using Odoo's `res.users.change_password`, catch only
  credential denial as `wrong_password`, flush, and recompute the caller's
  session token. Do not return or cache either password.
- [x] **Step 4:** Re-run those focused classes; the orchestrator owns ruff.
  Commit
  `[ADD] webvue_api: self password change with session continuity`.

### Task 7: Extend the canonical `/hr` data layer and UI

**Files:**
- Modify: `apps/web/app/composables/useHrEmployees.ts`
- Modify: `apps/web/app/composables/useHrDepartments.ts`
- Create: `apps/web/app/composables/hrAccess.ts`
- Create: `apps/web/app/composables/__tests__/hrAccess.test.ts`
- Create: `apps/web/app/composables/__tests__/hrAdmin.test.ts`
- Modify: `apps/web/app/components/hr/DirectoryTable.vue`
- Modify: `apps/web/app/components/hr/EmployeeCard.vue`
- Modify: `apps/web/app/components/hr/DeptPanel.vue`
- Create: `apps/web/app/components/hr/DepartmentTable.vue`
- Create: `apps/web/app/components/hr/DepartmentDialog.vue`
- Create: `apps/web/app/components/hr/AccessBadge.vue`
- Create: `apps/web/app/components/hr/CreateEmployeeDialog.vue`
- Create: `apps/web/app/components/hr/EmployeeDialog.vue`
- Create: `apps/web/app/components/hr/EmployeeGeneralForm.vue`
- Create: `apps/web/app/components/hr/EmployeeAccessPanel.vue`
- Create: `apps/web/app/components/hr/SetPasswordDialog.vue`
- Modify: `apps/web/app/pages/hr.vue`
- Modify: `apps/web/i18n/locales/ar/hr.json`
- Modify: `apps/web/i18n/locales/en/hr.json`

**Interfaces:**
- Extend `HrEmployeeListParams` with `archived?: boolean`, `limit?`, `offset?`.
- Add mutations `useCreateHrEmployee`, `useUpdateHrEmployee`,
  `useArchiveHrEmployee`, `useUnarchiveHrEmployee`, `useGrantHrAccess`,
  `useUpdateHrAccess`, `useRevokeHrAccess`; none are optimistic.
- Add `useDeleteHrDepartment`; on success invalidate departments, employees,
  and documents.
- `hrAccess.ts` maps exact wire state to locale keys for no account, employee,
  admin, vendor, and access stopped.

- [x] **Step 1:** Unit-test badge mapping, archived parameter serialization,
  and mutation cache invalidation. Password bodies must never appear in query
  keys or persisted cache data.
- [x] **Step 2:** Extend composables against T1/T4 schemas. Employee mutations
  replace detail/list cache or invalidate `['hr','employees']`; they also
  invalidate `['people']` after access changes because PMO picker membership
  may change, without editing the picker itself.
- [x] **Step 3:** Build the employee dialogs. `EmployeeCard` remains the
  read-only presentation for non-admins. Admin general fields save together;
  access actions are explicit, state-aware, and confirm destructive actions.
  Vendor state is read-only. Show the fixed-login warning after email edits.
- [x] **Step 4:** Extend `DirectoryTable` and `/hr` with top-level employee and
  department tabs. The employee table adds manager/account columns, admin
  create, archived view, and row management without moving the route to
  `/people`. In the departments tab, selecting a department mounts the
  existing `DocumentList` workflow and all document actions.
- [x] **Step 5:** Use `DeptPanel`, `DepartmentTable`, and `DepartmentDialog` for
  employee count and safe delete. For
  `department_in_use`, render separate employee/child/document reasons from
  `ApiError.details`; do not replace the server check with client-only logic.
- [x] **Step 6:** Add Arabic/English keys additively. Do not remove or rename
  `hr.docs.*`, `hr.directory.*`, or the delivered editor/reader messages.
- [x] **Step 7:** Run only
  `npx vitest run app/composables/__tests__/hrAccess.test.ts app/composables/__tests__/hrAdmin.test.ts`
  from `apps/web`. The orchestrator owns lint, browser acceptance, and the
  broad web suite in T10.
- [x] **Step 8:** Commit `[IMP] web: manage employees and access from the HR directory`.

### Task 8: Add branding settings with live preview

**Files:**
- Create: `apps/web/app/composables/useBrandingAdmin.ts`
- Create: `apps/web/app/composables/colorHex.ts`
- Create: `apps/web/app/composables/__tests__/colorHex.test.ts`
- Create: `apps/web/app/components/settings/SettingsTabs.vue`
- Create: `apps/web/app/components/settings/BrandingForm.vue`
- Create: `apps/web/app/components/settings/BrandingPreview.vue`
- Create: `apps/web/app/pages/settings/branding.vue`
- Modify: `apps/web/app/pages/settings/projects.vue`
- Modify: `apps/web/app/composables/useBranding.ts`
- Modify: `apps/web/i18n/locales/ar/settings.json`
- Modify: `apps/web/i18n/locales/en/settings.json`

**Interfaces:**
- `normalizeHex(value): string | null` returns lowercase `#rrggbb`.
- `useBrandingAdmin()` parses `BrandingSchema`; `useUpdateBranding()` accepts
  `BrandingPatch`, replaces admin cache, and updates Nuxt data key `branding`.

- [x] **Step 1:** Test colour normalization and patch construction boundaries.
- [x] **Step 2:** Implement composable and settings tabs. Employee sees the
  existing forbidden copy; admin/vendor can open the form.
- [x] **Step 3:** Implement explicit-save form and preview. Validate PNG/JPEG
  and 1 MiB before base64 conversion; strip the `data:` prefix from the body.
- [x] **Step 4:** Update the public branding state from the PATCH response so
  sidebar/title/colour change immediately; retain server cache behavior on
  hard reload.
- [x] **Step 5:** Run
  `npx vitest run app/composables/__tests__/colorHex.test.ts` from `apps/web`;
  the orchestrator owns lint and the broad web suite. Commit
  `[ADD] web: company branding settings and live preview`.

### Task 9: Add `/account` password change

**Files:**
- Create: `apps/web/app/composables/useChangePassword.ts`
- Create: `apps/web/app/composables/passwordForm.ts`
- Create: `apps/web/app/composables/__tests__/passwordForm.test.ts`
- Create: `apps/web/app/components/account/PasswordForm.vue`
- Create: `apps/web/app/pages/account.vue`
- Modify: `apps/web/app/components/AppSidebar.vue`
- Modify: `apps/web/i18n/locales/ar/common.json`
- Modify: `apps/web/i18n/locales/en/common.json`

**Interfaces:**
- `useChangePassword().mutateAsync(PasswordChange) -> Me`.
- `validatePasswordForm(current, next, confirm)` returns
  `{valid, mismatch, weak}` and `passwordErrorField(code)` returns
  `'current' | 'new' | null`; these pure helpers require no Vue DOM harness.
- Form test ids: `pw-current`, `pw-new`, `pw-confirm`, `pw-submit`;
  sidebar item: `nav-account`.

- [x] **Step 1:** Add pure helper tests for mismatch, minimum length, and
  wrong-current/weak-new error mapping. Browser acceptance in T10 covers field
  clearing and hydration-disabled controls because this repository has no Vue
  component-mounting test dependency.
- [x] **Step 2:** Implement mutation and form. Map only `wrong_password` to the
  current field and `weak_password` to the new field; preserve other API text.
- [x] **Step 3:** Add `/account` and the user-menu item above logout. Add mirrored
  `account.*` and `nav.account` copy to common locales.
- [x] **Step 4:** Run
  `npx vitest run app/composables/__tests__/passwordForm.test.ts` from
  `apps/web`; the orchestrator owns lint and the broad web suite. Commit
  `[ADD] web: self-service password change from account`.

### Task 10: Live acceptance, regression gate, and delivery docs

**Files:**
- Create: `apps/web/e2e/hr-people-access.spec.ts`
- Create: `apps/web/e2e/branding.spec.ts`
- Create: `apps/web/e2e/account.spec.ts`
- Modify: `apps/web/e2e/contracts-hr.spec.ts`
- Modify: `apps/web/e2e/contracts.spec.ts`
- Preserve and run: `apps/web/e2e/hr-directory.spec.ts`, `apps/web/e2e/hr-documents.spec.ts`
- Modify after implementation: `README.md`, `CLAUDE.md`, `docs/parallel-work.md`, `docs/superpowers/specs/2026-09-03-webvue-platform-design.md`, `docs/superpowers/specs/2026-09-05-webvue-phase-3b-people-branding-design.md`
- Preserve and inspect: `deploy/provision.sh` (it already installs `webvue_hr`)

**Interfaces:**
- E2E uses unique employee emails and restores the admin password in teardown.
- No test relies only on hidden UI for authorization; backend HttpCase remains
  the direct security proof.

- [x] **Step 1: Extend live contract checks.** Parse all HR list envelopes and
  mutation responses; parse branding/account responses; assert PMO people ids
  resolve to the linked `res.users` record, using fixtures whose user and
  employee ids deliberately differ (the two models may otherwise share the
  same numeric id).
- [x] **Step 2: Add HR access scenario.** Admin creates an employee on `/hr`,
  grants access, signs in through a second context, sees read-only HR, promotes
  then demotes the user, resets password, revokes access, and observes the old
  context redirect to login. Exercise archive/unarchive and confirm documents
  remain usable throughout.
- [x] **Step 3: Add branding scenario.** Save name/colour and a small PNG,
  observe sidebar update without reload, then reload and parse admin branding.
- [x] **Step 4: Add account scenario.** Change the admin password, remain signed
  in, authenticate with the new password, then restore the original password in
  teardown even if an intermediate assertion fails.
- [x] **Step 5: Run the final gate once on a fresh disposable DB:** Odoo four
  addons with all four tags, `ruff check odoo-addons`, contracts unit, web unit,
  web lint/vue-tsc, then Playwright with the required services. Stop the task
  Nuxt dev server before `npm run build` so generated state is not shared
  between dev and build. Record exact
  counts; the pre-plan baseline reported by the integration lead was 144 Odoo,
  41 contracts, and 136 web unit tests, with ruff/lint green, but completion
  requires fresh post-change evidence.
- [x] **Step 6:** Run explicit preservation checks: no diff in PMO people picker;
  all `HrDocument*` exports remain; existing HR document tests/e2e pass; `/hr`
  is still the sidebar destination; `rg -n "sudo\("` shows no new occurrence.
- [x] **Step 7:** Update delivery docs additively and verify provisioning still
  installs `webvue_hr`; do not rewrite `deploy/provision.sh` without an actual
  missing entry. Do not mark the archived pre-reorganization WIP as shipped. Commit
  `[IMP] docs: deliver reconciled phase 3b people branding and account`.

## Coverage matrix

| Approved requirement | Tasks |
|---|---|
| Employee create/edit, archived view | T1, T2, T4, T7, T10 |
| Grant/reset/revoke access and effective roles | T1, T2, T4, T7, T10 |
| Self/vendor/archive guard rails | T2, T4, T10 |
| Session invalidation and caller continuity | T4, T6, T10 |
| Department delete with every real reference | T1, T2, T4, T7, T10 |
| Preserve documents and attachments | Global constraints, T7, T10 |
| Preserve pagination and `Hr*` exports | T1, T4, T10 |
| Preserve `/hr` and PMO people picker | Global constraints, T7, T10 |
| Branding API/UI/cache bust | T3, T5, T8, T10 |
| Account password UI | T3, T6, T9, T10 |
| Arabic/RTL and explicit Save UX | T7–T9 |
| No new `sudo()`, direct authorization tests | T2, T4–T6, T10 |

## Self-review

- **Spec coverage:** Every in-scope API, wire shape, UI state, guard rail,
  session behavior, and preservation requirement maps to a task above.
- **Compatibility:** The plan never changes list envelopes to arrays, never
  exports unprefixed HR names, keeps `work_phone`, `user_id`, `parent_id`,
  `child_ids`, and all document fields.
- **Route safety:** Existing `hr_employees.py` and `hr_departments.py` are
  extended; no duplicate controller modules or `/people` replacement exists.
- **Quarantine:** The archived WIP is an evidence source, not a merge source or
  shipped feature claim.
- **Execution order:** W1 fixes contracts/model rules, W2 supplies APIs, W3
  consumes them in UI, and W4 owns live integration and final verification.
