# HR and payroll

Pages: `/hr/employees`, `/hr/departments`, `/hr/leave`, `/hr/payroll`, `/hr/shifts`,
`/hr/onboarding`, `/hr/offboarding`, `/hr/assets`, `/hr/recruitment`, `/hr/reports`,
self-service `/hr/self/*`, settings `/settings/apps/hr`. Owner: `webvue_hr`.
Personas and status values: [README](README.md).

Approval note: leave is decided by holders of `hr.leave.approve` (the HR role), not by the
employee's line manager. Whether the line manager should also decide is open (`HR-60`).

## Employees and departments

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| HR-01 | Create a department and an employee in it, then archive the employee | admin | Saved, listed, archived through the inline confirmation | automated | `e2e/tests/hr-journey.e2e.ts` |
| HR-02 | Edit an employee: job, department, manager | hr_manager | Saved and shown on the detail page | planned | |
| HR-03 | Set an employee as their own manager | hr_manager | Refused | planned | |
| HR-04 | Unarchive an employee | hr_manager | Back in the active list | planned | |
| HR-05 | Edit and delete a department | hr_manager | Saved / removed | planned | |
| HR-06 | Employee views the directory | staff1 | Read-only; no create, edit or archive | planned | |
| HR-07 | Employee profile self-service | staff1 | Own profile only | planned | |

## Leave

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| HR-10 | Create a leave allocation for an employee | hr_manager | Balance shown to the employee | planned | |
| HR-11 | Employee requests leave | staff1 | Request `confirm`, visible to HR | planned | |
| HR-12 | Employee withdraws a pending request | staff1 | Request removed | planned | |
| HR-13 | HR approves a request | hr_manager | `validate`; employee sees approved | planned | |
| HR-14 | HR refuses with a reason | hr_manager | `refuse`; reason in the record history | planned | |
| HR-15 | HR decides own request | hr_manager | Refused (403) | planned | |
| HR-16 | Request leave for another employee | hr_manager | Allowed with `hr.leave.manage`; refused for staff1 | planned | |
| HR-17 | Update and revoke an allocation; change own allocation | hr_manager | Updated/revoked; own allocation refused | planned | |
| HR-18 | Cancellation policy `manager_approval`: employee asks to cancel approved leave, HR approves / refuses | staff1 → hr_manager | Pending cancellation then decided; own decision refused; stale revision 409 | planned | |
| HR-19 | Cancellation policy `direct_employee` | staff1 | Approved leave cancelled immediately | planned | |
| HR-20 | Cancellation policy `manager_only` | staff1 → hr_manager | Employee request refused; HR cancels approved leave directly | planned | |
| HR-21 | Change the cancellation policy | hr_manager | Needs `hr.leave.config`; others refused | planned | |

## Payroll

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| HR-30 | Payroll settings: day divisor, structure, unpaid and annual leave types, GOSI rates, bank profiles | payroll | Saved | planned | |
| HR-31 | Employee compensation and IBAN | payroll | Saved; never shown to hr_manager or in the directory | planned | |
| HR-32 | Create a monthly run and compute | payroll | Payslips per employee, `computed` | planned | |
| HR-33 | Edit inputs on a computed run | payroll | Run back to `draft` | planned | |
| HR-34 | Approve a run | payroll | `approved`; recompute, edit and delete then refused | planned | |
| HR-35 | Approve a run that contains the approver's own payslip | payroll | Refused (403) | planned | |
| HR-36 | Approve an empty run or one with a negative net | payroll | Refused | planned | |
| HR-37 | Bank file and WPS file | payroll | Generated for an approved run; refused `missing_iban` when an IBAN is missing | planned | |
| HR-38 | GOSI statement | payroll | Totals match payslips | planned | |
| HR-39 | Employee opens own payslips | staff1 | Own payslips only; none of anyone else | planned | |
| HR-40 | End-of-service settlement draft then confirm | payroll | Save needs manage, confirm needs approve | planned | |
| HR-41 | HR manager opens payroll | hr_manager | No payroll pages or compensation data | planned | |

## Shifts, onboarding, offboarding, custody, recruitment, reports

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| HR-45 | Create a schedule and assign it | hr_manager | Employee sees it in `/hr/self/schedule` | planned | |
| HR-46 | Shift day reference `company` vs `user` timezone | hr_manager | Days shift as configured | planned | |
| HR-47 | Onboarding plan and run; assignee completes a step | hr_manager → staff1 | Step done once; second completion refused | planned | |
| HR-48 | Cancel an onboarding run | hr_manager | `cancelled` | planned | |
| HR-49 | Offboarding: departure date, clearance steps | hr_manager | Second departure date refused; own clearance refused | planned | |
| HR-50 | Custody: create category and asset, assign, return, archive | hr_manager | Employee sees own assets in `/hr/self/assets` | planned | |
| HR-51 | Assign an already assigned asset; return an unassigned one | hr_manager | Refused | planned | |
| HR-52 | Recruitment: job, applicant, refuse, reset, hire | hr_manager | Hire creates an employee; hiring a refused applicant refused; second link refused | planned | |
| HR-53 | Expiring items and Saudization reports | hr_manager | Figures match the seeded and created data | planned | |
| HR-54 | HR sub-feature switched off (for example `hr.payroll`) | it_admin / vendor | Its pages and routes disappear | planned | See PLT-10 |
| HR-60 | Line manager decides the team's leave | pm | Owner decision: today only the HR role decides | decision | |
