# HR stack fit test — 2026-10-19

Phase A of [the HR plan](../superpowers/plans/2026-10-19-hr-complete-stack-plan.md). No LiwanOS
code changed. Scratch database only (never `odoo19`), dropped after the run.

## Inputs

| Source | Commit |
|---|---|
| Odoo 19 Community | `34eed49d88f0f4357e1f54fe82cb0ad280939572` |
| LiwanOS `main` | `4e3488b9613a09ed71d93583613086821eb52519` |
| OCA/hr 19.0 | `23e948031779315958c3897652d04da813a058fb` |
| OCA/payroll 19.0 | `58f8a39799383ef98d50097f81f4abcc6dd03782` |
| OCA/hr-attendance 19.0 | `f9ff6f58f43c9c63cb5ed3228943c5ef0c4c8677` |
| OCA/hr-holidays 19.0 | `abd1ff286b505d95f8fd6219adbe1a711f1a3ba7` |

OCA clones live outside the repo in `/Users/tariq/code/spikes/oca-hr-stack`.

Installed together: `liwan_hr, hr_holidays, hr_attendance, hr_recruitment, hr_skills,
hr_work_entry, payroll, hr_attendance_reason, hr_holidays_natural_period, hr_employee_relative`
(Odoo auto-installed `hr_holidays_attendance, hr_work_entry_holidays, hr_recruitment_skills,
hr_homeworking*, hr_calendar, hr_org_chart, hr_recruitment_sms`).

## Results

| Check | Result |
|---|---|
| Install of the full set | passed, no errors, no override warnings |
| `liwan_hr` test suite with the set loaded (`--test-tags /liwan_hr`) | **0 failed, 0 errors of 110 tests** (at install and again on `-u liwan_hr`) |
| Smoke: SA company, employee, `hr.version` wage 10000 from 2026-01-01 | passed |
| Smoke: annual leave allocation 21 days, 2-day leave | `validate`, 2.0 days |
| Smoke: attendance 06:00–14:00 UTC | 7.0 worked hours (1 h break from the calendar) |
| Smoke: job + applicant | created, stage `New` |
| Smoke: OCA payslip, structure BASIC + NET, September 2026 | `WORK100` 22 d / 176 h, `LEAVE120` −2 d / −16 h, BASIC 10000, NET 10000 |
| No `liwan_hr` group implies `payroll.group_payroll_user` | passed (none) |
| Odoo UI and generic routes of the new modules (`/odoo/payroll`, `/odoo/recruitment`, `/json/2/hr.payslip/...`, `/web`) | all 404 (closed by the `liwan_platform` guard) |

## Findings for phase B

1. **Payroll group escalation (confirmed):** `payroll.group_payroll_user` implies
   `hr.group_hr_manager` and `hr.group_hr_user`. Payroll access must be granted only through the
   `hr.payroll.*` capabilities, never by assigning that group.
2. **Leave types need a work-entry type:** a leave type without `work_entry_type_id` makes OCA
   `payroll` fail on payslip creation (`hr_payslip_worked_days.code` not null). Every Saudi leave
   type shipped as data must set one.
3. **Leaves are deducted, not replaced:** `WORK100` is the full calendar; leave lines are
   negative unless `payroll.leaves_positive` is set. Salary rules must be written for that sign.
4. **Engines only:** 56 Odoo menus came with the new modules; they are unreachable (guard), so
   every function the customer needs requires a LiwanOS page and API. Nothing is visible yet.
5. **Not tested:** `hr_holidays_public` (AGPL accepted, but it needs the `openupgradelib` Python
   package, not installed in the Odoo venv); appraisal (no 19.0 OCA module; four LGPL-3 store
   candidates not downloaded).
6. Optional: `pdfminer.six` missing in the Odoo venv (PDF attachment indexing off); not HR-specific.

## Cleanup

Scratch database `liwan_scratch_hrfit_093237` dropped; temp data/logs removed.
