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
| ACC-03 | Invite a user by email with roles | it_admin | 201; the account has no password and shows a pending invitation; an invitation mail goes to the address; access log `user.invited` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); The user opens the emailed link, saves a mobile number and a password of 12 characters or more, then signs in with the given roles |
| ACC-06 | Send a user a password reset link | it_admin | The user gets an emailed link and chooses the new password; the old password works until then; log `user.reset_link_sent`, then `user.password_reset` once the link is used | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); An account with a pending invitation answers 409 `invitation_pending`: resend the invitation instead |
| ACC-12 | Disable the last access administrator | it_admin | Refused `last_access_admin` | `POST /api/v1/admin/users/<id>/disable` | planned | round 3 final: unreachable by construction. Only the built-in system_admin role holds access.users.disable (custom roles may not hold it: custom_role_permission_forbidden) and it also holds assign_roles, so the acting administrator always counts as the surviving one; the target must be in the actor's own company; self-change answers 422 self_access_change. Legacy admins also keep the root company an administrator; round 2: not runnable: legacy admins (e2e_admin, admin) always remain, so last_access_admin is unreachable without disabling a seeded persona |
| ACC-13 | Vendor support user is untouchable | it_admin | Refused `protected_user` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); Was 403 protected_user on the removed password route |
| ACC-14 | System admin manages access but cannot write HR or project records | it_admin | HR and project write actions absent or refused | `cap access.users.assign_roles` | automated | `e2e/tests/access-matrix.e2e.ts`: it_admin refused on /hr/employees/new and /projects/new |
| ACC-16 | Built-in role descriptions in Arabic | it_admin | Arabic text next to Arabic names | `page /settings/team/roles` `GET /api/v1/admin/roles` | fail | #139; Known bug, `e2e/tests/bugs/roles-builtin-descriptions-english.e2e.ts` |
| ACC-18 | Create a branch (child company) and move a user to it | it_admin | Branch user sees branch data only | `page /settings/team/branches` `PATCH /api/v1/admin/users/<id>/branches` | planned | round 3 final: a branch (child company) and its membership can only be created from the Odoo shell (no UI/API); with shell-made membership the delegation flow was run instead (see ACC-309, ACC-311, ACC-312, ACC-295, ACC-319) and root-company users see no branch data without explicit branch roles; round 2: not runnable: branch membership cannot be granted (it_admin and created users belong to no branch; branch users hold only their own branch; no UI/API adds a membership); policy writes are shared state; needs a branch (child) company; none exists on the stack and no UI/API creates one |

## Session, identity (`/me`) and tenant lifecycle

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-31 | Request without a session | every persona | Any `/api/v1/admin/*` and `/api/v1/me*` call without a session cookie is refused (401); no data returned | `GET /api/v1/me` `GET /api/v1/admin/users` | fail | #177; anonymous call to /api/v1/admin/* and /api/v1/me through the web server answers 403 {code: session_required} (dev response also carries a stack), not 401; no data returned |

## Own account pages (`/account`, `/account/settings`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Two-factor sign-in (`/auth/totp`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-67 | Two-factor step for an account that may not sign in | staff1 | 403 `login_refused` | `POST /api/v1/auth/totp` | fail | #197; vendor-support account with TOTP (own user): login step answers {ok:false, mfa:totp}, then POST /api/v1/auth/totp -> 403 code `forbidden` with the raw Odoo English message «Sorry, Public user (id=3) doesn't have 'read' access to: User (res.users)…» instead of 403 `login_refused`; see findings3/access.md; not run: needs a pending two-factor login (no TOTP account on the stack) |

## Settings overview and navigation

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Users list (`/settings/team/users`, GET /api/v1/admin/users)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-87 | Search by name or login | it_admin | `q` matches name or login, case-insensitive; the URL keeps `?q=` | `page /settings/team/users` `GET /api/v1/admin/users` | fail | #176; typing in the search box filters the list live but the URL only gets ?q= after pressing Enter; refresh after typing loses the query. Direct link ?q= restores correctly |
| ACC-107 | Bad role in the URL does not crash the page | it_admin | `?role_id=abc` yields no filter; no error screen | `page /settings/team/users` | fail | #176; /settings/team/users?role_id=abc shows the generic error «حدث خطأ غير متوقع» with retry (API answers 422 role_id must be an integer); expected: parameter ignored |

## Invite a user (`/settings/team/users/new`, POST /api/v1/admin/users)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-110 | Invite with a valid name, login and roles | it_admin | 201; the panel says «أرسلنا دعوة إلى …»; the user page shows the pending invitation, roles and capabilities; access log `user.invited` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); The form has no password field |
| ACC-111 | Submit stays disabled until the form is valid | it_admin | Disabled while name/login empty, login not an email («اكتب بريدًا إلكترونيًا صحيحًا.») or no role chosen | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); The password fields and the confirmation are gone |
| ACC-115 | The form keeps its values after a failed send | it_admin | An error banner shows (for example «يوجد حساب بهذا البريد مسبقًا.») and the entered name, login and roles stay | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); Replaces the cleared-password check |
| ACC-119 | A password key is refused | it_admin | 422 `invalid` naming `password`; an administrator never supplies a password | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); Replaces the weak-password check |
| ACC-129 | Invited account audit | it_admin | One `user.invited` event with actor, target name and no password or token in before/after | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |

## User page (`/settings/team/users/[id]`, GET /api/v1/admin/users/<id>)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-145 | Allowed actions reflect capabilities and state | it_admin | `assign_roles`, `send_reset_link` and `disable`/`reactivate` appear per capability; a pending invitation adds `resend_invitation`, `edit_invitation` and `cancel_invitation`; a user never gets `disable` on self | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |

## Edit a user's roles (`/settings/team/users/[id]/access`, PATCH /api/v1/admin/users/<id>/access)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-157 | Remove the last access administrator's admin role | it_admin | 409 `last_access_admin`; roles unchanged | `PATCH /api/v1/admin/users/<id>/access` | planned | round 3 final: unreachable by construction. Only the built-in system_admin role holds access.users.disable (custom roles may not hold it: custom_role_permission_forbidden) and it also holds assign_roles, so the acting administrator always counts as the surviving one; the target must be in the actor's own company; self-change answers 422 self_access_change. Legacy admins also keep the root company an administrator; own role removal 422 self_access_change; round 2: see ACC-12; own admin role removal answers 422 self_access_change (observed on an own temporary admin) |
| ACC-168 | Locale message for `self_access_change` and `role_disabled` | it_admin | Arabic message shown | `PATCH /api/v1/admin/users/<id>/access` | gap | #140; access.errors in ar/access.json has no key for these codes; the raw code is displayed |

## Account security: reset link, disable, reactivate (`/settings/team/users/[id]/security`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-169 | Open the security page | it_admin | The reset-link button «إرسال رابط إعادة تعيين» and the disable button with the hint «يُبطل الجلسات القائمة.»; no password fields | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-170 | Security page read-only | custom role (access.users.read) | Notice «للقراءة فقط»; no buttons | `page /settings/team/users/[id]/security` `cap access.users.read` | fail | users.read-only account opens /settings/team/users/<id>/security: shows the generic forbidden text «ليس لديك صلاحية لعرض هذه الصفحة»; expected the read-only notice «للقراءة فقط» with no buttons (same root cause as #173 / users.read detail 403); #173 |
| ACC-172 | Send a reset link with inline confirmation | it_admin | First click asks inline «تأكيد»; confirm sends the mail; success alert «أرسلنا رابط إعادة التعيين إلى بريد المستخدم» | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); Mocked in `apps/web/e2e/tasmim6-settings-user-forms.spec.ts` up to the confirmation |
| ACC-173 | Reset link effect | it_admin | Using the link sets the new password; the old password and open sessions stop working; log `user.password_reset` with `sessions_revoked` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-174 | One reset mail reaches the user | it_admin | Exactly one mail with the link goes to the user; no other security mail | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); Replaces the no-mail check of the old administrator reset |
| ACC-175 | Short password on the reset page | anonymous | 422 `weak_password` under 12 characters after trim | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-176 | Reset link without the capability | staff1 | 403 `forbidden` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-177 | Reset link for the vendor support user | it_admin | 403 `protected_user` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-178 | Reset link with a stale version | it_admin | 409 `conflict` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-179 | Reset link for a user of another company | it_admin | 404 `not_found` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-180 | Reset link to own account | it_admin | Allowed by the code; own session outcome to be confirmed | `POST /api/v1/admin/users/<id>/reset-link` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; no `self_access_change` guard on reset; owner to confirm |
| ACC-183 | Disable the last access administrator | it_admin | 409 `last_access_admin` | `POST /api/v1/admin/users/<id>/disable` | planned | round 3 final: unreachable by construction. Only the built-in system_admin role holds access.users.disable (custom roles may not hold it: custom_role_permission_forbidden) and it also holds assign_roles, so the acting administrator always counts as the surviving one; the target must be in the actor's own company; self-change answers 422 self_access_change. Legacy admins also keep the root company an administrator; self-disable 422 self_access_change; round 2: see ACC-12 (self-disable answers self_access_change); see ACC-12 |
| ACC-188 | Disable an already-disabled user | it_admin | Route accepts it and writes another `user.disabled` event; the page hides the button | `POST /api/v1/admin/users/<id>/disable` | decision | #159; no inactive guard in _liwan_disable_user |
| ACC-189 | Reactivate a stopped user | it_admin | No password asked; a user who never accepted gets a new invitation, any other a reset link; roles are unchanged; log `user.reactivated` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-190 | Reactivate with a password key | it_admin | 422 `invalid` naming `password` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); Replaces the weak-password check |
| ACC-194 | Reactivate an already-active user | it_admin | Route overwrites the password and logs `user.reactivated` for an active user, so `access.users.disable` alone can set another user's password | `POST /api/v1/admin/users/<id>/reactivate` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; access_service.py `_liwan_reactivate_user` has no inactive check; the UI hides the button |

## Roles list (`/settings/team/roles`, GET /api/v1/admin/roles)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Role page and role forms (`/roles/[id]`, `/roles/new`, `/roles/[id]/edit`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-212 | Open a built-in role | it_admin | Read-only permission list grouped by domain; status/type tags; primary action «نسخ»; no edit, disable or delete | `page /settings/team/roles/[id]` `GET /api/v1/admin/roles/<id>` | fail | #176; built-in role page (system_admin) is read-only with notice, but has no «نسخ» primary action anywhere (only back + tabs); clone exists only as the list row action |
| ACC-231 | Duplicate role name | it_admin | Accepted (no uniqueness check on names) | `POST /api/v1/admin/roles` | decision | #159; two custom roles can share one name; owner to confirm |

## Permission catalog (GET /api/v1/admin/permissions)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Access log (`/settings/team/access-log`, GET /api/v1/admin/access-log)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-288 | Events never contain secrets | it_admin | After invite and reset, no event holds a password, token or hash in before/after | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-290 | Company profile, branding and maintenance changes are not in the log | it_admin | Expected: an event for each change, or a documented choice that they are not access events | `page /settings/team/access-log` | decision | #159; no `_liwan_log` call in company/branding/maintenance writes; `company` target type is used only by branch policy |

## Branch access policy (`/settings/team/branches`, `/api/v1/admin/access/branches`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-294 | Mode isolated | it_admin | Requests are limited to the current company; branch memberships grant nothing; branch data is absent from lists | `PATCH /api/v1/admin/access/branches` | planned | round 3 final: needs the mode switched to isolated (shared company-wide policy, forbidden while other agents run); not run; round 2: not runnable: branch membership cannot be granted (it_admin and created users belong to no branch; branch users hold only their own branch; no UI/API adds a membership); policy writes are shared state; needs a branch (child) company; none exists on the stack and no UI/API creates one; see ACC-19 |
| ACC-296 | Mode inherited | it_admin | Branches marked «السماح بالوراثة في هذا الفرع» give the user the capabilities of the chosen built-in roles held in the root company | `PATCH /api/v1/admin/access/branches` | planned | round 3 final: needs the mode switched to inherited and saved (shared policy); the inherited UI (per-branch «السماح بالوراثة في هذا الفرع» + 11 built-in role checkboxes) was opened without saving; not run; round 2: not runnable: branch membership cannot be granted (it_admin and created users belong to no branch; branch users hold only their own branch; no UI/API adds a membership); policy writes are shared state; needs a branch (child) company; none exists on the stack and no UI/API creates one |
| ACC-304 | No branches | it_admin | «لا توجد فروع ضمن نطاق إدارتك.» | `page /settings/team/branches` | fail | #176; branch policy page with no child companies shows only the policy select and save; the text «لا توجد فروع ضمن نطاق إدارتك.» is not shown |
| ACC-308 | Branch creation from the customer UI | it_admin | Administrator can create a branch company |  | gap | #155; no page or route creates a branch; `res.company` create is limited to Odoo system administrators |

## User branch delegation (`/settings/team/users/[id]/branches`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Employee accounts (`liwan_access_hr`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-331 | Invite an employee | it_admin | 201 with the user payload; the user is linked to the employee file and uses the employee's contact; the invitation goes to the login; log `user.invited` then `user.employee_linked` | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-340 | Password key, bad assignments, extra field | it_admin | 422 `invalid` (a `password` key is unknown) / `invalid` / `unsupported_scope` as for user creation | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-346 | Archive the employee of the last access administrator | hr_manager | Refused 409 `last_access_admin` |  | planned | round 3 final: needs a user that is the last access administrator, unreachable (see ACC-12), and archiving an employee also needs a confirmed end-of-service settlement; round 2: see ACC-12 (legacy admins keep the company an administrator); not run: archiving an employee first needs a confirmed end-of-service settlement (payroll flow); not built in this run |
| ACC-347 | Archive an employee whose account is already disabled | hr_manager | Archive succeeds; check whether a duplicate event is written |  | decision | #159; _liwan_disable_employee_account has no inactive guard |
| ACC-349 | Candidates expose HR data under account-grant rights | it_admin | Names, departments and work emails are returned to a holder of `access.users.grant` without `hr.employees.read` | `GET /api/v1/admin/employee-accounts/candidates` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; raw SQL below the HR ACLs by design; owner to confirm |

## Company profile (`/settings/company`, `/api/v1/admin/company`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-384 | Company profile edits are for the session company only | it_admin | A branch session edits the branch's own profile; a payload `company_id` is rejected as not writable | `PATCH /api/v1/admin/company` | fail | #176; PATCH /admin/company {company_id:2} answers 404 not_found «Record does not exist», not 422 «field is not writable» |

## Branding (`هوية` card, `/api/v1/admin/branding`, public `/api/v1/branding`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-388 | Pick a preset | it_admin | Colour field fills and the form becomes dirty | re-run needed date kept in notes | planned | re-run needed 2026-10-30 (default colour changed); preset «أزرق»: field #5b3f8c -> #0055ff; save button disabled=false |
| ACC-389 | Reset to default | it_admin | «إعادة اللون الافتراضي» sets the default lavender; saved only on submit | re-run needed date kept in notes | planned | re-run needed 2026-10-30 (default colour changed); reset to default -> field #5b3f8c; saved value still #5b3f8c (not saved until submit) |
| ACC-390 | Cancel changes | it_admin | Colour returns to the saved value | re-run needed date kept in notes | planned | re-run needed 2026-10-30 (default colour changed); cancel -> field #5b3f8c, saved #5b3f8c |
| ACC-400 | Public branding default colour | every persona | A tenant without a saved colour returns `#5b3f8c` | re-run needed date kept in notes | planned | re-run needed 2026-10-30 (default colour changed); public branding default colour is #5b3f8c (checked after restoring) |
| ACC-402 | Public branding when the tenant has no profile | every persona | A clean not-found answer is expected, not a server error | `GET /api/v1/branding` | planned | round 3 final: needs the tenant profile record deleted, which breaks the whole shared stack and cannot be restored safely; exclusive phase: not run: needs the tenant profile record deleted, which would break the whole shared stack (no safe way to restore it); round 2: not runnable: needs data or state that cannot be built without changing seeded personas, a feature switch or a control-plane notice; route has no api_handler; raises MissingError |

## Maintenance windows (`/settings/system#maintenance`, `/api/v1/admin/maintenance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-420 | Book with the preference but none saved | it_admin | 422 «Save a preferred maintenance window first.» | `POST /api/v1/admin/maintenance/bookings` | planned | round 3 final: needs a tenant without a saved preference; the preference cannot be deleted (no API, and the DB refuses because maintenance events reference it; removing the history would destroy audit evidence); not run: no published maintenance release notices on the stack (they come from the control plane) |

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
| ACC-477 | Audit catalog: user.invited | it_admin | Written once on invite and employee invite, target user, `after.active` true | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |

## Account invitations (`/join`, `/forgot-password`, `/reset-password`, `/account/mobile`)

An administrator never types a password. The invited user chooses it from an emailed link; the mobile number is required before any other route answers (`403 mobile_required`). Mocked journeys: `apps/web/e2e/account-invitations.spec.ts`.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-484 | Accept an invitation | invited user | The link opens `/join`; mobile and a password of 12+ characters are saved; the user is signed in and lands on the home page | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); The page sends no referrer and is never cached |
| ACC-485 | Expired or reused invitation link | invited user | The page says the link no longer works and points to the administrator | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-486 | Resend, change the email of and cancel an invitation | it_admin | Resend mails a fresh link and kills the old one; changing the email mails the new address; cancel archives the account and frees the seat | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-487 | Forgot password | any user | The answer is the same for a known and an unknown address; a known one gets a mail with a link | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-488 | Choose a new password from the link | any user | A password of 12+ characters ends the other sessions; the link works once | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); |
| ACC-489 | Account without a mobile number | existing user | Every route but `/me`, `/me/mobile` and `/me/password` answers 403 `mobile_required` and the UI opens `/account/mobile`; saving a number unlocks the app | re-run needed date kept in notes | planned | re-run needed 2026-11-06 (account invitations); A number another active user holds answers 409 `mobile_taken` |
