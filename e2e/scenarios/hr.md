# HR and payroll

Pages: `/hr` (employee directory), `/hr/employees`, `/hr/departments`, `/hr/leave`, `/hr/payroll`,
`/hr/shifts`, `/hr/onboarding`, `/hr/offboarding`, `/hr/assets`, `/hr/recruitment`, `/hr/reports`,
self-service pages (files `hr/self/*`, served at `/account/profile`, `/account/leave`, `/account/pay`,
`/account/assets`, `/account/schedule`), settings `/settings/apps/hr`. Owners: `webvue_hr`,
`webvue_hr_finance` (payroll posting, payment, end-of-service provision, cost centers).
Personas and status values: [README](README.md).

Approval note: leave is decided by holders of `hr.leave.approve` (the HR role), not by the
employee's line manager. Whether the line manager should also decide is open (`HR-60`).

How to read the refusals below (all from `webvue_api` handlers):

- Missing capability: 403 `forbidden`, message `<key> capability is required`.
- Feature or sub-feature switched off (`hr.enabled`, `hr.payroll`, `hr.recruitment`, `hr.shifts`,
  `hr.onboarding`, `hr.offboarding`, `hr.assets`, plus `finance.enabled` for the finance bridge): a write answers
  403 `feature_not_included` with `details.feature`; a read of a retained feature still works.
- Expired tenant, or suspended tenant with support signed in: every write answers 403 `tenant_read_only`;
  a suspended tenant without support answers 403 `tenant_suspended`.
- Record of another company or a missing id: 404 `not_found` (never a 403, so existence is not leaked).
- Unknown or non-writable body field: 422 `invalid` with `field`, message `field '<name>' is not writable`.
- Persona names are the README keys; `custom role (...)` is a role built in the access settings with only the
  capabilities listed.

Product gaps found while reading the code are recorded as `gap` rows (HR audit trail has no page, the
employee contract block has no editor, leave on behalf of another employee has no form, a refused applicant
cannot be reset from the page). Open owner questions are `decision` rows.

## Employee directory (`/hr`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-06 | Employee views the directory | staff1 | Read-only; no create, edit or archive | `page /hr` `GET /api/v1/hr/employees` `cap hr.employees.read` | planned | |
| HR-61 | Directory opens with data: 25 rows per page ordered by name, columns name, department, manager, status; KPI strip shows headcount | hr_manager | Heading «دليل الموظفين»; rows link to the record carrying the list state; KPI tiles headcount, archived, Saudization percent and expiring count | `page /hr` `GET /api/v1/hr/employees` `GET /api/v1/hr/saudization` `GET /api/v1/hr/expiring` | planned | |
| HR-62 | KPI strip for a plain reader shows headcount only | staff1 | Archived, Saudization and expiring tiles are left out (no dash placeholders) and the expiring alert never appears | `page /hr` `cap hr.employees.read` | planned | |
| HR-63 | Expiring alert on the directory | hr_manager | Warning «expiring within 30 days» with a link to `/hr/reports` when the 30-day expiring report is not empty; hidden otherwise | `page /hr` `GET /api/v1/hr/expiring` | planned | |
| HR-64 | Search by name | hr_manager | Debounced search writes `?q=`; rows filtered by name (case-insensitive substring); chip with the value and a clear button | `page /hr` `GET /api/v1/hr/employees` | planned | |
| HR-65 | Filter by department | hr_manager | Select writes `?department_id=`; only that department's employees; a `?department_id=` link opens already filtered | `page /hr` `GET /api/v1/hr/employees` | planned | |
| HR-66 | Archived scope | hr_manager | «المؤرشفون» writes `?archived=1`; only archived employees; «النشطون» returns | `page /hr` `GET /api/v1/hr/employees` `cap hr.employees.archive` | planned | |
| HR-67 | Archived list without archive capability | staff1 | the list route with `archived=1` answers 403 `forbidden` (`hr.employees.archive capability is required`); the page never offers the scope | `GET /api/v1/hr/employees` `cap hr.employees.archive` | planned | |
| HR-68 | Pagination keeps filters | hr_manager | Page 2 writes `?offset=25`; refresh and browser back keep q, department and offset; changing a filter resets the offset | `page /hr` `GET /api/v1/hr/employees` | planned | |
| HR-69 | Empty result | hr_manager | Empty state with a clear-filters action; clearing restores the full list | `page /hr` | planned | |
| HR-70 | Account column and row actions follow capabilities | hr_manager, staff1 | hr_manager sees the account (access) column and row actions «تعديل» / «أرشفة الموظف»; staff1 sees neither and `access` is null in the API | `page /hr` `GET /api/v1/hr/employees` `cap hr.employees.access_status.read` | planned | |
| HR-71 | Row archive from the directory | hr_manager | Inline confirmation in the row; confirming archives, the row leaves the active list | `page /hr` `POST /api/v1/hr/employees/<id>/archive` | planned | |
| HR-72 | Invalid list parameters | hr_manager | `archived=x` 422 (`archived must be '0', 'false', '1' or 'true'`); `department_id=abc` 422 `department_id must be an integer`; `department_id=0` 422 `department_id must be a positive integer`; `limit=-1` 422; `limit=500` capped to 200 | `GET /api/v1/hr/employees` | planned | |
| HR-73 | Reader without employee read | custom role (leave request only, no HR read) | `GET /api/v1/hr/employees` 403 `hr.employees.read capability is required`; the page shows the forbidden state | `GET /api/v1/hr/employees` `GET /api/v1/hr/me` | planned | |
| HR-74 | Other company's employees | hr_manager | Employees of another company never appear in the list or the total | `GET /api/v1/hr/employees` | planned | |
| HR-75 | HR switched off for the tenant | it_admin | `hr.enabled` off: every HR route answers 403 `feature_not_included` on writes; HR entries leave the navigation | `page /hr` `GET /api/v1/hr/employees` | planned | See PLT-10 |

## Employee record, create, edit and archive

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-01 | Create a department and an employee in it, then archive the employee | admin | Saved, listed, archived through the inline confirmation | `page /hr/employees/new` `page /hr/departments/new` `POST /api/v1/hr/employees` `POST /api/v1/hr/departments` `POST /api/v1/hr/employees/<id>/archive` | automated | `e2e/tests/hr-journey.e2e.ts` |
| HR-02 | Edit an employee: job, department, manager | hr_manager | Saved and shown on the detail page | `page /hr/employees/[id]/edit` `PATCH /api/v1/hr/employees/<id>` | planned | |
| HR-03 | Set an employee as their own manager | hr_manager | Refused | `PATCH /api/v1/hr/employees/<id>` | planned | |
| HR-476 | Own-manager refusal message | hr_manager | `PATCH` with `parent_id` equal to the employee's own id answers 422 `an employee cannot manage themselves` with field `parent_id`; the manager select excludes the employee | `PATCH /api/v1/hr/employees/<id>` | planned | HR-03 detail |
| HR-04 | Unarchive an employee | hr_manager | Back in the active list | `POST /api/v1/hr/employees/<id>/unarchive` | planned | |
| HR-07 | Employee profile self-service | staff1 | Own profile only | `page /hr/self/profile` `GET /api/v1/hr/me` | planned | |
| HR-76 | New employee form | hr_manager | `/hr/employees/new` opens as a panel over the directory; saving creates (201) and returns to the list state it came from | `page /hr/employees/new` `POST /api/v1/hr/employees` `cap hr.employees.manage` | planned | |
| HR-77 | Create validation | hr_manager | Empty or whitespace name 422 `name must not be empty` (field `name`); invalid email 422 `work_email must be a valid email address`; unknown department 422 `department_id does not reference an existing record`; department of another company 422 `department_id is outside the current company`; `user_id` or `active` in the body 422 `field 'user_id' is not writable` | `POST /api/v1/hr/employees` | planned | |
| HR-78 | Create without capability | staff1 | `POST /api/v1/hr/employees` 403 `hr.employees.manage capability is required`; the panel shows the forbidden state | `page /hr/employees/new` `POST /api/v1/hr/employees` | planned | |
| HR-79 | System administrator has no HR write by default | it_admin | `system_admin` alone cannot create or edit employees (403) until an HR role is assigned | `POST /api/v1/hr/employees` `cap hr.employees.manage` | planned | Access README: system_admin does not imply HR write |
| HR-80 | Unsaved employee form is protected | hr_manager | Leaving a dirty form shows the unsaved-draft guard; discarding leaves, saving stays clean | `page /hr/employees/new` `page /hr/employees/[id]/edit` | planned | |
| HR-81 | Employee record opens | staff1 | Identity card with name, job title, department, manager, work email and phone; active tag; no contract block and no account block in the API | `page /hr/employees/[id]` `GET /api/v1/hr/employees/<id>` | planned | |
| HR-82 | Record for a manager | hr_manager | Actions «تعديل», «منح الوصول» (only when the employee has no login and the viewer holds `access.users.grant`) and the overflow menu with «أرشفة الموظف» | `page /hr/employees/[id]` `cap hr.employees.manage` | planned | |
| HR-83 | Archived employee record is hidden from a plain reader | staff1 | `GET /api/v1/hr/employees/<id>` of an archived employee answers 404; hr_manager (archive capability) opens it with an archived tag | `GET /api/v1/hr/employees/<id>` `cap hr.employees.archive` | planned | |
| HR-84 | Unknown, malformed or other-company id | hr_manager | `/hr/employees/0`, `/hr/employees/abc` and an id of another company show the not-found state; the API answers 404 `not_found` | `page /hr/employees/[id]` `GET /api/v1/hr/employees/<id>` | planned | |
| HR-85 | Edit form validation | hr_manager | Same field messages as create; clearing department or manager sends null and is saved; no fields 422 `no fields to update` | `page /hr/employees/[id]/edit` `PATCH /api/v1/hr/employees/<id>` | planned | |
| HR-86 | Manager or department outside the company | hr_manager | `parent_id` of another company 422 `parent_id is outside the current company`; unreadable record 422 `parent_id is not available` | `PATCH /api/v1/hr/employees/<id>` | planned | |
| HR-87 | Edit another company's employee | hr_manager | `PATCH` answers 404 `not_found` | `PATCH /api/v1/hr/employees/<id>` | planned | |
| HR-88 | Contract block through the API | hr_manager | `contract` object accepts `start_date`, `end_date`, `probation_end_date`, `identity_expiry_date`, `notice_period_days`, `contract_type_id`; end before start 422 `contract.end_date is before start_date`; end without start 422 `contract.end_date needs a start_date`; negative notice 422 `notice_period_days must be a non-negative integer`; empty object 422; unknown key 422 `contract field 'x' is not writable` | `PATCH /api/v1/hr/employees/<id>` | planned | |
| HR-89 | Contract dates have no editor in the UI | hr_manager | The employee pages show and edit only name, job, email, phone, department, manager; contract start/end, probation end, identity expiry and notice period (which feed the expiring report) can be set only through the API | `page /hr/employees/[id]/edit` | gap | `apps/web/app/components/hr/EmployeeGeneralForm.vue` has no contract fields |
| HR-90 | Archive with inline confirmation | hr_manager | Overflow menu «أرشفة الموظف» opens an inline confirm (no dialog); confirming archives, tag becomes archived, menu offers «استعادة الموظف» | `page /hr/employees/[id]` `POST /api/v1/hr/employees/<id>/archive` `cap hr.employees.archive` | planned | |
| HR-91 | Archive blocked: no departure date | hr_manager | With `hr.offboarding` on, an employee without a departure date: 422 `departure_missing` (details.employee_ids); inline warning «سجّل تاريخ الخروج أولًا.» | `page /hr/employees/[id]` `POST /api/v1/hr/employees/<id>/archive` | planned | |
| HR-92 | Archive blocked: custody still held | hr_manager | With `hr.assets` on and an active asset assigned: 422 `custody_open` (details.equipment_ids); warning «ما زالت عهدة مسلّمة للموظف. أعدها أولًا.» | `POST /api/v1/hr/employees/<id>/archive` | planned | |
| HR-93 | Archive blocked: final settlement not confirmed | hr_manager | With `hr.payroll` on and a departed employee without a confirmed settlement: 422 `settlement_missing`; warning «لم تُعتمد التسوية النهائية. اعتمدها في الرواتب أولًا.» | `POST /api/v1/hr/employees/<id>/archive` | planned | |
| HR-94 | Exit blockers disappear with their sub-feature | it_admin, hr_manager | Tenant without `hr.assets` (or `hr.payroll`, `hr.offboarding`) never gets the matching blocker: archive succeeds without that step | `POST /api/v1/hr/employees/<id>/archive` | planned | |
| HR-95 | Archive and unarchive need the archive capability | custom role (employees manage, no archive) | `POST .../archive` and `.../unarchive` answer 403 `hr.employees.archive capability is required`; `employees.manage` does not imply it | `POST /api/v1/hr/employees/<id>/archive` `POST /api/v1/hr/employees/<id>/unarchive` `cap hr.employees.archive` | planned | |
| HR-96 | Archived employee leaves reports and pickers | hr_manager | Archived employee is out of the active list, the assignment pickers and the shift assignment form; payroll still pays a leaver for the month worked | `GET /api/v1/hr/employees` | planned | |
| HR-97 | Employee with history cannot be deleted | hr_manager | No delete route or button exists for employees; only archive (leave, payslip, settlement, compensation, plan run, dated shift row or a second version make deletion impossible) | `page /hr/employees/[id]` | planned | `webvue_hr/models/hr_employee.py` `_unlink_except_employee_history` |
| HR-98 | Employee without HR profile opens self pages | custom role (employee read, no employee record) | `GET /api/v1/hr/me` returns null; self pages show «لا يوجد ملف موظف مرتبط بحسابك» | `GET /api/v1/hr/me` `page /hr/self/profile` | planned | |
| HR-99 | Access page of an employee | it_admin | `/hr/employees/[id]/access` redirects (replace) to the user's page in team settings, or to the new-user form with `employee_id` when the employee has no login; refused without `access.users.grant` | `page /hr/employees/[id]/access` | planned | See ACC-* |

## Departments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-05 | Edit and delete a department | hr_manager | Saved / removed | `page /hr/departments/[id]/edit` `PATCH /api/v1/hr/departments/<id>` `DELETE /api/v1/hr/departments/<id>` | planned | |
| HR-100 | Departments list opens with data | hr_manager | Heading «الهيكل التنظيمي»; list view with name, manager, employee count; KPI strip; footer with the result count | `page /hr/departments` `GET /api/v1/hr/departments` `cap hr.departments.read` | planned | |
| HR-101 | Three views | hr_manager | `?view=tree` hierarchy (parent to children, expandable, add-child action), `?view=canvas` org chart; unknown view value falls back to the list; refresh keeps the view | `page /hr/departments` | planned | |
| HR-102 | Search departments | hr_manager | `?q=` filters by department or manager name; chip and clear; refresh keeps it | `page /hr/departments` | planned | |
| HR-103 | Empty departments | hr_manager | Empty state, create button shown | `page /hr/departments` | planned | |
| HR-104 | Staff sees departments read-only | staff1 | List and record readable; no create, edit, delete or child-add actions | `page /hr/departments/[id]` `GET /api/v1/hr/departments/<id>` | planned | |
| HR-105 | Department record | hr_manager | Name, manager (or «بدون مدير»), employee count, child count, link to its documents when `documents.items.read` is held | `page /hr/departments/[id]` | planned | |
| HR-106 | Department documents legacy URLs | hr_manager | `/hr/departments/[id]/documents`, `/documents/new`, `/documents/[id]`, `/documents/[id]/edit` redirect (301) to `/documents` filtered by `context_kind=hr.department`; the pages themselves only render not-found | `page /hr/departments/[id]/documents/[id]` `page /hr/departments/[id]/documents/[id]/edit` `page /hr/departments/[id]/documents/new` | planned | See DOC-09 |
| HR-107 | New department form | hr_manager | Panel over the list; parent and manager optional; `?parent_id=` prefilled from «add child»; 201 on save | `page /hr/departments/new` `POST /api/v1/hr/departments` `cap hr.departments.manage` | planned | |
| HR-108 | Create validation | hr_manager | Missing name 422 `name is required`; blank 422 `name must not be empty`; unknown field 422; parent of another company 403 `parent_id is outside the current company`; non-integer parent 422 `parent_id must be an integer` | `POST /api/v1/hr/departments` | planned | |
| HR-109 | Create or edit without capability | staff1 | `/hr/departments/new` and `/edit` show the forbidden state; API 403 `hr.departments.manage capability is required` | `page /hr/departments/new` `POST /api/v1/hr/departments` `PATCH /api/v1/hr/departments/<id>` | planned | |
| HR-110 | Edit department | hr_manager | Rename, change parent and manager, clear both; empty body 422 `no fields to update`; edit of another company's department 404 | `PATCH /api/v1/hr/departments/<id>` | planned | |
| HR-111 | Delete department inline | hr_manager | Row «حذف» asks inline; an empty department is removed (204) | `page /hr/departments` `DELETE /api/v1/hr/departments/<id>` | planned | |
| HR-112 | Delete refused: still in use | hr_manager | Department with employees, child departments or linked documents: 422 `department_in_use` with `details.employees`, `children` (and documents); the inline confirm shows the message | `DELETE /api/v1/hr/departments/<id>` | planned | `webvue_documents_hr` adds the document count |
| HR-113 | Department of another company | hr_manager | GET, PATCH and DELETE answer 404 `not_found` | `GET /api/v1/hr/departments/<id>` | planned | |
| HR-114 | Department list paging | hr_manager | `limit` and `offset` honoured, `limit` capped to 200; invalid values 422 | `GET /api/v1/hr/departments` | planned | |

## Leave requests (employee)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-11 | Employee requests leave | staff1 | Request `confirm`, visible to HR | `page /hr/self/leave/new` `POST /api/v1/hr/leave/requests` `cap hr.leave.request` | planned | |
| HR-12 | Employee withdraws a pending request | staff1 | Request removed | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-16 | Request leave for another employee | hr_manager | Allowed with `hr.leave.manage`; refused for staff1 | `POST /api/v1/hr/leave/requests` `cap hr.leave.manage` | planned | |
| HR-115 | Personal leave page | staff1 | `/account/leave` («إجازاتي»): balance tiles per leave type (allocated, taken, pending, remaining), own requests newest first, «طلب إجازة» action | `page /hr/self/leave` `GET /api/v1/hr/leave/balances` `GET /api/v1/hr/leave/requests` `cap hr.leave.read` | planned | |
| HR-116 | Balance tiles hide with the KPI toggle | staff1 | Hiding figures hides tiles only; a balance load error still shows with retry; leave types without allocation need no balance | `page /hr/self/leave` `GET /api/v1/hr/leave/balances` | planned | |
| HR-117 | No balances yet | staff1 | «لا رصيد» empty block, request form still available | `page /hr/self/leave` | planned | |
| HR-118 | Request form | staff1 | Type, from, to, notes; submit creates a request in state `confirm` (201) and returns to the list it came from | `page /hr/self/leave/new` `GET /api/v1/hr/leave/types` `POST /api/v1/hr/leave/requests` | planned | |
| HR-119 | Request form validation | staff1 | Missing dates 422 `date_from is required`; `date_to` before `date_from` 422 `date_to is before date_from`; malformed date 422 `must be a YYYY-MM-DD date`; unknown leave type 422 `leave_type_id is not available`; non-string notes 422 | `POST /api/v1/hr/leave/requests` | planned | |
| HR-120 | Request exceeds balance or overlaps | staff1 | Stock hr_holidays refusal surfaced as 422 `invalid` with its message (insufficient allocation, overlapping request, public holiday only) | `POST /api/v1/hr/leave/requests` | planned | |
| HR-121 | Request without an employee record | custom role (leave request, no employee record) | 422 `the current user has no employee record in this company`; the page shows «لا يوجد ملف موظف مرتبط بحسابك» instead of the form | `page /hr/self/leave/new` `POST /api/v1/hr/leave/requests` | planned | |
| HR-122 | Request without the request capability | custom role (leave read only) | `/account/leave/new` shows the forbidden state; API 403 `hr.leave.request capability is required` | `page /hr/self/leave/new` `POST /api/v1/hr/leave/requests` `cap hr.leave.read` | planned | |
| HR-123 | Leave types list | staff1 | Types of the company's country plus shared ones, ordered by sequence; the form offers only these | `GET /api/v1/hr/leave/types` | planned | |
| HR-124 | Own request record | staff1 | `/account/leave/[id]` shows type, period, days, state, notes; `GET /api/v1/hr/leave/me/<id>` returns only the caller's own request | `page /hr/self/leave/[id]` `GET /api/v1/hr/leave/me/<id>` | planned | |
| HR-125 | Someone else's request through the own-request route | staff1 | `GET /api/v1/hr/leave/me/<id>` of another employee answers 404 | `GET /api/v1/hr/leave/me/<id>` | planned | |
| HR-126 | Staff sees only their own requests | staff1 | `GET /api/v1/hr/leave/requests` returns only own rows; `GET .../requests/<id>` of another employee's request 404; `mine=1` is implied | `GET /api/v1/hr/leave/requests` `GET /api/v1/hr/leave/requests/<id>` | planned | |
| HR-127 | Withdraw inline | staff1 | Row action «سحب الطلب» asks inline (no dialog); confirming deletes the request (`withdrawn: true`) and the row disappears | `page /hr/self/leave` `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-128 | Withdraw refusals | staff1, hr_manager | Withdrawing someone else's pending request 403 `only the requester can withdraw a request`; withdraw needs `hr.leave.request`; a decided request is cancelled, not withdrawn | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-129 | Request on behalf of another employee: details | hr_manager, staff1 | `employee_id` in the body creates 201 for a manager; staff1 with the same body 403 `hr.leave.manage capability is required`; employee of another company 422 `employee_id is outside the current company`; the target employee's company decides the available leave types | `POST /api/v1/hr/leave/requests` | planned | API only, see next row |
| HR-130 | No form field to request on behalf of someone | hr_manager | `LeaveRequestForm` has type, dates and notes only; `employee_id` cannot be chosen in the UI | `page /hr/self/leave/new` | gap | `apps/web/app/components/hr/LeaveRequestForm.vue` |
| HR-131 | Balances of another employee | hr_manager, staff1 | the balances route with an `employee_id` is allowed for a manager; staff1 gets 403 for anyone but themselves; invalid id 422 | `GET /api/v1/hr/leave/balances` | planned | |
| HR-132 | Leave list filters | hr_manager | `state=confirm,validate1` comma list; unknown state 422 `state must be one of confirm, validate1, validate, refuse, cancel`; `employee_id`, `mine=1`, `cancellation_state=pending` (any other value 422 `cancellation_state must be pending`); newest start date first; paging | `GET /api/v1/hr/leave/requests` | planned | |
| HR-133 | Request record of an unknown id | hr_manager | `/hr/leave/0`, `/hr/leave/abc` or another company's id show the not-found state; API 404 | `page /hr/leave/[id]` `GET /api/v1/hr/leave/requests/<id>` | planned | |

## Leave decisions (HR)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-13 | HR approves a request | hr_manager | `validate`; employee sees approved | `page /hr/leave` `POST /api/v1/hr/leave/requests/<id>/approve` `cap hr.leave.approve` | planned | |
| HR-14 | HR refuses with a reason | hr_manager | `refuse`; reason in the record history | `POST /api/v1/hr/leave/requests/<id>/refuse` | planned | |
| HR-15 | HR decides own request | hr_manager | Refused (403) | `POST /api/v1/hr/leave/requests/<id>/approve` | planned | |
| HR-477 | Own-request refusal message | hr_manager | Approving or refusing one's own request answers 403 `forbidden` «a request cannot be approved or refused by its own requester»; the record shows no approve or refuse buttons (`can_approve` false) | `POST /api/v1/hr/leave/requests/<id>/approve` `POST /api/v1/hr/leave/requests/<id>/refuse` | planned | HR-15 detail |
| HR-134 | Approval queue | hr_manager | `/hr/leave` («الإجازات») opens on «بانتظار الاعتماد» (states `confirm`, `validate1`); counts tag; scopes «طلبات إلغاء الإجازات» and «كل الطلبات» write `?scope=all` or `?cancellation_state=pending` | `page /hr/leave` `GET /api/v1/hr/leave/requests` | planned | |
| HR-135 | Queue paging and refresh | hr_manager | `?offset=25` pages; refresh and back from a record keep scope and offset | `page /hr/leave` | planned | |
| HR-136 | Empty queue | hr_manager | Per-scope empty state text | `page /hr/leave` | planned | |
| HR-137 | Staff cannot open the approval queue actions | staff1 | `/hr/leave` shows no approve or refuse actions; `POST .../approve` 403 `hr.leave.approve capability is required` | `page /hr/leave` `cap hr.leave.read` | planned | |
| HR-138 | Approve from the list row | hr_manager | Row action «اعتماد» approves at once; state badge becomes approved; row leaves the pending scope | `page /hr/leave` `POST /api/v1/hr/leave/requests/<id>/approve` | planned | |
| HR-139 | Approve from the record | hr_manager | `/hr/leave/[id]` button «اعتماد» (`hr-leave-record-approve`); record shows approved tag | `page /hr/leave/[id]` `GET /api/v1/hr/leave/requests/<id>` | planned | |
| HR-140 | Refuse inline with an optional reason | hr_manager | «رفض» opens an inline confirmation with a reason box; confirming refuses and posts the reason to the request chatter; reason must be a string (422 otherwise) | `page /hr/leave/[id]` `POST /api/v1/hr/leave/requests/<id>/refuse` | planned | |
| HR-141 | Two-step approval leave type | hr_manager | A leave type needing two approvals: first approval moves `confirm` to `validate1`, second to `validate`; `can_approve` follows the stock rules | `POST /api/v1/hr/leave/requests/<id>/approve` | planned | depends on the leave type validation setting |
| HR-142 | Decide an already decided request | hr_manager | Approving a `refuse` or `cancel` request is refused by hr_holidays with 422 `invalid` | `POST /api/v1/hr/leave/requests/<id>/approve` `POST /api/v1/hr/leave/requests/<id>/refuse` | planned | |
| HR-143 | Decide with extra body fields | hr_manager | Any field other than `reason` (refuse) answers 422 `field 'x' is not writable` | `POST /api/v1/hr/leave/requests/<id>/approve` | planned | |
| HR-144 | Decide a request of another company | hr_manager | 404 `not_found` | `POST /api/v1/hr/leave/requests/<id>/refuse` | planned | |
| HR-145 | Approver attention items | hr_manager | Home «needs decision» lists pending requests and pending cancellations the viewer can decide, linking to `/hr/leave/[id]`; staff1 sees none | `page /hr/leave/[id]` `cap hr.leave.approve` | planned | `modules/hr/attention.ts` |
| HR-146 | No bell notification on leave decisions | staff1 | The code posts only to the request chatter; the employee gets no bell notification when a request is approved or refused | `POST /api/v1/hr/leave/requests/<id>/approve` | decision | Owner choice: notify the employee (webvue_notify) or rely on the list |
| HR-60 | Line manager decides the team's leave | pm | Owner decision: today only the HR role decides | `cap hr.leave.approve` | decision | |

## Leave cancellation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-18 | Cancellation policy `manager_approval`: employee asks to cancel approved leave, HR approves / refuses | staff1 → hr_manager | Pending cancellation then decided; own decision refused; stale revision 409 | `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` `POST /api/v1/hr/leave/requests/<id>/cancellation/refuse` | planned | |
| HR-19 | Cancellation policy `direct_employee` | staff1 | Approved leave cancelled immediately | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-20 | Cancellation policy `manager_only` | staff1 → hr_manager | Employee request refused; HR cancels approved leave directly | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-147 | Request cancellation (policy manager_approval) | staff1 | «طلب إلغاء الإجازة» inline with an optional reason; a cancellation row `pending` is created (revision 1), leave stays `validate`; chatter «Employee cancellation requested» | `page /hr/self/leave/[id]` `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-148 | Request cancellation of a non-approved leave | staff1 | Only approved leave accepts a request: 422 `only approved leave accepts a cancellation request` | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-149 | Cancellation requested twice | staff1 | A second request while one is pending returns the pending one (no duplicate row, no error) | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-150 | Cancellation request refused by policy | staff1 | Under `manager_only` the employee gets 403 `The company policy does not allow a cancellation request.` and the UI offers no request action | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-151 | Leave already started or no longer cancellable | staff1 | Stock `can_cancel` false (dates passed or work entries): 422 `The employee can no longer cancel this leave. Reload and check its dates and work entries.` | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-152 | Direct employee cancellation | staff1 | Under `direct_employee`, «إلغاء الإجازة» inline cancels at once (state `cancel`) through the stock cancel wizard; work entries freed | `page /hr/self/leave` `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-153 | Manager direct cancel | hr_manager | «إلغاء بقرار المدير» on another employee's approved leave, any policy: records a manager-initiated cancellation then executes it; not approved leave 422 `only approved leave can be directly cancelled by a manager` | `page /hr/leave/[id]` `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-154 | Manager cancels a pending cancellation request | hr_manager | `cancel` on a leave with a pending cancellation approves it and requires the matching `revision` | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-155 | Approve cancellation | hr_manager | «اعتماد الإلغاء» (revision required): row `approved`, revision +1, leave `cancel`, reviewer and reason recorded, chatter «Manager approved cancellation» | `page /hr/leave/[id]` `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` | planned | |
| HR-156 | Refuse cancellation needs a reason | hr_manager | «رفض الإلغاء» without a reason 422 `refusal reason is required`; with one the row is `refused`, leave stays approved | `POST /api/v1/hr/leave/requests/<id>/cancellation/refuse` | planned | |
| HR-157 | Decision needs a revision | hr_manager | Missing, boolean or non-positive revision 422 `positive revision is required` | `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` | planned | |
| HR-158 | Stale cancellation revision | hr_manager | Two approvers on the same revision: the second gets 409 `cancellation changed; reload before deciding`; the UI reloads and shows «تغيّرت الإجازة أو طلب الإلغاء. حُمّلت أحدث البيانات؛ راجعها قبل المحاولة مجددًا.» | `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` | planned | |
| HR-159 | Leave changed after the request | hr_manager | Approving a cancellation after the leave record changed: 409 `leave changed; refuse this request and ask the employee to reload and resubmit` | `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` | planned | |
| HR-160 | Cancellation decision without a request | hr_manager | 404 `cancellation request does not exist` | `POST /api/v1/hr/leave/requests/<id>/cancellation/refuse` | planned | |
| HR-161 | Decide own cancellation | hr_manager | A manager who is the leave owner: 403 `You cannot decide your own cancellation request.` | `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` | planned | |
| HR-162 | Cancellation decisions need the approve capability | staff1 | 403 `hr.leave.approve capability is required` on approve, refuse and manager direct cancel | `POST /api/v1/hr/leave/requests/<id>/cancellation/approve` | planned | |
| HR-163 | Cancellation history after refusal | staff1 | A refused request can be requested again: revision increments, state back to `pending` | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | |
| HR-164 | Cancellation badges and history | hr_manager, staff1 | List row and record show the cancellation state badge (pending, approved, refused), initiator, reason, reviewer and review reason | `page /hr/leave/[id]` | planned | |

## Leave allocations

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-10 | Create a leave allocation for an employee | hr_manager | Balance shown to the employee | `page /hr/leave/allocations/new` `POST /api/v1/hr/leave/allocations` `cap hr.leave.manage` | planned | |
| HR-17 | Update and revoke an allocation; change own allocation | hr_manager | Updated/revoked; own allocation refused | `PATCH /api/v1/hr/leave/allocations/<id>` `POST /api/v1/hr/leave/allocations/<id>/revoke` | planned | |
| HR-165 | Allocations list | hr_manager | `/hr/leave/allocations` lists grants of the managed companies newest start first, 25 per page via `?offset=`; row opens the grant | `page /hr/leave/allocations` `GET /api/v1/hr/leave/allocations` | planned | |
| HR-166 | Allocations list filter by employee | hr_manager | `employee_id` filter; invalid id 422 | `GET /api/v1/hr/leave/allocations` | planned | |
| HR-167 | Allocations need manage | staff1 | List, record and new pages show the forbidden state; API 403 `hr.leave.manage capability is required` | `page /hr/leave/allocations` `page /hr/leave/allocations/new` `GET /api/v1/hr/leave/allocations` | planned | |
| HR-168 | Allocation record | hr_manager | `/hr/leave/allocations/[id]`: employee, type, days, validity, state badge; edit and revoke offered unless refused | `page /hr/leave/allocations/[id]` `GET /api/v1/hr/leave/allocations/<id>` | planned | |
| HR-169 | Allocation of another company or unknown id | hr_manager | 404 on the record and the API | `GET /api/v1/hr/leave/allocations/<id>` | planned | |
| HR-170 | Grant form | hr_manager | Employee, type (only types that require an allocation), days, start, optional end; 201; the grant is approved at once whatever the type validation (owner decision D-5 b) | `POST /api/v1/hr/leave/allocations` | planned | |
| HR-171 | Grant validation | hr_manager | Days zero, negative or boolean 422 `number_of_days must be a positive number`; missing start 422 `date_from is required`; end before start 422; type without allocations 422 `this leave type does not use allocations`; employee outside the company 422 `employee_id is outside the current company` | `POST /api/v1/hr/leave/allocations` | planned | |
| HR-172 | Grant to oneself | hr_manager | 403 `an allocation cannot be granted by its own employee` | `POST /api/v1/hr/leave/allocations` | planned | |
| HR-173 | Grant for an employee outside manage scope | hr_manager | Employee in a company where the caller lacks `hr.leave.manage`: 403 | `POST /api/v1/hr/leave/allocations` | planned | |
| HR-174 | Edit allocation days and validity | hr_manager | Days and dates change; type and employee are fixed (422 on any other field); empty body 422 `at least one field is required` | `PATCH /api/v1/hr/leave/allocations/<id>` | planned | |
| HR-175 | Edit allocation below taken days | hr_manager | Reducing days or validity under the days already taken is refused 422 by hr_holidays | `PATCH /api/v1/hr/leave/allocations/<id>` | planned | |
| HR-176 | Edit refused or own allocation | hr_manager | A `refuse` allocation: 422 `a refused allocation cannot be changed`; own allocation: 403 `an allocation cannot be changed by its own employee` | `PATCH /api/v1/hr/leave/allocations/<id>` | planned | |
| HR-177 | Revoke inline | hr_manager | «سحب الرصيد» asks inline, state becomes `refuse`; a revoke that would leave validated leave uncovered is refused 422 and the message shows inline | `page /hr/leave/allocations/[id]` `POST /api/v1/hr/leave/allocations/<id>/revoke` | planned | |
| HR-178 | Revoke with a body | hr_manager | Any body field 422 `field 'x' is not writable` | `POST /api/v1/hr/leave/allocations/<id>/revoke` | planned | |
| HR-179 | Allocation reaches the employee | staff1 | After a grant the personal balance tile shows allocated/remaining; after revoke it disappears | `GET /api/v1/hr/leave/balances` | planned | |

## Leave settings (cancellation policy)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-21 | Change the cancellation policy | hr_manager | Needs `hr.leave.config`; others refused | `PATCH /api/v1/hr/leave/settings` `cap hr.leave.config` | planned | |
| HR-180 | Policy card shows the current value | hr_manager | `/settings/apps/hr#leave` card with three options and the stored revision (0 when never saved, default `manager_approval`) | `GET /api/v1/hr/leave/settings` `page /settings/apps/hr` | planned | |
| HR-181 | Policy option effects | hr_manager, staff1 | `manager_approval`: employee asks, HR decides; `direct_employee`: employee cancels approved leave at once; `manager_only`: only HR cancels (see HR-18 to HR-20) | `PATCH /api/v1/hr/leave/settings` | planned | |
| HR-182 | Policy validation | hr_manager | Unknown policy 422 `unknown cancellation policy`; missing or negative revision 422 `nonnegative revision is required`; unknown field 422 | `PATCH /api/v1/hr/leave/settings` | planned | |
| HR-183 | Stale policy revision | hr_manager | Second editor with an old revision 409 `leave settings changed; reload before saving`; draft kept and a reload button offered | `PATCH /api/v1/hr/leave/settings` | planned | |
| HR-184 | Policy is read-only without config | custom role (leave read) | `GET /api/v1/hr/leave/settings` 403 `hr.leave.config capability is required`; the leave section is not offered | `GET /api/v1/hr/leave/settings` | planned | |
| HR-185 | Policy per company | hr_manager | Settings row is per company (unique); a branch company follows its own policy, absence means `manager_approval` | `PATCH /api/v1/hr/leave/settings` | planned | |

## Self-service pages (employee)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-186 | Own profile page | staff1 | `/account/profile` («بياناتي وملفي الوظيفي»): identity card and properties of the caller's own employee; no contract or compensation | `page /hr/self/profile` `GET /api/v1/hr/me` `cap hr.employees.read` | planned | |
| HR-39 | Employee opens own payslips | staff1 | Own payslips only; none of anyone else | `page /hr/self/pay` `GET /api/v1/hr/payroll/payslips/mine` | planned | |
| HR-187 | Own payslips list | staff1 | `/account/pay` («راتبي وقسائم الرواتب»): approved payslips only, newest first, month, number, net, 25 per page via `?offset=` | `page /hr/self/pay` `GET /api/v1/hr/payroll/payslips/mine` | planned | |
| HR-188 | Own payslips: none yet | staff1 | Empty state «لا قسائم راتب لك بعد» | `page /hr/self/pay` | planned | |
| HR-189 | Own payslip document | staff1 | `/account/pay/[id]` printable payslip (lines, gross, deductions, net, company name and VAT); back to the list | `page /hr/self/pay/[id]` `GET /api/v1/hr/payroll/payslips/mine/<id>` | planned | HR-39 |
| HR-190 | Draft or computed payslips are invisible to the employee | staff1 | Payslips of a run that is not approved never appear in the list; the document route answers 404 | `GET /api/v1/hr/payroll/payslips/mine` `GET /api/v1/hr/payroll/payslips/mine/<id>` | planned | |
| HR-191 | Another employee's payslip by id | staff1 | `GET /api/v1/hr/payroll/payslips/mine/<id>` answers 404 `not_found`; `GET .../runs/<id>/payslips/<id>` 403 `hr.payroll.read capability is required` | `GET /api/v1/hr/payroll/payslips/mine/<id>` | planned | |
| HR-192 | Payslips with payroll sub-feature off | staff1 | `hr.payroll` off: the entry leaves the account page; list answers 403 `feature_not_included` on write-gated tenants and works read-only for a retained feature | `GET /api/v1/hr/payroll/payslips/mine` | planned | See PLT-10 |
| HR-193 | Own assets | staff1 | `/account/assets` («عهدي»): name, serial, category, assign date; read-only, no link into administrative asset records | `page /hr/self/assets` `GET /api/v1/hr/assets/me` | planned | HR-50 |
| HR-194 | Own assets: none | staff1 | Empty state «لا توجد عهدة بحوزتك» | `page /hr/self/assets` | planned | |
| HR-195 | Own assets without an employee record | custom role (employee read, no employee record) | `GET /api/v1/hr/assets/me` returns an empty list; page shows the no-employee state | `GET /api/v1/hr/assets/me` | planned | |
| HR-196 | Own schedule | staff1 | `/account/schedule` («جدول عملي»): the caller's planning rows (schedule, start, end) | `page /hr/self/schedule` `GET /api/v1/hr/shifts/me` | planned | HR-45 |
| HR-197 | Own schedule: none | staff1 | Empty state «لا ورديات مُخطّطة لك» | `page /hr/self/schedule` | planned | |
| HR-198 | Own schedule without an employee record | custom role (employee read, no employee record) | `GET /api/v1/hr/shifts/me` 422 `the current user has no employee record in this company`; page shows the no-employee state | `GET /api/v1/hr/shifts/me` | planned | |
| HR-199 | Self pages never expose others | staff1 | Typing another employee's id into any `/account/*` URL or the `mine` API shows nothing of theirs (404 or own data) | `page /hr/self/leave/[id]` | planned | |

## Payroll settings (general, GOSI rates, salary file profiles, end-of-service cases)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-30 | Payroll settings: day divisor, structure, unpaid and annual leave types, GOSI rates, bank profiles | payroll | Saved | `GET /api/v1/hr/payroll/settings` `PATCH /api/v1/hr/payroll/settings` `POST /api/v1/hr/payroll/gosi-rates` `POST /api/v1/hr/payroll/bank-profiles` `cap hr.payroll.config` | planned | |
| HR-200 | Payroll card of the HR settings page | payroll | `/settings/apps/hr#payroll`: general form, GOSI rate table, salary file profiles, end-of-service case map; read-only without `hr.payroll.config` | `page /settings/apps/hr` `cap hr.payroll.read` | planned | |
| HR-201 | Settings defaults before the first save | payroll | `GET /api/v1/hr/payroll/settings`: divisor 30, structure «Saudi», unpaid leave type, annual leave type, revision 0 | `GET /api/v1/hr/payroll/settings` | planned | |
| HR-202 | Day divisor range | payroll | 28 to 31 accepted; 27, 32, `30.5` or a boolean 422 `day_divisor must be a whole number from 28 to 31` | `PATCH /api/v1/hr/payroll/settings` | planned | |
| HR-203 | Settings relations | payroll | Unknown structure, annual leave type or unpaid type id 422 `<field> does not reference an existing record`; `unpaid_leave_type_ids` not a list 422 | `PATCH /api/v1/hr/payroll/settings` | planned | |
| HR-204 | Settings revision | payroll | Missing revision 422 `revision must be an integer of at least 0`; stale revision 409 `payroll settings changed; reload before saving` and the UI keeps the draft with a reload button; empty body 422 `no fields to update` | `PATCH /api/v1/hr/payroll/settings` | planned | |
| HR-205 | Settings change is audited | payroll | An `payroll_settings_changed` audit event with old and new values of the four policy fields | `PATCH /api/v1/hr/payroll/settings` | planned | See the audit rows |
| HR-206 | Divisor effect on pay | payroll | A day-based amount (absence, unpaid leave, leave encashment) is monthly wage / divisor x days; changing the divisor changes the next computation | `PATCH /api/v1/hr/payroll/settings` | planned | |
| HR-207 | Settings need config; read needs read | hr_manager, payroll | hr_manager: `GET` 403 `hr.payroll.read capability is required`; a reader without config: `PATCH` 403 `hr.payroll.config capability is required` | `GET /api/v1/hr/payroll/settings` `cap hr.payroll.read` | planned | HR-41 |
| HR-208 | GOSI rate table | payroll | Lists shared seed rates (read-only, marked shared) and the company's own, per branch and nationality class, with from-date and wage floor/cap | `GET /api/v1/hr/payroll/gosi-rates` | planned | |
| HR-209 | Add a GOSI rate | payroll | Needs branch, class, date, both rates, wage min and max; 201; audit `gosi_rate_created` | `POST /api/v1/hr/payroll/gosi-rates` | planned | |
| HR-210 | GOSI rate validation | payroll | Missing key 422 `<key> is required`; unknown branch or class 422 `<name> is not a known value`; negative or non-finite number 422 `<name> must be zero or more`; `wage_max` below `wage_min` 422 `wage_max must not be below wage_min`; same branch, class and start date 422 `a rate already starts on that date for this branch and class` (field `date_from`) | `POST /api/v1/hr/payroll/gosi-rates` | planned | |
| HR-211 | Concurrent duplicate GOSI rate | payroll | Two creations for the same key at once: the loser gets 409 `a GOSI rate was created for this branch, class and date at the same time` | `POST /api/v1/hr/payroll/gosi-rates` | planned | |
| HR-212 | Edit a GOSI rate | payroll | PATCH with the row revision; revision +1; audit `gosi_rate_changed`; empty body 422; stale revision 409 `the GOSI rate changed; reload before saving` | `PATCH /api/v1/hr/payroll/gosi-rates/<id>` | planned | |
| HR-213 | Shared GOSI rate is read-only | payroll | PATCH or DELETE of a seed rate 403 `a shared rate is read-only, add a rate of your own`; another company's rate 404 | `PATCH /api/v1/hr/payroll/gosi-rates/<id>` `DELETE /api/v1/hr/payroll/gosi-rates/<id>` | planned | |
| HR-214 | Delete a GOSI rate | payroll | DELETE with `{revision}` only (extra field 422); 204; audit `gosi_rate_deleted` logged before the unlink | `DELETE /api/v1/hr/payroll/gosi-rates/<id>` | planned | |
| HR-215 | Rate in force on the month | payroll | A computation uses, per branch, the latest start date not after the pay month; the company row wins over a shared row; no rate for the class 422 `gosi_rate_missing` | `GET /api/v1/hr/payroll/gosi-rates` | planned | |
| HR-216 | Salary file profiles list | payroll | Shared seeds (generic CSV bank file, Mudad WPS) and the company's own with columns, delimiter, encoding, header, footer | `GET /api/v1/hr/payroll/bank-profiles` | planned | |
| HR-217 | Create a salary file profile | payroll | `name`, `kind` (bank or wps) and non-empty `columns` required; 201; audit `bank_profile_created` | `POST /api/v1/hr/payroll/bank-profiles` | planned | |
| HR-218 | Profile validation | payroll | Missing name/kind/columns 422 `<key> is required`; unknown kind, delimiter (`,` `;` tab or pipe), encoding (utf-8, utf-8-sig) or footer (none, totals) 422 `<name> is not a known value`; `include_header` not boolean 422; column with unknown source 422 `a column source is not a known value`; blank label 422 `every column needs a label`; constant value only on a constant column 422 `only a constant column carries a constant_value, and it needs one` | `POST /api/v1/hr/payroll/bank-profiles` | planned | |
| HR-219 | Edit a profile | payroll | PATCH with revision replaces the column list when sent; revision +1; stale 409 `the salary file profile changed; reload before saving`; shared profile 403 `a shared profile is read-only, add a profile of your own` | `PATCH /api/v1/hr/payroll/bank-profiles/<id>` | planned | |
| HR-220 | Delete a profile | payroll | 204 when no kept salary file uses it; audit `bank_profile_deleted` | `DELETE /api/v1/hr/payroll/bank-profiles/<id>` | planned | |
| HR-221 | Delete a profile kept by a salary file | payroll | 409 `profile_in_use` (`details.file_count`); the audit row is rolled back | `DELETE /api/v1/hr/payroll/bank-profiles/<id>` | planned | |
| HR-222 | End-of-service case map | payroll | One row per departure reason with its case (termination, contract_expiry, resignation, force_majeure, marriage_childbirth, no_award) and revision; seeds map `Fired` to termination and `Resigned` to resignation | `GET /api/v1/hr/payroll/eos-cases` | planned | |
| HR-223 | Change a case mapping | payroll | Saves at once per row with the row revision (0 when the company has none); audit `eos_case_changed`; unknown case 422 `case must be one of ...`; unknown reason 422 | `PUT /api/v1/hr/payroll/eos-cases` | planned | |
| HR-224 | Stale case mapping | payroll | 409 `the end-of-service case of this reason changed; reload before saving`; the table locks until reloaded and shows «غيّر مستخدم آخر هذه الإعدادات أثناء تعديلك...» | `PUT /api/v1/hr/payroll/eos-cases` | planned | |
| HR-225 | Config writes need config | custom role (payroll read and manage, no config) | Rate, profile, case and settings writes 403 `hr.payroll.config capability is required`; the forms are read-only | `PUT /api/v1/hr/payroll/eos-cases` `PATCH /api/v1/hr/payroll/gosi-rates/<id>` | planned | |

## Compensation and IBAN

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-31 | Employee compensation and IBAN | payroll | Saved; never shown to hr_manager or in the directory | `page /hr/employees/[id]/compensation` `GET /api/v1/hr/payroll/compensation/<id>` `PUT /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-226 | Compensation section on the employee record | payroll | Section with basic, housing, transport, other allowance, fixed wage, IBAN, bank, GOSI number and date, relationship type; edit button with `hr.payroll.manage` | `page /hr/employees/[id]` `cap hr.payroll.manage` | planned | |
| HR-227 | Compensation hidden from HR | hr_manager | The record page never fetches or shows the section; `GET .../compensation/<id>` 403 `hr.payroll.read capability is required` | `GET /api/v1/hr/payroll/compensation/<id>` | planned | HR-41 |
| HR-228 | No compensation yet | payroll | Section offers «add»; API 404 `the employee has no compensation record` | `GET /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-229 | Compensation form | payroll | Every key is required (null allowed for IBAN, bank, GOSI number and date); saved with 200 and audit `compensation_changed` (wages and IBAN named, never valued) | `PUT /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-230 | Compensation amounts | payroll | Basic wage must be positive (zero 422 `basic_wage must be positive`); allowances zero or more; text, boolean or non-finite 422 `<field> must be a number` | `PUT /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-231 | IBAN validation | payroll | Saudi IBAN `SA` + 22 digits with the mod-97 check; spaces and lower case normalised to compact upper case; bad IBAN 422 `iban must be a valid Saudi IBAN`; empty/null clears it | `PUT /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-232 | Compensation relations | payroll | Unknown `bank_id` 422 `bank_id does not reference a bank`; unknown `relationship_type` 422 (employee, independent_contractor, consultant, other_cooperation) | `PUT /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-233 | Relationship type warning | payroll | A non-employee relationship shows the relationship warning on the form | `page /hr/employees/[id]/compensation` | planned | |
| HR-234 | Compensation form without manage | custom role (payroll read) | `/hr/employees/[id]/compensation` shows the forbidden state; `PUT` 403 `hr.payroll.manage capability is required` | `page /hr/employees/[id]/compensation` | planned | |
| HR-235 | Compensation of another company's employee | payroll | GET and PUT answer 404 `not_found` | `PUT /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-236 | Compensation of an archived employee | payroll | Still readable and writable (a leaver is paid for the month worked) | `GET /api/v1/hr/payroll/compensation/<id>` | planned | |
| HR-237 | Compensation never leaks | hr_manager, staff1 | Neither the employee serializer, the directory, the people picker nor the self pages ever carry wage, IBAN or GOSI data | `GET /api/v1/hr/employees/<id>` | planned | HR-31 |

## Payroll runs

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-32 | Create a monthly run and compute | payroll | Payslips per employee, `computed` | `page /hr/payroll/new` `POST /api/v1/hr/payroll/runs` `POST /api/v1/hr/payroll/runs/<id>/compute` `cap hr.payroll.manage` | planned | |
| HR-34 | Approve a run | payroll | `approved`; recompute, edit and delete then refused | `POST /api/v1/hr/payroll/runs/<id>/approve` `cap hr.payroll.approve` | planned | |
| HR-35 | Approve a run that contains the approver's own payslip | payroll | Refused (403) | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-478 | Own payslip in the run: refusal detail | payroll | Run that holds the approver's own payslip: 403 `transition_forbidden` field `employee_id` with `details.employee_ids`; another approver can approve | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | HR-35 detail |
| HR-36 | Approve an empty run or one with a negative net | payroll | Refused | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-479 | Approve an empty run | payroll | A run with no payslip (nobody with a compensation record is due) 422 `run_empty` field `employee_id` | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | HR-36 detail |
| HR-480 | Approve a run with a negative net | payroll | A payslip whose deductions exceed earnings 422 `negative_net` with `details.employee_ids`; fixing the inputs and computing again allows approval | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | HR-36 detail |
| HR-41 | HR manager opens payroll | hr_manager | No payroll pages or compensation data | `page /hr/payroll` `cap hr.payroll.read` | automated | `e2e/tests/access-matrix.e2e.ts`: /hr/payroll refused for hr_manager |
| HR-481 | HR manager is refused every payroll route | hr_manager | Settings, GOSI rates, bank profiles, runs, payslips, compensation, EOS cases, finance settings, cost centers and audit events all answer 403 `forbidden` (the `hr.payroll.*` capability is required); the employee record shows no compensation block | `GET /api/v1/hr/payroll/gosi-rates` `GET /api/v1/hr/payroll/bank-profiles` `GET /api/v1/hr/payroll/eos-cases` | planned | HR-41 detail |
| HR-238 | Runs list opens | payroll | `/hr/payroll` («الرواتب»): runs newest month first with state badge, employee count, totals; 25 per page via `?offset=` | `page /hr/payroll` `GET /api/v1/hr/payroll/runs` `cap hr.payroll.read` | planned | |
| HR-239 | Runs filters | payroll | Year select (current +/- years) writes `?year=`; state select (مسودة, محسوب, معتمد, مُرحّل, مدفوع) writes `?state=`; chips; refresh and back keep them; unknown state 422 `state must be one of ...`; invalid year 422 | `page /hr/payroll` `GET /api/v1/hr/payroll/runs` | planned | |
| HR-240 | Runs list empty | payroll | Empty state «لا مسيرات رواتب بعد» with the create action | `page /hr/payroll` | planned | |
| HR-241 | New run form | payroll | `/hr/payroll/new` panel: month `YYYY-MM`; saving creates a draft with one payslip per employee under contract in the month who has a compensation record, then opens the run | `page /hr/payroll/new` | planned | |
| HR-242 | Run month validation | payroll | Missing or malformed month 422 `month must be a YYYY-MM month`; a second run for the same month 422 `duplicate` (field `month`); concurrent creation 409 `a payroll run was created for this month at the same time` | `POST /api/v1/hr/payroll/runs` | planned | |
| HR-243 | Run needs a payroll structure | payroll | Settings without a structure: 422 `structure_missing` «Choose the payroll structure in the payroll settings first.» | `POST /api/v1/hr/payroll/runs` | planned | |
| HR-244 | Who gets a payslip | payroll | Employees with a contract overlapping the month, a compensation record and no departure before the month start; archived leavers included; employees without compensation produce a `compensation_missing` warning instead | `GET /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-245 | Run page | payroll | `/hr/payroll/[id]`: month title, state tag, totals (gross, deductions, GOSI, net), warnings list, action bar from `allowed_actions`, payslip register with search | `page /hr/payroll/[id]` `GET /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-246 | Allowed actions by state and capability | payroll, hr_manager | draft/computed + manage: compute, cancel, edit_inputs; computed + approve: approve; approved + finance caps: post; hr_manager sees the run API 403 | `GET /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-247 | Compute a draft run | payroll | Payslips synced (new eligible added, no-longer-eligible dropped), sheets computed, state `computed`; totals filled | `POST /api/v1/hr/payroll/runs/<id>/compute` | planned | |
| HR-248 | Compute refusals | payroll | Missing contract date 422 `contract_missing`; no compensation 422 `compensation_missing`; no nationality 422 `nationality_missing`; Saudi without GOSI registration date 422 `gosi_registration_missing`; no rate 422 `gosi_rate_missing`; each names `details.employee_id` | `POST /api/v1/hr/payroll/runs/<id>/compute` | planned | |
| HR-249 | Compute an approved run | payroll | 403 `transition_forbidden` «An approved run cannot be computed again.» | `POST /api/v1/hr/payroll/runs/<id>/compute` | planned | |
| HR-250 | Recompute after a change | payroll | Computing again picks up changed compensation, settlement or contract; leaver pay prorated by paid days | `POST /api/v1/hr/payroll/runs/<id>/compute` | planned | |
| HR-251 | Approve a computed run | payroll | Inline confirmation; payslips done, run state `approved`, approver and time recorded, snapshot of IBAN, bank and identification stored, audit `run_approved`; page shows «معتمد» and approver | `page /hr/payroll/[id]` `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-252 | Approve a draft run | payroll | 403 `transition_forbidden` «Only a computed run can be approved.» | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-253 | Approve blocked by a leaver without settlement | payroll | 422 `settlement_missing` with the employee ids when a leaver of the month has no confirmed settlement | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-254 | Approve blocked by open custody | payroll | 422 `custody_open` for a leaver of the month still holding equipment | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-255 | Approve blocked by stale figures | payroll | After a compensation change the run is stale: 422 `run_stale` «Payroll figures changed after the last compute: compute the run again.» | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-256 | Approve blocked by missing IBAN | payroll | 422 `missing_iban` (details.employee_ids) for an employee with a net to pay and no IBAN; a zero net needs none | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-257 | Approve needs the approve capability | custom role (payroll read and manage) | 403 `hr.payroll.approve capability is required`; no approve button | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |
| HR-258 | Delete (cancel) a run | payroll | `cancel` asks inline; a draft or computed run is removed with its payslips (204), its month is free again; audit `run_cancelled` | `DELETE /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-259 | Delete an approved run | payroll | 403 `transition_forbidden` «An approved run cannot be deleted.» | `DELETE /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-260 | Run of another company or unknown id | payroll | `/hr/payroll/0` and foreign ids show not-found; API 404 `not_found` | `GET /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-261 | Runs need the payroll sub-feature | it_admin | `hr.payroll` off: every payroll route 403 `feature_not_included` on writes; navigation entry gone | `GET /api/v1/hr/payroll/runs` | planned | See PLT-10 |
| HR-262 | Runs are read-only in an expired tenant | payroll | Expired tenant: compute, approve, delete and salary-file generation answer 403 `tenant_read_only`; lists and run pages still open | `POST /api/v1/hr/payroll/runs/<id>/compute` | planned | |
| HR-263 | Run printable register | payroll | «طباعة السجل» loads every payslip (not only the page) and prints | `page /hr/payroll/[id]` | planned | |
| HR-264 | Run state change recorded | payroll | Run chatter/tracking records state, approver and time | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | |

## Payslip inputs

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-33 | Edit inputs on a computed run | payroll | Run back to `draft` | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-265 | Inputs table | payroll | Register rows carry overtime amount, absence days, bonus amount, deduction amount, advance recovery amount, each editable in place while the run is draft or computed | `page /hr/payroll/[id]` | planned | |
| HR-266 | Cells save independently | payroll | Only the cell being saved waits; saves reach the server in the order made | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-267 | Input validation | payroll | Empty body 422 `no fields to update`; unknown key 422 `field 'x' is not writable`; negative, non-finite, boolean or text 422 `<key> must be a number, zero or more` | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-268 | Input effect on pay | payroll | Overtime and bonus raise gross, absence days and deduction reduce net (ABSENCE, DEDUCTION lines), advance recovery reduces net and is booked to the advance account | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-269 | Editing a computed run resets it | payroll | Stored lines are dropped, payslips back to draft, run `draft`; audit `run_inputs_changed` names the changed input codes without amounts | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-270 | Edit an approved run | payroll | 403 `transition_forbidden` with `details.reason = not_editable` | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-271 | Unknown payslip or another run's payslip | payroll | 404 `not_found` | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |
| HR-272 | Inputs need manage | custom role (payroll read) | 403 `hr.payroll.manage capability is required`; cells are read-only | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | |

## Payslips of a run

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-273 | Payslip register | payroll | `GET .../runs/<id>/payslips`: one row per employee (employee, department snapshot, state, paid days, inputs, gross, deductions, net, `iban_missing`) ordered by employee, 25 per page | `GET /api/v1/hr/payroll/runs/<id>/payslips` | planned | |
| HR-274 | Register search | payroll | `?q=` filters by employee name in the URL; refresh keeps it | `GET /api/v1/hr/payroll/runs/<id>/payslips` | planned | |
| HR-275 | Payslip document | payroll | `/hr/payroll/[id]/payslips/[id]`: printable document with lines, gross, deductions, net, employer GOSI apart, company name and VAT | `page /hr/payroll/[id]/payslips/[id]` `GET /api/v1/hr/payroll/runs/<id>/payslips/<id>` | planned | |
| HR-276 | Payslip line figures | payroll | BASIC, HOUSING, TRANSPORT, OTHER, OVERTIME, BONUS, EOS, LEAVE_ENC as earnings; ABSENCE, UNPAID, DEDUCTION, ADVANCE, SETTLEMENT_DED, GOSI employee as deductions; net = earnings - deductions; zero lines hidden | `GET /api/v1/hr/payroll/runs/<id>/payslips/<id>` | planned | |
| HR-277 | Paid days and prorating | payroll | A whole month is the divisor; a part month counts calendar days between contract start, month, contract end and departure | `GET /api/v1/hr/payroll/runs/<id>/payslips/<id>` | planned | |
| HR-278 | Unpaid leave deduction | payroll | Approved leave of a type marked unpaid in the settings deducts days x wage / divisor | `GET /api/v1/hr/payroll/runs/<id>/payslips/<id>` | planned | |
| HR-279 | GOSI on a payslip | payroll | Saudi (before/from July 2024), GCC and non-Saudi classes each get their branches (annuities, SANED, hazards) on the capped, prorated base (basic + housing) | `GET /api/v1/hr/payroll/runs/<id>/payslips/<id>` | planned | |
| HR-280 | Payslip print | payroll | «طباعة القسيمة» disabled until loaded; back button returns to the run | `page /hr/payroll/[id]/payslips/[id]` | planned | |
| HR-281 | Payslip of another run or company | payroll | 404 `not_found` | `GET /api/v1/hr/payroll/runs/<id>/payslips/<id>` | planned | |
| HR-282 | Payslips without read | hr_manager | List and document 403 `hr.payroll.read capability is required` | `GET /api/v1/hr/payroll/runs/<id>/payslips` | planned | HR-41 |

## Salary files and GOSI statement

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-37 | Bank file and WPS file | payroll | Generated for an approved run; refused `missing_iban` when an IBAN is missing | `cap hr.payroll.read` | planned | |
| HR-482 | Bank file route | payroll | Generation is a same-site JSON write (POST with `profile_id` and `value_date` in the body) answering a CSV download; employees with a net to pay only; missing IBAN 422 `missing_iban` | `cap hr.payroll.read` `POST /api/v1/hr/payroll/runs/<id>/bank-file` | planned | |
| HR-483 | WPS file route | payroll | POST `/api/v1/hr/payroll/runs/<id>/wps-file` returns every payslip including zero net, only when each line's earnings less deductions equal its net (422 `wps_totals_mismatch`) and every employee has an IBAN | `cap hr.payroll.read` `POST /api/v1/hr/payroll/runs/<id>/wps-file` | planned | |
| HR-38 | GOSI statement | payroll | Totals match payslips | `page /hr/payroll/[id]/gosi` | planned | |
| HR-484 | GOSI statement route | payroll | GET `/api/v1/hr/payroll/runs/<id>/gosi-statement` of an approved run: month, one line per employee with GOSI (number, class, contributory wage, per-branch employee/employer shares) and grand totals; a draft or computed run 403 `transition_forbidden` | `page /hr/payroll/[id]/gosi` `GET /api/v1/hr/payroll/runs/<id>/gosi-statement` | planned | |
| HR-283 | Files section of the run page | payroll | Shown only for approved, posted and paid runs: profile select per kind, value date (bank), «تنزيل» buttons, link to the GOSI statement | `page /hr/payroll/[id]` | planned | |
| HR-284 | Bank file content | payroll | CSV laid out by the chosen profile (default generic CSV): employees with a positive net only, each with the IBAN, bank code and identification stored at approval; file named `salaries-YYYY-MM.csv`; `Cache-Control: private, no-store` | `page /hr/payroll/[id]` | planned | |
| HR-285 | WPS file content | payroll | Every payslip including zero net; named `wps-YYYY-MM.csv`; value date is today | `page /hr/payroll/[id]` | planned | |
| HR-286 | Files of an unapproved run | payroll | 403 `transition_forbidden` «the salary files need an approved payroll run» | `page /hr/payroll/[id]` | planned | |
| HR-287 | File refusals | payroll | Profile of the wrong kind 422 `profile_id must be a bank profile` (or wps); unknown or foreign profile 404; non-JSON content type 415 `unsupported_media_type`; cross-site request 403 `cross_site_request`; missing IBAN 422 `missing_iban` with `details.employee_ids` (names resolved by the page); WPS totals that do not add up 422 `wps_totals_mismatch` | `page /hr/payroll/[id]` | planned | |
| HR-288 | Every download is kept and audited | payroll | Each generated file is stored with its profile layout and an audit `payment_file_generated` (kind, filename, value date; never content); a profile used by a kept file cannot be deleted | `page /hr/payroll/[id]` | planned | |
| HR-289 | Salary file IBAN comes from the approval snapshot | payroll | Changing the compensation IBAN after approval does not change the generated file | `page /hr/payroll/[id]` | planned | |
| HR-290 | Files are writes in a read-only tenant | payroll | Expired tenant: file generation 403 `tenant_read_only`, buttons say so first | `page /hr/payroll/[id]` | planned | |
| HR-291 | Salary files with read only | custom role (payroll read) | Files can be generated with `hr.payroll.read` alone (no manage/approve needed) | `cap hr.payroll.read` | planned | Doubtful: a read capability downloads IBANs, see the report |
| HR-292 | GOSI statement page | payroll | `/hr/payroll/[id]/gosi`: per employee GOSI number, class, contributory wage, branch shares, employee/employer totals, totals row, print button | `page /hr/payroll/[id]/gosi` | planned | |
| HR-293 | GOSI statement not approved | payroll | Draft or computed run: 403 `transition_forbidden`; page shows «كشف التأمينات متاح بعد اعتماد المسيّر» with a back button | `page /hr/payroll/[id]/gosi` | planned | |
| HR-294 | GOSI statement empty | payroll | Run without GOSI lines shows the empty state | `page /hr/payroll/[id]/gosi` | planned | |

## End-of-service settlement

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-40 | End-of-service settlement draft then confirm | payroll | Save needs manage, confirm needs approve | `cap hr.payroll.approve` | planned | |
| HR-485 | Settlement routes | payroll | PUT `/api/v1/hr/payroll/eos/<id>/settlement` saves the draft (`hr.payroll.manage`), GET reads it, POST `.../settlement/confirm` locks it (`hr.payroll.approve`), GET `.../estimate` previews | `cap hr.payroll.manage` `PUT /api/v1/hr/payroll/eos/<id>/settlement` `GET /api/v1/hr/payroll/eos/<id>/settlement` `POST /api/v1/hr/payroll/eos/<id>/settlement/confirm` | planned | |
| HR-295 | Estimate before saving | payroll | `GET .../eos/<id>/estimate` (date defaults to the departure date, `case` optional) returns service years, EOS wage, award, leave days and amount | `page /hr/offboarding/[id]` `GET /api/v1/hr/payroll/eos/<id>/estimate` | planned | |
| HR-296 | Estimate refusals | payroll | No date and no departure 422 `date is required: the employee has no departure date`; unknown case 422; date before service start 422 `invalid`; no contract date 422 `contract_missing`; no annual leave type 422 `annual_leave_type_missing`; no case mapping 422 `eos_case_missing` | `page /hr/offboarding/[id]` | planned | |
| HR-297 | Award per case | payroll | Termination, contract expiry, force majeure and marriage/childbirth pay half a month per year to five years and a month per year after; resignation pays 0 under 2 years, one third to 5, two thirds under 10, full from 10; `no_award` pays 0 | `page /hr/offboarding/[id]` | planned | Saudi Labor Law arts. 84-87 (VERIFY flag in the seed) |
| HR-298 | Leave encashment | payroll | Remaining annual balance on the date (negative pays nothing) x wage / divisor | `page /hr/offboarding/[id]` | planned | |
| HR-299 | Settlement section | payroll | Offboarding record shows the section only with `hr.payroll.read`; choose the case, enter open deductions, save the draft, confirm | `page /hr/offboarding/[id]` | planned | |
| HR-300 | Save a draft | payroll | Creates or recomputes the draft for the current departure; audit `settlement_saved`; negative or text deductions 422 `open_deductions must be zero or more`; no departure date 422 `departure_missing` | `page /hr/offboarding/[id]` | planned | |
| HR-301 | Confirm needs approve | custom role (payroll read and manage) | Confirm 403 `hr.payroll.approve capability is required` | `cap hr.payroll.manage` | planned | |
| HR-302 | Confirm own settlement | payroll | 403 `transition_forbidden` «You cannot confirm your own settlement.» (details.employee_id); UI says «لا يمكنك اعتماد تسوية نهاية خدمتك أنت.» | `page /hr/offboarding/[id]` | planned | |
| HR-303 | Confirm recomputes first | payroll | If balance, departure or wage changed since the draft: 422 `settlement_changed` with draft and recomputed figures; saving the draft again then confirming works | `page /hr/offboarding/[id]` | planned | |
| HR-304 | Confirmed settlement is locked | payroll | Saving again 403 `transition_forbidden` «A confirmed settlement cannot be changed.»; confirming again «The settlement is already confirmed.»; UI «التسوية معتمدة بالفعل ولا يمكن تغييرها.» | `page /hr/offboarding/[id]` | planned | |
| HR-305 | Departure date change after confirmation | hr_manager, payroll | `departure_mismatch` is true; the payroll run for the month treats the settlement as unconfirmed (blocker `settlement_missing`) | `page /hr/offboarding/[id]` | planned | |
| HR-306 | Settlement reaches the payslip | payroll | In the departure month the payslip reads award (EOS), encashment (LEAVE_ENC) and open deductions (SETTLEMENT_DED) from the confirmed settlement | `page /hr/payroll/[id]/payslips/[id]` | planned | |
| HR-307 | Settlement of another company's employee | payroll | 404 `not_found` (also for a missing settlement: 404 `the employee has no final settlement`) | `page /hr/offboarding/[id]` | planned | |

## Payroll audit trail

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-308 | Audit events API | payroll | `GET /api/v1/hr/payroll/audit-events` lists events of the current company newest first: action, who, when, record and changed fields; paged | `GET /api/v1/hr/payroll/audit-events` `cap hr.payroll.audit.read` | planned | |
| HR-309 | Audit filters | payroll | `action` must be a known action (422 otherwise); `date_from` / `date_to` are inclusive local days in the user's timezone; `date_from` after `date_to` 422 `date_to must be on or after date_from` | `GET /api/v1/hr/payroll/audit-events` | planned | |
| HR-310 | Audit needs its own capability | custom role (payroll read and manage) | 403 `hr.payroll.audit.read capability is required` | `GET /api/v1/hr/payroll/audit-events` | planned | |
| HR-311 | Audit rows are immutable and secret-free | payroll | No create, edit or delete path; wages, IBANs, settlement figures and constant column values never appear in change rows | `GET /api/v1/hr/payroll/audit-events` | planned | |
| HR-312 | Every audited action leaves one event | payroll | settings, GOSI rate create/change/delete, profile create/change/delete, case change, compensation, settlement save/confirm, inputs, run approve/cancel, file generated | `GET /api/v1/hr/payroll/audit-events` | planned | |
| HR-313 | No page shows the audit trail | payroll | Nothing in `apps/web` reads the audit route, so a holder of `hr.payroll.audit.read` has no screen for it | `page /settings/apps/hr` | gap | grep `audit-events` in `apps/web/app` only finds the finance audit |

## Payroll finance bridge (posting, payment, end-of-service provision, cost centers)

Needs the finance bridge (`webvue_hr_finance`), the `finance.enabled` feature and finance capabilities on top of payroll
ones. Run states after approval: `approved` then `posted` then `paid`. Persona for these rows is
`custom role (payroll_manager + finance_manager)` unless stated, because no seeded persona holds both.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-314 | Finance settings card | custom role (payroll_manager + finance_manager) | `/settings/apps/hr#payroll` shows journal, ten account mappings (basic, allowance, variable, GOSI expense, GOSI payable, salaries payable, deductions, advances, EOS expense, EOS provision), default cost center and entry detail; the card is hidden when the bridge answers 403 or 404 | `GET /api/v1/hr/payroll/finance-settings` `page /settings/apps/hr` | planned | |
| HR-315 | Finance settings read capability | cfo | Readable with `hr.payroll.read` or `finance.setup.read` (either); a persona with neither 403 `one of hr.payroll.read, finance.setup.read capability is required` | `GET /api/v1/hr/payroll/finance-settings` | planned | |
| HR-316 | Save finance settings | custom role (payroll_manager + finance_manager) | PATCH accepts `journal_id`, `accounts` (key to id or null), `default_analytic_account_id`, `entry_detail` (`aggregated` or `per_employee`); each only when sent | `PATCH /api/v1/hr/payroll/finance-settings` `cap hr.payroll.finance.manage` | planned | |
| HR-317 | Finance settings validation | custom role (payroll_manager + finance_manager) | Empty body 422 `no fields to update`; unknown key (also inside `accounts`) 422; `entry_detail` other than the two 422 `entry_detail must be aggregated or per_employee`; journal not of type general, other company or foreign currency refused 422; account of another company refused; salaries payable and advance accounts must allow reconciliation 422 `accounts.<key> must allow reconciliation` | `PATCH /api/v1/hr/payroll/finance-settings` | planned | |
| HR-318 | Finance settings write capability | accountant | Needs `hr.payroll.finance.manage` or `finance.setup.manage` (either); `accountant` holds neither: 403 | `PATCH /api/v1/hr/payroll/finance-settings` | planned | The write has no revision, last write wins (see the report) |
| HR-319 | Entry detail option | custom role (payroll_manager + finance_manager) | `aggregated`: one line per account and cost center; `per_employee`: salary, advance and expense lines carry the employee as partner | `PATCH /api/v1/hr/payroll/finance-settings` | planned | |
| HR-320 | Cost centers table | custom role (payroll_manager + finance_manager) | One row per department of the company with its analytic account (or none) | `GET /api/v1/hr/payroll/cost-centers` | planned | |
| HR-321 | Map a department to a cost center | cfo | PUT `{analytic_account_id}` creates or updates the mapping; `null` clears it; saves per row | `PUT /api/v1/hr/payroll/cost-centers/<id>` `cap finance.analytic.manage` | planned | |
| HR-322 | Cost center refusals | cfo | Missing key 422 `analytic_account_id is required`; analytic account of another company refused; department of another company 404; without `finance.analytic.manage` 403 | `PUT /api/v1/hr/payroll/cost-centers/<id>` | planned | |
| HR-323 | Posting preview | custom role (payroll_manager + finance_manager) | Approved run only: balanced lines per account (expense debit, GOSI payable, salaries payable credit), cost center and employee per line, warnings `unmapped_department` | `GET /api/v1/hr/payroll/runs/<id>/posting-preview` | planned | |
| HR-324 | Preview of a run that is not approved | custom role (payroll_manager + finance_manager) | 403 `transition_forbidden` «Only an approved run has a posting preview.» | `GET /api/v1/hr/payroll/runs/<id>/posting-preview` | planned | |
| HR-325 | Preview refusals | custom role (payroll_manager + finance_manager) | Journal not set 422 `settings_incomplete` (field `journal_id`); accounts missing 422 `settings_incomplete` with `details.accounts`; department without cost center and no default 422 `missing_cost_center`; journal currency different from the company 422 | `GET /api/v1/hr/payroll/runs/<id>/posting-preview` | planned | |
| HR-326 | Post the run | custom role (payroll_manager + finance_manager) | Inline confirmation with the preview; one posted journal entry dated the month end (ref run name), run `posted`, entry name shown (`قيد المحاسبة`) to a reader of entries | `POST /api/v1/hr/payroll/runs/<id>/post` `cap finance.entries.post` | planned | |
| HR-327 | Post refusals | custom role (payroll_manager + finance_manager) | Not approved 403 `transition_forbidden` «Only an approved run can be posted.»; a later month already has its EOS provision 422 `provision_after_run`; locked period 422 `period_locked`; unbalanced entry refused; without `finance.entries.post` 403 | `POST /api/v1/hr/payroll/runs/<id>/post` | planned | |
| HR-328 | Posted entry is protected | cfo | The payroll journal entry cannot be reset, cancelled or deleted from finance | `POST /api/v1/hr/payroll/runs/<id>/post` | planned | |
| HR-329 | Record salary payment | custom role (payroll_manager + finance_manager) | Posted run: choose a bank or cash journal and a date; one outbound payment of the salaries payable is created, posted and reconciled; run `paid`; payment name shown | `POST /api/v1/hr/payroll/runs/<id>/payment` `cap finance.payments.manage` | planned | |
| HR-330 | Payment refusals | custom role (payroll_manager + finance_manager) | Run not posted 403 `transition_forbidden` «Only a posted run can be paid.»; journal not bank/cash or other company 422 `the journal must be a bank or cash journal`; foreign currency 422; date before the payroll entry 422 `the payment date is before the payroll entry`; locked period 422; nothing owed 422 | `POST /api/v1/hr/payroll/runs/<id>/payment` | planned | |
| HR-331 | Payment input validation | custom role (payroll_manager + finance_manager) | Missing or malformed `date` / `journal_id` 422 | `POST /api/v1/hr/payroll/runs/<id>/payment` | planned | |
| HR-332 | Payment cannot be unreconciled | cfo | The reconciliation of the salary payment cannot be undone from finance | `POST /api/v1/hr/payroll/runs/<id>/payment` | planned | |
| HR-333 | Finance actions on the run page by capability | payroll, cfo | `post` appears for approved runs with `finance.entries.post`; `record_payment` for posted runs with `finance.payments.manage`; `eos_provision` for posted or paid with `finance.entries.post`; payroll alone sees none | `GET /api/v1/hr/payroll/runs/<id>` | planned | |
| HR-334 | Bridge absent or finance feature off | it_admin | Without `finance.enabled` the finance routes answer 403 `feature_not_included`; the run page shows no finance action and the finance settings card is hidden | `GET /api/v1/hr/payroll/finance-settings` | planned | |
| HR-335 | End-of-service provision list | custom role (payroll_manager + finance_manager) | Lists posted provisions (month, entry) of the company; needs `hr.payroll.read` and `finance.entries.read` | `page /hr/payroll/[id]` `GET /api/v1/hr/payroll/eos-provisions` | planned | GET `/api/v1/hr/payroll/eos-provisions` |
| HR-336 | Post the month's provision | custom role (payroll_manager + finance_manager) | From a posted or paid run: one entry per month (201), expense debit and provision credit by cost center (or per employee); remembered so the next month posts only the delta | `page /hr/payroll/[id]` `POST /api/v1/hr/payroll/eos-provisions` | planned | POST `/api/v1/hr/payroll/eos-provisions` with `{month}` |
| HR-337 | Provision refusals | custom role (payroll_manager + finance_manager) | Run of the month not posted 403 `transition_forbidden`; this or a later month already posted 422 `duplicate`; an earlier run not posted 422 `earlier_run_unposted`; locked period; nothing to post 422 `invalid`; accounts missing 422 `settings_incomplete` | `page /hr/payroll/[id]` | planned | |

## Shifts: schedules

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-45 | Create a schedule and assign it | hr_manager | Employee sees it in `/hr/self/schedule` | `page /hr/shifts/schedules/new` `POST /api/v1/hr/shifts/schedules` `POST /api/v1/hr/shifts/assignments` `cap hr.shifts.manage` | planned | |
| HR-338 | Schedules list | hr_manager | `/hr/shifts/schedules`: name, timezone, hours per week, state; segmented «نشطة / الكل / مؤرشفة» writes `?active=`; 25 per page | `page /hr/shifts/schedules` `GET /api/v1/hr/shifts/schedules` `cap hr.shifts.read` | planned | |
| HR-339 | Schedules list filter and invalid value | hr_manager | `active=all`, `0`, `false`, `1`, `true` accepted; anything else 422 `active must be '0', 'false', '1', 'true' or 'all'` | `GET /api/v1/hr/shifts/schedules` | planned | |
| HR-340 | Schedules empty | hr_manager | Empty state with create | `page /hr/shifts/schedules` | planned | |
| HR-341 | New schedule form | hr_manager | Name, timezone, work-time lines (day 0-6, period morning/lunch/afternoon/full_day, from and to hours, week type); creates (200) a company schedule that is not auto-generated | `POST /api/v1/hr/shifts/schedules` | planned | Returns 200 not 201 (see the report) |
| HR-342 | Schedule validation | hr_manager | Blank name 422 `name is required`; unknown timezone 422 `tz is not a known timezone`; `two_weeks` true 422 `two_weeks must be false`; no lines 422 `attendances must be a non-empty list`; bad day 422 `dayofweek must be a day between 0 and 6`; bad period 422; hour outside 0-24 or `hour_to` before `hour_from` 422; week type other than 0, 1 or null 422 | `POST /api/v1/hr/shifts/schedules` | planned | |
| HR-343 | Schedule record | hr_manager | `/hr/shifts/schedules/[id]`: lines, hours per week, timezone, state; edit form and archive button | `page /hr/shifts/schedules/[id]` `GET /api/v1/hr/shifts/schedules/<id>` | planned | |
| HR-344 | Edit a schedule | hr_manager | PATCH name, timezone or the whole set of lines (replaced); empty body 422 `at least one field is required`; hours per week recomputed | `PATCH /api/v1/hr/shifts/schedules/<id>` | planned | |
| HR-345 | Archive a schedule inline | hr_manager | Confirm then archived; the schedule leaves the assignment pickers but stays on existing assignments | `POST /api/v1/hr/shifts/schedules/<id>/archive` | planned | |
| HR-346 | Archive a schedule still planned for an employee | hr_manager | The engine refuses (422 with its message) while a current employee is planned on it | `POST /api/v1/hr/shifts/schedules/<id>/archive` | planned | |
| HR-347 | Archive with a body | hr_manager | Any field 422 `field 'x' is not writable` | `POST /api/v1/hr/shifts/schedules/<id>/archive` | planned | |
| HR-348 | Schedule of another company or an employee's own calendar | hr_manager | 404 `not_found`; auto-generated per-employee calendars never appear | `GET /api/v1/hr/shifts/schedules/<id>` | planned | |
| HR-349 | Schedules need shifts capabilities | staff1 | List, record, create pages show the forbidden state; API 403 `hr.shifts.read capability is required` (read) or `hr.shifts.manage capability is required` (write) | `page /hr/shifts/schedules` `GET /api/v1/hr/shifts/schedules` `cap hr.shifts.read` | planned | |
| HR-350 | Shifts sub-feature off | it_admin | `hr.shifts` off: routes 403 `feature_not_included`, navigation entry gone, `/account/schedule` hidden | `GET /api/v1/hr/shifts/schedules` | planned | See PLT-10 |

## Shifts: assignments and settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-46 | Shift day reference `company` vs `user` timezone | hr_manager | Days shift as configured | `GET /api/v1/hr/shifts/settings` `PATCH /api/v1/hr/shifts/settings` | planned | |
| HR-351 | Assignments list | hr_manager | `/hr/shifts` (القائمة الرئيسية للورديات): employee, schedule, period; filters employee, schedule, `on_date` written to the URL; 25 per page; clear filters | `page /hr/shifts` `GET /api/v1/hr/shifts/assignments` | planned | |
| HR-352 | Assignments filter validation | hr_manager | Non-integer `employee_id` or `schedule_id` 422; malformed `on_date` 422 `on_date must be a YYYY-MM-DD date`; a row covers a date when each open end includes it | `GET /api/v1/hr/shifts/assignments` | planned | |
| HR-353 | Assign a schedule | hr_manager | `/hr/shifts/new` panel; start defaults to today (in the day-reference timezone), end optional; the employee's open-ended default row is cut the day before the start (and continues after a bounded period) | `page /hr/shifts/new` `POST /api/v1/hr/shifts/assignments` | planned | |
| HR-354 | Assignment validation | hr_manager | Missing employee or schedule 422; `date_end` before `date_start` 422 `date_end is before date_start`; archived or other-company employee 422 `employee_id is not an active employee of the current company`; archived or foreign schedule 422 `schedule_id is not an available work schedule` | `POST /api/v1/hr/shifts/assignments` | planned | |
| HR-355 | Overlapping assignment | hr_manager | A period meeting another dated row of the same employee: 422 `assignment_overlap` (field `date_start`); the cut rows stay as they were | `POST /api/v1/hr/shifts/assignments` | planned | |
| HR-356 | Plan own shifts | hr_manager | Assigning, editing or deleting a row of the caller's own employee: 403 `an assignment of the caller cannot be planned by the caller` | `POST /api/v1/hr/shifts/assignments` | planned | |
| HR-357 | Assignment record | hr_manager | `/hr/shifts/assignments/[id]`: employee, schedule, period; edit schedule and dates; delete inline | `page /hr/shifts/assignments/[id]` `GET /api/v1/hr/shifts/assignments/<id>` | planned | |
| HR-358 | Edit assignment | hr_manager | Change schedule or dates; empty body 422 `at least one field is required`; overlap re-checked excluding the row; the archived current schedule stays choosable | `PATCH /api/v1/hr/shifts/assignments/<id>` | planned | |
| HR-359 | Delete assignment | hr_manager | Inline confirm; row removed (`{id}` answered) | `DELETE /api/v1/hr/shifts/assignments/<id>` | planned | |
| HR-360 | Assignment of another company | hr_manager | 404 on the record, edit and delete | `GET /api/v1/hr/shifts/assignments/<id>` | planned | |
| HR-361 | Shift settings card | hr_manager | `/settings/apps/hr#shifts`: day reference `company` or `user` timezone, company timezone, effective timezone, today; read by anyone with `hr.employees.read` | `GET /api/v1/hr/shifts/settings` `page /settings/apps/hr` | planned | |
| HR-362 | Day reference options | hr_manager | `company`: today and defaults follow the company calendar timezone; `user`: follow the user's timezone (falls back to the company's) | `PATCH /api/v1/hr/shifts/settings` | planned | |
| HR-363 | Shift settings validation | hr_manager | Day reference other than the two 422 `choose company or user timezone`; revision not a non-negative integer 422; unknown field 422; stale revision 409 `shift settings changed; reload before saving` | `PATCH /api/v1/hr/shifts/settings` | planned | |
| HR-364 | Shift settings write needs manage | staff1 | Read allowed, `PATCH` 403 `hr.shifts.manage capability is required` | `PATCH /api/v1/hr/shifts/settings` | planned | |
| HR-365 | Own planning rows | staff1 | `GET /api/v1/hr/shifts/me` returns only the caller's rows, newest start first; paged | `GET /api/v1/hr/shifts/me` | planned | |

## Onboarding

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-47 | Onboarding plan and run; assignee completes a step | hr_manager → staff1 | Step done once; second completion refused | `POST /api/v1/hr/onboarding/plans` `POST /api/v1/hr/onboarding/runs` `POST /api/v1/hr/onboarding/runs/<id>/steps/<id>/done` | planned | |
| HR-48 | Cancel an onboarding run | hr_manager | `cancelled` | `POST /api/v1/hr/onboarding/runs/<id>/cancel` | planned | |
| HR-366 | Onboarding runs list | hr_manager | `/hr/onboarding` («استقبال الموظفين»): employee, plan, progress done/total, state; state select (open, done, cancelled) writes `?state=`; 25 per page; empty state «لا عمليات استقبال بعد» | `page /hr/onboarding` `GET /api/v1/hr/onboarding/runs` `cap hr.onboarding.read` | planned | |
| HR-367 | Runs list filters | hr_manager | `state` other than open/done/cancelled 422; `employee_id` filter; state is derived from the checklist and filtered after the read | `GET /api/v1/hr/onboarding/runs` | planned | |
| HR-368 | Onboarding needs read | staff1 | Page shows the forbidden state; API 403 `hr.onboarding.read capability is required` | `page /hr/onboarding` `cap hr.onboarding.read` | planned | |
| HR-369 | Plans list | hr_manager | `/hr/onboarding/plans`: plans of the company and shared ones; `?active=true` default, `false`, `all`; unknown value 422 `active must be true, false or all` | `page /hr/onboarding/plans` `GET /api/v1/hr/onboarding/plans` | planned | |
| HR-370 | New plan | hr_manager | `/hr/onboarding/plans/new`: name, optional department, at least one step (summary, responsible manager/coach/employee/other, delay count, unit days/weeks/months, before/after the plan date); 201; steps are always the stock to-do activity | `page /hr/onboarding/plans/new` `POST /api/v1/hr/onboarding/plans` `cap hr.onboarding.manage` | planned | |
| HR-371 | Plan validation | hr_manager | Missing name 422 `name is required`; missing steps 422 `steps is required`; empty steps list 422; blank summary 422; bad responsible type 422; `other` without `responsible_user_id` 422 `responsible_user_id is required for the other type`; user id on a non-other step 422; negative delay 422; unknown field 422 `unknown field: x`; department outside the company or a shared plan with a company department 422; inactive or foreign responsible user 422 `responsible_user_id is not available` | `POST /api/v1/hr/onboarding/plans` | planned | |
| HR-372 | Plan record and edit | hr_manager | `/hr/onboarding/plans/[id]`: edit name, department and steps (replaces all steps); PATCH with no fields 422 `no fields to update` | `page /hr/onboarding/plans/[id]` `GET /api/v1/hr/onboarding/plans/<id>` `PATCH /api/v1/hr/onboarding/plans/<id>` | planned | |
| HR-373 | Deactivate and reactivate a plan | hr_manager | Inline confirm toggles `active`; an inactive plan is not offered when launching a run, existing runs continue | `PATCH /api/v1/hr/onboarding/plans/<id>` | planned | |
| HR-374 | Offboarding plan through the onboarding route | hr_manager | A plan whose purpose is offboarding answers 404 on the onboarding routes and vice versa | `GET /api/v1/hr/onboarding/plans/<id>` | planned | |
| HR-375 | Plan write needs manage | staff1, custom role (onboarding read) | Create and edit 403 `hr.onboarding.manage capability is required`; forms show forbidden | `POST /api/v1/hr/onboarding/plans` | planned | |
| HR-376 | Launch a run | hr_manager | `/hr/onboarding/new`: employee, plan, optional date (default today); creates the stock activities for the employee and the run record (201), opens the run; `?employee_id=` prefilled after a hire | `page /hr/onboarding/new` `cap hr.onboarding.manage` | planned | |
| HR-377 | Launch validation | hr_manager | Missing employee or plan 422; unknown field 422; employee of another company 404; plan of another purpose or company 404; malformed `plan_date` 422 | `POST /api/v1/hr/onboarding/runs` | planned | |
| HR-378 | Launch needs employees manage too | custom role (onboarding manage only) | The capability dependency adds `hr.employees.manage`; a role built without it cannot be saved | `POST /api/v1/hr/onboarding/runs` | planned | Access README: dependencies |
| HR-379 | Run record | hr_manager | `/hr/onboarding/[id]`: employee, plan, plan date, launched by, progress, steps with assignee, deadline, state, completion date | `page /hr/onboarding/[id]` `GET /api/v1/hr/onboarding/runs/<id>` | planned | |
| HR-380 | Complete a step as manager | hr_manager | Any step of the run can be completed, optional feedback text; run becomes `done` when the last step is done | `POST /api/v1/hr/onboarding/runs/<id>/steps/<id>/done` | planned | |
| HR-381 | Complete a step as its assignee | custom role (onboarding read) | The assignee completes only their own step; another person's step 403 `an HR manager or the step assignee must complete a step` | `POST /api/v1/hr/onboarding/runs/<id>/steps/<id>/done` | planned | |
| HR-382 | Plain employee assignee cannot complete | staff1 | A step assigned to an ordinary employee (no `hr.onboarding.read`): the route needs that capability first, so staff1 gets 403; no self-service page lists the employee's own steps | `POST /api/v1/hr/onboarding/runs/<id>/steps/<id>/done` | decision | See HR-47: the step assignee in a normal onboarding is the employee or their manager |
| HR-383 | Complete refusals | hr_manager | Already done step 422 `this step is already done`; cancelled run 422 `this plan run is cancelled`; non-string feedback 422; step of another run 404 | `POST /api/v1/hr/onboarding/runs/<id>/steps/<id>/done` | planned | |
| HR-384 | Cancel a run | hr_manager | Inline form requires a reason (422 `reason is required` otherwise); open steps are removed, done steps stay, a note on the employee records plan and reason; state `cancelled` with who, when, why | `page /hr/onboarding/[id]` | planned | |
| HR-385 | Cancel refusals | hr_manager | A completed run 422 `A completed plan run cannot be cancelled.`; a cancelled run 422 `This plan run is already cancelled.` | `POST /api/v1/hr/onboarding/runs/<id>/cancel` | planned | |
| HR-386 | Run of another company | hr_manager | 404 on the record, steps and cancel | `GET /api/v1/hr/onboarding/runs/<id>` | planned | |
| HR-387 | Hire then start onboarding | hr_manager | After hiring an applicant the record offers «بدء الاستقبال» linking to `/hr/onboarding/new?employee_id=` | `page /hr/onboarding/new` | planned | See HR-52 |
| HR-388 | Onboarding sub-feature off | it_admin | `hr.onboarding` off: write routes 403 `feature_not_included`; page and navigation gone | `GET /api/v1/hr/onboarding/plans` | planned | See PLT-10 |

## Offboarding, departures and clearance

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-49 | Offboarding: departure date, clearance steps | hr_manager | Second departure date refused; own clearance refused | `POST /api/v1/hr/offboarding/departures` `POST /api/v1/hr/offboarding/runs/<id>/steps/<id>/done` | planned | |
| HR-389 | Departures list | hr_manager | `/hr/offboarding` («إنهاء الخدمة»): employees with a departure date, newest first; search `?q=`; clearance select (all, `cleared=true`, `cleared=false`); 25 per page; empty state «لا حالات إنهاء خدمة بعد» | `page /hr/offboarding` `GET /api/v1/hr/offboarding/departures` `cap hr.offboarding.read` | planned | |
| HR-390 | Departures filter validation | hr_manager | `cleared` other than true/false 422 `cleared must be true or false`; archived employees included | `GET /api/v1/hr/offboarding/departures` | planned | |
| HR-391 | A run without steps is not cleared | hr_manager | `cleared=true` excludes employees whose latest run has no steps or is cancelled | `GET /api/v1/hr/offboarding/departures` | planned | |
| HR-392 | Offboarding needs read | staff1 | Forbidden state; API 403 `hr.offboarding.read capability is required` | `page /hr/offboarding` | planned | |
| HR-393 | Departure reasons | hr_manager | Reasons of the company's country and shared ones, ordered by sequence | `GET /api/v1/hr/offboarding/reasons` | planned | |
| HR-394 | Register a departure | hr_manager | `/hr/offboarding/new`: employee, date, reason, description, «set contract end» (default true), optional clearance plan; 201; sets the departure fields and optionally the contract end; clearance run launched when a plan is chosen | `page /hr/offboarding/new` `cap hr.offboarding.manage` | planned | |
| HR-395 | Register validation | hr_manager | Missing employee, date or reason 422; malformed date 422 `departure_date must be a YYYY-MM-DD date`; `set_contract_end` not boolean 422; reason of another country 422 `departure_reason_id is not available`; employee that already has a departure date 422 `this employee already has a departure date`; unknown field 422 | `POST /api/v1/hr/offboarding/departures` | planned | |
| HR-396 | Register own departure | hr_manager | Self-decision refused: 403 `the caller cannot decide on their own employee record` | `POST /api/v1/hr/offboarding/departures` | planned | |
| HR-397 | Register needs manage | staff1 | `/hr/offboarding/new` forbidden; API 403 `hr.offboarding.manage capability is required` | `POST /api/v1/hr/offboarding/departures` | planned | |
| HR-398 | Departure record | hr_manager | `/hr/offboarding/[employeeId]`: reason, departure date, clearance progress, held-assets warning with link to `/hr/assets?employee_id=`, clearance steps, end-of-service section, departure form | `page /hr/offboarding/[id]` `GET /api/v1/hr/offboarding/departures/<id>` | planned | |
| HR-399 | Departure of an employee without departure date | hr_manager | `GET /api/v1/hr/offboarding/departures/<id>` 404 for an employee who has not left | `GET /api/v1/hr/offboarding/departures/<id>` | planned | |
| HR-400 | Edit a departure | hr_manager | Change date, reason or description; empty body 422 `no fields to update`; own departure 403; employee write capability needed (dependency) | `PATCH /api/v1/hr/offboarding/departures/<id>` | planned | |
| HR-401 | Start clearance from the record | hr_manager | A departure without a run offers a plan select and «بدء التصفية»; with a run shows the steps | `page /hr/offboarding/[id]` | planned | |
| HR-402 | Offboarding plans | hr_manager | `/hr/offboarding/plans` list, `/new`, `/[id]` record: same rules as onboarding plans, purpose offboarding | `page /hr/offboarding/plans` `page /hr/offboarding/plans/new` `page /hr/offboarding/plans/[id]` `GET /api/v1/hr/offboarding/plans` `GET /api/v1/hr/offboarding/plans/<id>` `POST /api/v1/hr/offboarding/plans` `PATCH /api/v1/hr/offboarding/plans/<id>` | planned | |
| HR-403 | Offboarding plan validation and toggle | hr_manager | Same refusals as the onboarding plan rows; deactivate hides it from the clearance picker | `PATCH /api/v1/hr/offboarding/plans/<id>` | planned | |
| HR-404 | Offboarding plan write needs manage | staff1 | 403 `hr.offboarding.manage capability is required` | `cap hr.offboarding.manage` | planned | |
| HR-405 | Clearance runs list and record | hr_manager | `GET /api/v1/hr/offboarding/runs` filter `state`, `employee_id`; record with steps | `GET /api/v1/hr/offboarding/runs` `GET /api/v1/hr/offboarding/runs/<id>` | planned | |
| HR-406 | Launch clearance | hr_manager | Employee and plan of the offboarding purpose; own employee 403 | `POST /api/v1/hr/offboarding/runs` | planned | |
| HR-407 | Complete a clearance step | hr_manager | Manager or assignee completes; the employee's own clearance can never be completed by themselves even as assignee: 403 `the caller cannot complete their own clearance` | `POST /api/v1/hr/offboarding/runs/<id>/steps/<id>/done` | planned | |
| HR-408 | Cancel clearance | hr_manager | Reason required; done steps stay; the departure then has no clearance until a new run starts; own clearance 403 | `POST /api/v1/hr/offboarding/runs/<id>/cancel` | planned | |
| HR-409 | Departure date drives pay | hr_manager, payroll | Departure date inside a month makes the leaver need a confirmed settlement before that month's run can be approved | `PATCH /api/v1/hr/offboarding/departures/<id>` | planned | |
| HR-410 | Offboarding sub-feature off | it_admin | `hr.offboarding` off: write routes 403 `feature_not_included`; the archive no longer requires a departure date | `GET /api/v1/hr/offboarding/runs` | planned | See PLT-10 |

## Assets and custody

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-50 | Custody: create category and asset, assign, return, archive | hr_manager | Employee sees own assets in `/hr/self/assets` | `page /hr/assets/categories/new` `page /hr/assets/new` `POST /api/v1/hr/assets/categories` `POST /api/v1/hr/assets/equipment` `POST /api/v1/hr/assets/equipment/<id>/assign` `POST /api/v1/hr/assets/equipment/<id>/return` `POST /api/v1/hr/assets/equipment/<id>/archive` | planned | |
| HR-51 | Assign an already assigned asset; return an unassigned one | hr_manager | Refused | `cap hr.assets.manage` | planned | |
| HR-486 | Custody refusal messages | hr_manager | Assigning an assigned asset 422 `this asset is already assigned; return it first` (field `employee_id`); returning an unassigned asset 422 `this asset is not assigned; there is nothing to return`; the UI hides the return action on an unassigned asset | `POST /api/v1/hr/assets/equipment/<id>/assign` `POST /api/v1/hr/assets/equipment/<id>/return` | planned | HR-51 detail |
| HR-411 | Assets list | hr_manager | `/hr/assets` («الأصول والعهد»): name, category, serial, holder, assign date; 25 per page; links to categories | `page /hr/assets` `GET /api/v1/hr/assets/equipment` `cap hr.assets.read` | planned | |
| HR-412 | Assets filters | hr_manager | `?q=` (name or serial), `category_id`, `employee_id` (archived holder allowed), `assigned=true/false`, `active=true/false/all`; chips and clear; refresh and back keep them | `page /hr/assets` `GET /api/v1/hr/assets/equipment` | planned | |
| HR-413 | Assets filter validation | hr_manager | `assigned` other than true/false 422 `assigned must be 'true' or 'false'`; `active` other than true/false/all 422; category of another company 422 `category_id does not reference a category of the current company`; unknown holder 422 `employee_id does not reference an employee of the current company` | `GET /api/v1/hr/assets/equipment` | planned | |
| HR-414 | Assets need read | staff1 | Page forbidden; API 403 `hr.assets.read capability is required` | `page /hr/assets` | planned | |
| HR-415 | Categories list | hr_manager | `/hr/assets/categories`: company and shared categories by name; empty state; create action with manage | `page /hr/assets/categories` `GET /api/v1/hr/assets/categories` | planned | |
| HR-416 | New category | hr_manager | Panel over the categories list; blank name 422 `name must not be empty`; unknown field 422; 201 | `page /hr/assets/categories/new` | planned | |
| HR-417 | New asset form | hr_manager | `/hr/assets/new` panel: name, category, serial, model, warranty date; 201 then opens the asset; blank name 422; unknown field 422; category of another company 422 | `page /hr/assets/new` | planned | |
| HR-418 | Asset record | hr_manager | `/hr/assets/[id]`: identity, custody panel, details form edited in place (save disabled until dirty), return and archive actions; archived asset still opens | `page /hr/assets/[id]` `GET /api/v1/hr/assets/equipment/<id>` | planned | |
| HR-419 | Edit asset details | hr_manager | PATCH name, category, serial, model, warranty date; empty body 422 `no fields to update`; clearing category sends null | `PATCH /api/v1/hr/assets/equipment/<id>` | planned | |
| HR-420 | Assign inline | hr_manager | Custody panel: choose an active employee and a date (default today); asset shows the holder | `page /hr/assets/[id]` | planned | |
| HR-421 | Assign refusals | hr_manager | Missing employee 422 `employee_id is required`; archived or other-company employee 422 `employee_id does not reference an active employee of the current company`; own employee 403 `equipment custody of the caller's own employee is not a self-decision`; malformed date 422 | `POST /api/v1/hr/assets/equipment/<id>/assign` | planned | |
| HR-422 | Return inline | hr_manager | «إعادة العهدة» asks inline; holder cleared, history kept in the chatter; returning one's own custody 403 | `page /hr/assets/[id]` | planned | |
| HR-423 | Archive (scrap) inline | hr_manager | Archive asks inline with a scrap date (default today); asset leaves the active list | `page /hr/assets/[id]` | planned | |
| HR-424 | Archive an asset that is still assigned | hr_manager | Not blocked: the asset is archived while the holder stays set, and the employee archive check (active equipment only) no longer counts it | `POST /api/v1/hr/assets/equipment/<id>/archive` | decision | Owner choice: block until returned, or clear the holder on archive |
| HR-425 | Asset of another company | hr_manager | 404 on the record and every action | `GET /api/v1/hr/assets/equipment/<id>` | planned | |
| HR-426 | Asset writes need manage | custom role (assets read) | Create, edit, assign, return, archive and category create 403 `hr.assets.manage capability is required`; record shows fields read-only | `cap hr.assets.read` | planned | |
| HR-427 | Assets sub-feature off | it_admin | `hr.assets` off: write routes 403 `feature_not_included`; `/account/assets` and the custody exit blocker disappear | `GET /api/v1/hr/assets/me` | planned | See PLT-10 |

## Recruitment

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-52 | Recruitment: job, applicant, refuse, reset, hire | hr_manager | Hire creates an employee; hiring a refused applicant refused; second link refused | `page /hr/recruitment/jobs/new` `page /hr/recruitment/new` `POST /api/v1/hr/recruitment/jobs` `POST /api/v1/hr/recruitment/applicants` `POST /api/v1/hr/recruitment/applicants/<id>/refuse` `POST /api/v1/hr/recruitment/applicants/<id>/reset` `POST /api/v1/hr/recruitment/applicants/<id>/hire` | planned | |
| HR-428 | Applicants list | hr_manager | `/hr/recruitment` («التوظيف»): number, applicant, job, stage, status, priority; newest first; 25 per page | `page /hr/recruitment` `GET /api/v1/hr/recruitment/applicants` `cap hr.recruitment.read` | planned | |
| HR-429 | Applicants status filter | hr_manager | Segmented «الكل / قيد التوظيف / تم التعيين / مرفوض / مؤرشف» writes `?status=`; unknown status 422 `status is not a known applicant status` | `GET /api/v1/hr/recruitment/applicants` | planned | |
| HR-430 | Applicants search, job and stage | hr_manager | `?q=`, `job_id`, `stage_id`; stage list follows the chosen job; a stage not linked to the job 422 `stage_id is not available for this job position`; job of another company 422 `job_id is outside the current company`; chips and clear; refresh and back keep them | `GET /api/v1/hr/recruitment/stages` `page /hr/recruitment` | planned | |
| HR-431 | Applicants empty | hr_manager | Empty state with create | `page /hr/recruitment` | planned | |
| HR-432 | Recruitment needs read | staff1 | Page forbidden; API 403 `hr.recruitment.read capability is required` (also for stages and refuse reasons) | `GET /api/v1/hr/recruitment/refuse-reasons` | planned | |
| HR-433 | Refuse reasons list | hr_manager | Reasons ordered by sequence | `GET /api/v1/hr/recruitment/refuse-reasons` | planned | |
| HR-434 | New applicant | hr_manager | `/hr/recruitment/new` panel: name, job, email, phone, availability; applicant created in the first stage of the job (201) | `page /hr/recruitment/new` `cap hr.recruitment.manage` | planned | |
| HR-435 | New applicant validation | hr_manager | Blank name 422 `partner_name must not be empty`; missing job 422 `job_id is required`; foreign job 422; bad email 422 `email_from must be a valid email address`; bad date 422; unknown field 422 | `POST /api/v1/hr/recruitment/applicants` | planned | |
| HR-436 | Applicant record | hr_manager | `/hr/recruitment/[id]`: status badge, stage and priority selects, contact details; department and employee references shown only with `hr.departments.read` / `hr.employees.read` | `page /hr/recruitment/[id]` `GET /api/v1/hr/recruitment/applicants/<id>` | planned | |
| HR-437 | Move stage and priority | hr_manager | Selecting a stage or priority saves at once; priority 0-3 only (else 422 `priority must be one of 0, 1, 2 or 3`); empty body 422 `no fields to update` | `PATCH /api/v1/hr/recruitment/applicants/<id>` | planned | |
| HR-438 | Refuse an applicant | hr_manager | Inline: reason required (button disabled until chosen); applicant archived with the reason, status «مرفوض»; no mail sent | `page /hr/recruitment/[id]` | planned | |
| HR-439 | Refuse validation | hr_manager | Missing reason 422 `refuse_reason_id is required`; unknown reason 422 `refuse_reason_id does not reference an existing record` | `POST /api/v1/hr/recruitment/applicants/<id>/refuse` | planned | |
| HR-440 | Reset an applicant | hr_manager | `reset` returns the applicant to the first stage (and un-refuses it) | `POST /api/v1/hr/recruitment/applicants/<id>/reset` | planned | |
| HR-441 | Refused applicant cannot be reset from the page | hr_manager | The record offers «إعادة إلى المرحلة الأولى» only while the applicant is open to the pipeline, so a refused applicant cannot be restored from the UI | `page /hr/recruitment/[id]` | gap | `apps/web/app/pages/hr/recruitment/[applicantId].vue` `openToPipeline` |
| HR-442 | Hire an applicant | hr_manager | «تعيين كموظف» inline: creates the employee in the applicant's company and links it; success notice with the employee link and a start-onboarding link | `page /hr/recruitment/[id]` | planned | |
| HR-443 | Hire needs both capabilities | custom role (recruitment manage only) | Hire 403 `hr.employees.manage capability is required` (both `hr.recruitment.manage` and `hr.employees.manage` are needed); the button is hidden | `cap hr.employees.manage` | planned | |
| HR-444 | Hire refusals | hr_manager | Applicant already linked 422 `this applicant is already linked to an employee`; refused applicant 422 `a refused applicant cannot be hired`; hired employee has no login (access is granted separately) | `POST /api/v1/hr/recruitment/applicants/<id>/hire` | planned | |
| HR-445 | Recruitment writes need manage | custom role (recruitment read) | Create, edit, refuse, reset 403 `hr.recruitment.manage capability is required`; record fields read-only | `PATCH /api/v1/hr/recruitment/applicants/<id>` | planned | |
| HR-446 | Jobs list | hr_manager | `/hr/recruitment/jobs`: name, department, target, ongoing applicants, state; `?active=true/false/all`, `?q=`, `department_id`; invalid `active` 422 | `page /hr/recruitment/jobs` `GET /api/v1/hr/recruitment/jobs` | planned | |
| HR-447 | New job | hr_manager | `/hr/recruitment/jobs/new` panel: name, department, target number, description; 201; blank name 422; negative or non-integer target 422 `no_of_recruitment must be a non-negative integer`; department of another company 422 | `page /hr/recruitment/jobs/new` | planned | |
| HR-448 | Job record and edit | hr_manager | `/hr/recruitment/jobs/[id]`: edit in place, active switch (archive/restore), link to its applicants (`?job_id=`); patch with active not boolean 422; empty body 422 | `page /hr/recruitment/jobs/[id]` `GET /api/v1/hr/recruitment/jobs/<id>` `PATCH /api/v1/hr/recruitment/jobs/<id>` | planned | |
| HR-449 | Job and applicant of another company | hr_manager | 404 on records; stage listing with a foreign `job_id` 422 | `GET /api/v1/hr/recruitment/applicants/<id>` | planned | |
| HR-450 | Recruitment sub-feature off | it_admin | `hr.recruitment` off: write routes 403 `feature_not_included` | `GET /api/v1/hr/recruitment/jobs` | planned | See PLT-10 |

## Reports

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-53 | Expiring items and Saudization reports | hr_manager | Figures match the seeded and created data | `page /hr/reports` `GET /api/v1/hr/expiring` `GET /api/v1/hr/saudization` | planned | |
| HR-451 | Reports page | hr_manager | `/hr/reports` («التقارير»): Saudization tiles (rate, Saudi, non-Saudi, unknown) and by-department table; expiring table | `page /hr/reports` | planned | |
| HR-452 | Saudization arithmetic | hr_manager | Active employees by nationality; rate = Saudi / (Saudi + non-Saudi), unknown excluded from the rate but counted in the total; null when nobody has a nationality; employees without department in a «no department» row | `GET /api/v1/hr/saudization` | planned | |
| HR-453 | Expiring window | hr_manager | Segmented 30 / 60 / 90 days writes `?within=` (30 is the bare URL); items overdue first with negative days; today, N days left, overdue badges | `GET /api/v1/hr/expiring` | planned | |
| HR-454 | Expiring sources | hr_manager | Contract end, probation end and identity expiry of active employees; the documents bridge adds dated documents; the employee name links to the record carrying the report as back target | `GET /api/v1/hr/expiring` | planned | See DOC-11 |
| HR-455 | Expiring validation | hr_manager | `within_days` outside 0 to 365 or not an integer 422 `within_days must be an integer from 0 to 365`; default 60 | `GET /api/v1/hr/expiring` | planned | |
| HR-456 | Reports are manager-only | staff1 | Page shows «التقارير متاحة لمديري الموارد البشرية فقط.»; both routes 403 `hr.employees.manage capability is required` | `cap hr.employees.manage` | planned | |
| HR-457 | Empty report | hr_manager | Nothing expiring shows the empty state; no employees shows the Saudization empty state | `page /hr/reports` | planned | |
| HR-458 | Other company's employees | hr_manager | Not counted in any figure | `GET /api/v1/hr/saudization` | planned | |

## Settings page (`/settings/apps/hr`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-459 | Page sections by capability | hr_manager, payroll, staff1 | Sections payroll (payroll read), leave (leave config), shifts (employee read / shifts manage); a user with none sees the forbidden state | `page /settings/apps/hr` | planned | |
| HR-460 | Sub-navigation anchors | hr_manager | `#payroll`, `#leave`, `#shifts` anchors scroll to their card; refresh keeps the anchor | `page /settings/apps/hr` | planned | |
| HR-461 | Read-only cards | custom role (payroll read) | Forms render values with editing disabled and no save button | `page /settings/apps/hr` | planned | |
| HR-462 | Reload after conflict | payroll | After a 409 the reload button refetches and refills the form or shows the reload error; a failed refetch never swaps the card to its error state | `page /settings/apps/hr` | planned | |
| HR-463 | Truncated lookups | custom role (payroll_manager + finance_manager) | When the accounts, journals or analytic lists are truncated the finance form says so | `page /settings/apps/hr` | planned | |

## Cross-cutting: capabilities, company scope and tenant state

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-54 | HR sub-feature switched off (for example `hr.payroll`) | it_admin / vendor | Its pages and routes disappear | `GET /api/v1/hr/payroll/settings` | planned | See PLT-10 |
| HR-464 | Baseline employee capabilities | staff1 | Every employee holds `hr.employees.read`, `hr.departments.read`, `hr.leave.read` and `hr.leave.request` and nothing else in HR | `cap hr.employees.read` `cap hr.departments.read` `cap hr.leave.read` `cap hr.leave.request` | planned | |
| HR-465 | HR manager role | hr_manager | Holds employees read, manage, archive, access status; departments read, manage; leave read, request, approve, manage, config; recruitment, shifts, onboarding, offboarding and assets read and manage; holds no payroll capability | `cap hr.employees.access_status.read` `cap hr.departments.manage` `cap hr.recruitment.manage` `cap hr.shifts.read` `cap hr.assets.manage` | planned | |
| HR-466 | Payroll manager role | payroll | Holds payroll read, manage, approve, config, audit read and finance manage and nothing else beyond the employee baseline | `cap hr.payroll.finance.manage` | planned | |
| HR-467 | Capability dependencies | it_admin | A custom role cannot hold a capability without its dependencies: payroll keys need `hr.payroll.read`; shifts/onboarding/offboarding manage need `hr.employees.manage`; every area read needs `hr.employees.read` (recruitment excepted) | `cap hr.onboarding.read` `cap hr.offboarding.read` `cap hr.shifts.manage` | planned | See ACC-* |
| HR-468 | Sensitive capabilities are flagged | it_admin | Manage/approve/config/offboarding/payroll capabilities show as sensitive in the role editor | `cap hr.payroll.read` `cap hr.payroll.manage` `cap hr.payroll.approve` `cap hr.payroll.config` `cap hr.payroll.audit.read` | planned | |
| HR-469 | Membership alone grants nothing | ceo | A general manager with no HR role holds only the baseline: cannot approve leave or open payroll | `cap hr.leave.approve` | planned | |
| HR-470 | Branch company capabilities | hr_manager | A capability held in the parent company applies to its branches only as the access model allows; leave of a branch employee visible to the staff of that branch | `GET /api/v1/hr/leave/requests` | planned | See ACC-* |
| HR-471 | Foreign company ids everywhere | hr_manager | A record id from another company answers 404 (never 403) on employees, departments, leave, runs, payslips, compensation, assets, plans, runs, assignments, applicants and jobs | `GET /api/v1/hr/employees/<id>` | planned | |
| HR-472 | Odoo web client stays closed | hr_manager | `/odoo`, `/web/dataset` and the generic RPC endpoints answer 404 for HR staff too; every HR function lives in `/hr` | `page /hr` | planned | |
| HR-473 | Suspended tenant | hr_manager | Suspended tenant without support: every HR route 403 `tenant_suspended` | `GET /api/v1/hr/employees` | planned | See SAAS-* |
| HR-474 | Expired tenant is read-only | hr_manager | Writes 403 `tenant_read_only`, reads work | `POST /api/v1/hr/employees` | planned | |
| HR-475 | `non_saas` deployment | it_admin | HR works with no control-plane connection and no billing | `page /hr` | planned | R8 |
