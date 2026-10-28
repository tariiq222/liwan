# SaaS: selling, provisioning and subscription

Surfaces: vendor console `apps/vendor-admin` (`/customers/new`, `/customers/[id]`,
`/tenants/[id]`), control plane `apps/control-plane`, customer pages `/invite/accept`,
`/login`, `/subscription` (`change`, `status`, `invoices`, `branches`) in `apps/web`.
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

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| SAAS-01 | Prospect signs up on a public page and verifies the email | prospect | Tenant requested without a vendor | gap | No `/register`, no email verification |
| SAAS-02 | Vendor creates a customer on a zero-priced or trial plan | vendor owner | Customer, quote and order created; order `not_required` | planned | |
| SAAS-03 | Provisioning finishes | worker | Tenant enabled; first admin holds the entitled roles and is not vendor support | planned | |
| SAAS-04 | Admin accepts the invitation and sets a password | new admin | Signs in at `/login`; used or expired token refused | planned | |
| SAAS-05 | Vendor resends the invitation | vendor owner | New link sent | gap | API exists, no vendor console button |
| SAAS-06 | First-run setup after the first login | new admin | Guided setup | gap | No onboarding wizard; company profile at `/settings/company` |
| SAAS-07 | Admin adds staff with roles | new admin | Staff sign in with their roles (ACC-03) | planned | Users are created with a password; no email invitation for staff (gap) |
| SAAS-08 | Create one user beyond `users.limit` | new admin | Refused with a clear message | planned | |
| SAAS-09 | Subscription summary, usage and invoices | new admin | Values match the control plane | planned | |
| SAAS-10 | Upgrade and downgrade: quote, order, status page | new admin | Entitlements change after fulfilment | planned | |
| SAAS-11 | Start a trial on a plan with `trial_days`; convert it | new admin | Countdown shown; conversion creates an order | planned | |
| SAAS-12 | Vendor extends or ends a trial | vendor owner | Needs step-up; tenant follows the new end | planned | |
| SAAS-13 | Paid first order through Moyasar test mode or the simulator | vendor + prospect | Payment, then provisioning | gap | No UI path to pay before a tenant exists |
| SAAS-14 | Tenant suspended | vendor owner | Sign-in refused with the suspension message | planned | |
| SAAS-15 | Tenant read-only | vendor owner | Reads work, writes refused with a clear message | planned | |
| SAAS-16 | Plan without an application | staff | Application hidden everywhere (PLT-10) | planned | |
| SAAS-17 | Storage quota reached by attachments | staff1 | Upload refused with a clear message | planned | |
| SAAS-18 | Customer-hosted `non_saas` mode | admin | No `/subscription`; no vendor connection needed; every application works | planned | |
| SAAS-19 | Downgrade removes an application with existing data | vendor → admin → staff | Hidden, data kept, back on upgrade | planned | Also J-16 |
