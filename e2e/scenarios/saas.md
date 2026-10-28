# SaaS: selling, provisioning and subscription

Surfaces: vendor console `apps/vendor-admin` (every page listed in the Covers column), control plane
`apps/control-plane`, customer pages `/invite/accept`, `/login`, `/subscription` (`change`, `status`, `invoices`,
`branches`) in `apps/web`, entitlement enforcement in `odoo-addons/webvue_platform/models/entitlement_service.py`.
Personas and status values: [README](README.md).

How a customer starts today (code checked 2026-10-28): there is **no public self-service
signup**. A vendor operator creates the customer in the vendor console with company name,
admin name, admin email, plan and billing cadence. The order is fulfilled when it is `paid`
or `not_required`, the shared worker provisions the tenant database and the first
administrator, and that administrator receives an invitation link valid for 72 hours. A paid
first order has no payment path in the UI yet.

Stacks: control plane `deploy/control-plane/init-local.sh` + `run-local.sh`; vendor console
dev login (`apps/vendor-admin/README.md`); customer commercial mocks
`apps/web/e2e/commercial-mock-routes.mjs`. Real provisioning additionally needs a shared
runtime config, tenant registry, Odoo image and SMTP capture.

Reading this file:

- Control-plane routes are written in plain text such as cp POST /v1/commercial/orders (they are not coverage
  tokens). Vendor console pages are tokens starting with the word vendor.
- Vendor roles and what each may do (`admin-auth/roles.ts`): owner (everything), customer_success (read, tenants,
  subscriptions), finance (read, billing), product (read, catalog, pricing), operations (read, operations run),
  support (read, audit read). Step-up (a passkey confirmation younger than 5 minutes) is needed for any non-GET call that
  needs `vendor.pricing.manage`, `vendor.billing.manage`, `vendor.operations.run` or `vendor.accounts.manage`, and
  for catalog publication and trial extend or end. Refusal: 403 `step_up_required`; missing capability: 403
  `forbidden`. Session: 30 minutes idle, 12 hours absolute.
- Customer capabilities are derived from WebVue capabilities (`app/utils/customerCapabilities.ts`): administrators
  (`settings.branding.manage` or `access.roles.manage`) get subscription.read, subscription.manage, branches.manage,
  billing.read; a holder of `access.users.read` only gets subscription.read; everyone else none.
- Customer commercial routes are off (404) unless `customerCommercialEnabled` is true; `non_saas` builds never set it.

## Existing scenarios

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-01 | Prospect signs up on a public page and verifies the email | prospect | Tenant requested without a vendor | `page /login` | gap | No `/register`, no email verification |
| SAAS-02 | Vendor creates a customer on a zero-priced or trial plan | vendor owner | Customer, quote and order created; order `not_required` | `vendor /customers/new` | planned | Detail in SAAS-80 to SAAS-96 |
| SAAS-03 | Provisioning finishes | worker | Tenant enabled; first admin holds the entitled roles and is not vendor support | `vendor /tenants/[id]` | planned | |
| SAAS-04 | Admin accepts the invitation and sets a password | new admin | Signs in at `/login`; used or expired token refused | `page /invite/accept`, `page /login` | planned | Detail in SAAS-60 to SAAS-72 |
| SAAS-05 | Vendor resends the invitation | vendor owner | New link sent | `vendor /customers/[id]` | gap | API exists, no vendor console button |
| SAAS-06 | First-run setup after the first login | new admin | Guided setup | `page /` | gap | No onboarding wizard; company profile at `/settings/company` |
| SAAS-07 | Admin adds staff with roles | new admin | Staff sign in with their roles (ACC-03) | `page /login` | planned | Users are created with a password; no email invitation for staff (gap) |
| SAAS-08 | Create one user beyond `users.limit` | new admin | Refused with a clear message | `page /subscription` | planned | Detail in SAAS-200 to SAAS-203 |
| SAAS-09 | Subscription summary, usage and invoices | new admin | Values match the control plane | `page /subscription`, `page /subscription/invoices` | planned | |
| SAAS-10 | Upgrade and downgrade: quote, order, status page | new admin | Entitlements change after fulfilment | `page /subscription/change`, `page /subscription/status` | planned | |
| SAAS-11 | Start a trial on a plan with `trial_days`; convert it | new admin | Countdown shown; conversion creates an order | `page /subscription` | planned | |
| SAAS-12 | Vendor extends or ends a trial | vendor owner | Needs step-up; tenant follows the new end | `vendor /customers/[id]` | planned | |
| SAAS-13 | Paid first order through Moyasar test mode or the simulator | vendor + prospect | Payment, then provisioning | `vendor /invoices/[id]` | gap | No UI path to pay before a tenant exists |
| SAAS-14 | Tenant suspended | vendor owner | Sign-in refused with the suspension message | `page /login` | planned | See SAAS-210: nothing in the control plane sets the tenant profile to suspended |
| SAAS-15 | Tenant read-only | vendor owner | Reads work, writes refused with a clear message | `page /subscription` | planned | Read-only is the expired state, see SAAS-211 |
| SAAS-16 | Plan without an application | staff | Application hidden everywhere (PLT-10) | `page /apps` | planned | |
| SAAS-17 | Storage quota reached by attachments | staff1 | Upload refused with a clear message | `page /subscription` | planned | Detail in SAAS-204 |
| SAAS-18 | Customer-hosted `non_saas` mode | admin | No `/subscription`; no vendor connection needed; every application works | `page /subscription` | planned | Detail in SAAS-230 to SAAS-235 |
| SAAS-19 | Downgrade removes an application with existing data | vendor → admin → staff | Hidden, data kept, back on upgrade | `page /subscription/change` | planned | Also J-16 |

## Vendor console: sign-in, enrollment, session

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-20 | Signed-out visit to any vendor page | visitor | Redirect to `/login?next=<page>`; `/` redirects to `/overview` once signed in | `vendor /login`, `vendor /` | planned | `decideAccess`; `next` must be a same-app path, otherwise `/` |
| SAAS-21 | Sign in with a passkey | vendor owner | Passkey options, verify, session cookie `__Host-webvue_admin`; step-up is fresh straight after a passkey sign-in | `vendor /login` | planned | cp /v1/admin/auth/passkey/options and verify |
| SAAS-22 | Passkey sign-in fails | vendor operator | 401 `auth_failed`; counted against the ip scope | `vendor /login` | planned | Limit 20 failures per 15 minutes per IP |
| SAAS-23 | Lost device: email, password and TOTP code | vendor owner | Signed in; session has no fresh step-up, so sensitive actions ask for a passkey | `vendor /login` | planned | cp /v1/admin/auth/fallback; the TOTP step may not be reused (`last_step`) |
| SAAS-24 | Fallback with a wrong password, wrong code or unknown email | vendor operator | Same 401 `auth_failed` for all (timing equalised with a dummy hash) | `vendor /login` | planned | |
| SAAS-25 | Five wrong attempts for one account | vendor operator | 6th attempt 429 `rate_limited` for 15 minutes even with the right password; audit `auth.locked` | `vendor /login` | planned | Account scope limit 5, IP scope 20 |
| SAAS-26 | Sign in with a recovery code | vendor owner | Signed in; the code is single-use (second use 401) | `vendor /login` | planned | cp /v1/admin/auth/recovery |
| SAAS-27 | Developer one-click sign-in | vendor owner | Only when `NUXT_PUBLIC_DEV_LOGIN` and `ADMIN_DEV_LOGIN_EMAIL` are set; otherwise the routes answer failure | `vendor /login` | planned | Local only, never production |
| SAAS-28 | Signed-in user opens `/login` | vendor owner | Redirected to `next` or `/` | `vendor /login` | planned | |
| SAAS-29 | Open an enrollment link | vendor operator | Invitation info (email, purpose enroll or reset); the token is removed from the address bar | `vendor /enroll` | planned | cp /v1/admin/auth/invitation |
| SAAS-30 | Invalid, expired, used or disabled-account enrollment token | vendor operator | 401 `auth_failed`, no hint which | `vendor /enroll` | planned | |
| SAAS-31 | Enroll step 1: register a passkey | vendor operator | Options, then verify with a label; audit `auth.passkey_registered` | `vendor /enroll` | planned | |
| SAAS-32 | Enroll step 2: TOTP | vendor operator | QR/URI shown; code verified | `vendor /enroll` | planned | |
| SAAS-33 | Complete enrollment | vendor operator | Needs a passkey registered during this invitation, an acceptable password, a valid TOTP code; account becomes active, recovery codes shown once, session with fresh step-up | `vendor /enroll` | planned | |
| SAAS-34 | Complete without passkey, with weak password or bad code | vendor operator | 422 `invalid` | `vendor /enroll` | planned | |
| SAAS-35 | Reset link for an existing account | vendor owner | Account goes to `enrolling`, old passkeys, TOTP, recovery codes, sessions and invitations are wiped; the link finishes enrollment once | `vendor /enroll`, `vendor /team` | planned | purpose reset |
| SAAS-36 | Step-up prompt | vendor owner | A call needing step-up gets 403 `step_up_required`; the console asks for a passkey; after confirmation the action goes through for 5 minutes | `vendor /plans/[id]` | planned | `StepUpPanel` |
| SAAS-37 | Idle and absolute session end | vendor operator | After 30 minutes idle or 12 hours: 401, back to `/login?next=` | `vendor /login` | planned | |
| SAAS-38 | Sign out | vendor owner | Session revoked (204), audit `auth.signed_out`, old cookie refused | `vendor /overview` | planned | |
| SAAS-39 | Replayed or unsigned BFF call | visitor | 401 `unauthorized` («Invalid service assertion» or «Replayed service assertion»); no vendor role: 403 `forbidden` | `vendor /overview` | planned | Nonce kept 60 seconds |
| SAAS-40 | Body over 64 KiB, or service key missing | vendor owner | 413 `payload_too_large` / 503 `vendor_unavailable` | `vendor /overview` | planned | |

## Vendor console: team (`vendor.accounts.manage`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-41 | List accounts | vendor owner | Email, name, status, roles, passkey count, last seen | `vendor /team` | planned | |
| SAAS-42 | Operator without the capability opens the team page | vendor operator | 403 page; nav entry hidden | `vendor /team` | planned | Only owner holds it |
| SAAS-43 | Invite a colleague with roles and a reason | vendor owner | 201; one-time link shown with expiry (24 hours); no email is sent; audit `account.invited` | `vendor /team/new` | planned | Needs step-up |
| SAAS-44 | Invite validation | vendor owner | Bad email, empty or over-long name, no role, duplicate role, unknown role, reason outside 3 to 1000 characters: 422 `invalid` | `vendor /team/new` | planned | |
| SAAS-45 | Invite an existing email | vendor owner | 409 `conflict` | `vendor /team/new` | planned | |
| SAAS-46 | Change roles | vendor owner | 204; audit with roles; takes effect on the next request | `vendor /team` | planned | |
| SAAS-47 | Remove the last owner role | vendor owner | 409 `last_owner` | `vendor /team` | planned | Recovery only through the operator CLI |
| SAAS-48 | Disable an account | vendor owner | Sessions revoked, pending invitations consumed; 422 if already disabled; 409 `last_owner` for the only owner | `vendor /team` | planned | |
| SAAS-49 | Reset an account | vendor owner | Link returned; an owner resetting itself as the last owner: 409 `last_owner`; a non-owner actor: 403 | `vendor /team` | planned | |
| SAAS-50 | Roles and a missing account | vendor owner | Unknown account id: 404 `not_found`; disabled target roles: 422 | `vendor /team` | planned | |

## Vendor console: overview, analytics, audit

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-51 | Overview with attention list | vendor operator | Prioritised items (at most the attention limit) with «n of total» text; empty state when nothing needs attention | `vendor /overview` | planned | cp GET /v1/commercial/attention |
| SAAS-52 | Overview hides overdue invoices from roles without billing | vendor operator | Only `vendor.billing.manage` holders get overdue-invoice items | `vendor /overview` | planned | |
| SAAS-53 | Status strip counts open their lists | vendor owner | Failed operations, pending operations, workspaces, active workspaces, subscriptions, past due, stalled, setup required, renewals; failed operations opens `/operations?status=attention` | `vendor /overview`, `vendor /operations` | planned | |
| SAAS-54 | Overview when the commercial routes are not deployed | vendor owner | Attention section says unavailable; counts still load | `vendor /overview` | planned | `isNotAvailable` |
| SAAS-55 | Analytics for a period | finance role | MRR and related figures for `from` and `to`; bad dates: 422 | `vendor /analytics` | planned | cp GET /v1/commercial/analytics; needs `vendor.billing.manage` |
| SAAS-56 | Analytics without billing | vendor operator | 403 page | `vendor /analytics` | planned | |
| SAAS-57 | Audit log | support role | Newest first, 25 per page, with actor, action, subject, reason | `vendor /audit` | planned | Needs `vendor.audit.read` |
| SAAS-58 | Audit filters | support role | Category, free text, actor, customer, from and to dates; bad filter 422 `invalid`; chips remove each; URL keeps them | `vendor /audit` | planned | |
| SAAS-59 | Audit without the capability | finance role | 403 page | `vendor /audit` | planned | Finance does not hold `vendor.audit.read` |

## Invitation: `/invite/accept`

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-60 | Open a valid link | new admin | Short «جارٍ التحقق من رابط الدعوة...» then the form «قبول الدعوة» with password and confirm | `page /invite/accept` | planned | Check answers only `{usable}` |
| SAAS-61 | Link without a token | prospect | Straight to «رابط الدعوة غير صالح أو منتهي» / «اطلب من مسؤول شركتك إرسال دعوة جديدة.» | `page /invite/accept` | planned | |
| SAAS-62 | Expired link (older than 72 hours by default) | new admin | Same invalid message; no hint of why | `page /invite/accept` | planned | |
| SAAS-63 | Used link | new admin | Same invalid message | `page /invite/accept` | planned | A link is single-use |
| SAAS-64 | Revoked link (a newer invitation was issued) | new admin | Same invalid message | `page /invite/accept` | planned | Issuing revokes older open invitations for the same login |
| SAAS-65 | Malformed token (shorter than 20 or longer than 200 characters) | prospect | Same invalid message | `page /invite/accept` | planned | |
| SAAS-66 | Password rules on the form | new admin | Rules «١٢ حرفًا على الأقل» and «تطابق كلمتي المرور» turn green; submit stays disabled until both hold | `page /invite/accept` | planned | |
| SAAS-67 | Accept with a valid password | new admin | Success «تم تفعيل حسابك» with «اسم الدخول: {login}» and button to `/login?login=`; token is consumed | `page /invite/accept`, `page /login` | planned | |
| SAAS-68 | Password rejected by the tenant | new admin | Form stays, «كلمة المرور مرفوضة»; password fields cleared; the link is still usable | `page /invite/accept` | planned | 422 `password_rejected` |
| SAAS-69 | Password longer than 256 characters | new admin | Treated as invalid input (400 `invalid_invitation`) | `page /invite/accept` | planned | Capped in the BFF |
| SAAS-70 | Acceptance already running (second tab) | new admin | «جارٍ تفعيل حسابك» with retry; typed password kept | `page /invite/accept` | planned | 409 `in_progress` (5 s lock timeout) |
| SAAS-71 | Admin account disabled, missing or database invalid | new admin | «لا يمكن تفعيل هذا الحساب» / «تواصل مع مسؤول شركتك.» | `page /invite/accept` | planned | 409 `account_unavailable` |
| SAAS-72 | Control plane or tenant unavailable | new admin | «الخدمة غير متاحة حاليًا» with «إعادة المحاولة»; password kept; the token is not consumed | `page /invite/accept` | planned | 503; also when no password setter is configured (`unimplementedSetPassword`) |
| SAAS-73 | Too many attempts from one address | prospect | 11th check or accept within a minute: 429 `rate_limited`; the page treats it as temporary, not as invalid | `page /invite/accept` | planned | Accept and check count separately; more than 4 in flight: 503 |
| SAAS-74 | Cross-site or non-JSON request | visitor | 403 `cross_site_request` / 415; body over 8 KiB (accept) or 2 KiB (check): 413 | `page /invite/accept` | planned | `assertPublicMutationOrigin` |
| SAAS-75 | Invitation email | new admin | Email in the customer's language with the link on the customer's own host; status `sent` or `local_capture`; token scrubbed from the outbox afterwards | `page /invite/accept` | planned | SMTP capture needed |
| SAAS-76 | Email send fails | vendor operator | Invitation `delivery_status=failed`, outbox failure recorded; no resend button (see SAAS-05) | `vendor /customers/[id]` | gap | |
| SAAS-77 | Vendor resend through the API | vendor owner | 202 `{id, expires_at, delivery_status: queued}`; TTL 300 s to 7 days; customer without a tenant: 409 `not_ready`; no admin login: 422 `admin_login`; unknown customer 404; needs `vendor.subscriptions.manage` | `vendor /customers/[id]` | planned | cp POST /v1/commercial/customers/{id}/invitations; API-level only |
| SAAS-78 | Invited admin signs in | new admin | Lands on `/` with the roles the plan entitles | `page /login`, `page /` | planned | |
| SAAS-79 | Staff accounts of the customer | new admin | No invitation flow: the admin creates the user with a password (ACC-03) | `page /login` | gap | |

## Vendor console: customers

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-80 | Customer list | vendor operator | Name, state, plan; 25 per page, newest first; search by name, filter by state (`awaiting_payment`, `activating`, `active`, `failed`, `inactive`, `setup_required`) | `vendor /customers` | planned | cp GET /v1/commercial/clients; bad `state`, `q` over 200 characters or bad page: 422 |
| SAAS-81 | Empty list | vendor operator | Empty state | `vendor /customers` | planned | |
| SAAS-82 | Create customer in plan mode (shared onboarding on) | vendor owner | Fields: company, admin name, admin email, plan, cadence; price shown; creates customer, quote and order, lands on `/customers/{id}` | `vendor /customers/new` | planned | Roles needed: `vendor.tenants.manage` and `vendor.subscriptions.manage` |
| SAAS-83 | Create as a role without subscriptions | vendor operator | Warning «forbidden» text and the button stays disabled; with only `vendor.subscriptions.manage` the page is 403 | `vendor /customers/new` | planned | Page needs `vendor.tenants.manage` |
| SAAS-84 | Create validation | vendor owner | Name 1 to 200, admin name up to 120, email valid up to 100; 422 `invalid` with field | `vendor /customers/new` | planned | |
| SAAS-85 | Double submit or lost response | vendor owner | Same `request_id` returns the original customer (200); same id with different body: 409 `idempotency_conflict`; the page reuses the customer on retry | `vendor /customers/new` | planned | |
| SAAS-86 | No published plan | vendor owner | Notice «none»; submit disabled | `vendor /customers/new` | planned | |
| SAAS-87 | Unsaved form | vendor owner | Leaving asks for confirmation | `vendor /customers/new` | planned | `SharedUnsavedChanges` |
| SAAS-88 | Legacy mode (shared onboarding off) | vendor owner | Form for tenant registration: name, mode saas or non_saas, hosting managed or customer_hosted, target, published catalog version and tier, reason; lands on `/tenants/{id}` | `vendor /customers/new`, `vendor /tenants/[id]` | planned | cp POST /v1/tenants |
| SAAS-89 | Legacy registration refusals | vendor owner | Unknown target 422 `target_not_authorized`; target already registered 409 `conflict`; catalog version not published 422 `invalid` field `catalog_version`; tier not published 422 field `catalog_tier`; catalog not matching the managed target 422; shared execution off 503 | `vendor /customers/new` | planned | |
| SAAS-90 | Customer detail tabs | customer success | Tabs summary, workspace, operations, invoices (billing roles only); state badge; subscription, usage, branches, entitlement summary | `vendor /customers/[id]` | planned | `?tab=` kept in URL |
| SAAS-91 | Unknown or malformed customer id | vendor operator | Not-found page | `vendor /customers/[id]` | planned | |
| SAAS-92 | Display states | vendor operator | `setup_required` (no subscription), `awaiting_payment`, `activating`, `active`, `failed` (fulfilment failed or refund), `inactive` (suspended or cancelled) | `vendor /customers/[id]` | planned | SQL in `customers.ts` |
| SAAS-93 | Workspace tab and provisioning progress | vendor operator | Progress of the shared provisioning job polls until done; failure shows the stage | `vendor /customers/[id]` | planned | cp GET /v1/shared/tenants/{id}/provisioning |
| SAAS-94 | Workspace unreadable | vendor operator | Badge «unknown», retry | `vendor /customers/[id]` | planned | |
| SAAS-95 | Cancel a pending order | vendor owner | Needs reason of 3 or more characters (else 422 `reason_required`); only awaiting-payment or failed, not started, non-renewal orders; invoice voided, pending branches archived; live provider attempts cancelled first | `vendor /customers/[id]` | planned | cp POST /v1/commercial/orders/{id}/cancel |
| SAAS-96 | Cancel refusals | vendor owner | Paid or fulfilling order: 409 `order_not_cancellable`; provider mismatch 409; unknown payment outcome 409 `payment_reconciliation_required`; unknown order 404 | `vendor /customers/[id]` | planned | |
| SAAS-97 | Extend a trial | customer success | Days 1 to 365 and reason 3 to 1000; needs step-up; tenant expiry date follows; not trialing: 409 `trial_not_active`; no binding: 409 `tenant_binding_unavailable` | `vendor /customers/[id]` | planned | |
| SAAS-98 | End a trial now | customer success | Needs step-up; subscription becomes past due and the first invoice is issued; payment origin unusable: 422 `return_url_forbidden` | `vendor /customers/[id]` | planned | |
| SAAS-99 | Trial panel for a role without subscriptions | finance role | Buttons disabled with read-only note | `vendor /customers/[id]` | planned | |
| SAAS-100 | Customer terms (negotiated prices) | vendor owner | Page needs pricing and subscription rights; saves a revision; only the latest applies to new quotes | `vendor /customers/[id]/terms/new` | planned | cp POST /v1/commercial/customer-terms |
| SAAS-101 | Terms validation | vendor owner | Unknown customer 404; invalid body 422 | `vendor /customers/[id]/terms/new` | planned | |
| SAAS-102 | Change a customer's plan from the vendor side | customer success | Choose plan, bundles, cadence, quantities; preview shows the quote (draft terms can be previewed with `preview: true`); place order with idempotency key | `vendor /customers/[id]/change` | planned | Page needs `vendor.subscriptions.manage` |
| SAAS-103 | Change refusals | customer success | Change pending: 409 `subscription_change_pending`; stale revision 409 `revision_conflict`; expired quote 422 `quote_expired`; plan not sellable 422; cadence change 422 `cadence_change_unsupported`; downgrade below usage 422 `downgrade_below_usage`; usage sample missing 409 `usage_unavailable`; same idempotency key with other body 409 `idempotency_conflict` | `vendor /customers/[id]/change` | planned | |
| SAAS-104 | Tenant page for a workspace without a customer | vendor owner | Tabs summary, workspace, operations | `vendor /tenants/[id]` | planned | |
| SAAS-105 | Tenant page for a workspace that has a customer | vendor owner | Redirects (replace) to `/customers/{id}?tab=workspace` or `operations` | `vendor /tenants/[id]`, `vendor /customers/[id]` | planned | `tenant-customer` middleware |
| SAAS-106 | Vendor creates the order but nobody can pay it | vendor owner | Paid-plan order stays `awaiting_payment`; see SAAS-13 | `vendor /customers/[id]` | gap | The vendor payment-attempt route exists (cp POST /v1/commercial/orders/{id}/payment-attempts) but no page calls it |
| SAAS-107 | Operator without any vendor role | vendor operator | 403 `forbidden` «Vendor account holds no role» | `vendor /overview` | planned | |

## Vendor console: plans, bundles, catalog

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-110 | Plan list | vendor operator | Status filter (draft, validated, published, withdrawn, all), search, paging; bad status or limit: 422 | `vendor /plans` | planned | cp GET /v1/commercial/plans |
| SAAS-111 | Plan detail | vendor operator | Prices per cadence, limits, included and optional bundles, trial days, grace days, auto-suspend, status, history of revisions | `vendor /plans/[id]` | planned | Unknown id: 404 `plan_missing` |
| SAAS-112 | Create a plan draft | product role | Needs catalog and pricing rights and step-up; 201; audit `plan.created`; unknown pricing policy 422 field `policy_revision_id` | `vendor /plans/new` | planned | |
| SAAS-113 | Plan form validation | product role | Issue codes surfaced per field: audience_invalid, branch_limit_invalid, branch_price_missing, currency_mismatch, currency_not_supported, currency_exponent_invalid, duplicate_price_cadence, platform_limit_derived, price_missing, storage_minimum_not_whole_gb, term_not_multiple, unit_price_missing, bundle_missing, bundle_unavailable, bundle_duplicated, bundle_audience_mismatch, catalog_release_mismatch, release_missing | `vendor /plans/new` | planned | |
| SAAS-114 | Edit a draft or validated plan | product role | Saves with `edit_revision`; stale revision 409 `revision_conflict` with a reload prompt; a published plan cannot be edited (409 `transition_invalid`) | `vendor /plans/[id]/edit` | planned | |
| SAAS-115 | Validate then publish | product role | Draft to validated to published; publish needs the validated digest (409 `review_required`) and an unchanged content digest (409 `content_digest_mismatch`); issues listed with 422 `invalid`; reason 3 to 1000 | `vendor /plans/[id]` | planned | |
| SAAS-116 | Publishing withdraws the older revision of the same plan | product role | Previous published revision becomes unavailable; the customer catalog lists one revision | `vendor /plans/[id]` | planned | audit `plan.withdrawn_by_publish` |
| SAAS-117 | Withdraw and restore | product role | Withdraw only an available published revision; restore only a withdrawn one; otherwise 409 `transition_invalid` | `vendor /plans/[id]` | planned | |
| SAAS-118 | New revision of a published plan | product role | 201; new draft copy with next version | `vendor /plans/[id]` | planned | |
| SAAS-119 | Delete | product role | Only a draft with no references; otherwise 409 `plan_delete_forbidden` | `vendor /plans/[id]` | planned | Destructive action confirmed inline |
| SAAS-120 | Plan for one customer only | product role | Audience customer: invisible to other customers' catalogs and quotes (404 `plan_missing`) | `vendor /plans/new` | planned | |
| SAAS-121 | Read-only role on plans | vendor operator | Pages open; edit, new and lifecycle buttons hidden or disabled with reason | `vendor /plans` | planned | Only `vendor.read` |
| SAAS-122 | Bundle list and detail | vendor operator | Same filters; detail with prices, catalog release, customer count | `vendor /bundles`, `vendor /bundles/[id]` | planned | |
| SAAS-123 | Create bundle | product role | Needs catalog rights; prices in the body also need pricing rights (403) | `vendor /bundles/new` | planned | |
| SAAS-124 | Edit bundle | product role | Same optimistic revision rules; publish, withdraw, restore need pricing rights and step-up | `vendor /bundles/[id]/edit` | planned | |
| SAAS-125 | Withdraw a referenced bundle | product role | Warning that plans referencing it are stranded; delete refused 409 `bundle_delete_forbidden` | `vendor /bundles/[id]` | planned | |
| SAAS-126 | Catalog (read-only history of packages) | vendor operator | List and detail of old packages with status; no edit buttons | `vendor /catalog`, `vendor /catalog/[id]` | planned | Write calls answer 410 `packages_retired`; package routes need `vendor.read` |
| SAAS-127 | Catalog release | product role | Create a release from a catalog version with reason; repeated create returns 200 with the same release, first create 201; needs step-up | `vendor /catalog` | planned | cp POST /v1/commercial/catalog/releases; no console button found, API-level |
| SAAS-128 | Quote preview | vendor operator | Server computes totals; unknown quote 404 `quote_missing` | `vendor /customers/[id]/change` | planned | cp POST /v1/commercial/quotes |
| SAAS-129 | Policies | vendor operator | Pricing policy list readable | `vendor /plans/new` | planned | cp GET /v1/commercial/policies |

## Vendor console: invoices and billing

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-130 | Invoice list | finance role | Number, customer, status, total; filters `customer_id`, `status`; bad values 422; paging up to 200 | `vendor /invoices` | planned | Needs `vendor.billing.manage` |
| SAAS-131 | Invoice list for a role without billing | vendor operator | 403 page; customer tab «invoices» hidden | `vendor /invoices` | planned | |
| SAAS-132 | Invoice detail | finance role | Lines with quantity and free/paid split, totals, payment attempts of the order, adjustments | `vendor /invoices/[id]` | planned | Unknown id 404 |
| SAAS-133 | Record a refund of a pending credit note | finance role | Needs external reference and reason; note becomes refunded; no money moves; same reference again returns the same note | `vendor /invoices/[id]` | planned | cp POST /v1/commercial/invoice-adjustments/{id}/refund; needs step-up |
| SAAS-134 | Refund refusals | finance role | Note not pending: 409 `credit_note_not_pending`; reference used on another note: 409 `refund_reference_in_use`; unknown 404 | `vendor /invoices/[id]` | planned | |
| SAAS-135 | Late payment after cancellation | finance role | A pending credit note is created for manual review; a duplicate payment gets its own note | `vendor /invoices/[id]` | planned | `settlements.ts` |
| SAAS-136 | Failed fulfilment after payment | finance role | Invoice becomes `credit_pending` with a credit note | `vendor /invoices/[id]` | planned | |
| SAAS-137 | Payment simulator settle | finance role | Dev and test only: outcome succeeded, failed or canceled; production or non-simulator adapter: 404 | `vendor /invoices/[id]` | planned | No page button |
| SAAS-138 | Renewals run | finance role | Generates renewal orders and applies dunning; `now` override refused in production (403) | `vendor /invoices` | planned | cp POST /v1/commercial/renewals/run; the scheduler normally runs it |
| SAAS-139 | Payment provider callback | visitor | Provider event verified by the adapter alone, outside vendor auth | `vendor /invoices` | planned | cp POST /v1/commercial/payment-events/{provider} |

## Vendor console: operations

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-140 | Operation list | vendor operator | Type, status, stage, target, time; filters by workspace and status (all, pending, attention, ...); bad status 422; 25 per page | `vendor /operations` | planned | source `all` merges legacy and shared |
| SAAS-141 | Operation detail | vendor operator | Events timeline; unknown id 404 | `vendor /operations/[id]` | planned | |
| SAAS-142 | Run an operation from the workspace | operations role | Types tenant.create, tenant.inspect, health, backup, tenant.entitle, upgrade, restore need a reason, `request_id` and step-up; 202 queued; same request id and body replays with 200 | `vendor /tenants/[id]` | planned | cp POST /v1/tenants/{id}/operations |
| SAAS-143 | Operation refusals | operations role | Operations disabled: 403 `operations_disabled`; unresolved mutation: 409 `reconciliation_required`; already provisioning: 409 `conflict`; not provisioned yet: 422 `invalid`; catalog missing: 422 `catalog_required`; entitle on non_saas: 422 `local_policy_protected`; managed target not allowed: 422 `operation_unavailable`; request id reused with other body: 409 | `vendor /tenants/[id]` | planned | |
| SAAS-144 | Restore needs approval | operations role | Missing, used or expired approval: 422 `approval_required`; approval is single-use and lasts one hour | `vendor /tenants/[id]` | planned | |
| SAAS-145 | Upgrade needs a trusted release | operations role | Missing release file: 422 `invalid` | `vendor /tenants/[id]` | planned | |
| SAAS-146 | Retry a failed read operation | operations role | Only failed `tenant.inspect` or `health`; other types: 422 `retry_forbidden`; shared operations cannot be retried | `vendor /operations/[id]` | planned | |
| SAAS-147 | Operations grant | customer success | Enable or disable operations for a workspace with a reason; audited; an inventory failure does not undo the grant | `vendor /tenants/[id]` | planned | cp POST /v1/tenants/{id}/operations-grant |
| SAAS-148 | Tenant list filters | vendor operator | `q`, `mode` saas or non_saas (else 422 field `mode`), 25 per page | `vendor /customers` | planned | cp GET /v1/tenants |
| SAAS-149 | Registry mutation and recovery | customer success | Needs tenants rights and step-up; registry not configured: 503 `registry_unavailable` | `vendor /tenants/[id]` | planned | cp POST /v1/registry/mutations |
| SAAS-150 | Shared onboarding | vendor owner | Needs tenants and operations rights; first call 202, replay 200; refusals `shared_onboarding_forbidden` 403, `published_catalog_missing` 409, `catalog_tier_missing` 409, `shared_adapter_unavailable` 503 | `vendor /customers/new` | planned | cp POST /v1/shared/tenants |
| SAAS-151 | Shared job queue | operations role | provision, backup, restore jobs queued with reason; shared mode off: 503 `shared_execution_unavailable` | `vendor /tenants/[id]` | planned | |
| SAAS-152 | Catalog draft validate and publish | product role | Validate draft to validated (trusted check, else 422 `catalog_invalid`); publish validated to published with step-up; wrong state 409 `conflict` | `vendor /catalog/[id]` | planned | cp POST /v1/catalog/{id}/validate; legacy catalog, no console control |

## Customer: subscription pages

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-160 | Open `/subscription` as administrator | it_admin | Title, plan block with state badge, cadence, renewal date, entitled applications, usage, branches summary, latest 3 invoices, auto-renew | `page /subscription` | planned | Mock stack `commercial-mock-routes.mjs` |
| SAAS-161 | Open as a reader only | hr_manager | Only plan and usage; no invoices block, no change or trial buttons, auto-renew read-only text «التغيير متاح لمن يملك صلاحية إدارة الاشتراك.» | `page /subscription` | planned | Needs `access.users.read` |
| SAAS-162 | Open without any subscription capability | staff1 | Forbidden state «لا تملك صلاحية عرض الاشتراك.» | `page /subscription` | planned | |
| SAAS-163 | Customer without a subscription yet | it_admin | «none» text and button «ابدأ التجربة» | `page /subscription` | planned | 404 from the control plane is a state, not an error |
| SAAS-164 | Trial banner | it_admin | «متبقٍ {count} يوم من التجربة», end date; warning colour at 3 days or fewer with the expiring text | `page /subscription` | planned | |
| SAAS-165 | Pending change block | it_admin | «تغيير قيد التنفيذ» with «حالة الطلب» link when an order is open; action style when payment or activation needs the customer | `page /subscription` | planned | |
| SAAS-166 | Section failure | it_admin | A failing usage, branches or invoices call shows a warning in that section, not an empty one | `page /subscription` | planned | |
| SAAS-167 | Usage panel | it_admin | Rows for users, storage, branches, projects with used and limit; stale sample shows the «غير متاح حاليًا» note, never zero | `page /subscription` | planned | `freshness` fresh or stale after 15 minutes |
| SAAS-168 | Auto-renew on | it_admin | Needs consent checkbox text and a saved payment token; without token: 409 `token_required`; shows «مفعّل» | `page /subscription` | planned | cp POST /v1/customer/auto-renew |
| SAAS-169 | Auto-renew off | it_admin | «متوقف»; repeating is a no-op | `page /subscription` | planned | |
| SAAS-170 | Change page: catalog | it_admin | Plans and optional bundles of the customer's audience, cadence, users, storage in GB, extra branches; empty «لا توجد باقات متاحة حاليًا.» | `page /subscription/change` | planned | Needs `subscription.manage`, else forbidden |
| SAAS-171 | Live total | it_admin | Each change re-prices on the server («يُحتسب السعر في الخادم عند كل تغيير») and shows included versus paid quantities | `page /subscription/change` | planned | cp POST /v1/customer/preview needs only subscription.read |
| SAAS-172 | Preview refusals | it_admin | Pick plan first «اختر باقة أولًا.»; server refusal shows «تعذّر حساب السعر. حاول مرة أخرى.»; change preview without a subscription 409 `subscription_required` | `page /subscription/change` | planned | |
| SAAS-173 | Accept a quote | it_admin | «تأكيد والمتابعة» places an order with a per-action idempotency key kept in session storage; a refresh or retry reuses it | `page /subscription/change` | planned | |
| SAAS-174 | Quote expired | it_admin | «انتهت صلاحية العرض. أعد حساب السعر.» (422 `quote_expired`) | `page /subscription/change` | planned | |
| SAAS-175 | Subscription changed elsewhere | it_admin | «تغيّر اشتراكك منذ آخر عرض...» (409 `revision_conflict`) with «إعادة حساب السعر» | `page /subscription/change` | planned | |
| SAAS-176 | Price changed between preview and accept | it_admin | «تغيّر السعر قبل التأكيد؛ راجع الإجمالي الجديد.» | `page /subscription/change` | planned | `sameQuoteEconomics` |
| SAAS-177 | Another change already pending | it_admin | 409 `subscription_change_pending`; generic failure «تعذّر إكمال الطلب» with link to status | `page /subscription/change` | planned | |
| SAAS-178 | Downgrade below current usage | it_admin | 422 `downgrade_below_usage` naming the limit key; no order; usage unavailable: 409 `usage_unavailable` | `page /subscription/change` | planned | |
| SAAS-179 | Paid order: redirect to the provider | it_admin | After the order a payment attempt is created and the browser is sent to the provider page «جارٍ نقلك إلى صفحة الدفع…»; only same-origin or allow-listed redirects are followed | `page /subscription/change` | planned | `safePaymentRedirect`; payment unavailable: 503 `payment_unavailable` |
| SAAS-180 | Zero-due order | it_admin | No provider; goes straight to the status page | `page /subscription/status` | planned | Order `not_required` payment state |
| SAAS-181 | Draft guard | it_admin | Leaving with unaccepted changes asks «لديك تغييرات غير محفوظة. هل تريد المغادرة؟» | `page /subscription/change` | planned | |
| SAAS-182 | Start a trial | it_admin | Button «ابدأ تجربة {count} يومًا» for a plan with `trial_days`; order is zero-due and fulfilled; subscription state trialing | `page /subscription/change` | planned | cp POST /v1/customer/trial |
| SAAS-183 | Trial refusals | it_admin | Plan without trial days 422 `trial_disabled`; trial already used 409 `trial_already_used`; subscription already applied 409 `trial_not_available`; old tenant without expiry support 409 `tenant_upgrade_required` shown as «خدمتك تحتاج تحديثًا قبل بدء التجربة...»; no binding or order: `trial_order_unavailable` shown as «تعذّر تجهيز التجربة الآن. تواصل مع الدعم.» | `page /subscription/change` | planned | |
| SAAS-184 | Convert the trial («ادفع الآن») | it_admin | Trial ends now, first invoice and hosted attempt created, browser goes to the provider; no attempt yet: «اشتراكك قيد التفعيل؛ ستظهر الفاتورة بعد اكتمال التفعيل.» | `page /subscription` | planned | cp POST /v1/customer/trial/convert; not trialing 409 `trial_not_active` |
| SAAS-185 | Status page with an order | it_admin | `?order=` shows payment and activation steps with their Arabic labels and the outcome card (applied, cancelled, awaiting payment, payment failed, processing, activation failed, refund) | `page /subscription/status` | planned | Polls while processing |
| SAAS-186 | Status page without an order | it_admin | «لا يوجد طلب معلّق حاليًا.» | `page /subscription/status` | planned | |
| SAAS-187 | Status of a settled order | it_admin | «هذا الطلب لم يعد معلّقًا...» with «العودة إلى الاشتراك» | `page /subscription/status` | planned | |
| SAAS-188 | Other customer's or malformed order id | it_admin | 404, same as unknown; read error text with «تحديث الحالة» | `page /subscription/status` | planned | No oracle |
| SAAS-189 | Retry payment | it_admin | «إكمال الدفع» creates a new attempt for an awaiting order; failure «تعذّر فتح صفحة الدفع. حاول مرة أخرى.» | `page /subscription/status` | planned | Wrong provider or mode: 409 `provider_mismatch` |
| SAAS-190 | Provider return | it_admin | Browser returns to `/api/commercial/payment-callback?attempt=` which verifies with the provider and redirects 303 to `/subscription/status?order=`; unknown or invalid attempt goes to `/subscription`; POST from the provider answers 204; rate limits per client, per attempt and global | `page /subscription/status` | planned | Anonymous signed call; 405 for other methods |
| SAAS-191 | Payment failed or cancelled | it_admin | Outcome card «فشلت عملية الدفع»; subscription unchanged; a new order can be started | `page /subscription/status` | planned | |
| SAAS-192 | Branches list | it_admin | Included and extra branches with state; add button only with `branches.manage` | `page /subscription/branches` | planned | |
| SAAS-193 | Add branches | it_admin | Names (1 to 200), review quote, accept, pay if due; duplicate name 409 `branch_name_taken`; mixed add and archive 422 `mixed_branch_change_unsupported`; no subscription 409 `subscription_required` | `page /subscription/branches/new` | planned | Beyond `branches.extra_limit`: 422 `downgrade_below_usage` or a quote refusal |
| SAAS-194 | Branches page as a reader | hr_manager | Read-only text; add page shows forbidden | `page /subscription/branches/new` | planned | |
| SAAS-195 | Archive a branch | it_admin | Expected: customer can archive an extra branch | `page /subscription/branches` | gap | The branch-quote API accepts `archive`, but no page offers it |
| SAAS-196 | Invoice list | it_admin | Own invoices only; empty text; needs `billing.read`, else forbidden | `page /subscription/invoices` | planned | |
| SAAS-197 | Invoice detail | it_admin | Lines with quantity and free/paid, total in SAR; another customer's or malformed id: 404 | `page /subscription/invoices/[id]` | planned | |
| SAAS-198 | Customer cancels an unpaid order | it_admin | Expected: customer can cancel before paying | `page /subscription/status` | gap | The control plane lets a customer with `subscription.manage` cancel, but the web proxy allow-list has no cancel route and no page |
| SAAS-199 | Forged identity or unknown route through the proxy | it_admin | Keys such as tenant_id, customer_id, capabilities, principal in query or body: 400 `forbidden_field`; unknown route or `..`: 404; non-JSON 415; wrong origin 403 `cross_site_request`; missing or wrong CSRF 403 `csrf_failed`; body over 64 KiB 413; more than 20 changes a minute 429 `rate_limited` | `page /subscription` | planned | `customer-commercial.ts` |

## Quotas, expiry, suspension and non_saas

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SAAS-200 | User limit | it_admin | Creating or reactivating the user that exceeds `users.limit` answers 403 `feature_not_included` «this limit has been reached», limit key `users.limit`; message «بلغت الحد المسموح للمستخدمين في باقتك.» | `page /subscription` | planned | `_webvue_claim_users`; vendor support and the root user are not counted |
| SAAS-201 | Archiving frees a seat | it_admin | After archiving one user the next creation succeeds | `page /subscription` | planned | |
| SAAS-202 | Limit unset | it_admin | `null` limit means unlimited | `page /subscription` | planned | |
| SAAS-203 | Corrupt limit in the tenant profile | it_admin | 503 `tenant_configuration_invalid` | `page /subscription` | planned | Negative or non-integer limit |
| SAAS-204 | Storage limit | staff1 | An upload that would pass `storage.limit_mb` answers 403 limit reached; «بلغت سعة المرفقات المسموح بها في باقتك.»; deleting frees space | `page /subscription` | planned | Sum of binary attachment sizes |
| SAAS-205 | Project limit | pm | The project above `projects.max_projects` is refused; message «بلغت الحد المسموح للمشاريع في باقتك.»; copying a project counts | `page /subscription` | planned | `_webvue_claim_projects` |
| SAAS-206 | Extra branch limit | it_admin | Active extra branches counted against `branches.extra_limit` | `page /subscription/branches` | planned | |
| SAAS-207 | Limit race | it_admin | Two concurrent creates at the last seat: exactly one succeeds (tenant profile row lock) | `page /subscription` | planned | |
| SAAS-208 | Plan changes the limits | it_admin | New limits apply after fulfilment, not before | `page /subscription/status` | planned | |
| SAAS-209 | Feature off versus limit reached | it_admin | `details.reason` is `feature` or `limit` so the UI can tell them apart | `page /subscription` | planned | |
| SAAS-210 | Dunning suspends the subscription | vendor owner | Plan with `auto_suspend`: after the grace period the subscription state becomes `suspended` and the customer shows `inactive`; expected the tenant's sign-in is refused | `vendor /customers/[id]` | gap | Only the control-plane subscription state changes (`renewals.ts:135`); no code pushes `status=suspended` to the tenant profile, so users keep working |
| SAAS-211 | Expired commercial end date | staff1 | After `commercial_valid_until` passes the tenant is read-only: reads work, writes answer 403 `tenant_read_only` «this tenant is read-only» | `page /subscription` | planned | Date set from trial end plus grace (`commercialExpiryDate`) |
| SAAS-212 | Suspended tenant API | staff1 | Every `/api/v1` call 403 `tenant_suspended`; session ended; only password change and TOTP calls stay writable | `page /login` | planned | |
| SAAS-213 | Vendor support access on a suspended tenant | vendor operator | Support users may sign in only when `support_access_enabled`; then writes are `tenant_read_only` | `page /login` | planned | |
| SAAS-214 | Binary images of a suspended tenant | visitor | Image route refuses | `page /login` | planned | `ir_binary.py` |
| SAAS-215 | Trial ends without payment | it_admin | Subscription goes past due, first invoice issued; after grace the tenant turns read-only | `page /subscription` | planned | |
| SAAS-216 | Failed activation | it_admin | Status card «تعذّر تفعيل الطلب» and, when paid, a pending credit note for the vendor | `page /subscription/status` | planned | Needs-intervention codes: stale_target, observed_mismatch, provision_needs_intervention |
| SAAS-217 | Vendor suspends or reactivates a tenant by hand | vendor owner | Expected: a console action with reason | `vendor /tenants/[id]` | gap | No such action; `tenant.entitle` carries features only |
| SAAS-218 | Stale downgrade usage | vendor owner | Downgrade needs a usage sample younger than 15 minutes; collector paused while a shared job runs | `vendor /customers/[id]/change` | planned | |
| SAAS-230 | `non_saas` build: subscription page | admin | `/subscription` answers 404 (commercial off); no nav entry | `page /subscription` | planned | `customer-commercial` middleware |
| SAAS-231 | `non_saas` build: commercial API | admin | `/api/commercial/v1/*` answers 404 | `page /subscription/status` | planned | |
| SAAS-232 | `non_saas` sign-in without any vendor connection | admin | Works with the control plane down; no calls leave the install | `page /login` | planned | R5, R8 |
| SAAS-233 | `non_saas` entitlements | admin | Local policy decides features and limits; `tenant.entitle` refused 422 `local_policy_protected`; no `valid_until` allowed on the profile | `vendor /tenants/[id]` | planned | CHECK constraints in `tenant_profile.py` |
| SAAS-234 | `non_saas` applications | admin | Every installed application usable, quotas per local policy | `page /apps` | planned | |
| SAAS-235 | `non_saas` invitation and branding | admin | No vendor invitation; branding at `/settings/company` | `page /invite/accept` | planned | |
