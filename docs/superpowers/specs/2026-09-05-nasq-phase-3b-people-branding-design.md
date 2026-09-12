> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# nasq — Phase 3b: People Access, Branding, and Account

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). ليس تعليمات واجهة.

**Date:** 2026-09-05
**Target baseline:** canonical `main` after the 2026-09-05 workspace reorganization
**Status:** Delivered locally on 2026-09-05; approved scope and HR compatibility requirements retained

**Verification state:** Odoo aggregate `182`, contracts `52`, web unit `152`,
and Playwright `47` green, plus clean `ruff`, `vue-tsc`, and production-build
gates. This is local branch evidence only; canonical `main` remains the
pre-Phase-3b baseline and no merge, push, deployment, DNS cutover, or release
approval is implied.
**Parent spec:** `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`

## Goal

Let a `customer_admin` manage employees and their nasq access from the existing
HR directory, manage the company's name, logo, and primary colour, and let every
signed-in user change their own password. This phase extends the HR work already
on `main`; it does not recreate the HR pillar or move its existing department
documents.

## Delivered baseline that this phase must preserve

`main` already contains a working first HR slice:

- `odoo-addons/nasq_hr/` is installed as a pillar. It owns
  `nasq.hr.document`, its company rule, ACL, controllers, serializers, and
  tests.
- `/api/v1/hr/departments`, `/api/v1/hr/employees`, and
  `/api/v1/hr/documents` exist. All list responses are paginated objects
  `{items, total}`.
- `packages/contracts/src/hr/index.ts` exports the strict `HrDepartment*`,
  `HrEmployee*`, and `HrDocument*` schemas. Those exported names are the
  canonical contract.
- `/hr` is the canonical people screen. It contains the directory,
  department panel, employee card, and department documents. The sidebar
  points to `/hr`.
- `GET /api/v1/people?q=` remains the PMO assignee picker. Its `id` is a
  `res.users` id; it is unrelated to the HR route identity.
- The HR document editor, reader, attachment upload, tests, contract exports,
  and `hr.json` messages are shipped behavior and remain in scope.

The pre-reorganization phase-3b work is preserved at
`archive/pre-reorganization-20260905` (commit `e4e8e9b`) and in the recovery
bundle. It is quarantined reference material. It may be consulted for a
specific test or implementation idea, but it must not be checked out, merged,
or copied over the current HR contracts.

## Product decisions

| Area | Decision |
|---|---|
| Employee source | `hr.employee`. A login is granted from an employee record; no phase-3b flow creates an unlinked user. |
| Canonical screen | Extend `/hr`. The heading-only `/people` route is retired during workspace integration; do not recreate it. |
| Two explicit actions | Creating an employee and granting access are separate actions. An employee may exist with only a name. |
| Employee fields | Name required; work email, work phone, job title, department, and manager optional. Admin edits use one explicit Save action. |
| Directory access | Every signed-in nasq employee reads active employees. Admins may switch to an archived-only view. |
| Login | Granting access uses the normalized `work_email`. The login stays fixed when work email later changes; the UI explains this. |
| Password | Admin supplies a password when granting or resetting access. Minimum 8 characters. There is no invitation email or forced first-login change. |
| Roles | Access reads as `employee`, `admin`, or `vendor`; writes accept only `employee` or `admin`. A role change must change effective group membership. |
| Guard rails | An admin cannot demote or deactivate themselves. Vendor-linked employees cannot be archived or have access changed from nasq. |
| Deactivation | Archiving an employee also deactivates their linked user. Unarchiving restores only the employee. Revoking access deactivates only the user. |
| Re-grant | Granting access to an employee linked to an inactive user reactivates that same user id with the submitted password and role. |
| Departments | Preserve current CRUD and paginated contract. Add delete. Deletion is refused while any active/archived employee, child department, or HR document references the department. |
| Documents | Preserve department documents, attachment upload/download, HTML editor/reader, ACL, APIs, schemas, tests, and locale keys unchanged except for compatible additive fixes. |
| Branding | Admin edits company name, PNG/JPEG logo up to 1 MiB, and `#rrggbb` primary colour. The existing font remains fixed. Logo replacement is supported; clearing is not. |
| Account | `/account` changes the caller's password after validating the current password. The caller stays signed in; other sessions become invalid on their next request. |
| `sudo()` | Add no new `sudo()`. The existing public branding read retains its established `sudo()` because anonymous users cannot read `res.company`; authenticated admin writes run as the caller. |

## API contract

All new or extended routes use `type='json2'`, `auth='user'`, explicit
serializers, and `@api_handler`. Errors keep the existing envelope
`{code, message, field?, details?}` and a real HTTP status. `details` is an
optional additive numeric map used by `department_in_use`; existing errors do
not gain an empty details object.

### Employees

```text
GET    /api/v1/hr/employees?q=&department_id=&archived=&limit=&offset=
POST   /api/v1/hr/employees
GET    /api/v1/hr/employees/{id}
PATCH  /api/v1/hr/employees/{id}
POST   /api/v1/hr/employees/{id}/archive
POST   /api/v1/hr/employees/{id}/unarchive
POST   /api/v1/hr/employees/{id}/access
PATCH  /api/v1/hr/employees/{id}/access
DELETE /api/v1/hr/employees/{id}/access
```

The list response remains:

```ts
type HrEmployeeList = { items: HrEmployee[]; total: number }
```

`archived` accepts `0|false|1|true`. Missing/false returns active employees.
True returns archived employees and is admin-only; other callers receive
`403 forbidden`. Search and department filters apply before `limit`/`offset`.

The compatible employee shape extends the current wire shape; no existing key
is removed or renamed:

```ts
type HrEmployee = {
  id: number                    // hr.employee id
  name: string
  job_title: string
  department: HrRef | null
  work_email: string
  work_phone: string
  user_id: number | null        // preserved compatibility key
  manager: HrRef | null
  active: boolean
  access: null | {
    user_id: number
    login: string
    role: 'employee' | 'admin' | 'vendor'
    active: boolean
  }
}
```

Create accepts `{name, work_email?, work_phone?, job_title?, department_id?,
parent_id?}`. Patch accepts the same fields as optional values; relation ids
accept `null` to clear. Unknown fields are `422 invalid`. A changed work email
never changes `access.login`. Invalid email, cross-company/unknown relation
ids, and selecting the employee as their own manager are rejected with a
field-specific 422.

Access grant accepts `{password, role}` and creates or reactivates the linked
user. Access patch accepts a non-empty subset of `{password, role}`. Access
delete deactivates the linked user. Business errors are:

- `422 email_required`, `login_taken`, `weak_password`,
  `employee_archived`, `self_role`, or `self_deactivate`;
- `403 vendor_protected` for archive and all access mutations on a
  vendor-linked employee;
- `403 forbidden` for every employee write.

### Departments and documents

The existing department list remains `{items, total}`. `HrDepartment` retains
`id`, `name`, `parent_id`, `manager`, and `child_ids`, and gains
`employee_count` without replacing `parent_id` with another shape.

```text
DELETE /api/v1/hr/departments/{id}
  -> 204
  -> 422 department_in_use with details
     {employees: number, children: number, documents: number}
```

Counts include archived employees. Parent cycles remain `422 invalid`.
Existing department GET/POST/PATCH behavior and all document routes are kept.
Document payloads remain paginated and keep `attachment_ids`; phase 3b does
not introduce tags, personnel documents, or document reparenting.

### Branding and account

```text
GET   /api/v1/branding                 public, cached; existing route retained
GET   /api/v1/admin/branding           customer_admin or vendor
PATCH /api/v1/admin/branding           customer_admin or vendor
POST  /api/v1/me/password              every signed-in user
```

Branding PATCH accepts a non-empty subset of `{name, primary_color, logo}`.
`logo` is raw base64 without a `data:` prefix. Errors include
`logo_too_large`, `logo_format`, and `invalid`. `logo_url` gains a version
query derived from the company write timestamp so saved logos refresh without
changing the four-field `BrandingSchema`.

Password change accepts `{current, new}` and returns the existing `Me` shape.
It returns `422 wrong_password` on `current` and `422 weak_password` on `new`.

## Contract naming and compatibility

The root contract barrel already exports `RefSchema` from PMO. HR must keep
the `Hr` prefix to prevent root-export collisions. Phase 3b extends the
existing `packages/contracts/src/hr/index.ts` with:

- `HrRefSchema`, `HrEmployeeAccessSchema`, `HrAccessRoleSchema`,
  `HrWritableRoleSchema`;
- `HrEmployeeCreateSchema`, `HrEmployeePatchSchema`,
  `HrAccessGrantSchema`, `HrAccessPatchSchema`;
- `HrDepartmentCreateSchema`, `HrDepartmentPatchSchema`.

It retains `HrEmployeeSchema`, `HrEmployeeListSchema`, `HrDepartmentSchema`,
`HrDepartmentListSchema`, and every `HrDocument*` export. Shared contracts add
`BrandingPatchSchema` and `PasswordChangeSchema`. New input schemas and all HR
schemas are strict; existing shared output schemas retain their current behavior.

## User experience

### `/hr`

The page has two top-level tabs: **الموظفون** (default) and **الأقسام**. The
employee table shows name, job title, department, manager, and account status;
admins also get employee creation, archived filtering, and an employee
management dialog. Account status uses the fixed labels **بدون حساب**,
**موظف**, **مدير نظام**, **مورّد**, and **الدخول موقوف**.

The employee dialog has two tabs:

- **البيانات:** one Save form for the employee fields. Non-admins see the
  current read-only card. If a linked employee's work email changes, show that
  the login email remains unchanged.
- **الدخول:** admin-only. It grants access, changes role, resets password, or
  revokes access according to current state. Vendor access is read-only.
  Grant is disabled with a visible reason when the employee is archived or has
  no work email.

The admin row menu archives or restores the employee. The departments tab
keeps the delivered department selection and document workflow, and gains
employee counts and safe delete feedback. Selecting a department shows its
documents and the current document create/edit/read/attachment actions. No
phase-3b change may remove, rename, or hide those actions.

### `/settings/branding`

Settings gains project/branding tabs. The branding form validates name,
colour, and logo on the client, previews unsaved values, saves explicitly, and
updates the app chrome from the response.

### `/account`

The sidebar user menu gains **حسابي** above logout. `/account` contains current,
new, and confirmation password fields with an explicit submit action.

## Security and session acceptance

- Direct API tests prove every non-admin write is 403; hidden buttons alone
  are not evidence.
- Demoting an admin makes their next admin request fail with 403.
- An admin reset or access revoke invalidates a session opened before the
  mutation. An unrelated user's session stays valid.
- Self password change keeps the caller's current session valid, authenticates
  with the new password, and rejects the old password.
- Password values never appear in logs, response bodies, fixtures committed as
  production data, or client caches.
- The PMO picker continues to return user ids while HR returns employee ids.

## Out of scope

Invitation email, forced password rotation, 2FA management, custom roles,
login rename, fonts, employee import, photos, departure workflows, private HR
fields, document taxonomy, document reparenting, payroll, time off,
attendance, multi-company product behavior, and any change to PMO picker files.
