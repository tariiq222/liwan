# nasq — HR Design Spec

> تاريخي. السياسة: [DESIGN.md](../../DESIGN.md). ليس تعليمات واجهة.

**Date:** 2026-09-04
**Target:** nasq (Odoo 19.0 CE engine, Nuxt 4 UI)
**Status:** Draft
**Parent spec:** `2026-09-03-nasq-platform-design.md` (binding; this document opens the HR pillar that the parent deferred past the project-management phases)

## Goal

Give every customer a **company directory** in the nasq web app: departments an admin can maintain, a read-only employee card, and **free-title department documents** (HTML body + attachments, search by name; each document has a department). HR is a nasq product pillar — not a customer overlay, not a vendor-console workflow. Customers' staff stay in Nuxt; nobody at the customer opens Odoo.

This spec covers the HR phase sequence. **HR-1** is specified in enough detail to plan and implement. HR-2 and HR-3 are scoped so later plans do not invent a second architecture. Payroll is out of nasq v1.

## Phases

nasq already ships a heading-only **الأشخاص** stub and (from project phase 1) a minimal `GET /api/v1/people?q=` picker that returns **user** ids for task assignees. HR does not replace that picker. It adds a real directory on new `/api/v1/hr/*` paths.

| Phase | Delivers | OUTPUTS |
|---|---|---|
| **HR-1** — Directory + dept admin + free-title documents | `/people` becomes the company directory. Admins maintain the department tree. Every employee can open a **read-only** employee card and browse **department documents** (read company-wide). | Addon `nasq_hr` with model `nasq.hr.document` + ACL/rules. New json2 controllers under `/api/v1/hr/*` (departments, employees, documents). Zod contracts in `packages/contracts/src/hr.ts`. Nuxt directory UI (table + dept panel + card + document reader/editor). `GET /api/v1/people?q=` **unchanged**. |
| **HR-2** — Admin assigns employee department + job title (no invite) | `customer_admin` sets `department_id` and `job_title` on an existing employee from the card. No user invite, no role change, no deactivate — those stay on Settings › Users. | `PATCH /api/v1/hr/employees/{id}` whitelist `{department_id, job_title}` only. Card fields become editable for admin; employees still read-only. No new invite API. |
| **HR-3** — Time off and/or attendance | One of: leave requests (`hr.leave`) with a simple approve path, or daily attendance, or both if the same ACL/UI pattern holds. Chosen in a later grilling; not designed here. | New `/api/v1/hr/time-off/*` and/or `/api/v1/hr/attendance/*` plus Nuxt screens. Still no payroll. |
| **Payroll** | **Out of nasq v1.** Payslips, contracts-as-compensation, bank details, GOSI/insurance filings, and accounting journals are not nasq product surface. | None. Customers who need payroll keep it outside nasq (or a later paid package, not this pillar). |

## Settled decisions (grilling, 2026-09-04)

| Question | Decision |
|---|---|
| Product frame | nasq only. HR is a core pillar of the resellable product. Do not special-case any customer. Customer-specific HR rules, if any ever appear, live in a `customer_<name>_*` overlay — never in `nasq_hr` / `nasq_api`. |
| What HR-1 is | Directory + department admin + free-title documents. Not a full HCM suite. |
| `/people` vs the assignee picker | Two different resources. `GET /api/v1/people?q=` stays the **user** picker (`id` = `user_id`) for tasks. The directory uses **employee** ids on `/api/v1/hr/employees`. User id ≠ employee id. Never collapse them. |
| New API prefix | All HR reads/writes go under `/api/v1/hr/*`. Do not extend `people.py` or `/api/v1/admin/departments`. Do not reuse `/api/v1/people` for directory payloads. |
| Who can read | Every `nasq_core.group_employee` reads the **company-wide** directory, department tree, employee cards, and documents. No "only my department" filter in HR-1. |
| Who can write | `nasq_core.group_customer_admin` writes departments and documents on **any** department. Employees cannot. |
| Department manager | `hr.department.manager_id` is displayed. It grants **no** extra publish/write on documents and no extra department CRUD. No "dept manager" nasq group in HR-1. |
| `sudo()` | Forbidden. If an employee cannot read a record, fix the ACL / `ir.rule`. Never sudo to dodge access. |
| Employee card in HR-1 | Read-only for everyone, including admin. Name, job title, department, work email, work phone. Writes of department + job title wait for HR-2. |
| User invite | Not HR. Invite / role / deactivate stay Settings › Users (platform spec). HR-2 assigns org fields on an employee that already exists. |
| Documents | New model `nasq.hr.document`. Required `department_id` (Many2one `hr.department`). Free-text **title** (`name`), **HTML body**, **attachments**. Search by **name** (`ilike`); filter by `department_id`. **No tags.** Department documents, not personnel files — no `employee_id`. Employees read all departments' documents company-wide. `customer_admin` writes documents on any department. |
| Document editor | Tiptap (same stack as task description): bold, italic, lists, links; RTL-aware; stores HTML compatible with Odoo's `Html` field. Employees see sanitised HTML, not the editor. |
| Body format | Odoo `Html` field. No Markdown store. No Wiki namespace. |
| Attachments | `ir.attachment` linked to the document. List + download in HR-1; admin upload. Binary still served at `/web/content/<id>`. |
| Departments | Stock `hr.department` (name, parent, manager). Admin CRUD in the dept panel on `/people`. No parallel nasq department model. |
| Employee source | Stock `hr.employee` / `hr.employee.public`. Directory lists employees (not users). An employee may have no `user_id`. |
| Payroll | Out of nasq v1. |
| Time off / attendance | HR-3, not HR-1. |
| Testing in this spec | Future-only: this document does not prescribe test code. The HR-1 plan owns HttpCase, zod, Vitest, and Playwright. |
| Isolation vs project phase 1 | Implement HR-1 **after** nasq phase-1 merge, or as new files only until then. Never edit `people.py`, `tasks.py`, `useTasks.ts`, `usePeople.ts` while that workstream owns them. |

## HR-1 detailed

### Screens

All copy via `$t()` / `t()`. Arabic default. RTL logical properties only.

#### `/people` — الدليل (directory)

Replaces the heading-only **الأشخاص** stub. One primary screen, two regions:

1. **Directory table** (default). Columns: الاسم · المسمى الوظيفي · القسم. Toolbar: search (`q` on employee name, server `ilike`), optional department filter, admin-only control to open the dept panel. Row click opens the employee card. Empty state: "لا موظفون بعد" with no create action for employees (users are invited elsewhere).
2. **Dept panel** (admin). Secondary surface — a `Sheet` or end-column, not a separate settings page. Tree of `hr.department`: create, rename, set parent, set مدير القسم. Employees see department names as read-only chips/filters, not the panel.

One primary action for admin: **مستند جديد** (create document on the selected department) **or** **قسم جديد** inside the dept panel — not both as competing black buttons. Document create lives with that department's documents; department create lives in the panel.

#### Employee card — بطاقة الموظف (read-only)

Overlay (`Sheet`) from the directory row, not a full page. Fields, all read-only in HR-1:

| Field | Source | Notes |
|---|---|---|
| الاسم | `hr.employee.name` | |
| المسمى الوظيفي | `hr.employee.job_title` | May be empty; HR-2 fills it |
| القسم | `department_id` | `{id, name}` or null |
| البريد | `work_email` | |
| الهاتف | `work_phone` | |
| avatar | `/web/image/hr.employee/{id}/avatar_128` | |

Do not show salary, identification, private address, or bank fields. Do not show a user-invite button. Closing returns to `/people` with the current search/filter.

#### Documents — المستندات

Documents belong to a **department**. Primary view: when a department is selected (dept panel / filter), list that department's documents — not a single company-wide dump as the only view. Optional extra: company-wide search by **title** (`q` → `name ilike`) across all departments. Columns: العنوان · آخر تحديث (inside a selected department; company-wide search may also show القسم). **No tags, no tag filter, no category taxonomy.**

- Employee: open a document → read-only title + department + sanitised HTML body + attachment list (name, size, download via `/web/content/{id}`). Employees can read documents of **every** department (company-wide), not only their own.
- Admin: create on a department (`department_id` required); edit title, Tiptap body, attach files. `customer_admin` may write documents on **any** department. HR-1 does not reparent (no PATCH `department_id`). Every write returns the full document detail.

Empty state (selected department with no docs): "لا مستندات" + admin action "مستند جديد" (creates on that department).

### API

Existing picker — **do not change**:

```
GET /api/v1/people?q=     auth=user, readonly
  → [{ id: <user_id>, name, user_id }]
```

`id` is the **user** id (assignee picker). HR must not change its shape, query params, or serializer. Do not add employee fields to it.

New HR routes — all `type='json2'`, `auth='user'`, serializer-whitelisted, wrapped in `@api_handler`. Errors `{code, message, field?}` with real HTTP status. Never `type='http'` for JSON, never `auth='bearer'` for browser traffic, never `sudo()`.

```
GET    /api/v1/hr/departments
GET    /api/v1/hr/departments/{id}
POST   /api/v1/hr/departments                 customer_admin; 403 forbidden otherwise
PATCH  /api/v1/hr/departments/{id}            customer_admin

GET    /api/v1/hr/employees?q=&department_id=
GET    /api/v1/hr/employees/{id}              employee id, not user id

GET    /api/v1/hr/documents?q=&department_id=
GET    /api/v1/hr/documents/{id}
POST   /api/v1/hr/documents                   customer_admin; department_id required
PATCH  /api/v1/hr/documents/{id}              customer_admin; name, body only (no reparent)
```

List endpoints paginate like tasks (limit cap, `offset` or "load more"). Writes return the **full detail** shape; the client replaces its cache with it. Field edits on documents/departments may be optimistic; there is no pending-confirm state machine in HR-1.

**Wire ids:**

| Resource | `id` on the wire | Must not be confused with |
|---|---|---|
| `GET /api/v1/people` | `res.users` id | employee id |
| `/api/v1/hr/employees` | `hr.employee` id | user id |
| `/api/v1/hr/departments` | `hr.department` id | |
| `/api/v1/hr/documents` | `nasq.hr.document` id | |

Employee detail **may** include optional `user_id` (nullable) so the UI can show "has a login" without using that value as the record identity.

**Department whitelist:** `id`, `name`, `parent_id`, `manager` (`{id, name}` or null), `child_ids` (ids). Writable: `name`, `parent_id`, `manager_id`.

**Employee whitelist (HR-1, read-only):** `id`, `name`, `job_title`, `department` (`{id, name}` or null), `work_email`, `work_phone`, `user_id` (nullable int). No write route in HR-1.

**Document whitelist:** `id`, `name`, `department` (`{id, name}`), `body` (HTML string), `attachment_ids` (`{id, name, mimetype, file_size}[]`), `write_date`. Writable on create: `name`, `body`, `department_id` (required). Writable on PATCH: `name`, `body` — no reparent in HR-1 (`department_id` is not PATCH-able). Attachment upload follows the existing `/web/content` pattern (or a small `POST /api/v1/hr/documents/{id}/attachments` if the plan needs an explicit json2 wrapper); no tags field exists.

404 `not_found` when the id is missing or the user cannot see it. 403 `forbidden` on admin-only writes. 422 `invalid` on bad types / empty title / missing `department_id` on create.

### ACL

| Group | Directory / cards | Departments | Documents |
|---|---|---|---|
| `nasq_core.group_employee` | read, company-wide | read | read |
| `nasq_core.group_customer_admin` | read | read + write | read + write |
| Department manager (no extra group) | same as employee | same as employee | same as employee — **cannot publish** |
| `base.group_system` (vendor) | full Odoo | full Odoo | full Odoo |

Rules are company-scoped (`company_id` on `nasq.hr.document`; `hr.department` / `hr.employee` already are). Employees of company A never see company B.

`customer_admin` already implies `hr.group_hr_manager` in `nasq_core`; HR-1 still **whitelists** through serializers and still does not sudo. Document access is **our** model: grant `nasq_core.group_employee` read and `nasq_core.group_customer_admin` write on `nasq.hr.document` via `ir.model.access` + `ir.rule`. Do not rely on Odoo HR Officer groups for the Nuxt document UI.

Controllers run as the logged-in user. If a test can only pass with `sudo()`, the ACL is wrong.

### Model `nasq.hr.document`

New addon `nasq_hr` (depends `nasq_core`, `hr`, `mail`). Do not put this model in `nasq_pmo` or `nasq_core`.

```
nasq.hr.document
  name            Char, required, translatable optional (title is free text; no enum)
  body            Html
  attachment_ids  Many2many ir.attachment
  department_id   Many2one hr.department, required, index
  company_id      Many2one res.company, required, default user company, index
```

No `tag_ids`. No `employee_id` (documents are department documents, not personnel files). Chatter (`mail.thread`) is optional and not on the HR-1 wire.

### Frontend notes (HR-1)

- Data layer: new composables (`useHrDepartments`, `useHrEmployees`, `useHrDocuments`) over `useApi()`. **Do not** extend `usePeople.ts` (assignee picker).
- `apps/web/app/pages/people.vue` is a **shell** only: hosts the directory table, dept panel, card overlay, and documents on the department panel / when a department is selected (company-wide title search is an extra, not the only view). New presentational components live under `app/components/hr/`.
- Tiptap for admin document body; reuse the task editor pattern if it already exists after phase-1 merge, otherwise a new `HrDocumentEditor.vue`.
- i18n keys under `hr.*` in `ar.json` / `en.json`. Do not rewrite unrelated keys.

## Testing (future-only)

This spec does not ship tests and does not freeze fixture names. When HR-1 is implemented, coverage must include:

- HttpCase on every `/api/v1/hr/*` route: employee can read, cannot write; admin can write departments and documents; 403/404/422 shapes; employee id ≠ user id; `GET /api/v1/people?q=` still returns user ids and still validates against the existing people/PersonRef contract.
- Zod schema tests for the new `hr.ts` shapes. Live contract e2e against the real `/api/v1/hr/*` endpoints.
- Playwright: directory search, open read-only card, admin dept panel, admin document create/edit, employee cannot see write controls.
- `ruff check odoo-addons`; no `sudo()` in `nasq_hr` or the new HR controllers.

Exact commands live in the HR-1 plan, not here.

## Out of HR-1

- Assigning `department_id` / `job_title` (HR-2).
- User invite, role change, deactivate, reset 2FA (Settings › Users; never HR).
- Time off, attendance, timesheets-as-HR (HR-3 / project time).
- Payroll, payslips, contracts-as-pay, bank accounts, GOSI (out of nasq v1).
- Document tags, categories, per-employee personnel files, document approval workflow, reparenting a document (`PATCH department_id`).
- Extra publish rights for department managers.
- Changing `GET /api/v1/people?q=` or `PersonRefSchema`.
- Merging user id and employee id on the wire.
- `sudo()` in controllers or serializers.
- Recruitment, appraisals, org-chart visualisation, private employee fields.
- Any edit of `people.py`, `tasks.py`, `useTasks.ts`, `usePeople.ts` while project phase 1 owns them.

## Open items (not blocking HR-1)

- HR-3: time off vs attendance vs both — later grilling.
- Whether HR-2 also allows admin to set `parent_id` (line manager) on the employee. Default: no, unless a follow-up says yes.
- Attachment upload: reuse `/web/content` vs a dedicated json2 wrapper — the plan picks one; the wire still has no tags.
