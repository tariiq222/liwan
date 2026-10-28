# Access, users and roles

Pages: `/settings/team/users` (`new`, `[userId]`, `access`, `branches`, `security`),
`/settings/team/roles` (`new`, `[roleId]`, `edit`), `/settings/team/branches`,
`/settings/team/access-log`, `/settings/company`, `/hr/employees/[id]/access`.
Owners: `webvue_core`, `webvue_access_hr`. Personas and status values: [README](README.md).

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| ACC-01 | Each persona signs in and sees only the applications its roles open | every persona | Sidebar lists exactly the role's applications | manual 2026-10-28 | `staff1`: يومي, مهامي, المشاريع, الاجتماعات, المحادثات, الموظفين, العمليات, المستندات, المساعد; no finance, no settings |
| ACC-02 | A page outside the persona's roles opened by URL | staff1 → `/finance` | 403 page «لا تملك صلاحية فتح هذه الصفحة» with a way back | manual 2026-10-28 | |
| ACC-03 | Create a user with a password and roles | it_admin | User signs in with the given roles; access log `user.granted` | planned | |
| ACC-04 | Change a user's roles | it_admin | New applications appear after the user's next request; log `user.roles_changed` | planned | |
| ACC-05 | Disable and reactivate a user | it_admin | Disabled user cannot sign in; reactivated user can; both logged | planned | |
| ACC-06 | Reset a user's password | it_admin | Old password refused, new accepted; log `user.password_reset` | planned | |
| ACC-07 | Duplicate login | it_admin | Refused `account_exists` on the login field | planned | |
| ACC-08 | Clone a built-in role into a custom role, edit, disable, delete when unused | it_admin | Each step saved; delete refused while assigned (`role_in_use`) | planned | |
| ACC-09 | Edit or delete a built-in role | it_admin | Refused `protected_role` | planned | |
| ACC-10 | Assign a disabled or non-assignable role | it_admin | Refused `role_disabled` / `role_not_assignable` | planned | |
| ACC-11 | Change own access | it_admin | Refused `self_access_change` | planned | |
| ACC-12 | Disable the last access administrator | it_admin | Refused `last_access_admin` | planned | |
| ACC-13 | Vendor support user is untouchable | it_admin | Refused `protected_user` | planned | |
| ACC-14 | System admin manages access but cannot write HR or project records | it_admin | HR and project write actions absent or refused | planned | |
| ACC-15 | Access log lists every change and cannot be edited | it_admin | Events listed with actor and time; no edit path | planned | |
| ACC-16 | Built-in role descriptions in Arabic | it_admin | Arabic text next to Arabic names | fail | Known bug, `e2e/tests/bugs/roles-builtin-descriptions-english.e2e.ts` |
| ACC-17 | Company profile and logo | it_admin | Name and logo shown in the shell and on the login page | planned | |
| ACC-18 | Create a branch (child company) and move a user to it | it_admin | Branch user sees branch data only | planned | |
| ACC-19 | Branch access mode `isolated` / `delegated` / `inherited` | it_admin | Each mode exposes exactly what it describes | planned | Mode is read-only in the UI today |
| ACC-20 | Grant an account to an employee from the employee page | it_admin | Account created and linked; log `user.employee_linked` | planned | |
| ACC-21 | Grant an account to an archived employee, one without work email, or one already linked | it_admin | Refused `employee_archived` / `work_email_required` / `account_exists` | planned | |
| ACC-22 | Archive an employee who has an account | hr_manager | Linked user disabled; log `employee.archived_access_disabled` | planned | |
| ACC-23 | Reactivate a user whose employee is archived | it_admin | Refused `employee_archived` | planned | |
| ACC-24 | Filter users by department without HR read | custom role | 403 | planned | |
| ACC-25 | Own account settings page | staff1 | Can change own preferences only | planned | |
