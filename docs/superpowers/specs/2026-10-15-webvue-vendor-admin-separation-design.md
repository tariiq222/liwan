# WebVue vendor administration separated from the customer product

Status: design approved section by section by the owner on 2026-10-15; written spec awaiting owner review.
Supersedes the unified-workspace decision in
company/vendor workspace design (2026-09-23).
Does not authorize deployment, DNS, merging, pushing, or any work listed under "Out of scope".

## Goal

The WebVue vendor administration (customers, subscriptions, billing, catalog/pricing, tenant
operations, audit) becomes its own application on its own domain, with its own accounts and
mandatory passkeys. Customer installations no longer ship, hide, or proxy any vendor
administration code. Both applications keep the same WebVue look through a shared design layer.

Success means:

- `apps/web` builds and runs with no vendor administration pages, components, server routes,
  locale namespace, navigation items or configuration flags.
- `apps/vendor-admin` is the only browser client of the vendor surface of `apps/control-plane`.
- `apps/control-plane` owns vendor identity, sessions and roles and is never exposed publicly.
- Vendor administration keeps working when every customer installation, including WebVue's own
  company installation, is down.

## Terminology (binding for code and docs)

| Term | Meaning |
|---|---|
| WebVue vendor administration / «لوحة تحكم ويب فيو» | `apps/vendor-admin`, served at `admin.webvue.sa` |
| Control plane | `apps/control-plane`, the private backend service and its `webvue_control` database |
| WebVue company installation | WebVue's own ordinary tenant, optional, with no vendor privileges |

The phrase "vendor console" (previously used for both `/odoo` and the `/vendor/*` header badge)
is retired from active docs. «إدارة ويب فيو» as a section inside a company installation no longer
exists.

## Current state (verified 2026-10-15 from source, `main` at `6802bb66`)

- The control plane is already a separate service and database, bound to loopback by default
  and refusing non-loopback binding without TLS (`apps/control-plane/src/config.ts`).
- Vendor identity is borrowed from a company installation: `apps/web/server/utils/vendor-control.ts`
  reads the Odoo `/api/v1/me` session, then signs a request whose actor is
  `(vendorInstallationId, odoo uid)`, checked against `vendor_memberships(issuer, actor_uid,
  capabilities)` in the control plane.
- About 45 page files under `apps/web/app/pages/vendor/`, 9 components, 5 composables and a
  `vendor` locale namespace ship to every customer build, hidden by `vendorWorkspaceEnabled`.
- The navigation exposes «إدارة ويب فيو» (`/vendor/overview`) and «وحدة التحكم» (`/odoo`, the raw
  Odoo backend for `group_vendor_support`). The shared edge guard already rejects `/odoo` and
  `/web` (`deploy/shared/guard.mjs`).
- `tools/arch_baseline.json` records eight R5 commercial-import exceptions in `apps/web`.

## Architecture

```
browser ──HTTPS──▶ apps/vendor-admin (Nuxt app + BFF)   admin.webvue.sa
                        │  private network, signed service request + nonce
                        ▼
                   apps/control-plane ──▶ webvue_control (PostgreSQL)
```

| Unit | Does | Does not |
|---|---|---|
| `apps/vendor-admin` | Renders pages; holds the session cookie; signs and forwards requests | Decide authorization; store data; call Odoo or any customer installation |
| `apps/control-plane` | Authenticates the session; resolves roles to capabilities; executes; audits | Listen on a public interface |
| `packages/ui` | Design tokens, theme, fonts, i18n base, presentational components, shell template | Call any API; know about customers, Odoo, tenants or vendor data |

The BFF keeps the existing service-key signature and nonce as a second layer. Its key is a
distinct secret of at least 32 bytes, different from the customer commercial key and from
`INTERNAL_EFFECT_KEY` (the control-api to control-worker channel added on 2026-10-15), and the
control plane refuses to start when any two of them are equal. The control
plane never trusts an actor claimed by the BFF: it resolves the actor from the session token
on every request.

Customer commercial traffic (`/subscription`, `apps/web/server/api/commercial`,
`customer-commercial.ts`, customer issuer/key) is unchanged by this work.

## Identity and sessions (control plane)

New tables in `webvue_control`: `vendor_accounts`, `vendor_account_roles`, `vendor_passkeys`,
`vendor_totp`, `vendor_recovery_codes`, `vendor_sessions`, `vendor_invitations`,
`vendor_auth_challenges`, `vendor_auth_attempts`.

`vendor_memberships` is kept as the derived capability table, because the workers re-check it
under row locks at execution time (`worker.ts`, `shared/job-store.ts`, `shared/registry-store.ts`,
`shared/onboarding.ts`, `shared/shared-backup.ts`, `shared/job-dispatcher.ts`). Only the account
service writes it: one row per account (`issuer` = the vendor installation id, `actor_uid` =
`vendor_accounts.id`), `capabilities` = the union of the account's roles, `revoked_at` set when the
account is disabled. The `grant`/`revoke` CLI commands that wrote it directly are removed. There
are no live vendor members to migrate (correction made 2026-10-15 while planning; the earlier
draft said the table would be dropped).

Login:

| Situation | Method |
|---|---|
| Normal sign-in | Passkey only (WebAuthn, user verification required), no password |
| Lost device | Password (Argon2id) + TOTP (RFC 6238) |
| Lost both | One of ten single-use recovery codes, or a reset by an owner |
| Last owner lost everything | Server-side CLI only |

Enrollment:

1. An owner creates an invitation (email, roles) and receives a single-use link valid 24 hours,
   copied manually. No mail server is required.
2. The invitee registers a passkey, sets a password and TOTP, and receives recovery codes.
   The account is unusable until all three are complete.
3. The first owner is created by a CLI command that only works while no owner exists.

Sessions:

- 256-bit random token; only its hash is stored.
- Cookie `__Host-webvue_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
- Idle timeout 30 minutes, absolute lifetime 12 hours.
- Step-up: a fresh passkey assertion is required when the last one is older than 5 minutes
  before any action needing `vendor.pricing.manage`, `vendor.billing.manage`,
  `vendor.operations.run`, `vendor.accounts.manage`, or a catalog publication.
- Disabling an account revokes all its sessions immediately.

Protection:

- Per-account and per-IP attempt limits with temporary lockout.
- One generic authentication error; no account enumeration.
- WebAuthn relying party ID and origin are bound to the configured admin domain.
- TOTP secrets are encrypted at rest; recovery codes are stored hashed.
- Every authentication event (success, failure, enrollment, reset, lockout) is written to the
  existing `audit_events`.

Libraries are established, version-pinned packages (`@simplewebauthn/server` for WebAuthn, an
Argon2id binding, a standard TOTP implementation); exact versions are chosen and checked in the
implementation plan.

## Roles and authorization

The eight existing capabilities stay as they are and every existing route check is kept.
One capability is added: `vendor.accounts.manage` (members, invitations, roles).

| Role | Key | Capabilities (`vendor.` prefix omitted) |
|---|---|---|
| Platform owner / مالك المنصة | `owner` | all eight + `accounts.manage` |
| Customer success / نجاح العملاء | `customer_success` | `read`, `tenants.manage`, `subscriptions.manage` |
| Finance / المالية | `finance` | `read`, `billing.manage` |
| Product / المنتج | `product` | `read`, `catalog.manage`, `pricing.manage` |
| Technical operations / التشغيل التقني | `operations` | `read`, `operations.run` |
| Support / الدعم الفني | `support` | `read`, `audit.read` |

Rules:

- Roles are defined in code and are not editable from the UI. Custom roles are out of scope.
- An account may hold several roles; capabilities are their union.
- At least one active owner must always exist; disabling the last owner or removing the last
  owner role is rejected, including for oneself.
- An owner can change their own roles only while another active owner exists.
- Roles and account status are read from the database on every request, so a revocation applies
  to the next request.
- Navigation shows only permitted items, but the control plane is the enforcement point and
  answers `403` regardless of the client.
- Role changes, invitations, disabling and sensitive operations record actor, target, time and a
  written reason, following the existing catalog-operation pattern.

Support reads commercial and operational state only. Access to a customer's business data is the
separate in-tenant `vendor_support` role, which this work does not change.

## Shared design layer (`packages/ui`)

A Nuxt layer consumed by both apps through `extends`. A unit moves only if it is presentational:
no API call, no `useMe`, no customer capability, no Odoo knowledge.

Moves: `tokens.css`, `main.css`, `components.css`, `shell.css`; the Nuxt UI theme from
`app.config.ts`; IBM Plex Sans Arabic fonts; base i18n configuration (Arabic default, RTL-first)
and generic shared strings; `components/shared/feedback/*`; presentational data and form
components such as `DataTable`, `FilterBar`, `Pagination`, `StatusBadge`, `MetricTile`,
`RowActions`, `DateField`, `InlineConfirm`, `UnsavedChanges`; `ShellFrame`, `BrandWordmark`; and a
presentational shell template (rail, header, context sidebar) that receives its items as props.

Stays in `apps/web`: `PersonPicker`, comments, attachments, notification center, global search,
`ShellHeader`/`ContextSidebar` wiring and every composable that knows customer modules.
The exact per-component list is fixed in the implementation plan after reading each file.

Storybook stays in `apps/web` as the single catalog and also loads `packages/ui`; stories stay
under `apps/web/stories/**`, so the paths named in `AGENTS.md` and `DESIGN.md` remain valid.
`apps/vendor-admin` follows `DESIGN.md` like `apps/web`.

`packages/ui` may not import from `apps/web`, `apps/vendor-admin` or `apps/control-plane`.

Fallback: if splitting the shell proves larger than planned, phase 1 moves only the visual
identity and simple components, and `apps/vendor-admin` builds its frame from them. The plan
records this explicitly if it is used.

## Removal from the customer product

Removed from `apps/web`:

- `app/pages/vendor/**`, `app/components/vendor/**`, `i18n/locales/*/vendor.json`
- `server/api/vendor/**`, `server/utils/vendor-control.ts`, `server/utils/vendor-signature.ts`
  and their tests
- `useVendorCommercial`, `useVendorSubscriptions`, `utils/vendorCommercial.ts`,
  `utils/vendorPackages.ts`, `utils/vendorSubscriptions.ts`
- navigation items «إدارة ويب فيو» and «وحدة التحكم», `vendorWorkspaceEnabled` and the other
  `vendor*` runtime config keys

Kept in `apps/web`: `/subscription`, `/invite` and their customer-commercial code; the dedicated
`/odoo` proxy rule for break-glass support only, with no navigation entry.

Expected policy effect: six of the eight R5 exceptions disappear and the baseline is rewritten
with `python3 -B tools/arch_policy.py --write-baseline`. `tools/arch_layers.json` loses the
`vendor` commercial page gate and its `allowed` entries and gains `apps/vendor-admin` and
`packages/ui`. Removing a commercial page gate and moving a web folder count as weakening under
`AGENTS.md`, so that commit needs the owner's `Architecture-approved-by:` trailer, added by the
owner, never by an agent.

## Architecture policy

`tools/arch_policy.py` gains rules:

- nothing in `apps/web` imports from `apps/vendor-admin`, and the reverse;
- `apps/vendor-admin` imports only from itself, `packages/ui`, `packages/commercial-contracts`
  and its declared dependencies, and never calls Odoo paths;
- `packages/ui` imports from no app.

R5 in `AGENTS.md` is restated: nothing in `odoo-addons` or `apps/web` imports from or references
the control plane, except the existing customer-commercial path; `apps/vendor-admin` is the only
vendor client. Git area `cp` covers `apps/vendor-admin`, so `tools/git_policy.py` is unchanged.

## Deployment

- `admin.webvue.sa` → `apps/vendor-admin` (public, HTTPS).
- `apps/control-plane` stays on the private network.
- Local development: `apps/vendor-admin` on its own port (for example `3100`) with an entry in
  `.claude/launch.json`.
- Deployment configuration under `deploy/` is written in this work. Actual deployment, DNS and
  certificates need separate owner authorization.

## Testing and acceptance

| Layer | Proof |
|---|---|
| Control plane | Passkey, password+TOTP and recovery-code flows; idle and absolute expiry; step-up; lockout; last-owner rule; every role gets `403` outside its capabilities; revocation applies on the next request |
| `apps/vendor-admin` | Unit tests; Playwright with a virtual WebAuthn authenticator; Arabic RTL and English LTR; 390/768/1440 widths; direct URL, refresh, back; forbidden, empty, loading and error states |
| `apps/web` | `/vendor/*` returns 404; navigation lacks both items; before/after screenshots of key pages match (ar/en, light/dark, three widths) on the isolated mock stack; `npm test` and e2e results unchanged against a pre-change baseline |
| Policy | `arch_policy.py --base main` and `git_policy.py --base main` pass |

All evidence is local. It does not establish production readiness.

## Phases

Each phase is its own `codex/cp-*` branch and worktree, with one logical change per commit.

Ordering constraints with parallel work open on 2026-10-15:

- Phase 1 starts only after `codex/web-project-surfaces` is merged or set aside: that branch edits
  `components.css`, `shell.css`, `components/shared/layout/*` and `DESIGN.md`, which phase 1 moves.
- Phase 2 starts after `codex/cp-saas-admin-roles` is merged, takes the next free
  `schema_NNN.sql` number at that time, and merges current `main` before review.

1. `packages/ui`: extract the design layer; `apps/web` is visually unchanged.
2. Control-plane identity and roles: tables, authentication, sessions, six roles; no UI.
3. `apps/vendor-admin`: the app, login and enrollment screens, and the moved pages.
4. Cleanup: remove vendor code from `apps/web`; update the active docs below; update
   `tools/arch_layers.json` and the baseline (owner trailer required).

## Documentation updates (phase 4)

| Document | Change |
|---|---|
| company-vendor-workspace design (2026-09-23) | Superseded by this design; file deleted (history in Git) |
| `AGENTS.md` | Restate R5 as above |
| `DESIGN.md` | Remove section 9 and the `/odoo` navigation row; state that `apps/vendor-admin` follows `DESIGN.md` |
| `docs/agents/web-rules.md` | Remove `/odoo` as a vendor console path |
| `docs/agents/odoo-rules.md` | Bundles live in the WebVue vendor administration |
| `apps/web/PRODUCT.md` | Fix the "vendor console" wording |
| `deploy/security/edge-rate-limit.md` | Fix the "vendor console" wording |
| `docs/superpowers/specs/2026-10-11-webvue-tasmim-design.md` | Note that `/vendor/*` and its badge moved to `apps/vendor-admin` |
| `docs/WORKSPACE.md` | Mark the vendor workspace integration section as historical and superseded |

Dated reports and plans under `docs/verification/`, `docs/project-closure/` and
`docs/superpowers/plans/` are not edited; they describe their own checkpoints.

## Out of scope

Custom vendor roles; email delivery; SSO; an external customer portal; changes to the in-tenant
`vendor_support` role or a time-limited support grant; production deployment, DNS and
certificates; any change to customer commercial traffic.

## Decisions 2026-10-16

- Lost-device recovery is CLI-only (`npm -w apps/control-plane run admin -- reset-account`) or an owner-issued reset. There is
  deliberately no route that adds a passkey from a password+TOTP session: a phished password and TOTP code would otherwise
  let an attacker register their own passkey and then step up.
- An owner who issues a reset sees the enrollment link and could enroll as that account. Owners are mutually trusted; the
  exposure is bounded by audit (`account.reset_issued`, `account.reset_completed`). Launch with two owners when possible.
- The last active owner cannot reset itself (`409 last_owner`): its recovery is the CLI `reset-account`.

## Addendum 2026-10-16

- D1: the shared billing presentation (price breakdown, invoice lines and their helpers) moves to `packages/commercial-ui`, a Nuxt layer extending `@webvue/ui`, used by both apps.
- D2: no `/vendor` route prefix; the whole app is the vendor console, while the BFF keeps the API prefix `/api/vendor/v1/**`.
- D3: vendor code and config are removed from `apps/web` in phase 3, because `apps/web` cannot build with dangling imports; phase 4 keeps only docs, the `arch_layers.json` gate removal and sign-off.
- D4: step-up is an inline panel, not a dialog; the browser's own passkey prompt is native UI.
- D5: TOTP setup shows a QR code (drawn in the browser by `qrcode-generator@2.0.4`, so the secret never leaves the page), the setup key and the `otpauth://` link.
