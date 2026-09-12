> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# nasq HR design

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). ليس تعليمات واجهة.

**Date:** 2026-09-04  
**Status:** HR-1 shipped in `v0.5.0-phase-hr`; HR-2 and HR-3 remain pending.  
**Parent:** `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`

This document records the HR product boundary and the implementation that is
now in the main line. HR is a core nasq pillar. It is not a customer overlay or
a vendor-console workflow; customer staff use Nuxt while Odoo remains the
engine.

## Delivered and pending

| Scope | Status | Contract |
| --- | --- | --- |
| HR-1 directory, departments, and department documents | Shipped | `/hr`, `/api/v1/hr/*`, `nasq_hr`, `packages/contracts/src/hr` |
| HR-2 admin assignment of employee department and job title | Pending | `PATCH /api/v1/hr/employees/{id}` after a separate plan |
| HR-3 time off and/or attendance | Pending decision | New API and UI only after product clarification |
| Payroll, payslips, compensation, bank details, and GOSI | Out of v1 | No nasq product surface |

HR-1 provides a company-wide directory at `/hr`, a read-only employee card,
customer-admin department CRUD, and free-title department documents with HTML
bodies and attachments. Documents are searchable by title and filterable by
department. There is no document tag or personnel-file model.

## Settled boundaries

- `/api/v1/people?q=` stays the PMO task assignee picker. Its `id` is a
  `res.users` id. `/api/v1/hr/employees` serializes `hr.employee` ids. A
  nullable `user_id` may be included on an employee, but never becomes its
  record id.
- All HR routes live under `/api/v1/hr/*`. They use `type='json2'`,
  `auth='user'`, the shared `api_handler`, query parameters from
  `request.httprequest.args`, and explicit serializers.
- `nasq_core.group_employee` reads the company-wide directory, departments,
  employee cards, and documents. `nasq_core.group_customer_admin` writes
  departments and documents on any department. A department manager receives
  no extra HR-1 write rights.
- `nasq_hr` has no `sudo()` path. Access is enforced through ACLs and record
  rules. A customer company cannot read another company's documents.
- Employee cards are read-only in HR-1, including for administrators. Invites,
  role changes, deactivation, and two-factor reset belong to account settings.
- Arabic is the default locale and all new UI copy uses the `hr.*` namespace.
  The UI uses Tailwind logical properties and sanitised HTML for employee
  document reading. Administrators edit document bodies with Tiptap.

## Screens

`/hr` is one screen with a directory table as its primary surface. The table
supports employee-name search and an optional department filter; columns are
name, job title, and department. Selecting a row opens a read-only card with
name, job title, department, work email, work phone, and avatar. It has no
save, invite, salary, identification, private-address, or bank controls.

Administrators can open the department panel to create, rename, parent, and
assign managers on stock `hr.department` records. Employees see department
names and filters but no department write controls.

Selecting a department shows its documents in the same HR screen. Employees
read title, department, sanitised HTML, and attachments for every department.
Administrators can create a document on a selected department, edit its title
and HTML body, and upload attachments. HR-1 does not reparent documents.

## API and wire shapes

The shipped routes are:

```text
GET    /api/v1/hr/departments
GET    /api/v1/hr/departments/{id}
POST   /api/v1/hr/departments                 customer_admin
PATCH  /api/v1/hr/departments/{id}            customer_admin

GET    /api/v1/hr/employees?q=&department_id=&limit=&offset=
GET    /api/v1/hr/employees/{id}              employee id

GET    /api/v1/hr/documents?q=&department_id=&limit=&offset=
GET    /api/v1/hr/documents/{id}
POST   /api/v1/hr/documents                   customer_admin
PATCH  /api/v1/hr/documents/{id}              customer_admin; no reparent
POST   /api/v1/hr/documents/{id}/attachments  customer_admin
```

List responses are `{items, total}`. Department responses contain `id`,
`name`, `parent_id`, `manager` (`{id,name}` or null), and `child_ids`.
Employee responses contain `id`, `name`, `job_title`, `department`,
`work_email`, `work_phone`, and nullable `user_id`. Document responses contain
`id`, `name`, `department`, `body`, `attachment_ids` (`id`, `name`, `mimetype`,
`file_size`), and `write_date`.

Create department accepts `name`, optional `parent_id`, and optional
`manager_id`. Create document requires `name` and `department_id` and accepts
an HTML `body`. Document PATCH accepts `name` and `body`; attachment upload
accepts a file name, base64 data, and optional MIME type. Empty names, bad
integers, missing department ids, unsupported fields, and invalid attachment
data return 422 `invalid`. Missing or inaccessible records return 404
`not_found`; employee writes return 403 `forbidden`.

## Implementation map

HR owns its complete vertical slice in `odoo-addons/nasq_hr`: model,
controllers, serializers, ACL/rules, and tests. The contract barrel is
`packages/contracts/src/hr/index.ts` and is re-exported from
`packages/contracts/src/index.ts`. The web implementation is
`apps/web/app/pages/hr.vue`, `apps/web/app/components/hr/*`,
`apps/web/app/composables/useHr*.ts`, and
`apps/web/i18n/locales/{ar,en}/hr.json`. HR E2E coverage is in
`apps/web/e2e/hr-directory.spec.ts`, `hr-documents.spec.ts`, and
`contracts-hr.spec.ts`.

The recovered pre-integration draft is preserved at
[`docs/archive/2026-09-04-nasq-hr-design.md`](../../archive/2026-09-04-nasq-hr-design.md).
The active implementation plan and its historical task mapping are at
[`docs/superpowers/plans/2026-09-04-nasq-hr-phase-1.md`](../plans/2026-09-04-nasq-hr-phase-1.md).
Phase 3b expands existing HR, people, branding, and account surfaces; its
specification remains owned by that workstream at
`docs/superpowers/specs/2026-09-05-nasq-phase-3b-people-branding-design.md`.

## Verification boundary

The HR branch was tagged `v0.5.0-phase-hr`. Current integration work still
requires the orchestrator's fresh checks before any release or cleanup claim.
The tests described by the implementation plan verify the HR layer; they do
not by themselves prove production deployment, DNS, mail, backups, or a
cutover.
