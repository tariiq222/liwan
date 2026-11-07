# Access, users and roles

Pages: `/settings/team/users` (`new`, `[userId]`, `access`, `branches`, `security`),
`/settings/team/roles` (`new`, `[roleId]`, `edit`), `/settings/team/branches`,
`/settings/team/access-log`, `/settings/company`, `/settings/system`, `/account`, `/account/settings`,
`/hr/employees/[id]/access`.
Owners: `liwan_core`, `liwan_api`, `liwan_access_hr`. Personas and status values: [README](README.md).

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
| ACC-12 | Disable the last access administrator | it_admin | Refused `last_access_admin` | `POST /api/v1/admin/users/<id>/disable` | planned | re-check 2026-11-06: still unreachable by construction on this tenant — only e2e_it_admin holds system_admin (1 administrator), self-disable and self-role-removal both answer 422 self_access_change (verified with its row version), and access.users.disable has custom_role_allowed=false so no custom role can raise a second administrator-only actor; round 3 final: unreachable by construction. Only the built-in system_admin role holds access.users.disable (custom roles may not hold it: custom_role_permission_forbidden) and it also holds assign_roles, so the acting administrator always counts as the surviving one; the target must be in the actor's own company; self-change answers 422 self_access_change. Legacy admins also keep the root company an administrator; round 2: not runnable: legacy admins (e2e_admin, admin) always remain, so last_access_admin is unreachable without disabling a seeded persona |
| ACC-14 | System admin manages access but cannot write HR or project records | it_admin | HR and project write actions absent or refused | `cap access.users.assign_roles` | automated | `e2e/tests/access-matrix.e2e.ts`: it_admin refused on /hr/employees/new and /projects/new |
| ACC-16 | Built-in role descriptions in Arabic | it_admin | Arabic text next to Arabic names | `page /settings/team/roles` `GET /api/v1/admin/roles` | manual 2026-11-06 | re-check 2026-11-06: the UI is Arabic now — /settings/team/roles shows «وصول دعم المورّد لتشغيل البيئة عند الطلب.» and «إدارة حسابات الدخول وإسناد الأدوار وسجل الوصول وإعدادات العلامة.» for the built-in roles, the detail /settings/team/roles/2 «الوصف» row is Arabic, and no English token (System administrator/Employee/Vendor support) appears on either page; the API still returns the stored English description and the localization is client-side (labelFallback.ts builtinRoleDescription), see access-findings.md; #139; Known bug, `e2e/tests/bugs/roles-builtin-descriptions-english.e2e.ts` |
| ACC-18 | Create a branch (child company) and move a user to it | it_admin | Branch user sees branch data only | `page /settings/team/branches` `PATCH /api/v1/admin/users/<id>/branches` | planned | re-check 2026-11-06: no branch can be created on this stack — POST /api/v1/admin/branches answers 409 branch_purchase_required «branches are added through the subscription purchase flow» in commercial mode saas with self_service_available=false, and the page offers only «شراء فرع»; the tenant has 0 child companies, so moving a user to a branch stays unbuildable; round 3 final: a branch (child company) and its membership can only be created from the Odoo shell (no UI/API); with shell-made membership the delegation flow was run instead (see ACC-309, ACC-311, ACC-312, ACC-295, ACC-319) and root-company users see no branch data without explicit branch roles; round 2: not runnable: branch membership cannot be granted (it_admin and created users belong to no branch; branch users hold only their own branch; no UI/API adds a membership); policy writes are shared state; needs a branch (child) company; none exists on the stack and no UI/API creates one |

## Session, identity (`/me`) and tenant lifecycle

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-31 | Request without a session | every persona | Any `/api/v1/admin/*` and `/api/v1/me*` call without a session cookie is refused (401); no data returned | `GET /api/v1/me` `GET /api/v1/admin/users` | manual 2026-11-06 | re-check 2026-11-06: anonymous GET /api/v1/me and /api/v1/admin/users both answer 401 with data.code=session_required «A valid session is required.» and no data, so the 403 the old note reported is gone; the dev response still carries a stack array of absolute server paths (h3 only adds it when debug is on, so a production build does not), recorded as a low-severity development-only note in findings; re-check 2026-11-06: anonymous GET /api/v1/me and /api/v1/admin/users both answer 401 with data.code=session_required «A valid session is required.» and no data; the dev response still carries a stack array with absolute server paths (h3 fills it when debug is on), recorded as a development-only disclosure in access-findings.md; #177; anonymous call to /api/v1/admin/* and /api/v1/me through the web server answers 403 {code: session_required} (dev response also carries a stack), not 401; no data returned |

## Own account pages (`/account`, `/account/settings`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Two-factor sign-in (`/auth/totp`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-67 | Two-factor step for an account that may not sign in | staff1 | 403 `login_refused` | `POST /api/v1/auth/totp` | fail | re-check 2026-11-06: still not reachable on this stack — no seeded or created account has TOTP enabled and /account/settings offers no two-factor enrolment, so no login reaches the MFA step (all 15 persona logins answer mfa: null); POST /api/v1/auth/totp without a pending login answers 401 no_pending_login as designed; the expected 403 login_refused is covered by the code test test_totp_of_a_support_account_without_support_access_is_login_refused; #197; vendor-support account with TOTP (own user): login step answers {ok:false, mfa:totp}, then POST /api/v1/auth/totp -> 403 code `forbidden` with the raw Odoo English message «Sorry, Public user (id=3) doesn't have 'read' access to: User (res.users)…» instead of 403 `login_refused`; see findings3/access.md; not run: needs a pending two-factor login (no TOTP account on the stack) |

## Settings overview and navigation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Users list (`/settings/team/users`, GET /api/v1/admin/users)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-87 | Search by name or login | it_admin | `q` matches name or login, case-insensitive; the URL keeps `?q=` | `page /settings/team/users` `GET /api/v1/admin/users` | manual 2026-11-06 | re-check 2026-11-06: typing «فهد» writes ?q=%D9%81%D9%87%D8%AF without pressing Enter (table filtered to 1 row) and a reload or the direct link restores the same row — the debounced watcher at users/index.vue:69 replaces the old Enter-only write; #176; typing in the search box filters the list live but the URL only gets ?q= after pressing Enter; refresh after typing loses the query. Direct link ?q= restores correctly |
| ACC-107 | Bad role in the URL does not crash the page | it_admin | `?role_id=abc` yields no filter; no error screen | `page /settings/team/users` | manual 2026-11-06 | re-check 2026-11-06: /settings/team/users?role_id=abc renders the list normally, no «حدث خطأ غير متوقع» and 0 retry buttons; queryPositiveInt drops the parameter before the request (the raw API still answers 422 role_id must be an integer); #176; /settings/team/users?role_id=abc shows the generic error «حدث خطأ غير متوقع» with retry (API answers 422 role_id must be an integer); expected: parameter ignored |

## Create a user (`/settings/team/users/new`, POST /api/v1/admin/users)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## User page (`/settings/team/users/[id]`, GET /api/v1/admin/users/<id>)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Edit a user's roles (`/settings/team/users/[id]/access`, PATCH /api/v1/admin/users/<id>/access)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-157 | Remove the last access administrator's admin role | it_admin | 409 `last_access_admin`; roles unchanged | `PATCH /api/v1/admin/users/<id>/access` | planned | re-check 2026-11-06: see ACC-12 — the only administrator is e2e_it_admin and removing its own roles answers 422 self_access_change, so the last_access_admin branch cannot be reached without changing a seeded persona; round 3 final: unreachable by construction. Only the built-in system_admin role holds access.users.disable (custom roles may not hold it: custom_role_permission_forbidden) and it also holds assign_roles, so the acting administrator always counts as the surviving one; the target must be in the actor's own company; self-change answers 422 self_access_change. Legacy admins also keep the root company an administrator; own role removal 422 self_access_change; round 2: see ACC-12; own admin role removal answers 422 self_access_change (observed on an own temporary admin) |
| ACC-168 | Locale message for `self_access_change` and `role_disabled` | it_admin | Arabic message shown | `PATCH /api/v1/admin/users/<id>/access` | gap | #140; access.errors in ar/access.json has no key for these codes; the raw code is displayed |

## Account security: reset password, disable, reactivate (`/settings/team/users/[id]/security`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-170 | Security page read-only | custom role (access.users.read) | Notice «للقراءة فقط»; no buttons | `page /settings/team/users/[id]/security` `cap access.users.read` | manual 2026-11-06 | re-check 2026-11-06: users_reader (access.users.read) opens /settings/team/users/7/security and sees «للقراءة فقط» with zero buttons; the protected Administrator (/users/2/security) shows «حساب محمي ولا يمكن تعديل وصوله من هنا.» with zero buttons; GET /api/v1/admin/users/<id> answers 200 for both, so the old users.read 403 root cause is gone; users.read-only account opens /settings/team/users/<id>/security: shows the generic forbidden text «ليس لديك صلاحية لعرض هذه الصفحة»; expected the read-only notice «للقراءة فقط» with no buttons (same root cause as #173 / users.read detail 403); #173 |
| ACC-180 | Reset own password through the admin route | it_admin | Allowed by the code (no self check); own session outcome to be confirmed | `POST /api/v1/admin/users/<id>/password` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; no `self_access_change` guard on reset; owner to confirm |
| ACC-183 | Disable the last access administrator | it_admin | 409 `last_access_admin` | `POST /api/v1/admin/users/<id>/disable` | planned | re-check 2026-11-06: see ACC-12 — self-disable answers 422 self_access_change (e2e_it_admin, version u9-r5), so disabling the last access administrator cannot be attempted; round 3 final: unreachable by construction. Only the built-in system_admin role holds access.users.disable (custom roles may not hold it: custom_role_permission_forbidden) and it also holds assign_roles, so the acting administrator always counts as the surviving one; the target must be in the actor's own company; self-change answers 422 self_access_change. Legacy admins also keep the root company an administrator; self-disable 422 self_access_change; round 2: see ACC-12 (self-disable answers self_access_change); see ACC-12 |
| ACC-188 | Disable an already-disabled user | it_admin | Route accepts it and writes another `user.disabled` event; the page hides the button | `POST /api/v1/admin/users/<id>/disable` | decision | #159; no inactive guard in _liwan_disable_user |
| ACC-194 | Reactivate an already-active user | it_admin | Route overwrites the password and logs `user.reactivated` for an active user, so `access.users.disable` alone can set another user's password | `POST /api/v1/admin/users/<id>/reactivate` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; access_service.py `_liwan_reactivate_user` has no inactive check; the UI hides the button |

## Roles list (`/settings/team/roles`, GET /api/v1/admin/roles)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Role page and role forms (`/roles/[id]`, `/roles/new`, `/roles/[id]/edit`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-212 | Open a built-in role | it_admin | Read-only permission list grouped by domain; status/type tags; primary action «نسخ»; no edit, disable or delete | `page /settings/team/roles/[id]` `GET /api/v1/admin/roles/<id>` | manual 2026-11-06 | re-check 2026-11-06: /settings/team/roles/2 (system_admin, protected) shows «نسخ» as the primary filled action in the page header (href /settings/team/roles/new?clone=2&returnTo=/settings/team/roles) and clicking it opens the clone form prefilled with «مدير النظام»; heading tags «محمي» «جاهز», permissions grouped by domain, no edit/disable/delete, GET /api/v1/admin/roles/2 allowed_actions=[read]; #176; built-in role page (system_admin) is read-only with notice, but has no «نسخ» primary action anywhere (only back + tabs); clone exists only as the list row action |
| ACC-231 | Duplicate role name | it_admin | Accepted (no uniqueness check on names) | `POST /api/v1/admin/roles` | decision | #159; two custom roles can share one name; owner to confirm |

## Permission catalog (GET /api/v1/admin/permissions)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Access log (`/settings/team/access-log`, GET /api/v1/admin/access-log)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-290 | Company profile, branding and maintenance changes are not in the log | it_admin | Expected: an event for each change, or a documented choice that they are not access events | `page /settings/team/access-log` | decision | #159; no `_liwan_log` call in company/branding/maintenance writes; `company` target type is used only by branch policy |

## Branch access policy (`/settings/team/branches`, `/api/v1/admin/access/branches`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-294 | Mode isolated | it_admin | Requests are limited to the current company; branch memberships grant nothing; branch data is absent from lists | `PATCH /api/v1/admin/access/branches` | planned | re-check 2026-11-06: needs a branch to switch the policy to isolated; there is none (branches: [], mode delegated) and the policy write is shared tenant state, so it was not switched; round 3 final: needs the mode switched to isolated (shared company-wide policy, forbidden while other agents run); not run; round 2: not runnable: branch membership cannot be granted (it_admin and created users belong to no branch; branch users hold only their own branch; no UI/API adds a membership); policy writes are shared state; needs a branch (child) company; none exists on the stack and no UI/API creates one; see ACC-19 |
| ACC-296 | Mode inherited | it_admin | Branches marked «السماح بالوراثة في هذا الفرع» give the user the capabilities of the chosen built-in roles held in the root company | `PATCH /api/v1/admin/access/branches` | planned | re-check 2026-11-06: needs a branch to inherit the chosen built-in roles; the tenant has no child company and the policy write is shared state, so the inherited mode was opened but not saved; round 3 final: needs the mode switched to inherited and saved (shared policy); the inherited UI (per-branch «السماح بالوراثة في هذا الفرع» + 11 built-in role checkboxes) was opened without saving; not run; round 2: not runnable: branch membership cannot be granted (it_admin and created users belong to no branch; branch users hold only their own branch; no UI/API adds a membership); policy writes are shared state; needs a branch (child) company; none exists on the stack and no UI/API creates one |
| ACC-304 | No branches | it_admin | «لا توجد فروع ضمن نطاق إدارتك.» | `page /settings/team/branches` | fail | re-check 2026-11-06: still reproduces — the tenant has 0 child companies (GET /api/v1/admin/access/branches -> branches: []) and /settings/team/branches renders the purchase panel «إضافة فرع / تُضاف الفروع من خلال الاشتراك» plus the preset and policy cards, but never «لا توجد فروع ضمن نطاق إدارتك.»; that string exists only in BranchRoleAssignments.vue (inherited mode), so no empty state renders with no branches; see access-findings.md; #176; branch policy page with no child companies shows only the policy select and save; the text «لا توجد فروع ضمن نطاق إدارتك.» is not shown |
| ACC-308 | Branch creation from the customer UI | it_admin | Administrator can create a branch company |  | gap | #155; no page or route creates a branch; `res.company` create is limited to Odoo system administrators |

## User branch delegation (`/settings/team/users/[id]/branches`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Employee accounts (`liwan_access_hr`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-346 | Archive the employee of the last access administrator | hr_manager | Refused 409 `last_access_admin` |  | planned | re-check 2026-11-06: still needs (a) a user that is the last access administrator, unreachable per ACC-12, and (b) a confirmed end-of-service settlement before an employee can be archived; /hr/employees lists no employee rows for it_admin, so the flow was not started; round 3 final: needs a user that is the last access administrator, unreachable (see ACC-12), and archiving an employee also needs a confirmed end-of-service settlement; round 2: see ACC-12 (legacy admins keep the company an administrator); not run: archiving an employee first needs a confirmed end-of-service settlement (payroll flow); not built in this run |
| ACC-347 | Archive an employee whose account is already disabled | hr_manager | Archive succeeds; check whether a duplicate event is written |  | decision | #159; _liwan_disable_employee_account has no inactive guard |
| ACC-349 | Candidates expose HR data under account-grant rights | it_admin | Names, departments and work emails are returned to a holder of `access.users.grant` without `hr.employees.read` | `GET /api/v1/admin/employee-accounts/candidates` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; raw SQL below the HR ACLs by design; owner to confirm |

## Company profile (`/settings/company`, `/api/v1/admin/company`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-384 | Company profile edits are for the session company only | it_admin | A branch session edits the branch's own profile; a payload `company_id` is rejected as not writable | `PATCH /api/v1/admin/company` | fail | re-check 2026-11-06: still reproduces and is now precise — PATCH /api/v1/admin/company {company_id: 2} answers 404 not_found «السجل غير موجود», because _reject_foreign_company_payload runs before the field whitelist; {company_id: 1} answers 422 «field 'company_id' is not writable» and {bogus: 1} answers 422 field bogus, so only an out-of-set company_id takes the 404 path; see access-findings.md; #176; PATCH /admin/company {company_id:2} answers 404 not_found «Record does not exist», not 422 «field is not writable» |

## Branding (`هوية` card, `/api/v1/admin/branding`, public `/api/v1/branding`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-388 | Pick a preset | it_admin | Colour field fills and the form becomes dirty | `page /settings/company` | manual 2026-11-06 | re-run 2026-11-06: preset «أزرق» sets the field from #5b3f8c to #0055ff and the page save bar appears with its save button enabled, while GET /api/v1/admin/branding stays #5b3f8c until submit; presets rendered: ليوان الافتراضي, أزرق, فيروزي, كهرماني; the seeded tenant's saved colour is still #5b3f8c while the code default is #7843c6 (see ACC-400); re-run needed 2026-10-30 (default colour changed); preset «أزرق»: field #5b3f8c -> #0055ff; save button disabled=false |
| ACC-389 | Reset to default | it_admin | «إعادة اللون الافتراضي» sets the default lavender; saved only on submit | `page /settings/company` | manual 2026-11-06 | re-run 2026-11-06: the «ليوان الافتراضي» preset fills #7843c6 and GET /api/v1/admin/branding still answers #5b3f8c, so the reset is only saved on submit; note the card has no control labelled «إعادة اللون الافتراضي» — the default preset plays that role; re-run needed 2026-10-30 (default colour changed); reset to default -> field #5b3f8c; saved value still #5b3f8c (not saved until submit) |
| ACC-390 | Cancel changes | it_admin | Colour returns to the saved value | `page /settings/company` | manual 2026-11-06 | re-run 2026-11-06: preset «كهرماني» (#b45309) then the page save bar «تراجع» returns the field to #5b3f8c, the saved value (GET /api/v1/admin/branding #5b3f8c), and the bar hides; branding left at #5b3f8c; re-run needed 2026-10-30 (default colour changed); cancel -> field #5b3f8c, saved #5b3f8c |
| ACC-400 | Public branding default colour | every persona | A tenant without a saved colour returns `#5b3f8c` | `GET /api/v1/branding` | planned | re-check 2026-11-06: cannot observe the fallback — no UI or API clears res.company.primary_color (PATCH /admin/branding requires a six-digit colour), and the seeded tenant has #5b3f8c saved, which is exactly the old default, so a saved value and the default are indistinguishable here; the expected value is also stale: the default is #7843c6 (DEFAULT_PRIMARY_COLOR in liwan_api/serializers/company.py:7 and LIWAN_PRIMARY), and public GET /api/v1/branding returns the saved #5b3f8c with Cache-Control public, max-age=300; re-run needed 2026-10-30 (default colour changed); public branding default colour is #5b3f8c (checked after restoring) |
| ACC-402 | Public branding when the tenant has no profile | every persona | A clean not-found answer is expected, not a server error | `GET /api/v1/branding` | planned | re-check 2026-11-06: still needs the liwan.tenant.profile record deleted, which would break the whole shared stack (public /api/v1/branding, the pre-login suspension gates and every company-scoped route) and has no safe restore path; not attempted; round 3 final: needs the tenant profile record deleted, which breaks the whole shared stack and cannot be restored safely; exclusive phase: not run: needs the tenant profile record deleted, which would break the whole shared stack (no safe way to restore it); round 2: not runnable: needs data or state that cannot be built without changing seeded personas, a feature switch or a control-plane notice; route has no api_handler; raises MissingError |

## Maintenance windows (`/settings/system#maintenance`, `/api/v1/admin/maintenance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-420 | Book with the preference but none saved | it_admin | 422 «Save a preferred maintenance window first.» | `POST /api/v1/admin/maintenance/bookings` | planned | re-check 2026-11-06: the 422 «Save a preferred maintenance window first.» cannot be reached on this stack — there are no published maintenance release notices (GET /api/v1/admin/maintenance -> releases total 0, preference null), and the release lookup runs first, so both a usePreference booking and an explicit-time booking answer 404 not_found «لم يُعثر على إشعار الإصدار.»; round 3 final: needs a tenant without a saved preference; the preference cannot be deleted (no API, and the DB refuses because maintenance events reference it; removing the history would destroy audit evidence); not run: no published maintenance release notices on the stack (they come from the control plane) |

## Commercial stub routes (`/api/commercial/v1/*`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Capability matrix (each key allowed and refused)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Notifications and audit entries

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-476 | Affected user is told about access changes | staff1 | When an administrator changes roles, resets the password or disables the account, no bell notification or mail reaches the user today |  | decision | #159; no `_liwan_deliver` call in the access flows; owner to decide whether the user should be notified |
