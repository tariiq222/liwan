# Journeys across applications

Each journey follows one piece of work through several people and applications. Personas act
in the order listed; each step signs in as that persona. Personas and status values:
[README](README.md). The single-application rows each journey relies on are listed in
"Builds on".

| ID | Journey | Personas in order | Checks | Builds on | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| J-01 | Unpaid leave to pay: request, approval, payroll deduction, posting, payment | staff1 → hr_manager → payroll → cfo | Deduction on the payslip; entry posted; payment recorded; staff1 sees the payslip | HR-11, HR-13, HR-32–34, FIN-09 | planned | |
| J-02 | Hire to first day: applicant hired, employee, user account with roles, onboarding, custody, documents | hr_manager → it_admin → new employee | New employee signs in and sees own assets and documents | HR-52, ACC-20, HR-47, HR-50, DOC-09 | planned | |
| J-03 | Leaving: offboarding, departure, clearance, archive employee, account disabled, end of service, final payroll | hr_manager → payroll → cfo | Login refused; settlement confirmed; provision posted | HR-49, ACC-22, HR-40 | planned | |
| J-04 | Leave cancellation under each policy mode | hr_manager → staff1 → hr_manager | Three modes behave as written | HR-18–21 | planned | |
| J-05 | Three-stage operations request with a return for change | ops_manager → staff2 → pm → hr_manager → ceo | Return, resubmit, three approvals, `done`, audit trail intact | OPS-01, OPS-05–07 | automated | `e2e/tests/operations-approval-journey.e2e.ts` (2026-10-28 pass, pm → hr_manager → ceo) |
| J-06 | Task completion approved through an operations request (`pmo_completion`) | pm → staff1 → reviewer | Completion accepted only at the final stage, which must be the task's reviewer | PMO-34, OPS-06 | planned | |
| J-07 | Project start to close: create, charter, sponsor approval, planning, tasks, completion reviews, automatic done | pm → ceo → staff1 → pm | Phases, statuses and bell to each person | PMO-02, PMO-13, PMO-18, PMO-34, PMO-38 | fail | Blocked 2026-10-28 at the first step by PMO-505 (role-assigned PMO manager cannot create a project) |
| J-08 | Meeting to work: resolutions converted to project tasks, worked and completed | it_admin → staff1 → pm | Converted once; task in the project; reminders | MTG-10, MTG-14, PMO-34 | planned | Organizer is `it_admin` until MTG-20 is decided |
| J-09 | Personal to-do promoted to a project task with sub-tasks | staff1 | Irreversible; link to the project task | TSK-07 | planned | |
| J-10 | Project costs from finance: cost center linked, bills posted, actuals on the project | cfo → accountant → cfo → pm | Actuals equal posted lines; pm cannot add a manual expense | PMO-51, PMO-52, FIN-07 | planned | |
| J-11 | Sales invoice to ZATCA | accountant → cfo → accountant | Accountant blocked on posting, allowed on submission; accepted | FIN-03–05, FIN-18, FIN-19 | planned | |
| J-12 | Separation of duties in money | payroll, accountant, auditor | Payroll cannot post a run without finance rights; accountant cannot post; auditor reads everything | HR-34, FIN-05, FIN-10, FIN-15 | planned | |
| J-13 | Document expiry to HR report and self-service | hr_manager → staff1 | In the expiring report and in `/documents/self` | DOC-09–11, HR-53 | planned | |
| J-14 | Branch isolation: branch created, user moved, data visibility per access mode | it_admin → branch user | No data from other branches | ACC-18, ACC-19 | planned | |
| J-15 | Assistant acting for a user with confirmation | staff1 | Approve applies, reject changes nothing; audit entries | PLT-06, PLT-07 | planned | |
| J-16 | Plan downgrade while users have data in the removed application | vendor → admin → staff | Hidden everywhere, data kept, back on upgrade | SAAS-10, PLT-10 | planned | |
| J-17 | New customer from sale to first working day | vendor → new admin → staff | Customer created, tenant provisioned, invitation accepted, staff created, staff complete a task and a leave request | SAAS-02–04, SAAS-07, J-01 | planned | Needs the provisioning stack |
