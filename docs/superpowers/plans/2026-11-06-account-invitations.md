# Account Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace administrator-typed passwords with emailed, single-use links (invite and reset), add a self-service forgot-password flow, and give every account a mobile number entered by its holder.

**Architecture:** `liwan_core` owns a small token model (hash only), the account mail sender (stock `ir.mail_server` from `base`) and the new service methods on `liwan.access.service`. `liwan_api` exposes the admin routes, the anonymous `/api/v1/public/account/*` routes and the mobile gate; `liwan_access_hr` switches the employee grant to the invite path. The Nuxt app replaces the password fields with the invite flow and adds the accept, forgot, reset and mobile pages. Provisioning creates the one outgoing mail server from deployment secrets.

**Tech Stack:** Odoo 19 Community (Python), Nuxt 4 + Nuxt UI v4 (Vue/TS), zod contracts in `packages/contracts`, bash provisioning, Caddy edge.

**Spec:** `docs/superpowers/specs/2026-11-06-account-invitations-design.md` (read it with this plan).

## Global Constraints

- Invite link valid 72 hours; reset link valid 60 minutes; single use; a new link of the same purpose for the same user revokes the previous one.
- Token: 32 random bytes, `secrets.token_urlsafe(32)`; stored only as `hashlib.sha256(token).hexdigest()`; compared with `hmac.compare_digest`. The raw token exists only in the outgoing email.
- Password minimum 12 characters everywhere (`MIN_PASSWORD_LENGTH = 12` in `liwan_api/controllers/common.py`, and the zod `PasswordInputSchema`).
- Mobile: E.164, `^\+[1-9]\d{7,14}$`, default country `+966` in the UI; unique among active users (pending invitees included, archived excluded); required for every internal user except `base.user_root` and `liwan_core.group_vendor_support` members.
- Mobile visibility: only `access.users.read` holders (admin user shapes) and the account holder (`/api/v1/me`). Never in `/api/v1/people`, directory, HR serializers or assistant context.
- Forgot-password always answers `202 {}` whatever the email; at most 3 reset links per user per hour; edge rate limit on `/api/v1/public/account/`.
- Sender `no-reply@liwanos.com`, display name `ليوان | LiwanOS`; Arabic first, then English; HTML plus plain text.
- No `password` key on any admin route or contract. Remove dead code, locale keys, stories and tests with it (repository rule: replace, do not layer).
- Odoo tests on a fresh scratch database only, never `odoo19`. New `sudo()` cases registered in `tools/arch_documented_sudo.json` with a reason naming the call and the blocking ACL.
- Public routes: `type='json2'`, `auth='public'`, `save_session=False`, listed in `tools/route_gate_allowlist.json` with a reason.
- `liwan_core` keeps `depends: ['base']`. Bump `liwan_core`, `liwan_api`, `liwan_access_hr` versions per `docs/migrations.md`.

## Review Focus

1. A token used twice, after revocation, after expiry, or for the other purpose (invite token on the reset route) must fail with the same 404 `invalid_token`. Tested in Task 1.
2. Two administrators editing or resending the same pending invitation concurrently: the stale one gets 409 `stale_version`, and exactly one link stays usable. Tested in Task 2.
3. The mobile gate must not lock out the vendor support user, the root user, or the mobile-save route itself, and must answer `mobile_required` (not 500) for JSON routes. Tested in Task 2.
4. Accepting an invitation whose user was archived (cancelled) between send and click fails with `invalid_token` and does not reactivate the user. Tested in Task 1.
5. SMTP down at send time: the admin action still succeeds, the user shows `delivery: failed`, and resend works once SMTP is back. Tested in Task 1 (sender stubbed to raise).

---

### Task 1: Core token, mail sender, account service (`liwan_core`)

**Files:**
- Create: `odoo-addons/liwan_core/models/account_token.py`
- Create: `odoo-addons/liwan_core/models/account_mail.py`
- Modify: `odoo-addons/liwan_core/models/__init__.py`, `odoo-addons/liwan_core/models/access_service.py` (`_liwan_create_account`, `_liwan_reset_password`, `_liwan_reactivate_user`), `odoo-addons/liwan_core/models/res_users.py` (field + protected-write allow-list), `odoo-addons/liwan_core/security/ir.model.access.csv`, `odoo-addons/liwan_core/__manifest__.py` (version)
- Test: `odoo-addons/liwan_core/tests/test_account_invitations.py` (import it in `tests/__init__.py`)

**Interfaces:**
- Produces model `liwan.account.token`: fields `user_id` (m2o res.users, required, ondelete cascade), `purpose` (selection `invite`/`reset`), `token_hash` (char, indexed unique), `expires_at`, `consumed_at`, `revoked_at` (datetimes), `delivery` (selection `pending`/`sent`/`failed`), `sent_at`. ACL: system only (`base.group_system`); all access goes through the service.
- Produces field `res.users.liwan_mobile` (Char, copy=False) with `models.UniqueIndex('(liwan_mobile) WHERE active AND liwan_mobile IS NOT NULL')`.
- Produces on `liwan.access.service`:
  - `_liwan_invite_account(name: str, login: str, assignments: list, partner_id: int | False = False) -> res.users` (replaces `_liwan_create_account`; creates the user with no password, issues an invite).
  - `_liwan_resend_invitation(user, expected_version) -> res.users`
  - `_liwan_change_invitation_login(user, login: str, expected_version) -> res.users` (pending users only; else 409 `invitation_not_pending`)
  - `_liwan_cancel_invitation(user, expected_version) -> res.users` (archives; pending users only)
  - `_liwan_send_reset_link(user, expected_version) -> res.users` (replaces `_liwan_reset_password`)
  - `_liwan_reactivate_user(user, expected_version) -> res.users` (no password; sends a reset link)
  - `_liwan_invitation_state(user) -> dict` → `{'state': 'pending'|'expired'|None, 'delivery': 'pending'|'sent'|'failed'|None, 'sent_at': str|None, 'expires_at': str|None}`; `None` state once a password exists.
  - `_liwan_accept_invitation(token: str, mobile: str, password: str) -> res.users` (public; sets password and mobile, consumes token, revokes sessions)
  - `_liwan_request_password_reset(email: str) -> None` (public; silent when unknown, archived, protected or over 3/hour)
  - `_liwan_reset_password_with_token(token: str, password: str) -> res.users` (public; consumes, revokes sessions)
  - `_liwan_token_usable(token: str, purpose: str) -> bool`
  - `_liwan_set_own_mobile(mobile: str) -> res.users` (current user)
  - `_liwan_mobile_required(user) -> bool`
  - `_liwan_normalize_mobile(value) -> str` raising `LiwanAccessRule('invalid_mobile', field='mobile', status=422)`; duplicate → `LiwanAccessRule('mobile_taken', field='mobile', status=409)`.
  - Errors: bad/expired/used/revoked token → `LiwanAccessRule('invalid_token', status=404)`; short password → `LiwanAccessRule('weak_password', field='password', status=422)`.
- Produces in `account_mail.py`: `liwan.account.mail` (AbstractModel) `_liwan_send(token_record, raw_token: str)` — builds the URL from `web.base.url` (`/join?token=` for invite, `/reset-password?token=` for reset), renders AR+EN subject/text/html, sends with `ir.mail_server.build_email` + `send_email`, registered with `self.env.cr.postcommit.add`; on any send exception it writes `delivery='failed'` in a fresh cursor and logs without the token.

- [ ] **Step 1: Write the failing tests** in `test_account_invitations.py` (a `TransactionCase` with an access admin who holds `access.users.grant`, `access.users.reset_password`, `access.users.disable`; stub `liwan.account.mail._liwan_send` to capture `(token_record, raw_token)`):
  - `test_invite_creates_passwordless_active_user_holding_a_seat`: user active, `password` empty in DB, `_liwan_count_users()` +1, one `invite` token `delivery='pending'`, captured raw token hashes to the stored hash.
  - `test_accept_sets_password_and_mobile_once`: accept with `+966500000001` and a 12-char password → user can authenticate (`_check_credentials`), `liwan_mobile == '+966500000001'`, token `consumed_at` set; second accept raises `invalid_token`.
  - `test_resend_and_login_change_revoke_previous_link`: old token → `invalid_token`; new token works; login change updates `login` and `email` only.
  - `test_cancel_archives_and_frees_seat_and_kills_link`; `test_accept_after_cancel_fails_and_keeps_user_archived`.
  - `test_reinvite_same_email_reactivates_archived_row` (no second user).
  - `test_expired_invite_keeps_seat_and_reports_expired` (move `expires_at` back): state `expired`, seat still counted, accept → `invalid_token`.
  - `test_reset_token_rejected_on_accept_and_invite_token_rejected_on_reset`.
  - `test_forgot_password_silent_for_unknown_and_rate_limited`: unknown email sends nothing and raises nothing; 4th request within an hour sends nothing.
  - `test_reset_with_token_revokes_other_sessions` (session token changes via `_compute_session_token`).
  - `test_weak_password_and_bad_mobile_and_duplicate_mobile`: 11 chars → `weak_password`; `0500` → `invalid_mobile`; second user same mobile → `mobile_taken`; an archived user's mobile does not block.
  - `test_mobile_required_rules`: true for a user without mobile; false for `base.user_root` and a vendor-support member.
  - `test_send_failure_marks_delivery_failed` (stub raises inside the postcommit path) and the invite call itself succeeds.
  - `test_no_raw_token_at_rest`: no column of `liwan_account_token` contains the raw token.
- [ ] **Step 2: Run them and confirm they fail**
  Run (from `/Users/tariq/code/odoo`, scratch DB per `docs/agents/odoo-rules.md`): `python3 odoo-bin -d liwan_inv_t1 --addons-path=<odoo addons>,<worktree>/odoo-addons -i liwan_core --test-tags /liwan_core:TestAccountInvitations --stop-after-init --http-port=8198`
  Expected: errors for missing model/methods.
- [ ] **Step 3: Implement** the model, mail sender and service methods with the interfaces above. Reuse the existing version check, scope assert, audit log (`user.invited`, `user.invitation_resent`, `user.invitation_login_changed`, `user.invitation_cancelled`, `user.reset_link_sent`, `user.password_set`), `_liwan_bump_policy` and the protected-write path (`_liwan_access_create` / `_liwan_access_write`). Public methods run as the public user: the token lookup and the user write need elevation; register each `sudo()` with its reason. Delete `_liwan_create_account` and `_liwan_reset_password`; update every caller in `liwan_core`.
- [ ] **Step 4: Run the tests again** — Expected: all pass. Also run `python3 -B tools/sudo_gate.py` and `python3 -B tools/arch_policy.py` from the worktree — Expected: exit 0.
- [ ] **Step 5: Commit** `feat(core): invite accounts by email and self-set passwords`

### Task 2: API routes, mobile gate, HR grant (`liwan_api`, `liwan_access_hr`)

**Files:**
- Modify: `odoo-addons/liwan_api/controllers/access_admin.py`, `odoo-addons/liwan_api/controllers/me.py`, `odoo-addons/liwan_api/controllers/common.py` (`MIN_PASSWORD_LENGTH = 12`, mobile gate inside `api_handler`), `odoo-addons/liwan_api/serializers/access.py` (`dump_admin_user`), `odoo-addons/liwan_api/serializers/user.py` (`dump_me`), `odoo-addons/liwan_access_hr/controllers/employee_accounts.py`, `odoo-addons/liwan_access_hr/models/access_service.py`, `tools/route_gate_allowlist.json`, `tools/arch_documented_sudo.json`, both manifests (version)
- Create: `odoo-addons/liwan_api/controllers/account_public.py`
- Test: `odoo-addons/liwan_api/tests/test_account_invitation_routes.py`, `odoo-addons/liwan_access_hr/tests/test_employee_account_invite.py` (imported in each `tests/__init__.py`)

**Interfaces:**
- Consumes: Task 1 service methods.
- Produces routes (all errors use the existing structured shape):
  - `POST /api/v1/admin/users` body exactly `{name, login, assignments}` → 201 admin user.
  - `GET /api/v1/admin/users/seats` (`access.users.grant`) → `{used: int, limit: int|null}` from `liwan.entitlement.service` (`_liwan_count_users`, `_liwan_limit_value('users.limit')`).
  - `POST /api/v1/admin/users/<id>/invitation/resend` `{expected_version}`; `PATCH /api/v1/admin/users/<id>/invitation` `{login, expected_version}`; `POST /api/v1/admin/users/<id>/invitation/cancel` `{expected_version}` → admin user.
  - `POST /api/v1/admin/users/<id>/reset-link` `{expected_version}` → admin user (replaces `/password`, which is deleted).
  - `POST /api/v1/admin/users/<id>/reactivate` `{expected_version}`.
  - `POST /api/v1/admin/employee-accounts` `{employee_id, login, assignments}` (login prefilled by the UI from the work email; HR work email never rewritten).
  - Public: `POST /api/v1/public/account/token` `{token, purpose}` → `{usable: bool}`; `POST /api/v1/public/account/invitation/accept` `{token, mobile, password}` → `{login}`; `POST /api/v1/public/account/password/forgot` `{email}` → 202 `{}`; `POST /api/v1/public/account/password/reset` `{token, password}` → `{login}`.
  - `PATCH /api/v1/me/mobile` `{mobile}` → `dump_me`.
  - `dump_admin_user` adds `mobile: str|null` and `invitation: {state, delivery, sent_at, expires_at}|null`; `allowed_actions` replaces `reset_password` with `send_reset_link` and adds `resend_invitation`, `edit_invitation`, `cancel_invitation` for pending users.
  - `dump_me` adds `mobile: str|null` and `mobile_required: bool`.
  - Gate: when `_liwan_mobile_required(request.env.user)`, `api_handler` answers 403 `mobile_required` for every authenticated route except `GET /api/v1/me`, `PATCH /api/v1/me/mobile`, `POST /api/v1/me/password` and the auth logout route.

- [ ] **Step 1: Write the failing route tests** (extend `LiwanApiCase`):
  - `test_create_rejects_password_key` → 422 `invalid` field `password`; `test_create_returns_pending_invitation`.
  - `test_seats_reports_used_and_limit`; `test_create_at_limit_refused` (existing quota error code).
  - `test_resend_edit_cancel_routes` incl. `test_concurrent_resend_stale_version` (second call with the old version → 409 `stale_version`; only one token usable).
  - `test_reset_link_route_and_old_password_route_gone` (`/password` → 404).
  - `test_public_routes_need_no_session_and_set_no_cookie`; `test_forgot_answers_202_for_unknown_email`; `test_accept_wrong_purpose_token_404`.
  - `test_mobile_gate_blocks_other_routes_but_not_me_mobile_password_logout`; `test_mobile_gate_skips_root_and_vendor_support`.
  - `test_mobile_hidden_from_people_and_directory` (`GET /api/v1/people?q=` items carry no `mobile` key).
  - HR: `test_employee_grant_sends_invite_and_keeps_work_email`; `test_employee_grant_rejects_password_key`.
- [ ] **Step 2: Run and confirm they fail** — `--test-tags /liwan_api:TestAccountInvitationRoutes,/liwan_access_hr:TestEmployeeAccountInvite` with `-i liwan_api,liwan_access_hr`.
- [ ] **Step 3: Implement** the routes, serializers, gate and HR change; delete `parse_password` from `access_admin.py` if unused; add the allow-list and sudo-registry entries.
- [ ] **Step 4: Run the tests, `python3 -B tools/sudo_gate.py`, `python3 -B tools/arch_policy.py`, and the existing access suites** (`/liwan_api:TestAccessAdmin*`, `/liwan_access_hr`) — Expected: all pass.
- [ ] **Step 5: Commit** `feat(api): account invitation, reset link and mobile routes`

### Task 3: Contracts and web (`packages/contracts`, `apps/web`)

**Files:**
- Modify: `packages/contracts/src/access/access.ts`, `packages/contracts/src/access/employeeAccounts.ts`, the `Me` schema file in `packages/contracts/src` (find with `rg -n "MeSchema" packages/contracts/src`), their `__tests__`
- Create: `packages/contracts/src/access/accountPublic.ts` (+ test)
- Modify: `apps/web/app/composables/useAdminUsers.ts`, `apps/web/app/composables/useEmployeeAccounts.ts`, `apps/web/app/pages/settings/team/users/new.vue`, `apps/web/app/pages/settings/team/users/[userId]/index.vue`, `.../[userId]/security.vue`, the users list page, `apps/web/app/pages/login.vue`, the `ar` and `en` locale files of the owning namespaces, related stories and unit tests, the mock API handlers used by Playwright
- Create: `apps/web/app/pages/join.vue`, `apps/web/app/pages/forgot-password.vue`, `apps/web/app/pages/reset-password.vue`, `apps/web/app/pages/account/mobile.vue`, `apps/web/app/composables/useAccountPublic.ts`, a global route middleware that sends a signed-in user with `me.mobile_required` to `/account/mobile`

**Interfaces:**
- Consumes: Task 2 routes and shapes exactly.
- Produces zod: `MobileSchema` (E.164 regex above), `PasswordInputSchema` (≥12), `AdminUserInvitationSchema`, `AdminUserSchema` (+`mobile`, `invitation`), `GrantAccountInputSchema` `{name, login, assignments}`, `InvitationLoginInputSchema`, `VersionOnlyInputSchema`, `SeatUsageSchema` `{used, limit}`, `EmployeeAccountInputSchema` `{employee_id, login, assignments}`, `AccountTokenCheckInputSchema`, `AcceptInvitationInputSchema` `{token, mobile, password}`, `ForgotPasswordInputSchema` `{email}`, `TokenPasswordResetInputSchema` `{token, password}`, `MeSchema` (+`mobile`, `mobile_required`). Delete `ResetPasswordInputSchema` and the `password` member of `ChangeUserStateInputSchema`.
- UI behavior from the spec Goals 1–6: seat line "هذا المستخدم رقم N من M في اشتراكك" before sending (from `/seats`; hidden when `limit` is null), confirmation "أرسلنا دعوة إلى <email>", list badges «بانتظار القبول» / «انتهت الدعوة» / «لم تصل الدعوة», detail actions resend / edit email (inline form) / cancel (inline confirmation), security page "إرسال رابط إعادة تعيين", login link «نسيت كلمة المرور؟». Public pages use `layout: false, access: 'public'` like `invite/accept.vue`, check the token on mount, keep the typed values on `unavailable`. Components from Storybook only.

- [ ] **Step 1: Write failing tests**: contract schema tests (password key rejected, mobile regex accepts `+966500000001` rejects `0500000001`, 11-char password rejected); composable tests for the new mutations' URLs and bodies; page tests: `new.vue` has no password input and shows the seat line; `join.vue` submits `{token, mobile, password}`; `forgot-password.vue` shows the same confirmation for any email; middleware redirects when `mobile_required`.
- [ ] **Step 2: Run** `npm test` from the worktree — Expected: the new tests fail.
- [ ] **Step 3: Implement** contracts, composables, pages, middleware, locales, stories, mock handlers; remove the password fields, `useResetAdminUserPassword`, `UserSecurityForm` password parts and their keys.
- [ ] **Step 4: Verify** `npm test` and `cd apps/web && npx nuxt prepare && npm run lint` — Expected: pass. Playwright on the isolated mock stack for the add-user form, `/join`, `/forgot-password`, `/reset-password`, `/account/mobile` in RTL, light and dark.
- [ ] **Step 5: Commit** `feat(web): invite users by email and add mobile number`

### Task 4: Outgoing mail server provisioning (`deploy`)

**Files:**
- Create: `deploy/seed_mail_server.py`
- Modify: `deploy/provision.sh` (call it after install and on a new `--mail-server` mode), the deploy env example, `deploy/OPERATIONS.md`, `deploy/Caddyfile` (rate limit for `/api/v1/public/account/`), `deploy/control-plane/env.example` (`LIWAN_MAIL_*` for OCI), tests in `deploy/test_operations.py` / `deploy/test_edge_rate_limit.py`

**Interfaces:**
- Env: `LIWAN_SMTP_HOST`, `LIWAN_SMTP_PORT` (default 587), `LIWAN_SMTP_USER`, `LIWAN_SMTP_PASSWORD`, `LIWAN_MAIL_FROM` (`ليوان | LiwanOS <no-reply@liwanos.com>`). All optional as a set: when `LIWAN_SMTP_HOST` is empty, provisioning skips mail and prints a warning (non_saas without mail still installs).
- `seed_mail_server.py` (run through `odoo shell` like `seed_public_origin.py`): create or update exactly one `ir.mail_server` named `LiwanOS outbound` with `smtp_encryption='starttls'`, `smtp_authentication='login'`, `from_filter` = the from-address domain; set `ir.config_parameter` `mail.default.from`. The password reaches the script only through the environment, never argv or logs.

- [ ] **Step 1: Write failing tests**: provision calls the seeder with the env present and skips it without; the seeder is idempotent (second run updates, no second record); the Caddy config limits `/api/v1/public/account/*`.
- [ ] **Step 2: Run** `python3 -m pytest deploy/test_operations.py deploy/test_edge_rate_limit.py -q` — Expected: fail.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run the same tests** — Expected: pass.
- [ ] **Step 5: Commit** `feat(deploy): provision the outgoing mail server`

### Task 5: Integration check (orchestrator)

- [ ] Merge the task branches into `codex/core-account-invitations`; run the Odoo suites of `liwan_core`, `liwan_api`, `liwan_access_hr` on one fresh scratch DB, `npm test`, the web type check, `python3 -B tools/arch_policy.py --base origin/main`, and `node tools/jev_review.mjs --base origin/main --task "email account invitations, reset links, mobile numbers"` if present.
- [ ] Independent review per `REVIEW.md` (odoo-reviewer for the addons, reviewer for web).
- [ ] Draft PR with the evidence; the real OCI send waits for the owner's SMTP credentials.
