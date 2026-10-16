# Nasq vendor admin (`apps/vendor-admin`)

The staff console of the Nasq vendor: customers (every client, with its subscription and workspace), plans, bundles, catalog, invoices, operations, audit and the
team that may use them. It is a separate Nuxt 4 application from the customer app (`apps/web`) and is served on its own
`admin` host. Arabic is the default locale and the UI is RTL-first. Design rules: [DESIGN.md](../../DESIGN.md).

## Boundaries

- It renders with the shared layers `@nasq/ui` and `@nasq/commercial-ui` and takes types and request signing from
  `@nasq/commercial-contracts`. It never imports `apps/web`, `odoo-addons`, `@nasq/contracts` or the control plane code,
  and never calls an Odoo route (rule `VA1` in `tools/arch_policy.py`). `apps/web` never imports this app.
- There is no `/vendor` page prefix: pages are `/overview`, `/customers` (`/customers/new`, `/customers/{id}?tab=` and, for a workspace that has no commercial record, `/tenants/{id}`), `/operations`, `/plans`, `/bundles`,
  `/catalog`, `/invoices`, `/audit`, `/team`, `/login` and `/enroll`. The API prefix `/api/vendor/v1/**` names the upstream
  control plane surface, not a page.

## How the BFF relates to the control plane

The browser talks only to this app's own server routes (`server/api/**`, the backend for frontend). The BFF holds the
service key and forwards each call to the control plane (`apps/control-plane`) as a signed request
(`signServiceRequest` from `@nasq/commercial-contracts/server`):

- Anonymous sign-in and enrollment routes (`/v1/admin/auth/*`) are signed with `anonymous: true`.
- All other routes are signed with the numeric account id taken from the session cookie, plus the header `x-nasq-session`.
- The session cookie (`__Host-nasq_admin`, `HttpOnly; Secure; SameSite=Strict; Path=/`; on a loopback `http:` origin in
  development only: `nasq_admin` without `Secure`) is never forwarded upstream.
- **The BFF always overwrites `x-nasq-client-ip`** with `getRequestIP(event, { xForwardedFor: trustProxy })`. A value sent
  by the browser is never forwarded. Turn `NUXT_TRUST_PROXY` on only behind the edge that sets `X-Forwarded-For` itself.
- Without a service key of at least 32 bytes every API route answers `503 { "code": "vendor_unavailable" }`.
- Request bodies are capped at 64 KiB at every hop: the edge (`request_body { max_size 64KB }` in
  `deploy/vendor-admin/Caddyfile.snippet`), this BFF (`413 payload_too_large`) and the control plane.

## Environment

| Variable | runtimeConfig key (private) | Meaning |
|---|---|---|
| `NUXT_CONTROL_URL` | `controlUrl` | Base URL of the control plane (`https://` outside loopback). |
| `NUXT_SERVICE_KEY` | `serviceKey` | Service key, at least 32 bytes; equals the control plane `CONTROL_SERVICE_KEY`. |
| `NUXT_INSTALLATION_ID` | `installationId` | Equals the control plane `CONTROL_INSTALLATION_ID`. |
| `NUXT_ADMIN_ORIGIN` | `adminOrigin` | Public origin of this app, for example `https://admin.example.com`; decides the cookie flavour. |
| `NUXT_TRUST_PROXY` | `trustProxy` | `true` when a trusted reverse proxy sets `X-Forwarded-For`. |
| `NUXT_PUBLIC_DEV_LOGIN` | `public.devLogin` | Local development only (the one public setting): `true` turns on the developer sign-in (see "Developer sign-in (local only)"). Never set it in production. |

The control plane additionally needs `ADMIN_SECRET_KEY`, `ADMIN_RP_ID` and `ADMIN_ORIGIN` (see
`deploy/control-plane/env.example`); `ADMIN_ORIGIN` must equal `NUXT_ADMIN_ORIGIN`. `deploy/vendor-admin/env.example` is
the template for this app.

## Deployment

The edge block is `deploy/vendor-admin/Caddyfile.snippet`; the environment template is `deploy/vendor-admin/env.example`.

- Publish only the edge (https). **Port 3100 must never be published outside the container network**: with `trustProxy` on,
  the BFF believes `X-Forwarded-For`, so it must be reachable from the edge alone.
- With an https `NUXT_ADMIN_ORIGIN`, `NUXT_TRUST_PROXY` must be `true`; the BFF answers `503` otherwise.
- The Caddy block sets `X-Forwarded-For` to the remote address itself (it overwrites, never appends) and caps request
  bodies at 64KB. The control plane stays on the private network.

## Run locally

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm ci --ignore-scripts
export NUXT_CONTROL_URL=http://127.0.0.1:<control plane port>
export NUXT_SERVICE_KEY=<same value as CONTROL_SERVICE_KEY>
export NUXT_INSTALLATION_ID=<same value as CONTROL_INSTALLATION_ID>
export NUXT_ADMIN_ORIGIN=http://localhost:3100
npm -w apps/vendor-admin run dev -- --port 3100
```

Start the control plane with `ADMIN_RP_ID=localhost` and `ADMIN_ORIGIN=http://localhost:3100`, create the first owner with
`npm -w apps/control-plane run admin -- bootstrap-owner ...`, and open the printed `.../enroll#...` link. See
`docs/operations/saas-commercial-runbook.md`, section 3.

### Developer sign-in (local only)

The login page and the step-up panel can offer one-click buttons ("دخول التطوير" and "تأكيد التطوير") that skip the passkey
and authenticator. They exist only on a developer machine and are refused everywhere else:

- Control plane: set `ADMIN_DEV_LOGIN_EMAIL=<email>` (with `ADMIN_ORIGIN=http://localhost:3100`, a loopback `CONTROL_HOST` and
  `NODE_ENV` not `production`). The control plane **fails to start** if any of these does not hold. Then create the account once:
  `npm -w apps/control-plane run admin -- dev-owner <email> "<display name>"` (idempotent; the account is an active owner with
  no password, passkey or authenticator, and the command refuses an email other than `ADMIN_DEV_LOGIN_EMAIL`).
- This app: set `NUXT_PUBLIC_DEV_LOGIN=true` next to `NUXT_ADMIN_ORIGIN=http://localhost:3100`, build it (`npm -w apps/vendor-admin run build`)
  and bind it to loopback: `HOST=127.0.0.1 PORT=3100 node .output/server/index.mjs`. The BFF routes `/api/auth/dev-login` and
  `/api/auth/dev-step-up` answer 404 unless the origin is a loopback `http:` origin **and** the socket peer is loopback (`127.0.0.1`,
  `::1`; `X-Forwarded-For` is never read), so a forged `Origin` from the network opens nothing. They do not read `NODE_ENV`, because
  the BFF works only from the production build, which always runs with `NODE_ENV=production`; the control plane gate above is the binding one.
- Both calls are audited with the reason `dev-login`, and `dev-step-up` only works for the `ADMIN_DEV_LOGIN_EMAIL` account.

Checks: `npm -w apps/vendor-admin run lint`, `npm -w apps/vendor-admin run test`, `npm -w apps/vendor-admin run build`.
Production image: `docker build -f apps/vendor-admin/Dockerfile -t nasq-vendor-admin .` (port 3100).

## Live proof against the real control plane

`apps/vendor-admin/e2e/live-control.spec.ts` (config `playwright.live.config.ts`) signs in, enrolls and manages the team
against the real control plane with real WebAuthn verification (a virtual authenticator) instead of the mock service. It
needs the whole stack, so it is not part of `npm run e2e`, `npm test` or CI. One command starts and stops everything,
prints a pass/fail table and exits non-zero on any failure:

```sh
PATH=/opt/homebrew/bin:$PATH node tools/vendor_admin_local_check.mjs
```

It creates the scratch database `nasq_control_scratch_p3live` on the local Postgres (127.0.0.1:5432), runs the control
plane on `127.0.0.1:4711` and this app's production build on `localhost:3103` with per-run random keys (never printed),
writes screenshots to `.superpowers/wave4-live-shots/`, and drops the database on exit. It refuses to run against any
database not named `nasq_control_scratch_*`.
