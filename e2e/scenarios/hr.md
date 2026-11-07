# HR and payroll

Pages: `/hr` (employee directory), `/hr/employees`, `/hr/departments`, `/hr/leave`, `/hr/payroll`,
`/hr/shifts`, `/hr/onboarding`, `/hr/offboarding`, `/hr/assets`, `/hr/recruitment`, `/hr/reports`,
self-service pages (files `hr/self/*`, served at `/account/profile`, `/account/leave`, `/account/pay`,
`/account/assets`, `/account/schedule`), settings `/settings/apps/hr`. Owners: `liwan_hr`,
`liwan_hr_finance` (payroll posting, payment, end-of-service provision, cost centers).
Personas and status values: [README](README.md).

Approval note: leave is decided by holders of `hr.leave.approve` (the HR role), not by the
employee's line manager. Whether the line manager should also decide is open (`HR-60`).

How to read the refusals below (all from `liwan_api` handlers):

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
| HR-71 | Row archive from the directory | hr_manager | Inline confirmation in the row; confirming archives, the row leaves the active list | `page /hr` `POST /api/v1/hr/employees/<id>/archive` | planned | fixed in the hr-launch-fixes branch, to rerun: #182; directory row «أرشفة الموظف» with inline confirm on an employee without departure date: nothing is archived and the only feedback is the generic toast «تعذّر الحفظ لأن بعض البيانات غير صحيحة.» (the record page shows the specific «لا يمكن أرشفة الموظف بعد — سجّل تاريخ الخروج أولًا.») |

## Employee record, create, edit and archive

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-84 | Unknown, malformed or other-company id | hr_manager | `/hr/employees/0`, `/hr/employees/abc` and an id of another company show the not-found state; the API answers 404 `not_found` | `page /hr/employees/[id]` `GET /api/v1/hr/employees/<id>` | fail | #197; UI: /hr/employees/0 and /hr/employees/abc show the not-found card (ok); API: /hr/employees/abc answers a raw Odoo HTML 404 page, /hr/employees/0 and 99999 JSON 404 not_found; API GET /hr/employees/abc answers 404 with the raw Odoo HTML error page instead of JSON 404 not_found; /hr/employees/0 and 99999 answer JSON 404 not_found |
| HR-86 | Manager or department outside the company | hr_manager | `parent_id` of another company 422 `parent_id is outside the current company`; unreadable record 422 `parent_id is not available` | `PATCH /api/v1/hr/employees/<id>` | planned | fixed in the hr-launch-fixes branch, to rerun: #197; r2 employee PATCH/POST with manager (parent_id) or department_id of the other company 422 «<field> is not available» (ok); but department PATCH/POST with parent_id of another company's department answers 403 with raw Odoo AccessError text (English, names the user) instead of 422; same for manager_id. findings2/hr.md; not run: second company |
| HR-89 | Contract dates have no editor in the UI | hr_manager | The employee pages show and edit only name, job, email, phone, department, manager; contract start/end, probation end, identity expiry and notice period (which feed the expiring report) can be set only through the API | `page /hr/employees/[id]/edit` | gap | #151; `apps/web/app/components/hr/EmployeeGeneralForm.vue` has no contract fields |

## Departments

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Leave requests (employee)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-130 | No form field to request on behalf of someone | hr_manager | `LeaveRequestForm` has type, dates and notes only; `employee_id` cannot be chosen in the UI | `page /hr/self/leave/new` | gap | #152; `apps/web/app/components/hr/LeaveRequestForm.vue` |

## Leave decisions (HR)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-141 | Two-step approval leave type | hr_manager | A leave type needing two approvals: first approval moves `confirm` to `validate1`, second to `validate`; `can_approve` follows the stock rules | `POST /api/v1/hr/leave/requests/<id>/approve` | fail | #237; leave type with two approvals («both») made from the Odoo shell: one approve by the HR manager moved confirm -> validate directly (stock can_validate for HR officers), second approve 422 «You cannot approve this leave.» (raw English); validate1 is unreachable because only the HR role holds hr.leave.approve; see findings3/hr.md; r2 not run: both leave types here need a single approval; depends on the leave type validation setting |
| HR-142 | Decide an already decided request | hr_manager | Approving a `refuse` or `cancel` request is refused by hr_holidays with 422 `invalid` | `POST /api/v1/hr/leave/requests/<id>/approve` `POST /api/v1/hr/leave/requests/<id>/refuse` | planned | fixed in the hr-launch-fixes branch, to rerun: #180; approve of a REFUSED request returned 200 and moved it to validate (can_approve is true on refused rows); a CANCELLED request: approve 422 «You cannot approve this leave.», refuse 422 «Time off request must be confirmed or validated in order to refuse it.» |
| HR-60 | Line manager decides the team's leave | pm | Owner decision: today only the HR role decides | `cap hr.leave.approve` | planned | round 3 final: owner decision row (#165), nothing to execute; owner decision row, nothing to execute; #165 |

## Leave cancellation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-148 | Request cancellation of a non-approved leave | staff1 | Only approved leave accepts a request: 422 `only approved leave accepts a cancellation request` | `POST /api/v1/hr/leave/requests/<id>/cancel` | planned | fixed in the hr-launch-fixes branch, to rerun: #180; r2 staff1 POST cancel on his REFUSED leave 13: 200 and the leave becomes state «cancel» (a refused request is silently rewritten as cancelled); expected 422 «only approved leave accepts a cancellation request». findings2/hr.md |

## Leave allocations

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Leave settings (cancellation policy)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Self-service pages (employee)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Payroll settings (general, GOSI rates, salary file profiles, end-of-service cases)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Compensation and IBAN

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Payroll runs

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-32 | Create a monthly run and compute | payroll | Payslips per employee, `computed` | `page /hr/payroll/new` `POST /api/v1/hr/payroll/runs` `POST /api/v1/hr/payroll/runs/<id>/compute` `cap hr.payroll.manage` | manual 2026-11-05 | retest #178: with nationalities set through the product only (Saudi and Egyptian), compensation PUT 200 and contract start set through PATCH, the 2026-10 run computed two payslips: Saudi gross 13500 with GOSI 1218.75, Egyptian 13500 with no employee GOSI; totals gross 27000, employer GOSI 1718.75; no database edit; retest #178: HR sets the nationality through PATCH /hr/employees/<id> nationality_id; payroll compute no longer depends on a DB edit; #178; payroll created run for 2026-09 (draft, allowed compute/cancel/edit_inputs) and computed: payslips for every employee with compensation, state computed, totals gross/deductions/GOSI/net. Needed nationality set directly in the scratch DB (see findings) |
| HR-264 | Run state change recorded | payroll | Run chatter/tracking records state, approver and time | `POST /api/v1/hr/payroll/runs/<id>/approve` | planned | round 3 final: run state tracking has no page or API; only the payroll audit events exist (HR-312); r2 not run: run tracking records have no page or API |

## Payslip inputs

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-266 | Cells save independently | payroll | Only the cell being saved waits; saves reach the server in the order made | `PATCH /api/v1/hr/payroll/runs/<id>/payslips/<id>/inputs` | planned | round 3 final: per-cell save ordering needs a UI race harness (two edits in flight with delayed responses); not built; r2 not run: per-cell saving needs a UI race test |

## Payslips of a run

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Salary files and GOSI statement

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-294 | GOSI statement empty | payroll | Run without GOSI lines shows the empty state | `page /hr/payroll/[id]/gosi` | planned | round 3 final: an empty run cannot be approved (422 run_empty), and the statement opens only for an approved run; an approved run without GOSI lines needs an approved run that is permanent in this data; r2 not run: an approved run always contains GOSI lines in this data |

## End-of-service settlement

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-305 | Departure date change after confirmation | hr_manager, payroll | `departure_mismatch` is true; the payroll run for the month treats the settlement as unconfirmed (blocker `settlement_missing`) | `page /hr/offboarding/[id]` | fail | #208; r2 confirmed settlement, then departure date moved (2027-04-10 -> 04-20): GET settlement answers 404 «the employee has no final settlement» (departure_mismatch can never be true; the UI shows an empty draft form instead of a mismatch notice); payroll run 2027-04 approve 422 settlement_missing details.employee_ids [39] (ok). findings2/hr.md |

## Payroll audit trail

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-313 | The audit trail has a page | payroll | A holder of `hr.payroll.audit.read` opens the trail with action and day filters and paging | `page /settings/apps/hr/audit` | planned | not run; page added for #153; rerun to confirm |

## Payroll finance bridge (posting, payment, end-of-service provision, cost centers)

Needs the finance bridge (`liwan_hr_finance`), the `finance.enabled` feature and finance capabilities on top of payroll
ones. Run states after approval: `approved` then `posted` then `paid`. Persona for these rows is
`custom role (payroll_manager + finance_manager)` unless stated, because no seeded persona holds both.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-334 | Bridge absent or finance feature off | it_admin | Without `finance.enabled` the finance routes answer 403 `feature_not_included`; the run page shows no finance action and the finance settings card is hidden | `GET /api/v1/hr/payroll/finance-settings` | fail | #220; exclusive phase, finance.enabled off: finance routes (finance-settings, posting-preview, cost-centers) 403 feature_not_included and the finance settings card on /settings/apps/hr is hidden; but the approved run page /hr/payroll/7 still shows an enabled «ترحيل إلى المحاسبة» button (clicking it only ends in a 403 on posting-preview), see findings; not run: feature switch (not allowed to switch features off) |

## Shifts: schedules

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-340 | Schedules empty | hr_manager | Empty state with create | `page /hr/shifts/schedules` | planned | round 3 final: every company, including a newly created one, gets a default schedule «Standard 40 hours/week» (new branch company shows 1 of 1), so the empty state cannot be produced; r2 not run: a default schedule always exists |

## Shifts: assignments and settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Onboarding

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Offboarding, departures and clearance

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Assets and custody

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-424 | Archive an asset that is still assigned | hr_manager | Refused: archiving an assigned asset answers 422 `invalid` (field `employee_id`) «return the asset to the company before archiving it»; the detail page offers «أرشفة الأصل» only once the asset is returned | `POST /api/v1/hr/assets/equipment/<id>/archive` | planned | #165 owner decision 2026-10-29 (direct fix); Odoo test `test_an_asset_held_by_an_employee_cannot_be_archived`; 2026-10-28 run: archiving an assigned asset succeeded (200) |

## Recruitment

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-440 | Reset an applicant | hr_manager | `reset` returns the applicant to the first stage (and un-refuses it) | `POST /api/v1/hr/recruitment/applicants/<id>/reset` | planned | fixed in the hr-launch-fixes branch, to rerun: #154; POST reset on a refused applicant returns 200, clears the refuse reason and moves nothing: the applicant stays archived (active false, status archived) instead of returning to the first stage active |
| HR-441 | Refused applicant cannot be reset from the page | hr_manager | The record offers «إعادة إلى المرحلة الأولى» only while the applicant is open to the pipeline, so a refused applicant cannot be restored from the UI | `page /hr/recruitment/[id]` | gap | #154; `apps/web/app/pages/hr/recruitment/[applicantId].vue` `openToPipeline` |
| HR-442 | Hire an applicant | hr_manager | «تعيين كموظف» inline: creates the employee in the applicant's company and links it; success notice with the employee link and a start-onboarding link | `page /hr/recruitment/[id]` | planned | fixed in the hr-launch-fixes branch, to rerun: #154; hire created the employee and linked it, but the applicant status stays «ongoing» (not hired) and the status=hired filter returns nothing, so the «تم التعيين» filter never lists hired applicants (UI hire flow not exercised) |

## Reports

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-456 | Reports are manager-only | staff1 | Page shows «التقارير متاحة لمديري الموارد البشرية فقط.»; both routes 403 `hr.employees.manage capability is required` | `cap hr.employees.manage` | planned | fixed in the hr-launch-fixes branch, to rerun: #182; staff1 gets the generic 403 page «لا تملك صلاحية فتح هذه الصفحة» instead of the expected text «التقارير متاحة لمديري الموارد البشرية فقط.»; both report routes answer 403 «hr.employees.manage capability is required» |

## Settings page (`/settings/apps/hr`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-463 | Truncated lookups | custom role (payroll_manager + finance_manager) | When the accounts, journals or analytic lists are truncated the finance form says so | `page /settings/apps/hr` | planned | round 3 final: needs more accounts, journals or analytic accounts than the list limit in one company and the finance setup; not built; r2 not run: needs more than the list limit of accounts; not run: finance bridge needs custom role payroll_manager+finance_manager and chart/journal setup, not built |

## Cross-cutting: capabilities, company scope and tenant state

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| HR-468 | Sensitive capabilities are flagged | it_admin | Manage/approve/config/offboarding/payroll capabilities show as sensitive in the role editor | `cap hr.payroll.read` `cap hr.payroll.manage` `cap hr.payroll.approve` `cap hr.payroll.config` `cap hr.payroll.audit.read` | fail | #207; r2 API permission catalog flags them (sensitive true for payroll, offboarding, manage, approve, config) but the role editor /settings/team/roles/<id>/edit shows no sensitive marker. findings2/hr.md; not run: custom role |
| HR-472 | Odoo web client stays closed | hr_manager | `/odoo`, `/web/dataset` and the generic RPC endpoints answer 404 for HR staff too; every HR function lives in `/hr` | `page /hr` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; /odoo, /json/2/..., /jsonrpc, /xmlrpc/2/common, /doc, /web/login answer 404 for hr_manager, but POST /web/session/get_session_info answers 200 with uid, db name «liwan_scratch_e2e», server_version 19.0 and base url; /web/dataset/call_kw answers 200 with a JSON-RPC 404 error body |
| HR-487 | Set an employee's nationality | hr_manager | The employee form offers a country picker (`GET /api/v1/hr/countries` with `q`, needs `hr.employees.manage`); PATCH `nationality_id` saves it, the detail returns `nationality`; an unknown country answers 422 `invalid` on `nationality_id` | `GET /api/v1/hr/countries` `PATCH /api/v1/hr/employees/<id>` | manual 2026-11-05 | retest #178: the employee edit picker searches in Arabic (السعودية, مصر, الأردن) and saves the choice (PATCH nationality_id 200, detail nationality الأردن); 999999 422 invalid on nationality_id; the list opens with Arabic names: the 15 countries Odoo leaves in English (Türkiye, Eswatini, ...) get their Arabic name from liwan_api/models/country_names.py (test_country_names); #178 retest: q=Saudi returns Saudi Arabia (SA); PATCH 200 nationality Saudi Arabia; nationality_id 999999 422 invalid; country names come back in English for an Arabic user (follow-up) |
