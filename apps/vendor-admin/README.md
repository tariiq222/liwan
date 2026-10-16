# Nasq vendor admin (`apps/vendor-admin`)

The staff console of the Nasq vendor: customers, tenants, plans, bundles, catalog, invoices, operations, audit and the
team that may use them. It is a separate Nuxt 4 application from the customer app (`apps/web`) and is served on its own
`admin` host. Arabic is the default locale and the UI is RTL-first. Design rules: [DESIGN.md](../../DESIGN.md).

## Boundaries

- It renders with the shared layers `@nasq/ui` and `@nasq/commercial-ui` and takes types and request signing from
  `@nasq/commercial-contracts`. It never imports `apps/web`, `odoo-addons`, `@nasq/contracts` or the control plane code,
  and never calls an Odoo route (rule `VA1` in `tools/arch_policy.py`). `apps/web` never imports this app.
- There is no `/vendor` page prefix: pages are `/overview`, `/customers`, `/tenants`, `/operations`, `/plans`, `/bundles`,
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

## Environment

| Variable | runtimeConfig key (private) | Meaning |
|---|---|---|
| `NUXT_CONTROL_URL` | `controlUrl` | Base URL of the control plane (`https://` outside loopback). |
| `NUXT_SERVICE_KEY` | `serviceKey` | Service key, at least 32 bytes; equals the control plane `CONTROL_SERVICE_KEY`. |
| `NUXT_INSTALLATION_ID` | `installationId` | Equals the control plane `CONTROL_INSTALLATION_ID`. |
| `NUXT_ADMIN_ORIGIN` | `adminOrigin` | Public origin of this app, for example `https://admin.example.com`; decides the cookie flavour. |
| `NUXT_TRUST_PROXY` | `trustProxy` | `true` when a trusted reverse proxy sets `X-Forwarded-For`. |

The control plane additionally needs `ADMIN_SECRET_KEY`, `ADMIN_RP_ID` and `ADMIN_ORIGIN` (see
`deploy/control-plane/env.example`); `ADMIN_ORIGIN` must equal `NUXT_ADMIN_ORIGIN`. `deploy/vendor-admin/env.example` is
the template for this app.

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

Checks: `npm -w apps/vendor-admin run lint`, `npm -w apps/vendor-admin run test`, `npm -w apps/vendor-admin run build`.
Production image: `docker build -f apps/vendor-admin/Dockerfile -t nasq-vendor-admin .` (port 3100).
