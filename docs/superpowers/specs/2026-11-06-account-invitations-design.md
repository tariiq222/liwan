# Account invitations, self-set passwords and mobile numbers

Status: design, awaiting owner approval (2026-11-06).

## Why

Today a company administrator creates an employee account by typing the employee's password, then
passes it on outside the system. The administrator therefore knows every employee's password, and
nothing in the tenant sends email. The owner wants every account holder to set their own password
from an emailed link, never seen or typed by anyone else, with mail sent from `no-reply@liwanos.com`.
The owner also wants every account to carry a verified-later mobile number so that mobile OTP sign-in
can be added in a later phase.

## Goals

1. **Invite instead of password.** Adding a user (from the users page and from an HR employee) asks
   for name, email and roles only. The system emails an invitation link; the invitee opens it, enters
   a mobile number and a password, and is signed in. No administrator surface accepts, shows or sets
   another person's password.
2. **Seat awareness before sending.** Before the invitation is sent, the form states which seat this
   is, for example "this user is 7 of 10 in your subscription". At the limit, sending is refused with
   a clear message. A pending invitation holds its seat.
3. **Clear outcome.** After sending, the page confirms "we sent an invitation to <email>". The user
   shows in the list with the state "pending acceptance".
4. **Correcting a wrong email.** While the invitation is pending the administrator can edit the email.
   Editing revokes the old link at once and sends a new invitation to the corrected address. The
   administrator can also resend (new link, old one revoked) or cancel (account removed, seat freed).
5. **Forgot password.** The sign-in page has "forgot password". The user enters their email and
   receives a reset link if an active account exists; the response is identical whether or not it
   exists. The administrator's current "set a new password" action is replaced by "send reset link".
6. **Mobile number for everyone.** Every account has a mobile number in E.164 form (default country
   +966), unique among internal users of the tenant, entered by the account holder on the invitation
   page. Existing users without one are asked for it right after sign-in and cannot continue until it
   is saved. Users can change it later from their account settings. No SMS verification in this phase.
7. **Customer administrator invitation.** The control-plane invitation that already emails a new
   customer's administrator keeps its flow, gains the mobile number field on its accept page, and
   sends from `no-reply@liwanos.com`.

## Non-goals

- SMS or OTP sign-in or verification (later phase; this phase only stores the number).
- Self-service sign-up of new companies (owner decision 2026-10-29: invitation only).
- Inbound mail. The sender address never receives mail (null MX on `liwanos.com`).
- Changing the sign-in identifier: the email stays the login.

## Anti-goals (failure even if it "works")

- Any path where an administrator, support staff or Claude sees or types another user's password.
- A link that still works after it was revoked, replaced, used once, or expired.
- Revealing through the forgot-password form, timing or error codes whether an email has an account.
- A raw token stored anywhere at rest (database, logs, outbox after sending).
- A second, parallel password path kept "just in case" (repository rule: replace, do not layer).
- Mail delivery depending on the control plane (R5: the product runs without it).

## Constraints

- Architecture rules R1–R10 in `AGENTS.md`. `liwan_core` depends on `base` only; the invitation and
  reset service belongs with the account service it extends (`liwan_core` access service, with the HR
  path in `liwan_access_hr`). Odoo `ir.mail_server` and its `build_email`/`send_email` are in `base`,
  so sending needs no new dependency.
- Public routes: the token pages are anonymous, so their API lives in the `/api/v1/public/` namespace
  (owner decision D3): `auth='public'`, `save_session=False`, authorized by the token only, listed in
  `tools/route_gate_allowlist.json` with a reason. Authenticated admin routes keep `json2`,
  `auth='user'`, `api_handler`, capability checks (`access.users.grant`, and the reset capability
  `access.users.reset_password` now meaning "send reset link").
- No new `sudo()` unless unavoidable; any new case is registered in `tools/arch_documented_sudo.json`
  with its reason (the public token routes are the likely candidates, as in `liwan_appointments`
  `guest_service.py`: constant-time token match before any elevated read).
- Seats: `liwan_platform` already counts every active internal user against the subscription
  (`_liwan_user_quota_delta`). A pending invitee is an active internal user with no usable password,
  so it holds a seat naturally and cancelling frees it. The pre-send "N of M" figure comes from the
  entitlement service's existing count and limit.
- Both `saas` and `non_saas` (R8). Mail server settings are deployment configuration, not a tenant
  setting: the operator supplies SMTP host, port, user, password and from-address through deployment
  secrets and provisioning creates or updates the one outgoing `ir.mail_server`. LiwanOS production
  uses OCI Email Delivery in Jeddah (`smtp.email.me-jeddah-1.oci.oraclecloud.com:587`, STARTTLS,
  from `no-reply@liwanos.com`); a customer-hosted install supplies its own.
- Arabic default, RTL first; all strings through the owning locale namespace. Emails are Arabic first
  with an English section, like the existing control-plane invitation email.
- Clean pre-release rules: remove the password fields, the `password` keys of the grant, employee-grant
  and reactivate APIs, `parse_password` for those routes, their zod contracts, locale keys, stories and
  tests in the same change. No compatibility path.
- Contracts: zod schemas in `packages/contracts` match the serializers exactly; list envelopes stay
  `{items, total}`; the user serializer gains the invitation state and mobile number.
- Presentation follows `DESIGN.md`; the new pages (accept invitation for employees, forgot password,
  reset password, add mobile number) use Storybook components only.

## Decided

| Topic | Decision | Source |
| --- | --- | --- |
| Who sets the password | The account holder, from the emailed link | Owner |
| Admin sees or types passwords | Never | Owner |
| After sending | Confirmation naming the email; list shows "pending acceptance" | Owner |
| Seat warning | Shown before sending, "user N of M"; blocked at the limit | Owner |
| Wrong email | Editable while pending; edit revokes the old link and re-sends | Owner (fix), Claude (revoke on edit) |
| Mobile number | Required for everyone, entered by the account holder on the accept page | Owner |
| Forgot password | Self-service link on the sign-in page, sent by email | Owner |
| Sender | `no-reply@liwanos.com` via OCI Email Delivery, Jeddah; send only | Owner |
| Who sees a mobile number | Holders of the user-administration capability and the account holder only; never colleagues, the directory, `/api/v1/people`, HR or directory views, or anything sent to the assistant. Tested | Owner |
| Expired invitation | Keeps its seat; shown as "invitation expired" with resend and cancel; only the administrator frees the seat | Owner |

## Claude's calls (owner may override)

- Invitation link valid 72 hours, reset link valid 60 minutes; both single-use; issuing a new link of
  the same kind for the same user revokes the previous one.
- Password minimum 12 characters everywhere (the existing customer-admin accept page already uses 12;
  the admin API used 8).
- After a password is set or reset, all other sessions of that user are revoked.
- Forgot-password is rate limited per email and per client address, and always answers the same way.
- Mobile uniqueness is per tenant database among internal users; stored normalized as E.164.
- Reactivating an archived user sends a reset link instead of asking for a password.
- Token engine: Odoo's `auth_signup` was checked first (owner rule: reuse engines). Its signed tokens
  cannot be revoked on demand (they stay valid until the user signs in or they expire), so correcting
  an email or resending would leave the old link working, and it pulls in `mail`/`web` and public Odoo
  signup pages that the `ir.http` guard closes anyway. A small LiwanOS model is used instead: one row
  per issued link with a SHA-256 hash of the token, purpose (`invite` or `reset`), user, expiry,
  consumed and revoked timestamps. The raw token exists only in the outgoing email.
- Mail is sent after commit (queued, retried), never inside the request that creates the account, so a
  slow or failing SMTP server does not fail the admin action; a send failure is visible on the user
  ("invitation not delivered, resend").
- Customer administrator mobile: the control-plane accept contract and its password effect stay
  unchanged, so no mobile number passes through the control plane (R5, personal data). The customer
  administrator enters it in the same post-sign-in mobile step as existing users. The control plane keeps
  its own SMTP adapter and `LIWAN_MAIL_*` settings, pointed at the same OCI sender.
- Cancel archives the pending user (the existing quota delta frees the seat); the login stays reserved,
  and inviting the same email again reactivates that archived row in place with a fresh invitation
  instead of creating a second user. No hard delete.
- Editing a pending invitee's email changes the user's login and email only. An HR employee's work email
  is never rewritten by this path; the HR "give access" form is prefilled from the work email and may be
  changed before sending. If the user shares the employee's partner, the builder gives the user its own
  partner email handling so HR data is not changed silently.
- Mobile rule scope: every internal user except `base.user_root` and members of `group_vendor_support`
  (the users the seat count already excludes). Enforced by the API and UI, not as a database `required`
  field. While it is missing, only the current-user, mobile-save and sign-out routes answer; everything
  else returns a structured `mobile_required` error the web client turns into the mobile step.
  Uniqueness covers active users including pending invitees, not archived users.

## Left to the builder

- Exact model, field and route names; whether sending uses a cron queue or Odoo's post-commit hook.
- How the Nuxt proxy exposes the public token routes and whether the employee accept page shares
  components with the existing `/invite/accept` page (sharing is preferred; two pages for two token
  sources is acceptable if the backends differ).
- The interstitial for existing users without a mobile number (route and guard placement).
- Email HTML layout within the brand rules; plain-text part required.
- Provisioning code that creates the `ir.mail_server` from deployment secrets, and the control-plane
  env values (`LIWAN_MAIL_*`).

## Verification

- Odoo tests (scratch database, never `odoo19`): invite creates a password-less active user holding a
  seat; accept sets password and mobile once, then the token fails; edit email revokes the old token;
  resend revokes; cancel frees the seat; limit reached refuses; forgot-password answers identically
  for unknown emails; reset revokes sessions; duplicate mobile rejected; no admin route accepts a
  `password` key.
- Contract and web unit tests (`npm test`), type check (`npm -w apps/web run lint`).
- Playwright on the isolated mock stack for the add-user form, the accept page, forgot and reset
  pages, and the mobile interstitial, in RTL and both themes.
- A real send through OCI Email Delivery from a non-production run once SMTP credentials exist,
  checking DKIM and SPF pass in the received headers.
