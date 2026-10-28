# Access, users and roles

Pages: `/settings/team/users` (`new`, `[userId]`, `access`, `branches`, `security`),
`/settings/team/roles` (`new`, `[roleId]`, `edit`), `/settings/team/branches`,
`/settings/team/access-log`, `/settings/company`, `/settings/system`, `/account`, `/account/settings`,
`/hr/employees/[id]/access`.
Owners: `webvue_core`, `webvue_api`, `webvue_access_hr`. Personas and status values: [README](README.md).

Custom roles can hold only `access.users.read`, `access.roles.read`, `access.audit.read`,
`settings.company.read`, `settings.company.manage`, `settings.branding.manage` and
`settings.maintenance.manage`; the other access keys belong to the built-in `system_admin` role, so
refusals for them use a persona without the key (for example `staff1`). Rows marked `custom role (...)`
need that role created through the UI first.

Error codes are the `code` of the JSON error body; the HTTP status follows. A row that names a route
lists it in Covers; the registered surfaces are checked by `python3 -B tools/e2e_scenario_coverage.py`.

## Core scenarios (original register)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-01 | Each persona signs in and sees only the applications its roles open | every persona | Sidebar lists exactly the role's applications | `GET /api/v1/me` | automated | `e2e/tests/access-matrix.e2e.ts` (11 personas, 2026-10-28 pass); `staff1`: يومي, مهامي, المشاريع, الاجتماعات, المحادثات, الموظفين, العمليات, المستندات, المساعد; no finance, no settings |
| ACC-02 | A page outside the persona's roles opened by URL | staff1 → `/finance` | 403 page «لا تملك صلاحية فتح هذه الصفحة» with a way back |  | automated | `e2e/tests/access-matrix.e2e.ts`: 19 pages per persona |
| ACC-03 | Create a user with a password and roles | it_admin | User signs in with the given roles; access log `user.granted` | `page /settings/team/users/new` `POST /api/v1/admin/users` `cap access.users.grant` | manual 2026-10-28 | it_admin created «مدير مكتب مشاريع تجريبي» with roles موظف + مدير مكتب المشاريع from the panel; the user signed in |
| ACC-04 | Change a user's roles | it_admin | New applications appear after the user's next request; log `user.roles_changed` | `page /settings/team/users/[id]/access` `PATCH /api/v1/admin/users/<id>/access` `cap access.users.assign_roles` | planned |  |
| ACC-05 | Disable and reactivate a user | it_admin | Disabled user cannot sign in; reactivated user can; both logged | `page /settings/team/users/[id]/security` `POST /api/v1/admin/users/<id>/disable` `POST /api/v1/admin/users/<id>/reactivate` `cap access.users.disable` | planned |  |
| ACC-06 | Reset a user's password | it_admin | Old password refused, new accepted; log `user.password_reset` | `POST /api/v1/admin/users/<id>/password` `cap access.users.reset_password` | planned |  |
| ACC-07 | Duplicate login | it_admin | Refused `account_exists` on the login field | `POST /api/v1/admin/users` | planned |  |
| ACC-08 | Clone a built-in role into a custom role, edit, disable, delete when unused | it_admin | Each step saved; delete refused while assigned (`role_in_use`) | `page /settings/team/roles/new` `page /settings/team/roles/[id]` `page /settings/team/roles/[id]/edit` `POST /api/v1/admin/roles/<id>/clone` `PATCH /api/v1/admin/roles/<id>` `POST /api/v1/admin/roles/<id>/disable` `POST /api/v1/admin/roles/<id>/enable` `DELETE /api/v1/admin/roles/<id>` `cap access.roles.manage` | planned |  |
| ACC-09 | Edit or delete a built-in role | it_admin | Refused `protected_role` | `PATCH /api/v1/admin/roles/<id>` `DELETE /api/v1/admin/roles/<id>` | planned |  |
| ACC-10 | Assign a disabled or non-assignable role | it_admin | Refused `role_disabled` / `role_not_assignable` | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-11 | Change own access | it_admin | Refused `self_access_change` | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-12 | Disable the last access administrator | it_admin | Refused `last_access_admin` | `POST /api/v1/admin/users/<id>/disable` | planned |  |
| ACC-13 | Vendor support user is untouchable | it_admin | Refused `protected_user` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-14 | System admin manages access but cannot write HR or project records | it_admin | HR and project write actions absent or refused | `cap access.users.assign_roles` | automated | `e2e/tests/access-matrix.e2e.ts`: it_admin refused on /hr/employees/new and /projects/new |
| ACC-15 | Access log lists every change and cannot be edited | it_admin | Events listed with actor and time; no edit path | `page /settings/team/access-log` `GET /api/v1/admin/access-log` `cap access.audit.read` | planned |  |
| ACC-16 | Built-in role descriptions in Arabic | it_admin | Arabic text next to Arabic names | `page /settings/team/roles` `GET /api/v1/admin/roles` | fail | Known bug, `e2e/tests/bugs/roles-builtin-descriptions-english.e2e.ts` |
| ACC-17 | Company profile and logo | it_admin | Name and logo shown in the shell and on the login page | `page /settings/company` `PATCH /api/v1/admin/company` `POST /api/v1/admin/company/logo` `GET /api/v1/branding` `cap settings.company.manage` | planned |  |
| ACC-18 | Create a branch (child company) and move a user to it | it_admin | Branch user sees branch data only | `page /settings/team/branches` `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-19 | Branch access mode `isolated` / `delegated` / `inherited` | it_admin | Each mode exposes exactly what it describes | `GET /api/v1/admin/access/branches` `PATCH /api/v1/admin/access/branches` | planned | Mode is read-only in the UI today |
| ACC-20 | Grant an account to an employee from the employee page | it_admin | Account created and linked; log `user.employee_linked` | `POST /api/v1/admin/employee-accounts` `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-21 | Grant an account to an archived employee, one without work email, or one already linked | it_admin | Refused `employee_archived` / `work_email_required` / `account_exists` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-22 | Archive an employee who has an account | hr_manager | Linked user disabled; log `employee.archived_access_disabled` | `GET /api/v1/admin/access-log` | planned |  |
| ACC-23 | Reactivate a user whose employee is archived | it_admin | Refused `employee_archived` | `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-24 | Filter users by department without HR read | custom role | 403 | `GET /api/v1/admin/users` | planned |  |
| ACC-25 | Own account settings page | staff1 | Can change own preferences only | `page /account/settings` `PATCH /api/v1/me/appearance` `POST /api/v1/me/password` | planned |  |

## Session, identity (`/me`) and tenant lifecycle

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-26 | Signed-in user loads own identity | staff1 | Returns id, name, login, email, lang, tz, role `employee`, roles, capabilities, company, appearance, modules, entitlements, platform and terminology | `GET /api/v1/me` | planned |  |
| ACC-27 | Administrator identity | it_admin | `role` is `admin` and `capabilities` lists all access and settings keys; `roles` carries `system_admin` with source `assignment` | `GET /api/v1/me` `cap access.users.assign_roles` | planned |  |
| ACC-28 | A user without a language set | staff1 | `lang` falls back to `ar_001`, never null, so the app still loads | `GET /api/v1/me` | planned | serializers/user.py DEFAULT_LANG |
| ACC-29 | Capabilities change after a role change without signing in again | it_admin | After staff1's roles change, the next `/me` of staff1 shows the new capabilities and a new `access_policy_version`; the sidebar updates after reload | `GET /api/v1/me` `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-30 | Contextual roles are listed beside assigned roles | pm | A project owner's `/me` roles include contextual entries whose source is not `assignment` | `GET /api/v1/me` | planned | WebVueAccessService._webvue_identity |
| ACC-31 | Request without a session | every persona | Any `/api/v1/admin/*` and `/api/v1/me*` call without a session cookie is refused (401); no data returned | `GET /api/v1/me` `GET /api/v1/admin/users` | planned |  |
| ACC-32 | Suspended tenant | staff1 | Every `/api/v1` call answers 403 `tenant_suspended` and the session is logged out | `GET /api/v1/me` | planned | entitlement_service._webvue_guard_api; vendor suspends the tenant in saas.md |
| ACC-33 | Read-only (expired) tenant: reads work, access writes refused | it_admin | `GET` routes answer; `POST/PATCH/DELETE` on users and roles answer 403 `tenant_read_only` | `GET /api/v1/admin/users` `POST /api/v1/admin/users` | planned |  |
| ACC-34 | Read-only tenant still lets a user change own password | staff1 | `POST /api/v1/me/password` succeeds while other writes are refused | `POST /api/v1/me/password` | planned | _webvue_api_write_allowed |
| ACC-35 | The Odoo web client is closed for everyone | it_admin | `/odoo`, `/web`, `/json/2`, `/xmlrpc` answer 404 for an anonymous caller and for a system administrator |  | planned | ir.http guard in webvue_platform |
| ACC-36 | Legacy administrator (not yet role-managed) holds the system capabilities | admin | Before any role is assigned to the account, access and settings pages open through legacy group fallback | `cap access.users.read` `GET /api/v1/admin/users` | planned |  |
| ACC-37 | First role assignment makes an account role-managed | it_admin | After assigning roles to a legacy account, legacy group capabilities stop applying and only the assigned roles count | `PATCH /api/v1/admin/users/<id>/access` | planned | user._webvue_mark_access_managed |

## Own account pages (`/account`, `/account/settings`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-38 | Personal overview opens for an employee linked to an HR file | staff1 | Shows the identity card, summary cards per application, and the «إعدادات حسابي» button | `page /account` | planned |  |
| ACC-39 | Personal overview shows «يحتاج انتباهك» when an application reports pending items | staff1 | Each attention row links to its source; absent when nothing is pending | `page /account` | planned |  |
| ACC-40 | Personal overview for an account with no personal services | employee | Empty state «لا توجد خدمات شخصية متاحة لحسابك حاليًا» with the hint to contact the administrator; the customize button is hidden | `page /account` | planned |  |
| ACC-41 | A summary card fails to load | staff1 | The card shows an error with retry; other cards still render | `page /account` | planned |  |
| ACC-42 | Reorder cards with «ترتيب البطاقات» | staff1 | Move up/down changes order, button label becomes «تم الترتيب»; order is kept after refresh (stored in the browser per company and user) | `page /account` | planned | localStorage |
| ACC-43 | Card order cannot be stored | staff1 | With storage blocked, alert «تعذر حفظ ترتيب البطاقات. سيبقى الترتيب الحالي لهذه الجلسة فقط.» | `page /account` | planned |  |
| ACC-44 | View own HR profile from the identity card | staff1 | «عرض ملفي الوظيفي» opens the employee file; absent when no profile section exists | `page /account` | planned |  |
| ACC-45 | Account settings show identity | staff1 | Login and company name are shown read-only | `page /account/settings` | planned |  |
| ACC-46 | Switch language Arabic ↔ English | staff1 | Page direction flips RTL/LTR at once; the choice survives refresh (cookie `webvue-locale`) | `page /account/settings` | planned |  |
| ACC-47 | Switch appearance mode light/dark | staff1 | Applied immediately and saved to the account: PATCH /api/v1/me/appearance; applies on another device after sign-in | `page /account/settings` `PATCH /api/v1/me/appearance` | planned |  |
| ACC-48 | Change font size small/medium/large | staff1 | Applied immediately and saved to the account | `page /account/settings` `PATCH /api/v1/me/appearance` | planned |  |
| ACC-49 | Appearance with an unknown field | staff1 | 422 `unknown_field`, field named | `PATCH /api/v1/me/appearance` | planned |  |
| ACC-50 | Appearance with an empty body | staff1 | 422 `invalid` «no fields to update» | `PATCH /api/v1/me/appearance` | planned |  |
| ACC-51 | Appearance with invalid mode or font size | staff1 | 422 `invalid` with field `mode` or `font_size`; `cream` is accepted by the API though the page offers only light and dark | `PATCH /api/v1/me/appearance` | planned | api/models/res_users.py APPEARANCE_MODES |
| ACC-52 | Change own password | staff1 | Success toast «تم تغيير كلمة المرور بنجاح.»; fields cleared; old password no longer signs in; session continues | `page /account/settings` `POST /api/v1/me/password` | planned |  |
| ACC-53 | Password form validation in the browser | staff1 | Empty current «أدخل كلمة المرور الحالية.», mismatch «كلمتا المرور غير متطابقتين.», short «يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.»; nothing is sent | `page /account/settings` | planned |  |
| ACC-54 | Change password with wrong current password | staff1 | 422 `wrong_password` on field `current`; message shown under the field | `POST /api/v1/me/password` | planned |  |
| ACC-55 | Change password with a weak new password | staff1 | 422 `weak_password` on field `new` | `POST /api/v1/me/password` | planned |  |
| ACC-56 | Change password with a missing current value or an extra field | staff1 | Missing current: 422 `wrong_password`; extra field: 422 `invalid` naming the field | `POST /api/v1/me/password` | planned |  |
| ACC-57 | Password change ends other sessions of the same account | staff1 | A second signed-in browser is refused on its next request; the current one stays signed in | `POST /api/v1/me/password` | planned | fresh_session_token |
| ACC-58 | Log out | staff1 | Session ends, navigation preference, assistant state and chat drafts are cleared, redirect to `/login`; the back button does not show private pages | `page /account/settings` | planned |  |
| ACC-59 | Log out fails (server unreachable) | staff1 | Toast «تعذر إنهاء الجلسة. تحقق من الاتصال وحاول مرة أخرى.»; user stays on the page | `page /account/settings` | planned |  |
| ACC-60 | Account pages are open to every signed-in user | admin | `/account` and `/account/settings` need no capability | `page /account` `page /account/settings` | planned |  |

## Two-factor sign-in (`/auth/totp`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-61 | Complete a pending two-factor login with a valid code | staff1 | Session finalised; response is the `/me` payload | `POST /api/v1/auth/totp` | planned | needs an account with TOTP enabled |
| ACC-62 | Code posted with no pending login | staff1 | 401 `no_pending_login` | `POST /api/v1/auth/totp` | planned |  |
| ACC-63 | Code in a wrong format | staff1 | 422 `invalid_code_format` (non-numeric after removing spaces) | `POST /api/v1/auth/totp` | planned |  |
| ACC-64 | Wrong code | staff1 | 401 `invalid_code`; the login stays pending | `POST /api/v1/auth/totp` | planned |  |
| ACC-65 | Code with spaces | staff1 | Spaces are removed and the code accepted | `POST /api/v1/auth/totp` | planned |  |
| ACC-66 | Two-factor step on a suspended tenant | staff1 | 403 `tenant_suspended` | `POST /api/v1/auth/totp` | planned |  |
| ACC-67 | Two-factor step for an account that may not sign in | staff1 | 403 `login_refused` | `POST /api/v1/auth/totp` | planned |  |

## Settings overview and navigation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-68 | Settings overview for a system administrator | it_admin | One card per page the user can reach (الشركة, الفريق والصلاحيات, النظام والأمان, الاشتراك…) listing its parts separated by «، »; each card opens the first part | `page /settings` `cap settings.company.read` | planned |  |
| ACC-69 | Settings overview for a user with no settings capability | staff1 | Empty state «هذه الصفحة لمدير النظام فقط»; no cards | `page /settings` | planned | locale key settings.forbidden |
| ACC-70 | Settings overview for a user with only `access.audit.read` | custom role (access.audit.read) | Only the team card appears, listing the access log part | `page /settings` `cap access.audit.read` | planned |  |
| ACC-71 | Settings sidebar follows capabilities | custom role (access.roles.read) | Team sub-list shows الأدوار only; users, branches and access log links are absent | `page /settings/team` `cap access.roles.read` | planned |  |
| ACC-72 | Team page for an administrator | it_admin | Four cards in order: branches, users, roles, access log; the three lists show the latest 5 rows with «عرض الكل» links | `page /settings/team` | planned | PREVIEW_ROWS = 5 |
| ACC-73 | Team preview card with no rows | it_admin | Roles/users/log cards show their empty text instead of rows | `page /settings/team` | planned |  |
| ACC-74 | Team preview card fails to load | it_admin | The failing card shows an error and retry; the other cards stay usable | `page /settings/team` | planned |  |
| ACC-75 | Team page with no team capability | staff1 | Forbidden state «لا تملك صلاحية قراءة هذه الصفحة.» | `page /settings/team` | planned |  |
| ACC-76 | Team page for `access.users.read` only | custom role (access.users.read) | Only the users card shows; the branches link needs `access.users.assign_roles` | `page /settings/team` `cap access.users.read` | planned |  |
| ACC-77 | Company settings page with no capability | staff1 | Forbidden state; no card | `page /settings/company` | planned |  |
| ACC-78 | System settings page with no capability | staff1 | Forbidden state «هذه الصفحة لمدير النظام فقط» | `page /settings/system` | planned |  |
| ACC-79 | System settings page for an administrator | it_admin | Cards for integrations (read-only) and maintenance; the sidebar sub-list scrolls to each card | `page /settings/system` `cap settings.maintenance.manage` | planned |  |
| ACC-80 | System page shows only the cards the user may see | custom role (settings.maintenance.manage) | Maintenance card only; the integrations card is hidden without its own capability | `page /settings/system` `cap settings.maintenance.manage` | planned |  |
| ACC-81 | Deep link to a settings card by hash | it_admin | `/settings/system#maintenance` scrolls to the card; refresh keeps the position | `page /settings/system` | planned |  |

## Users list (`/settings/team/users`, GET /api/v1/admin/users)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-82 | Open the users list with data | it_admin | Heading المستخدمون with a count tag; table of name, login, roles (first pills), status and row actions; footer shows shown/total | `page /settings/team/users` `GET /api/v1/admin/users` `cap access.users.read` | planned |  |
| ACC-83 | Users list with no capability | staff1 | Forbidden state «لا تملك صلاحية قراءة هذه الصفحة.»; the API answers 403 `forbidden` | `page /settings/team/users` `GET /api/v1/admin/users` | planned |  |
| ACC-84 | Read-only list for `access.users.read` | custom role (access.users.read) | List and detail open; the create button and the edit-access row action are absent; the security row action opens a read-only page | `page /settings/team/users` `cap access.users.read` | planned |  |
| ACC-85 | Create button follows `access.users.grant` | it_admin | «إنشاء حساب» is shown to the administrator and hidden from a read-only role | `page /settings/team/users` `cap access.users.grant` | planned |  |
| ACC-86 | Empty result | it_admin | Search for a name that does not exist shows «لا توجد حسابات مطابقة.»; footer hidden | `page /settings/team/users` | planned |  |
| ACC-87 | Search by name or login | it_admin | `q` matches name or login, case-insensitive; the URL keeps `?q=` | `page /settings/team/users` `GET /api/v1/admin/users` | planned |  |
| ACC-88 | Filter by status active / stopped | it_admin | `status=stopped` lists only disabled accounts, `active` only enabled; disabled accounts are otherwise included in the unfiltered list | `page /settings/team/users` `GET /api/v1/admin/users` | planned |  |
| ACC-89 | Filter by role | it_admin | `role_id` lists users holding the role; role options need `access.roles.read` | `page /settings/team/users` `GET /api/v1/admin/users` | planned |  |
| ACC-90 | Role filter options without roles read | custom role (access.users.read) | Only «كل الأدوار» is offered | `page /settings/team/users` | planned |  |
| ACC-91 | Filter by department with the HR bridge | hr_manager | Department select appears; `department_id` narrows the list to linked employees of that department | `page /settings/team/users` `GET /api/v1/admin/users` | planned | needs access.users.read and hr.departments.read in one account |
| ACC-92 | Department filter without HR read | custom role (access.users.read) | 403 `forbidden` for `department_id` when the caller lacks `hr.departments.read` | `GET /api/v1/admin/users` | planned | see ACC-24 |
| ACC-93 | Department filter with a non-numeric value | it_admin | 422 `invalid` field `department_id` «department_id must be a positive integer» | `GET /api/v1/admin/users` | planned |  |
| ACC-94 | Department filter when the HR feature is off | it_admin | The filter and employee column are absent; the API answers 400 `unsupported_filter` for `department_id` | `page /settings/team/users` `GET /api/v1/admin/users` | planned | feature off via vendor, see platform.md |
| ACC-95 | Unsupported query parameter | it_admin | 400 `unsupported_filter` naming the parameter | `GET /api/v1/admin/users` | planned |  |
| ACC-96 | Invalid status value | it_admin | 422 `invalid` field `status` (only active, stopped) | `GET /api/v1/admin/users` | planned |  |
| ACC-97 | Invalid role_id | it_admin | 422 `invalid` field `role_id` for 0, negative or non-numeric | `GET /api/v1/admin/users` | planned |  |
| ACC-98 | Pagination | it_admin | 25 per page in the page; `offset` in the URL; next/previous work; `limit` above 200 is capped at 200; negative limit or offset is 422 `invalid` | `page /settings/team/users` `GET /api/v1/admin/users` | planned | API default limit 50 |
| ACC-99 | Bad offset in the URL | it_admin | `?offset=abc` is ignored and page 1 shows | `page /settings/team/users` | planned |  |
| ACC-100 | Filters survive refresh and direct link | it_admin | Opening `?q=&status=stopped&role_id=` directly restores the controls and the result | `page /settings/team/users` | planned |  |
| ACC-101 | Open a user and come back | it_admin | Detail link carries the list query; the back arrow returns to the list with the same filters and page | `page /settings/team/users` `page /settings/team/users/[id]` | planned |  |
| ACC-102 | List excludes users of other companies | it_admin | A branch company's users do not appear in the root company list | `GET /api/v1/admin/users` | planned |  |
| ACC-103 | Vendor support account is listed as protected | it_admin | The support user shows a protected badge and has no edit actions | `page /settings/team/users` `GET /api/v1/admin/users` | planned | serializer protected flag |
| ACC-104 | List load error | it_admin | Error state with retry; retry reloads without losing filters | `page /settings/team/users` | planned |  |
| ACC-105 | Row actions per capability | it_admin | View, edit access (needs assign_roles) and security (needs users.read) are offered per row | `page /settings/team/users` `cap access.users.assign_roles` | planned |  |
| ACC-106 | Employee column with the HR bridge | hr_manager | Each row shows the linked employee name or «بلا موظف» | `page /settings/team/users` `GET /api/v1/admin/users` | planned | access_hr extra fields |
| ACC-107 | Bad role in the URL does not crash the page | it_admin | `?role_id=abc` yields no filter; no error screen | `page /settings/team/users` | planned |  |

## Create a user (`/settings/team/users/new`, POST /api/v1/admin/users)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-108 | Open the create panel from the list | it_admin | Route-backed panel over the list; heading «منح حساب»; direct link and refresh keep the panel; cancel returns to the filtered list | `page /settings/team/users/new` | planned |  |
| ACC-109 | Create panel without `access.users.grant` | staff1 | Panel shows «لا تملك صلاحية قراءة هذه الصفحة.»; `POST` answers 403 `forbidden` | `page /settings/team/users/new` `POST /api/v1/admin/users` `cap access.users.grant` | planned |  |
| ACC-110 | Create with a valid name, login, roles and password | it_admin | 201; redirected to the new user's page; roles and capabilities shown; the user can sign in; access log `user.granted` | `page /settings/team/users/new` `POST /api/v1/admin/users` | planned |  |
| ACC-111 | Submit stays disabled until the form is valid | it_admin | Disabled while name/login empty, login not an email («اكتب بريدًا إلكترونيًا صحيحًا.»), no role chosen, password shorter than 8, or confirmation different («كلمتا المرور غير متطابقتين.») | `page /settings/team/users/new` | planned |  |
| ACC-112 | Only active, assignable roles are offered | it_admin | Disabled roles and the vendor support role are not in the checklist | `page /settings/team/users/new` `cap access.roles.read` | planned |  |
| ACC-113 | Resulting capabilities preview | it_admin | Choosing roles lists the capabilities they give; unchecking updates the list | `page /settings/team/users/new` | planned |  |
| ACC-114 | Unsaved changes guard | it_admin | Leaving with typed data asks to confirm; after saving, no prompt | `page /settings/team/users/new` | planned |  |
| ACC-115 | Password and confirmation cleared after a failed save | it_admin | Both fields empty again; an error banner shows | `page /settings/team/users/new` | planned |  |
| ACC-116 | Duplicate login | it_admin | 409 `account_exists` field `login`; also when the login belongs to a disabled user or a user of another company | `POST /api/v1/admin/users` | planned |  |
| ACC-117 | Login not an email | it_admin | 422 `invalid` field `login` | `POST /api/v1/admin/users` | planned |  |
| ACC-118 | Empty name | it_admin | 422 `invalid` field `name` | `POST /api/v1/admin/users` | planned |  |
| ACC-119 | Weak password | it_admin | 422 `weak_password` field `password` (under 8 characters after trim) | `POST /api/v1/admin/users` | planned |  |
| ACC-120 | Unknown or missing payload field | it_admin | 422 `invalid` «field is not accepted» or «field is required» with the field name; nothing created | `POST /api/v1/admin/users` | planned |  |
| ACC-121 | Empty or malformed assignments | it_admin | 422 `invalid` field `assignments` (empty list, wrong keys, duplicate role+company) | `POST /api/v1/admin/users` | planned |  |
| ACC-122 | Assignment with a scope other than company | it_admin | 422 `unsupported_scope` field `assignments` | `POST /api/v1/admin/users` | planned |  |
| ACC-123 | Assignment for another company | it_admin | 422 `unsupported_scope`; the user is not created | `POST /api/v1/admin/users` | planned |  |
| ACC-124 | Assign a non-assignable role (vendor support) | it_admin | 422 `invalid` «role is not assignable» | `POST /api/v1/admin/users` | planned | role_not_assignable code never reaches the API, see ACC-10 |
| ACC-125 | Assign a disabled role | it_admin | 422 `role_disabled` | `POST /api/v1/admin/users` | planned |  |
| ACC-126 | Creation is all-or-nothing | it_admin | When the role step fails, no user, partner or audit entry remains | `POST /api/v1/admin/users` | planned | api_handler savepoint |
| ACC-127 | Package user limit reached | it_admin | 403 `feature_not_included` (limit users); the page shows the package message «بلغت الحد المسموح للمستخدمين في باقتك.» | `POST /api/v1/admin/users` | planned | saas.md covers limits |
| ACC-128 | Create on a read-only tenant | it_admin | 403 `tenant_read_only` | `POST /api/v1/admin/users` | planned |  |
| ACC-129 | Created account audit | it_admin | One `user.granted` event with actor, target name and no password in before/after | `POST /api/v1/admin/users` `GET /api/v1/admin/access-log` | planned |  |
| ACC-130 | Created account has no employee file | it_admin | The user page shows «بلا موظف» when the HR bridge is on | `page /settings/team/users/[id]` | planned |  |
| ACC-131 | Mode switch «حساب جديد» / «من موظف» | hr_manager | The switch exists only with the HR bridge; default is «حساب جديد»; `?employee_id=` opens «من موظف» | `page /settings/team/users/new` | planned |  |
| ACC-132 | Create from employee: choose a candidate | it_admin | Search and pick an employee; the name and work email come from the file; account is linked | `page /settings/team/users/new` `GET /api/v1/admin/employee-accounts/candidates` `POST /api/v1/admin/employee-accounts` | planned | see Employee accounts |
| ACC-133 | Create from employee with an active account | it_admin | The option is disabled and «هذا الموظف لديه حساب نشط مسبقًا.» shows | `page /settings/team/users/new` | planned |  |
| ACC-134 | Create from employee with a stopped account | it_admin | The option says «حساب موقوف»; the button becomes «إعادة تفعيل الحساب» and the account is reactivated with the chosen roles and a new password | `page /settings/team/users/new` `PATCH /api/v1/admin/users/<id>/access` `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-135 | Reactivation from the create panel fails after the roles step | it_admin | Roles are already saved and the account is still stopped (two separate requests); the user sees the error and can retry | `page /settings/team/users/new` `PATCH /api/v1/admin/users/<id>/access` `POST /api/v1/admin/users/<id>/reactivate` | planned | possible partial result, report if observed |

## User page (`/settings/team/users/[id]`, GET /api/v1/admin/users/<id>)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-136 | Open a user | it_admin | Identity card with status badge, roles and scopes, capabilities grouped by domain with their sources; tabs for account, edit access, security, changes | `page /settings/team/users/[id]` `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-137 | User page without `access.users.read` | staff1 | Forbidden state; API 403 `forbidden` | `page /settings/team/users/[id]` `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-138 | Tabs follow allowed actions | custom role (access.users.read) | Only the account tab (and changes when `access.audit.read`); no edit access or security tab | `page /settings/team/users/[id]` | planned |  |
| ACC-139 | «سجل التغييرات» tab | it_admin | Opens the access log filtered to this user | `page /settings/team/users/[id]` `page /settings/team/access-log` | planned |  |
| ACC-140 | Employee file tab | hr_manager | Shown only when the user is linked to an employee and the viewer holds `hr.employees.read` | `page /settings/team/users/[id]` | planned |  |
| ACC-141 | Non-numeric id in the URL | it_admin | Not-found state «العنصر غير موجود أو لا تملك صلاحية عرضه.» | `page /settings/team/users/[id]` | planned |  |
| ACC-142 | Unknown id | it_admin | 404 `not_found` «user does not exist» | `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-143 | User of another company or branch | it_admin | 404 `not_found`, indistinguishable from an unknown id | `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-144 | Vendor support user detail | it_admin | `protected: true`; allowed actions only `read`; page shows the protected notice | `page /settings/team/users/[id]` `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-145 | Allowed actions reflect capabilities and state | it_admin | `assign_roles`, `reset_password` and `disable`/`reactivate` appear per capability; a user never gets `disable` on self | `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-146 | Capability sources | it_admin | Each capability lists the role assignment and company scope that grants it | `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-147 | Page refresh and back | it_admin | Refresh keeps the page; back returns to the list with its filters | `page /settings/team/users/[id]` | planned |  |

## Edit a user's roles (`/settings/team/users/[id]/access`, PATCH /api/v1/admin/users/<id>/access)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-148 | Open the edit-access form | it_admin | Role checklist with current roles checked; preview of added, removed and retained capabilities; link «تفويض المستخدم للفروع» | `page /settings/team/users/[id]/access` `cap access.users.assign_roles` | planned |  |
| ACC-149 | Edit-access page without `access.users.assign_roles` | custom role (access.users.read) | Forbidden state | `page /settings/team/users/[id]/access` | planned |  |
| ACC-150 | Add a role | it_admin | Save; redirected to the user page; log `user.roles_changed` with before and after | `page /settings/team/users/[id]/access` `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-151 | Remove a role | it_admin | Capabilities leave at the user's next request | `page /settings/team/users/[id]/access` `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-152 | Add an administrator role shows a warning | it_admin | Adding `system_admin` shows an extra warning before saving | `page /settings/team/users/[id]/access` | planned | addingAccessAdminRole |
| ACC-153 | Save with no change | it_admin | Success with no new access-log entry | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-154 | Remove every role | it_admin | 422 `invalid` «assignments must not be empty»; a user is disabled, not left without roles | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-155 | Own access: keeping the administrator role | it_admin | Adding another role to own account succeeds as long as `system_admin` stays | `PATCH /api/v1/admin/users/<id>/access` | planned | see ACC-11 |
| ACC-156 | Own access: dropping the administrator role | it_admin | 422 `self_access_change` | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-157 | Remove the last access administrator's admin role | it_admin | 409 `last_access_admin`; roles unchanged | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-158 | Edit access of the vendor support user | it_admin | 403 `protected_user` | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-159 | Assign a disabled role not yet held | it_admin | 422 `role_disabled`; a disabled role the user already holds can stay | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-160 | Stale version | it_admin | 409 `conflict` with `details.current_version`; the form shows «تغيرت البيانات. أعد تحميل النسخة الأحدث ثم حاول مرة أخرى.» | `PATCH /api/v1/admin/users/<id>/access` | planned | two tabs, one saves first |
| ACC-161 | Missing `expected_version` or unknown field | it_admin | 422 `invalid` naming the field | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-162 | Scope or assignment shape errors | it_admin | 422 `unsupported_scope` / `invalid` field `assignments` | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-163 | Unknown user or other company's user | it_admin | 404 `not_found` | `PATCH /api/v1/admin/users/<id>/access` | planned |  |
| ACC-164 | Caller without the capability sends a valid request | staff1 | 403 `forbidden` | `PATCH /api/v1/admin/users/<id>/access` `cap access.users.assign_roles` | planned | unknown id answers 404 first, see report |
| ACC-165 | Read-only view for a user without the edit action | custom role (access.users.read) | Roles shown with «للقراءة فقط»; no save button | `page /settings/team/users/[id]` | planned |  |
| ACC-166 | Unsaved changes guard | it_admin | Leaving with changed checkboxes asks to confirm | `page /settings/team/users/[id]/access` | planned |  |
| ACC-167 | Role change takes effect and is audited | it_admin | The target's next request shows the new applications; log entry `user.roles_changed` | `PATCH /api/v1/admin/users/<id>/access` `GET /api/v1/admin/access-log` | planned |  |
| ACC-168 | Locale message for `self_access_change` and `role_disabled` | it_admin | Arabic message shown | `PATCH /api/v1/admin/users/<id>/access` | gap | access.errors in ar/access.json has no key for these codes; the raw code is displayed |

## Account security: reset password, disable, reactivate (`/settings/team/users/[id]/security`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-169 | Open the security page | it_admin | Password and confirmation fields, reset button, disable button with the hint «يُبطل الجلسات القائمة.» | `page /settings/team/users/[id]/security` | planned |  |
| ACC-170 | Security page read-only | custom role (access.users.read) | Notice «للقراءة فقط»; no buttons | `page /settings/team/users/[id]/security` `cap access.users.read` | planned |  |
| ACC-171 | Security page of the vendor support user | it_admin | Notice «حساب محمي ولا يمكن تعديل وصوله من هنا.» | `page /settings/team/users/[id]/security` | planned |  |
| ACC-172 | Reset password with inline confirmation | it_admin | First click asks inline «تأكيد»; confirm resets; success alert «تمت إعادة تعيين كلمة المرور»; fields cleared | `page /settings/team/users/[id]/security` `POST /api/v1/admin/users/<id>/password` `cap access.users.reset_password` | planned |  |
| ACC-173 | Reset password effect | it_admin | The user's old password and open sessions stop working; the new password signs in; log `user.password_reset` with `sessions_revoked` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-174 | No password reset email is sent | it_admin | No security mail goes to the user on an administrator reset (stock alert suppressed) | `POST /api/v1/admin/users/<id>/password` | planned | res_users._notify_security_setting_update |
| ACC-175 | Weak password on reset | it_admin | 422 `weak_password` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-176 | Reset without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-177 | Reset for the vendor support user | it_admin | 403 `protected_user` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-178 | Reset with a stale version | it_admin | 409 `conflict` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-179 | Reset a user of another company | it_admin | 404 `not_found` | `POST /api/v1/admin/users/<id>/password` | planned |  |
| ACC-180 | Reset own password through the admin route | it_admin | Allowed by the code (no self check); own session outcome to be confirmed | `POST /api/v1/admin/users/<id>/password` | decision | no `self_access_change` guard on reset; owner to confirm |
| ACC-181 | Disable with inline confirmation | it_admin | Confirmation «أكد إيقاف الوصول عن {name}.»; user cannot sign in; open sessions end; list shows stopped; log `user.disabled` | `page /settings/team/users/[id]/security` `POST /api/v1/admin/users/<id>/disable` `cap access.users.disable` | planned |  |
| ACC-182 | Disable own account | it_admin | 422 `self_access_change` | `POST /api/v1/admin/users/<id>/disable` | planned |  |
| ACC-183 | Disable the last access administrator | it_admin | 409 `last_access_admin` | `POST /api/v1/admin/users/<id>/disable` | planned | see ACC-12 |
| ACC-184 | Disable a vendor support user | it_admin | 403 `protected_user` | `POST /api/v1/admin/users/<id>/disable` | planned |  |
| ACC-185 | Disable with a stale version | it_admin | 409 `conflict`; page asks to reload | `POST /api/v1/admin/users/<id>/disable` | planned |  |
| ACC-186 | Disable without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/users/<id>/disable` `cap access.users.disable` | planned |  |
| ACC-187 | Disable frees a package seat | it_admin | The active-user count drops and a new user can be created at the limit | `POST /api/v1/admin/users/<id>/disable` | planned | saas limits |
| ACC-188 | Disable an already-disabled user | it_admin | Route accepts it and writes another `user.disabled` event; the page hides the button | `POST /api/v1/admin/users/<id>/disable` | decision | no inactive guard in _webvue_disable_user |
| ACC-189 | Reactivate with a new password | it_admin | Password required (hint «يتطلب كلمة مرور جديدة.»); user signs in with it; roles are unchanged; log `user.reactivated` | `page /settings/team/users/[id]/security` `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-190 | Reactivate with a weak password | it_admin | 422 `weak_password` | `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-191 | Reactivate an account whose employee is archived | it_admin | 409 `employee_archived` | `POST /api/v1/admin/users/<id>/reactivate` | planned | see ACC-23 |
| ACC-192 | Reactivate with the package at its user limit | it_admin | 403 `feature_not_included` | `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-193 | Reactivate with a stale version | it_admin | 409 `conflict` | `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-194 | Reactivate an already-active user | it_admin | Route overwrites the password and logs `user.reactivated` for an active user, so `access.users.disable` alone can set another user's password | `POST /api/v1/admin/users/<id>/reactivate` | decision | access_service.py `_webvue_reactivate_user` has no inactive check; the UI hides the button |
| ACC-195 | Reactivate without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/users/<id>/reactivate` | planned |  |
| ACC-196 | Security page for another company's user | it_admin | Not-found state | `page /settings/team/users/[id]/security` | planned |  |
| ACC-197 | Action buttons stay locked while a request runs | it_admin | Buttons disabled during pending mutation; no double submission | `page /settings/team/users/[id]/security` | planned |  |
| ACC-198 | Success message belongs to the right user | it_admin | Navigating to another user clears the previous success alert | `page /settings/team/users/[id]/security` | planned |  |

## Roles list (`/settings/team/roles`, GET /api/v1/admin/roles)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-199 | Open the roles list | it_admin | Heading الأدوار والصلاحيات with count tag; built-in (جاهز) and custom (مخصص) roles with user counts and status; footer | `page /settings/team/roles` `GET /api/v1/admin/roles` `cap access.roles.read` | planned |  |
| ACC-200 | Roles list without `access.roles.read` | staff1 | Forbidden state; API 403 `forbidden` | `page /settings/team/roles` `GET /api/v1/admin/roles` | planned |  |
| ACC-201 | Read-only roles list | custom role (access.roles.read) | Roles and detail open; «إنشاء دور» and the clone row action are absent | `page /settings/team/roles` `cap access.roles.read` | planned |  |
| ACC-202 | Search by Arabic or English name | it_admin | `q` matches `name_ar` or `name_en`; the URL keeps `?q=` | `page /settings/team/roles` `GET /api/v1/admin/roles` | planned |  |
| ACC-203 | Filter by type built-in / custom | it_admin | `type=custom` lists only company roles; invalid value gives 422 `invalid` field `type` | `page /settings/team/roles` `GET /api/v1/admin/roles` | planned |  |
| ACC-204 | Filter by status active / disabled | it_admin | `status=disabled` lists only disabled roles; invalid value gives 422 `invalid` field `status` | `page /settings/team/roles` `GET /api/v1/admin/roles` | planned |  |
| ACC-205 | Empty result | it_admin | «لا توجد أدوار مطابقة.» | `page /settings/team/roles` | planned |  |
| ACC-206 | Pagination and limits | it_admin | Pages of 25; `limit` capped at 200; unsupported query key is 400 `unsupported_filter` | `page /settings/team/roles` `GET /api/v1/admin/roles` | planned |  |
| ACC-207 | Filters survive refresh, direct link and back from a role | it_admin | Query restored; back from detail returns to the same filtered page | `page /settings/team/roles` | planned |  |
| ACC-208 | Roles of another company are hidden | it_admin | A branch's custom roles never appear; built-in roles are common to all | `GET /api/v1/admin/roles` | planned |  |
| ACC-209 | Disabled roles are listed | it_admin | Disabled roles show in the unfiltered list with a disabled badge | `page /settings/team/roles` `GET /api/v1/admin/roles` | planned |  |
| ACC-210 | User count is for the current company only | it_admin | `user_count` counts assignments in the session company | `GET /api/v1/admin/roles` | planned |  |
| ACC-211 | Clone from the row action | it_admin | Opens `/settings/team/roles/new?clone=<id>` with the filters kept | `page /settings/team/roles` `page /settings/team/roles/new` | planned |  |

## Role page and role forms (`/roles/[id]`, `/roles/new`, `/roles/[id]/edit`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-212 | Open a built-in role | it_admin | Read-only permission list grouped by domain; status/type tags; primary action «نسخ»; no edit, disable or delete | `page /settings/team/roles/[id]` `GET /api/v1/admin/roles/<id>` | planned |  |
| ACC-213 | Open a custom role | it_admin | Primary action «تعديل الدور»; menu has clone, disable/enable, delete (delete only when unused) | `page /settings/team/roles/[id]` `GET /api/v1/admin/roles/<id>` | planned |  |
| ACC-214 | Role page tabs | it_admin | Permissions; assigned users (needs users.read); changes (needs audit.read, opens the log filtered by this role) | `page /settings/team/roles/[id]` `page /settings/team/access-log` | planned |  |
| ACC-215 | Assigned users section | it_admin | First 25 users with a link to the filtered users list when there are more | `page /settings/team/roles/[id]` `GET /api/v1/admin/users` | planned |  |
| ACC-216 | Role page without `access.roles.read` | staff1 | Forbidden state | `page /settings/team/roles/[id]` `GET /api/v1/admin/roles/<id>` | planned |  |
| ACC-217 | Unknown role id | it_admin | 404 `not_found` «role does not exist»; page shows the not-found state | `GET /api/v1/admin/roles/<id>` | planned |  |
| ACC-218 | Role of another company | it_admin | 404 `not_found` | `GET /api/v1/admin/roles/<id>` | planned |  |
| ACC-219 | Non-numeric role id | it_admin | Not-found state | `page /settings/team/roles/[id]` | planned |  |
| ACC-220 | Create a custom role | it_admin | Name (Arabic required), English name, description, permissions; 201; redirected to the new role; log `role.created`; version `r<id>-v0` | `page /settings/team/roles/new` `POST /api/v1/admin/roles` `cap access.roles.manage` | planned |  |
| ACC-221 | Create form without `access.roles.manage` | custom role (access.roles.read) | Forbidden state; `POST` answers 403 `forbidden` | `page /settings/team/roles/new` `POST /api/v1/admin/roles` | planned |  |
| ACC-222 | Arabic name missing | it_admin | Field error «أدخل الاسم بالعربية.» and focus on the field; API 422 `invalid` field `name` | `page /settings/team/roles/new` `POST /api/v1/admin/roles` | planned |  |
| ACC-223 | English name not a string | it_admin | 422 `invalid` field `name` | `POST /api/v1/admin/roles` | planned |  |
| ACC-224 | Only custom-allowed permissions are offered | it_admin | The checklist omits sensitive access permissions (users.grant, assign_roles, disable, reset_password, roles.manage) | `page /settings/team/roles/new` `GET /api/v1/admin/permissions` | planned |  |
| ACC-225 | Posting a forbidden permission | it_admin | 422 `custom_role_permission_forbidden` with `details.permission` | `POST /api/v1/admin/roles` | planned |  |
| ACC-226 | Selecting a permission selects its dependencies | it_admin | Choosing `settings.company.manage` also checks `settings.company.read`; unchecking the base clears dependants | `page /settings/team/roles/new` | planned |  |
| ACC-227 | Posting a permission without its dependency | it_admin | 422 `missing_dependency` with `details.permission` and `details.missing` | `POST /api/v1/admin/roles` | planned |  |
| ACC-228 | Unknown permission key | it_admin | 422 `invalid` «unknown permission» | `POST /api/v1/admin/roles` | planned |  |
| ACC-229 | Duplicate permissions in the payload | it_admin | 422 `invalid` «permissions must be unique» | `POST /api/v1/admin/roles` | planned |  |
| ACC-230 | Role with no permissions | it_admin | Allowed; assigned users hold only the employee baseline | `POST /api/v1/admin/roles` | planned |  |
| ACC-231 | Duplicate role name | it_admin | Accepted (no uniqueness check on names) | `POST /api/v1/admin/roles` | decision | two custom roles can share one name; owner to confirm |
| ACC-232 | Missing or unknown payload field | it_admin | 422 `invalid` naming the field | `POST /api/v1/admin/roles` | planned |  |
| ACC-233 | Unsaved changes guard on the create panel | it_admin | Typing then leaving asks for confirmation | `page /settings/team/roles/new` | planned |  |
| ACC-234 | Clone a built-in role from the form | it_admin | Name prefilled «… - نسخة», description and allowed permissions copied; sensitive ones dropped | `page /settings/team/roles/new` `POST /api/v1/admin/roles/<id>/clone` | planned |  |
| ACC-235 | Clone request | it_admin | 201; new custom role named as given; log `role.created` | `POST /api/v1/admin/roles/<id>/clone` | planned |  |
| ACC-236 | Clone needs a name | it_admin | 422 `invalid` field `name` | `POST /api/v1/admin/roles/<id>/clone` | planned |  |
| ACC-237 | Clone without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/roles/<id>/clone` | planned |  |
| ACC-238 | Clone of an unknown role | it_admin | 404 `not_found` | `POST /api/v1/admin/roles/<id>/clone` | planned |  |
| ACC-239 | Edit a custom role | it_admin | Form shows current values; changes to name, description or permissions saved; log `role.updated` with before/after; permission diff panel lists added/removed/retained | `page /settings/team/roles/[id]/edit` `PATCH /api/v1/admin/roles/<id>` | planned |  |
| ACC-240 | Edit page for a built-in role | it_admin | Read-only with notice «دور جاهز محمي ولا يمكن تعديل تعريفه.»; no save | `page /settings/team/roles/[id]/edit` | planned |  |
| ACC-241 | Edit page without `access.roles.manage` | custom role (access.roles.read) | Forbidden state | `page /settings/team/roles/[id]/edit` | planned |  |
| ACC-242 | PATCH a built-in role | it_admin | 403 `protected_role` | `PATCH /api/v1/admin/roles/<id>` | planned | see ACC-09 |
| ACC-243 | PATCH with a stale version | it_admin | 409 `conflict` with `details.current_version`; banner «تغير الدور أثناء التحرير. أعد تحميل النسخة الأحدث.» | `PATCH /api/v1/admin/roles/<id>` | planned |  |
| ACC-244 | PATCH with only `expected_version` | it_admin | 422 `invalid` «at least one field is required» | `PATCH /api/v1/admin/roles/<id>` | planned |  |
| ACC-245 | PATCH without `expected_version` | it_admin | 422 `invalid` field `expected_version` | `PATCH /api/v1/admin/roles/<id>` | planned |  |
| ACC-246 | Permission change reaches assigned users | it_admin | Holders gain or lose the capability at their next request; policy version changes | `PATCH /api/v1/admin/roles/<id>` | planned |  |
| ACC-247 | Disable a custom role | it_admin | Inline confirm «إيقاف هذا الدور؟» stating existing assignments stay active; role leaves the assign lists; log `role.disabled` | `page /settings/team/roles/[id]` `POST /api/v1/admin/roles/<id>/disable` | planned |  |
| ACC-248 | Enable a disabled role | it_admin | Inline confirm «تفعيل هذا الدور؟»; role assignable again; log `role.enabled` | `page /settings/team/roles/[id]` `POST /api/v1/admin/roles/<id>/enable` | planned |  |
| ACC-249 | Disable or enable a built-in role | it_admin | 403 `protected_role` | `POST /api/v1/admin/roles/<id>/disable` `POST /api/v1/admin/roles/<id>/enable` | planned |  |
| ACC-250 | Disable / enable with a stale version | it_admin | 409 `conflict` | `POST /api/v1/admin/roles/<id>/disable` `POST /api/v1/admin/roles/<id>/enable` | planned |  |
| ACC-251 | Disable / enable without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/roles/<id>/disable` `POST /api/v1/admin/roles/<id>/enable` | planned |  |
| ACC-252 | Delete an unused custom role | it_admin | Inline confirm «حذف هذا الدور؟ لا يمكن التراجع عن الحذف.»; 204; back to the list; log `role.deleted` | `page /settings/team/roles/[id]` `DELETE /api/v1/admin/roles/<id>` | planned |  |
| ACC-253 | Delete is not offered for a role in use | it_admin | `delete` missing from allowed actions when `user_count > 0` | `page /settings/team/roles/[id]` `GET /api/v1/admin/roles/<id>` | planned |  |
| ACC-254 | Delete a role in use by direct call | it_admin | 409 `role_in_use` with `details.user_count` | `DELETE /api/v1/admin/roles/<id>` | planned | see ACC-08 |
| ACC-255 | Delete without `expected_version` | it_admin | 422 `invalid` field `expected_version` | `DELETE /api/v1/admin/roles/<id>` | planned |  |
| ACC-256 | Delete with a stale version | it_admin | 409 `conflict` | `DELETE /api/v1/admin/roles/<id>` | planned |  |
| ACC-257 | Delete a built-in role | it_admin | 403 `protected_role` | `DELETE /api/v1/admin/roles/<id>` | planned |  |
| ACC-258 | Delete without the capability | staff1 | 403 `forbidden` | `DELETE /api/v1/admin/roles/<id>` | planned |  |
| ACC-259 | A role action error is shown inline | it_admin | The confirmation closes and the error text appears under the permissions; the role stays | `page /settings/team/roles/[id]` | planned |  |
| ACC-260 | Capability check precedes lookup | staff1 | `PATCH`/`DELETE`/clone on a missing role answer 403 `forbidden`, not 404 | `PATCH /api/v1/admin/roles/<id>` `DELETE /api/v1/admin/roles/<id>` | planned |  |

## Permission catalog (GET /api/v1/admin/permissions)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-261 | Catalog lists every capability | it_admin | Items with key, domain, resource, action, Arabic/English label and description, dependencies, scopes, `custom_role_allowed`, `sensitive`; `version` `access-catalog-v1` | `GET /api/v1/admin/permissions` `cap access.roles.read` | planned |  |
| ACC-262 | Catalog without `access.roles.read` | staff1 | 403 `forbidden` | `GET /api/v1/admin/permissions` | planned |  |
| ACC-263 | Scopes | it_admin | Every permission offers a company scope as assignable; contextual scopes are listed as not assignable | `GET /api/v1/admin/permissions` | planned |  |
| ACC-264 | Sensitive and custom-allowed flags | it_admin | The five access-changing keys are `custom_role_allowed: false` and `sensitive: true`; branding and company manage are sensitive but allowed in custom roles | `GET /api/v1/admin/permissions` | planned |  |
| ACC-265 | Dependencies are exposed | it_admin | `access.users.assign_roles` lists `access.users.read` and `access.roles.read`; `settings.company.manage` lists `settings.company.read` | `GET /api/v1/admin/permissions` | planned |  |

## Access log (`/settings/team/access-log`, GET /api/v1/admin/access-log)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-266 | Open the access log | it_admin | Newest first; columns time, actor, action (Arabic label), target, result «نجحت»; footer with totals | `page /settings/team/access-log` `GET /api/v1/admin/access-log` `cap access.audit.read` | planned |  |
| ACC-267 | Access log without `access.audit.read` | staff1 | Forbidden state; API 403 `forbidden` | `page /settings/team/access-log` `GET /api/v1/admin/access-log` | planned |  |
| ACC-268 | Audit-only role | custom role (access.audit.read) | Log opens and filter selects that need users/roles read show only the all-options | `page /settings/team/access-log` `cap access.audit.read` | planned |  |
| ACC-269 | Filter by date range | it_admin | `from` and `to` limit events by time; the end picker cannot go before the start | `page /settings/team/access-log` `GET /api/v1/admin/access-log` | planned |  |
| ACC-270 | Filter by actor | it_admin | Actor select (needs users read) narrows to that person's actions | `page /settings/team/access-log` | planned |  |
| ACC-271 | Filter by target type and target | it_admin | Target select stays disabled until a type is chosen; changing the type clears the target; invalid type gives 422 `invalid` | `page /settings/team/access-log` `GET /api/v1/admin/access-log` | planned |  |
| ACC-272 | Filter by action | it_admin | Select lists the 15 known actions by Arabic label | `page /settings/team/access-log` | planned |  |
| ACC-273 | Invalid actor_id or target_id | it_admin | 422 `invalid` for 0, negative or non-numeric | `GET /api/v1/admin/access-log` | planned |  |
| ACC-274 | Unsupported query key | it_admin | 400 `unsupported_filter` | `GET /api/v1/admin/access-log` | planned |  |
| ACC-275 | Malformed `from` or `to` value | it_admin | A clean 422 is expected, not a server error | `GET /api/v1/admin/access-log` | planned | values go straight into the domain, see report |
| ACC-276 | Clear filters | it_admin | «مسح» resets the URL and the results | `page /settings/team/access-log` | planned |  |
| ACC-277 | Pagination | it_admin | 25 per page; offset in the URL; limit capped at 200 | `page /settings/team/access-log` | planned |  |
| ACC-278 | Filters survive refresh and direct link | it_admin | Query string restores every filter | `page /settings/team/access-log` | planned |  |
| ACC-279 | Empty result | it_admin | «لا توجد تغييرات مطابقة.» shown | `page /settings/team/access-log` | planned |  |
| ACC-280 | Open an event | it_admin | Detail shows time, actor, action, target, reason, and before/after panels with changed lines highlighted | `page /settings/team/access-log/[id]` `GET /api/v1/admin/access-log/<id>` | planned |  |
| ACC-281 | Event written by the system | it_admin | Actor shows «النظام» for events without an actor (such as migration events) | `page /settings/team/access-log/[id]` | planned |  |
| ACC-282 | Back from an event keeps the filters | it_admin | The back arrow returns to the log with the same query | `page /settings/team/access-log/[id]` | planned |  |
| ACC-283 | Unknown event id or non-numeric id | it_admin | 404 `not_found` / not-found state | `page /settings/team/access-log/[id]` `GET /api/v1/admin/access-log/<id>` | planned |  |
| ACC-284 | Event of another company | it_admin | 404 `not_found`, same text as an unknown id | `GET /api/v1/admin/access-log/<id>` | planned |  |
| ACC-285 | Event detail without the capability | staff1 | Forbidden state; API 403 `forbidden` | `page /settings/team/access-log/[id]` `GET /api/v1/admin/access-log/<id>` | planned |  |
| ACC-286 | No edit or delete path for events | it_admin | No page action or route changes an event; direct ORM write answers `audit_is_immutable` | `page /settings/team/access-log` | planned |  |
| ACC-287 | A failed request writes no event | it_admin | A refused disable (for example `last_access_admin`) leaves the log unchanged | `page /settings/team/access-log` | planned | api_handler rolls the request back |
| ACC-288 | Events never contain secrets | it_admin | After create and reset, no event holds a password, token or hash in before/after | `page /settings/team/access-log/[id]` | planned | `sensitive_audit_key` guard |
| ACC-289 | Log entries for each access action | it_admin | Create, roles change, disable, reactivate, reset, role create/update/disable/enable/delete each appear once with the right Arabic label | `page /settings/team/access-log` | planned | see Audit catalog |
| ACC-290 | Company profile, branding and maintenance changes are not in the log | it_admin | Expected: an event for each change, or a documented choice that they are not access events | `page /settings/team/access-log` | decision | no `_webvue_log` call in company/branding/maintenance writes; `company` target type is used only by branch policy |

## Branch access policy (`/settings/team/branches`, `/api/v1/admin/access/branches`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-291 | Open the branch policy page | it_admin | Mode select (فصل كامل / تفويض محدد (الافتراضي) / وراثة منظّمة) with its hint; branches and roles shown for inherited mode | `page /settings/team/branches` `GET /api/v1/admin/access/branches` | planned |  |
| ACC-292 | Branch page without both required capabilities | custom role (access.roles.read) | Forbidden state; API 403 `forbidden` (needs `access.users.assign_roles` and `access.roles.read`) | `page /settings/team/branches` `GET /api/v1/admin/access/branches` `cap access.roles.read` | planned |  |
| ACC-293 | Default mode | it_admin | A new tenant starts in `delegated` | `GET /api/v1/admin/access/branches` | planned |  |
| ACC-294 | Mode isolated | it_admin | Requests are limited to the current company; branch memberships grant nothing; branch data is absent from lists | `PATCH /api/v1/admin/access/branches` | planned | see ACC-19 |
| ACC-295 | Mode delegated | it_admin | A branch grants only what the user's explicit branch assignments give | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-296 | Mode inherited | it_admin | Branches marked «السماح بالوراثة في هذا الفرع» give the user the capabilities of the chosen built-in roles held in the root company | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-297 | Inherited roles are limited to active built-in roles | it_admin | Custom roles and disabled built-in roles not already selected are not offered; posting one gives 422 `invalid` | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-298 | Save a policy change | it_admin | Saved alert «حُفظت صلاحيات الفروع.»; policy version changes; log `branch.policy_changed` with before and after | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-299 | Sensitive roles warning | it_admin | Changing inherited roles shows the warning «قد تتضمن الأدوار المختارة وصولًا إلى بيانات حساسة؛ راجعها قبل الحفظ.» | `page /settings/team/branches` | planned |  |
| ACC-300 | Unknown mode | it_admin | 422 `invalid` field `mode` | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-301 | Branch list or role list malformed | it_admin | 422 `invalid` field `branches` (wrong keys, duplicate branch, non-integer role, branch outside the tree, `inherit` not boolean) | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-302 | Stale version | it_admin | 409 `conflict`; page shows the conflict text and a «تحميل آخر نسخة» button that asks before discarding edits | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-303 | Missing payload fields | it_admin | 422 `invalid` naming the field | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-304 | No branches | it_admin | «لا توجد فروع ضمن نطاق إدارتك.» | `page /settings/team/branches` | planned |  |
| ACC-305 | Unsaved changes guard | it_admin | Leaving with an edited mode or roles asks to confirm | `page /settings/team/branches` | planned |  |
| ACC-306 | Cache clearing after a policy change | it_admin | The affected user sees the new reach at the next request without signing in again | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-307 | Branch policy writes without the capabilities | staff1 | 403 `forbidden` | `PATCH /api/v1/admin/access/branches` | planned |  |
| ACC-308 | Branch creation from the customer UI | it_admin | Administrator can create a branch company |  | gap | no page or route creates a branch; `res.company` create is limited to Odoo system administrators |

## User branch delegation (`/settings/team/users/[id]/branches`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-309 | Open a user's branch delegation | it_admin | Per-branch role checklists with the policy hint and a link «عرض سياسة الفروع» | `page /settings/team/users/[id]/branches` `GET /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-310 | Delegation page without the capabilities | custom role (access.roles.read) | Forbidden state; API 403 `forbidden` | `page /settings/team/users/[id]/branches` `GET /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-311 | Assign a role in a branch | it_admin | Saved; user gains that role only in the branch; log `user.branch_roles_changed` | `page /settings/team/users/[id]/branches` `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-312 | Remove a branch role | it_admin | Capability leaves in that branch only | `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-313 | Remove the last branch administrator | it_admin | 409 `last_access_admin` | `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-314 | Vendor support user | it_admin | 403 `protected_user` | `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-315 | Stale user branch version | it_admin | 409 `conflict`; page offers reload | `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-316 | Invalid branch or role in the payload | it_admin | 422 `invalid` field `branches` | `PATCH /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-317 | Roles offered per branch | it_admin | Active built-in roles plus the branch's own custom roles; a disabled role already held stays visible and removable | `GET /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-318 | User of another company or non-numeric id | it_admin | 404 `not_found` / not-found state | `GET /api/v1/admin/users/<id>/branches` `page /settings/team/users/[id]/branches` | planned |  |
| ACC-319 | Only branches the user belongs to are listed | it_admin | Branches outside the user's memberships are absent | `GET /api/v1/admin/users/<id>/branches` | planned |  |
| ACC-320 | Back to the access tab | it_admin | Header back arrow returns to the user's edit-access page | `page /settings/team/users/[id]/branches` | planned |  |
| ACC-321 | Switching users while editing | it_admin | Unsaved draft of the first user is dropped; nothing is sent to the second | `page /settings/team/users/[id]/branches` | planned |  |
| ACC-322 | Unsaved changes guard | it_admin | Leaving with edits asks to confirm | `page /settings/team/users/[id]/branches` | planned |  |

## Employee accounts (`webvue_access_hr`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-323 | List candidates | it_admin | `{items,total}` with employee id, name, department, work email, active, linked user id and access state | `GET /api/v1/admin/employee-accounts/candidates` `cap access.users.grant` | planned |  |
| ACC-324 | Candidates without `access.users.grant` | staff1 | 403 `forbidden` | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-325 | Candidates when the HR feature is off | it_admin | 403 `feature_not_included` | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-326 | Search candidates | it_admin | `q` matches name or work email; `employee_id` returns that one | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-327 | Filter by department and status | it_admin | `department_id`, `status` active or archived; unknown status gives 422 `invalid` | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-328 | Candidate filter validation | it_admin | Non-positive `department_id` or `employee_id` gives 422 `invalid`; an unknown key gives 400 `unsupported_filter` | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-329 | Candidate paging | it_admin | `limit`/`offset` honoured; limit capped at 200 | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-330 | Candidates from another company are absent | it_admin | Only employees of the current company | `GET /api/v1/admin/employee-accounts/candidates` | planned |  |
| ACC-331 | Grant an account to an employee | it_admin | 201 with the user payload; the user is linked to the employee file and uses the employee's contact; log `user.granted` then `user.employee_linked` | `POST /api/v1/admin/employee-accounts` `cap access.users.grant` | planned | see ACC-20 |
| ACC-332 | Grant without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-333 | Grant when the HR feature is off or read-only | it_admin | 403 `feature_not_included` / `tenant_read_only` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-334 | Unknown or other-company employee | it_admin | 404 `not_found` «employee is not available» | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-335 | Archived employee | it_admin | 422 `employee_archived` field `employee_id` | `POST /api/v1/admin/employee-accounts` | planned | see ACC-21 |
| ACC-336 | Employee already linked to a user | it_admin | 409 `account_exists` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-337 | Employee without a work email | it_admin | 422 `work_email_required` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-338 | Employee without a contact record | it_admin | 422 `employee_contact_required` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-339 | Work email already used by another login | it_admin | 409 `account_exists` field `login` | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-340 | Weak password, bad assignments, extra field | it_admin | 422 `weak_password` / `invalid` / `unsupported_scope` as for user creation | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-341 | Grant leaves nothing behind when it fails | it_admin | No user, no link and no audit entry | `POST /api/v1/admin/employee-accounts` | planned |  |
| ACC-342 | User list shows the employee | hr_manager | Rows and detail carry `employee` (id, name, department) when HR is readable; null when unlinked | `GET /api/v1/admin/users` `GET /api/v1/admin/users/<id>` | planned |  |
| ACC-343 | User list without HR | it_admin | `employee` key absent when the HR feature is not readable | `GET /api/v1/admin/users` | planned |  |
| ACC-344 | Archive an employee who has an account | hr_manager | Linked account disabled and sessions revoked; log `employee.archived_access_disabled` with the employee id |  | planned | hr.employees.archive; see ACC-22 |
| ACC-345 | Archive the employee linked to own account | hr_manager | Refused `self_access_change`; employee not archived |  | planned |  |
| ACC-346 | Archive the employee of the last access administrator | hr_manager | Refused 409 `last_access_admin` |  | planned |  |
| ACC-347 | Archive an employee whose account is already disabled | hr_manager | Archive succeeds; check whether a duplicate event is written |  | decision | _webvue_disable_employee_account has no inactive guard |
| ACC-348 | Employee archive without `access.users.read` for the actor | hr_manager | Archive still disables the account (check uses `hr.employees.archive`) |  | planned |  |
| ACC-349 | Candidates expose HR data under account-grant rights | it_admin | Names, departments and work emails are returned to a holder of `access.users.grant` without `hr.employees.read` | `GET /api/v1/admin/employee-accounts/candidates` | decision | raw SQL below the HR ACLs by design; owner to confirm |

## Company profile (`/settings/company`, `/api/v1/admin/company`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-350 | Open the company page | it_admin | Header card with the company and completeness, then cards الملف التعريفي, العنوان الوطني, التواصل, الهوية والمستندات; the sidebar sub-list scrolls to each card | `page /settings/company` `GET /api/v1/admin/company` `cap settings.company.read` | planned |  |
| ACC-351 | Company page without any settings capability | staff1 | Forbidden state; API 403 `forbidden` | `page /settings/company` `GET /api/v1/admin/company` | planned |  |
| ACC-352 | Read-only view | custom role (settings.company.read) | Fields disabled with «يمكنك عرض بيانات الشركة فقط. التعديل يحتاج صلاحية إدارة بيانات الشركة.»; no logo upload; branding card hidden | `page /settings/company` `GET /api/v1/admin/company` `cap settings.company.read` | planned |  |
| ACC-353 | Branding only | custom role (settings.branding.manage) | Only the branding card; profile cards and header are hidden | `page /settings/company` `cap settings.branding.manage` | planned |  |
| ACC-354 | Edit the name | it_admin | Saved with toast «تم حفظ بيانات الشركة»; the shell and documents show the new name after reload | `page /settings/company` `PATCH /api/v1/admin/company` `cap settings.company.manage` | planned |  |
| ACC-355 | Empty name | it_admin | Client message «أدخل اسم الشركة»; API 422 `invalid` field `name` | `page /settings/company` `PATCH /api/v1/admin/company` | planned |  |
| ACC-356 | Edit tagline, registry, VAT, street, street2, city, zip, email, phone, website | it_admin | Each saved; blank clears the field; values are trimmed | `page /settings/company` `PATCH /api/v1/admin/company` | planned |  |
| ACC-357 | Choose a region | it_admin | Region list follows the company's country; saved as `state_id` | `page /settings/company` `PATCH /api/v1/admin/company` `GET /api/v1/admin/company/countries/<id>/states` | planned | country is read-only after provisioning |
| ACC-358 | Region from another country | it_admin | 422 `invalid` field `state_id` «does not belong to the company country» | `PATCH /api/v1/admin/company` | planned |  |
| ACC-359 | Region that does not exist or is not an integer | it_admin | 422 `invalid` field `state_id` | `PATCH /api/v1/admin/company` | planned |  |
| ACC-360 | Regions lookup | it_admin | `{items,total}` ordered by name; `q` filters by name or code; `limit`/`offset` honoured | `GET /api/v1/admin/company/countries/<id>/states` `cap settings.company.read` | planned |  |
| ACC-361 | Regions lookup for an unknown country | it_admin | 404 `not_found` | `GET /api/v1/admin/company/countries/<id>/states` | planned |  |
| ACC-362 | Regions lookup without the capability | staff1 | 403 `forbidden` | `GET /api/v1/admin/company/countries/<id>/states` | planned |  |
| ACC-363 | Text longer than 255 characters | it_admin | 422 `invalid` naming the field | `PATCH /api/v1/admin/company` | planned |  |
| ACC-364 | Value that is not a string or null | it_admin | 422 `invalid` naming the field | `PATCH /api/v1/admin/company` | planned |  |
| ACC-365 | Invalid email | it_admin | 422 `invalid` field `email` | `PATCH /api/v1/admin/company` | planned |  |
| ACC-366 | Invalid VAT number for the country | it_admin | 422 `invalid_vat` field `vat` with the country-specific message | `PATCH /api/v1/admin/company` | planned |  |
| ACC-367 | Unknown or read-only field (country, currency) | it_admin | 422 `invalid` «field is not writable»; nothing is saved | `PATCH /api/v1/admin/company` | planned |  |
| ACC-368 | Empty PATCH body | it_admin | 422 `invalid` «no fields to update» | `PATCH /api/v1/admin/company` | planned |  |
| ACC-369 | Application-added fields | hr_manager | Fields declared by installed applications appear in their section and save through the same route; selection values outside the options give 422 `invalid` | `page /settings/company` `PATCH /api/v1/admin/company` | planned | _webvue_company_profile_extensions |
| ACC-370 | PATCH without `settings.company.manage` | custom role (settings.company.read) | 403 `forbidden` | `PATCH /api/v1/admin/company` `cap settings.company.manage` | planned |  |
| ACC-371 | Field error stays on the field | it_admin | A rejected save keeps the draft and shows the message under the offending field | `page /settings/company` `PATCH /api/v1/admin/company` | planned |  |
| ACC-372 | Save status unknown (network cut) | it_admin | Message «لم نتأكد من اكتمال الحفظ. تحقق من السجل قبل إعادة المحاولة.» | `page /settings/company` | planned |  |
| ACC-373 | Cancel restores the saved values | it_admin | Draft discarded | `page /settings/company` | planned |  |
| ACC-374 | Unsaved changes guard | it_admin | Leaving with edits asks to confirm | `page /settings/company` | planned |  |
| ACC-375 | Completeness count | it_admin | Header card counts filled items among name, logo, country, registry, VAT, street, city, zip, email, phone | `page /settings/company` `GET /api/v1/admin/company` | planned |  |
| ACC-376 | Load error | it_admin | Error with «إعادة المحاولة»; retry loads | `page /settings/company` | planned |  |
| ACC-377 | Upload a logo | it_admin | PNG or JPEG up to 2 MiB accepted; toast «تم حفظ الشعار»; new `logo_url` carries a version so the shell and login page refresh | `page /settings/company` `POST /api/v1/admin/company/logo` | planned | see ACC-17 |
| ACC-378 | Logo of the wrong type (GIF, SVG, PDF) | it_admin | Browser message «استخدم صورة PNG أو JPEG»; API 422 `invalid` field `data` | `page /settings/company` `POST /api/v1/admin/company/logo` | planned |  |
| ACC-379 | Logo over 2 MiB | it_admin | Browser message «يجب ألا يتجاوز الشعار 2 ميجابايت»; API 422 `invalid` «the logo exceeds 2MB» | `page /settings/company` `POST /api/v1/admin/company/logo` | planned |  |
| ACC-380 | Logo with invalid base64 or empty data | it_admin | 422 `invalid` field `data` | `POST /api/v1/admin/company/logo` | planned |  |
| ACC-381 | Logo body with extra keys | it_admin | 422 `invalid` «the body must be {data}» | `POST /api/v1/admin/company/logo` | planned |  |
| ACC-382 | Logo upload without the capability | custom role (settings.company.read) | 403 `forbidden` | `POST /api/v1/admin/company/logo` | planned |  |
| ACC-383 | Company data written on a read-only tenant | it_admin | 403 `tenant_read_only` | `PATCH /api/v1/admin/company` `POST /api/v1/admin/company/logo` | planned |  |
| ACC-384 | Company profile edits are for the session company only | it_admin | A branch session edits the branch's own profile; a payload `company_id` is rejected as not writable | `PATCH /api/v1/admin/company` | planned |  |

## Branding (`هوية` card, `/api/v1/admin/branding`, public `/api/v1/branding`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-385 | Open the branding card | it_admin | Shows the document colour field with presets (ويب فيو الافتراضي, أزرق, فيروزي, كهرماني), a colour picker, and a note that name and logo live in the profile card | `page /settings/company` `GET /api/v1/admin/branding` `cap settings.branding.manage` | planned |  |
| ACC-386 | Branding read without the capability | staff1 | 403 `forbidden` | `GET /api/v1/admin/branding` `cap settings.branding.manage` | planned |  |
| ACC-387 | Change the primary colour | it_admin | Toast «تم حفظ لون المستندات»; the login page and documents use it after the public cache expires | `page /settings/company` `PATCH /api/v1/admin/branding` | planned |  |
| ACC-388 | Pick a preset | it_admin | Colour field fills and the form becomes dirty | `page /settings/company` | planned |  |
| ACC-389 | Reset to default | it_admin | «إعادة اللون الافتراضي» sets the default blue; saved only on submit | `page /settings/company` | planned |  |
| ACC-390 | Cancel changes | it_admin | Colour returns to the saved value | `page /settings/company` | planned |  |
| ACC-391 | Invalid colour in the browser | it_admin | Error «أدخل لوناً من ست خانات»; save disabled | `page /settings/company` | planned |  |
| ACC-392 | Invalid colour in the API | it_admin | 422 `invalid` field `primary_color` (six-digit hex with #) | `PATCH /api/v1/admin/branding` | planned |  |
| ACC-393 | Secondary colour | it_admin | Accepted by the API and returned as `secondary_color`; not editable in the page | `PATCH /api/v1/admin/branding` | planned |  |
| ACC-394 | Name or logo in a branding patch | it_admin | 422 `invalid` «field is not writable»; the whole request is refused | `PATCH /api/v1/admin/branding` | planned |  |
| ACC-395 | Empty branding patch | it_admin | 422 `invalid` | `PATCH /api/v1/admin/branding` | planned |  |
| ACC-396 | Branding write without the capability | custom role (settings.company.manage) | 403 `forbidden`: company manage does not include branding | `PATCH /api/v1/admin/branding` | planned |  |
| ACC-397 | Branding load error | it_admin | «تعذر تحميل إعدادات الهوية» with «إعادة المحاولة» | `page /settings/company` | planned |  |
| ACC-398 | Save error keeps the draft | it_admin | Error toast; colour stays typed | `page /settings/company` | planned |  |
| ACC-399 | Public branding for the login page | every persona | Without any session returns name, `logo_url`, `primary_color`, `font`; `secondary_color` only when set; header `Cache-Control: public, max-age=300` | `GET /api/v1/branding` | planned |  |
| ACC-400 | Public branding default colour | every persona | A tenant without a saved colour returns `#0066cc` | `GET /api/v1/branding` | planned |  |
| ACC-401 | Public branding logo | every persona | `logo_url` is null while the company still has the stock logo, versioned after an upload | `GET /api/v1/branding` | planned |  |
| ACC-402 | Public branding when the tenant has no profile | every persona | A clean not-found answer is expected, not a server error | `GET /api/v1/branding` | planned | route has no api_handler; raises MissingError |
| ACC-403 | Public branding exposes only branding | every persona | No other company field is present in the answer | `GET /api/v1/branding` | planned |  |

## Maintenance windows (`/settings/system#maintenance`, `/api/v1/admin/maintenance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-404 | Open the maintenance card | it_admin | Preference form, published releases with deadline, estimate, scope and urgency badges, booking form (when a tenant release is bookable), existing bookings | `page /settings/system` `GET /api/v1/admin/maintenance` `cap settings.maintenance.manage` | planned |  |
| ACC-405 | Read without `settings.maintenance.manage` | staff1 | 403 `forbidden`; the card is hidden | `page /settings/system` `GET /api/v1/admin/maintenance` | planned |  |
| ACC-406 | Read from a branch company session | it_admin | 403 «Maintenance is managed from the tenant root company.» | `GET /api/v1/admin/maintenance` | planned |  |
| ACC-407 | Empty state | it_admin | No preference: form uses defaults (UTC, Thursday, 02:00, 60 minutes); «لا توجد إصدارات صيانة منشورة حاليًا.»; «لم يُحجز موعد صيانة بعد.» | `page /settings/system` `GET /api/v1/admin/maintenance` | planned |  |
| ACC-408 | Release ordering | it_admin | Supported releases with future deadlines first, then releases with bookings, then recent history; each list capped at 200 with a total | `GET /api/v1/admin/maintenance` | planned |  |
| ACC-409 | Shared-scope release | it_admin | Shows «تؤثر هذه الصيانة في خدمة مشتركة…» and cannot be booked | `page /settings/system` `GET /api/v1/admin/maintenance` | planned |  |
| ACC-410 | Security release | it_admin | Shows the «تحديث أمني» badge | `page /settings/system` | planned |  |
| ACC-411 | Save the weekly preference | it_admin | First save sends `revision` 0 and creates revision 1; later saves must send the current revision; the form reloads from the result | `page /settings/system` `PATCH /api/v1/admin/maintenance/preference` | planned |  |
| ACC-412 | Preference with stale revision | it_admin | 409 `conflict` «Maintenance changed. Reload before saving.»; draft kept with the hint to use «إلغاء تعديلات المسودة» | `PATCH /api/v1/admin/maintenance/preference` | planned |  |
| ACC-413 | Preference with invalid timezone | it_admin | 422 `invalid` field `timezone` | `PATCH /api/v1/admin/maintenance/preference` | planned |  |
| ACC-414 | Preference with out-of-range numbers | it_admin | 422 `invalid` for weekday outside 0–6, start minute outside 0–1439, duration outside 1–1440, or non-integer | `PATCH /api/v1/admin/maintenance/preference` | planned |  |
| ACC-415 | Preference with missing or extra keys | it_admin | 422 `invalid` «Maintenance fields are missing or unknown.» | `PATCH /api/v1/admin/maintenance/preference` | planned |  |
| ACC-416 | Preference without the capability | staff1 | 403 `forbidden` | `PATCH /api/v1/admin/maintenance/preference` | planned |  |
| ACC-417 | Discard draft | it_admin | «إلغاء تعديلات المسودة» reloads the saved preference | `page /settings/system` | planned |  |
| ACC-418 | Book a release at an explicit time | it_admin | Choose release, local date-time, timezone and duration; booking `scheduled` with revision 1; appears in «حجوزاتك» | `page /settings/system` `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-419 | Book using the saved preference | it_admin | Checkbox «استخدام نافذتي المفضلة المحفوظة» books the next matching slot before the deadline | `page /settings/system` `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-420 | Book with the preference but none saved | it_admin | 422 «Save a preferred maintenance window first.» | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-421 | Book with a stale preference revision | it_admin | 409 `conflict` | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-422 | Booking window in the past | it_admin | 422 «Choose a future maintenance window.» | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-423 | Booking window shorter than the estimate | it_admin | 422 «The maintenance window is shorter than the measured estimate.» | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-424 | Booking window ending after the deadline | it_admin | 422 «The maintenance window must finish before the release deadline.» | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-425 | Booking at a missing or ambiguous daylight-saving time | it_admin | 422 field `localDateTime` with the daylight-saving message | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-426 | Booking with a malformed local time or timezone | it_admin | 422 `invalid` | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-427 | Booking an unknown release | it_admin | 404 `not_found` «Release notice not found.» | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-428 | Booking a withdrawn or non-tenant release | it_admin | 422 «This release is not available for an individual tenant booking.» | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-429 | Booking the same release twice | it_admin | 409 `conflict` | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-430 | Overlapping bookings | it_admin | 409 `conflict` when an active booking overlaps the window | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-431 | Booking without the capability | staff1 | 403 `forbidden` | `POST /api/v1/admin/maintenance/bookings` | planned |  |
| ACC-432 | Reschedule a scheduled booking | it_admin | Edit mode loads the booking in its own timezone; save with the booking revision; revision increases | `page /settings/system` `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-433 | Cancel a scheduled booking | it_admin | Inline «هل تريد إلغاء حجز الصيانة؟»; status `cancelled`; the release becomes bookable again | `page /settings/system` `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-434 | Change or cancel a booking that is running, complete, failed or already cancelled | it_admin | 409 `conflict` «Only scheduled maintenance can be changed or cancelled.» | `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-435 | Booking patch with a stale revision | it_admin | 409 `conflict` | `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-436 | Booking patch with the wrong key set | it_admin | 422 `invalid` | `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-437 | Unknown booking id | it_admin | 404 `not_found` | `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-438 | Booking patch without the capability | staff1 | 403 `forbidden` | `PATCH /api/v1/admin/maintenance/bookings/<id>` | planned |  |
| ACC-439 | Unsaved changes guard | it_admin | Leaving with an edited preference or booking asks to confirm | `page /settings/system` | planned |  |
| ACC-440 | Server error keeps the draft | it_admin | Alert with the message, the draft stays, a retry button reloads data | `page /settings/system` | planned |  |
| ACC-441 | Maintenance changes are recorded | it_admin | Each preference save, booking, reschedule and cancel writes a maintenance event (not an access-log event) | `POST /api/v1/admin/maintenance/bookings` | planned |  |

## Commercial stub routes (`/api/commercial/v1/*`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-442 | GET on any commercial path | it_admin | 404 `commercial_unavailable` «commercial self-service is not enabled for this installation» | `GET /api/commercial/v1/<id>` | planned |  |
| ACC-443 | POST on any commercial path | it_admin | 404 `commercial_unavailable` | `POST /api/commercial/v1/<id>` | planned |  |
| ACC-444 | PUT on any commercial path | it_admin | 404 `commercial_unavailable` | `PUT /api/commercial/v1/<id>` | planned |  |
| ACC-445 | PATCH on any commercial path | it_admin | 404 `commercial_unavailable` | `PATCH /api/commercial/v1/<id>` | planned |  |
| ACC-446 | DELETE on any commercial path | it_admin | 404 `commercial_unavailable` | `DELETE /api/commercial/v1/<id>` | planned |  |
| ACC-447 | Same answer in `saas` and `non_saas` | it_admin | The answer does not change with the commercial mode while billing has no surface | `GET /api/commercial/v1/<id>` | planned | saas.md covers the subscription pages |

## Capability matrix (each key allowed and refused)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-448 | Capability `access.users.read` allows: Open the users list and detail | custom role (access.users.read) | The operation succeeds and the matching page parts are shown | `cap access.users.read` | planned |  |
| ACC-449 | Capability `access.users.read` absent | staff1 | 403 on GET /api/v1/admin/users and forbidden pages | `cap access.users.read` | planned |  |
| ACC-450 | Capability `access.users.grant` allows: Create users and grant employee accounts | it_admin | The operation succeeds and the matching page parts are shown | `cap access.users.grant` | planned |  |
| ACC-451 | Capability `access.users.grant` absent | staff1 | 403 `forbidden`; no create button | `cap access.users.grant` | planned |  |
| ACC-452 | Capability `access.users.assign_roles` allows: Edit roles, branch policy and delegation | it_admin | The operation succeeds and the matching page parts are shown | `cap access.users.assign_roles` | planned |  |
| ACC-453 | Capability `access.users.assign_roles` absent | custom role (access.users.read) | 403 `forbidden`; no edit-access tab; branches link absent | `cap access.users.assign_roles` | planned |  |
| ACC-454 | Capability `access.users.disable` allows: Disable and reactivate accounts | it_admin | The operation succeeds and the matching page parts are shown | `cap access.users.disable` | planned |  |
| ACC-455 | Capability `access.users.disable` absent | custom role (access.users.read) | 403 `forbidden`; no disable button | `cap access.users.disable` | planned |  |
| ACC-456 | Capability `access.users.reset_password` allows: Reset a password | it_admin | The operation succeeds and the matching page parts are shown | `cap access.users.reset_password` | planned |  |
| ACC-457 | Capability `access.users.reset_password` absent | custom role (access.users.read) | 403 `forbidden`; no reset form | `cap access.users.reset_password` | planned |  |
| ACC-458 | Capability `access.roles.read` allows: Read roles and the catalog | custom role (access.roles.read) | The operation succeeds and the matching page parts are shown | `cap access.roles.read` | planned |  |
| ACC-459 | Capability `access.roles.read` absent | staff1 | 403 `forbidden`; roles page forbidden | `cap access.roles.read` | planned |  |
| ACC-460 | Capability `access.roles.manage` allows: Create, edit, clone, disable, delete roles | it_admin | The operation succeeds and the matching page parts are shown | `cap access.roles.manage` | planned |  |
| ACC-461 | Capability `access.roles.manage` absent | custom role (access.roles.read) | 403 `forbidden`; no create/edit buttons | `cap access.roles.manage` | planned |  |
| ACC-462 | Capability `access.audit.read` allows: Read the access log | custom role (access.audit.read) | The operation succeeds and the matching page parts are shown | `cap access.audit.read` | planned |  |
| ACC-463 | Capability `access.audit.read` absent | staff1 | 403 `forbidden`; log page forbidden | `cap access.audit.read` | planned |  |
| ACC-464 | Capability `settings.branding.manage` allows: Read and change branding colours | it_admin | The operation succeeds and the matching page parts are shown | `cap settings.branding.manage` | planned |  |
| ACC-465 | Capability `settings.branding.manage` absent | staff1 | 403 `forbidden`; branding card hidden | `cap settings.branding.manage` | planned |  |
| ACC-466 | Capability `settings.company.read` allows: Read the company profile and regions | custom role (settings.company.read) | The operation succeeds and the matching page parts are shown | `cap settings.company.read` | planned |  |
| ACC-467 | Capability `settings.company.read` absent | staff1 | 403 `forbidden`; company page forbidden | `cap settings.company.read` | planned |  |
| ACC-468 | Capability `settings.company.manage` allows: Edit the company profile and logo | it_admin | The operation succeeds and the matching page parts are shown | `cap settings.company.manage` | planned |  |
| ACC-469 | Capability `settings.company.manage` absent | custom role (settings.company.read) | 403 `forbidden`; fields disabled | `cap settings.company.manage` | planned |  |
| ACC-470 | Capability `settings.maintenance.manage` allows: Read and change maintenance windows | it_admin | The operation succeeds and the matching page parts are shown | `cap settings.maintenance.manage` | planned |  |
| ACC-471 | Capability `settings.maintenance.manage` absent | staff1 | 403 `forbidden`; card hidden | `cap settings.maintenance.manage` | planned |  |
| ACC-472 | Dependency: a custom role cannot hold a capability without its dependencies | it_admin | Saving `access.users.read`-dependent keys without the base key is refused `missing_dependency`; the form selects the base automatically | `cap access.roles.read` | planned |  |
| ACC-473 | Built-in role grants | it_admin | `system_admin` holds all twelve keys; `employee` holds none; `vendor_support` holds the system keys and cannot be assigned | `cap access.roles.manage` | planned |  |
| ACC-474 | Access capabilities cannot be put in a custom role | it_admin | The five sensitive access keys are absent from the custom-role form and refused by the API `custom_role_permission_forbidden` | `cap access.users.grant` | planned |  |
| ACC-475 | Company scope only | it_admin | Every assignment is company-scoped; other scope kinds are refused `unsupported_scope` | `cap access.users.assign_roles` | planned |  |

## Notifications and audit entries

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-476 | Affected user is told about access changes | staff1 | When an administrator changes roles, resets the password or disables the account, no bell notification or mail reaches the user today |  | decision | no `_webvue_deliver` call in the access flows; owner to decide whether the user should be notified |
| ACC-477 | Audit catalog: user.granted | it_admin | Written once on create and employee grant, target user, `after.active` true | `GET /api/v1/admin/access-log` | planned |  |
| ACC-478 | Audit catalog: user.roles_changed | it_admin | Written only when assignments differ; before/after hold role id, key and scope | `GET /api/v1/admin/access-log` | planned |  |
| ACC-479 | Audit catalog: user.disabled / user.reactivated / user.password_reset | it_admin | One event each with the before/after state; reset records `sessions_revoked` | `GET /api/v1/admin/access-log` | planned |  |
| ACC-480 | Audit catalog: user.employee_linked / employee.archived_access_disabled | hr_manager | Link and archive events carry the employee id | `GET /api/v1/admin/access-log` | planned |  |
| ACC-481 | Audit catalog: role.created / updated / disabled / enabled / deleted | it_admin | Each role action writes one event; create and clone share `role.created` | `GET /api/v1/admin/access-log` | planned |  |
| ACC-482 | Audit catalog: branch.policy_changed / user.branch_roles_changed | it_admin | Policy and delegation changes carry before and after | `GET /api/v1/admin/access-log` | planned |  |
| ACC-483 | Audit catalog: migration.legacy_admin_preserved | it_admin | Shows «الإبقاء على مسؤول قديم» with no actor for administrators kept by the migration | `GET /api/v1/admin/access-log` | planned |  |
