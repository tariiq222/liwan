# Company workspace and WebVue vendor administration

> Superseded on 2026-10-15 by the [vendor administration separation design](2026-10-15-webvue-vendor-admin-separation-design.md):
> vendor administration is the separate `apps/vendor-admin` application and no longer a section of a company
> workspace. The content below is kept as the historical record of the earlier decision.

Status: unified company workspace and separate customer databases approved by user on 2026-09-23.
The user requested verification and implementation through the vendor console, then proposed
using the same workspace for the vendor company (CRM, projects, other modules, employees/customers).
This supersedes the assumption that the vendor UI must be a separately navigated application.
It does not authorize merging customer databases, inheriting operations permission from CRM,
or implementing every Odoo application without a defined scope.

## Existing source

- One product, database per tenant; PMO/HR/chat/meetings implemented.
- CRM is not an implemented WebVue pillar. Stock Odoo crm may be extended later; do not recreate it.
- `/odoo` is the existing support console, not a multi-customer control plane.
- `role=vendor` currently means Odoo support; it must not become a global commercial grant.
- SaaS/non_saas classification is independent of hosting and company identity.

## Recommended composition

The vendor company has its own ordinary WebVue installation and business database.
Employees use existing project/HR/meeting/chat modules in the normal shell.
A new explicitly configured vendor-administration module exposes control-plane pages
in that same shell for separately granted operators only. Ordinary customer installations
leave the module disabled; they cannot activate it with role names, URLs, or client payloads.

The control-plane service, operations journal, inventory and worker remain separate from
business records. The company workspace is an authenticated UI/BFF client of this service.
Customer installations retain independent databases and remain functional without this service.

Identity must bind the configured vendor installation to an Odoo user ID, with current
server-side session validation on every request and a separate revocable vendor grant.
No account linking by matching email; no service secret or target path in the browser.
Customer-supplied `/me`, actor headers or tenant IDs are never authorization evidence.
The existing `role=vendor` and PMO/HR administrator capabilities are insufficient.

## Alternatives considered

1. Separate vendor application: strongest operational separation, but requires a separate
workspace and does not fit the user's updated daily-work intent.
2. Unified UI plus separate control service (recommended): one daily workspace, separate
operations authority/data; requires a carefully authenticated BFF boundary.
3. Vendor execution inside each customer's Odoo: rejected; spreads cross-customer authority
and ties customer business availability to vendor administration.

## CP4 pages

- Overview: registered installations, known health timestamp, pending/failed operations;
  no invented revenue, subscription or payment indicators.
- Installations: search/filter by explicit commercial mode and hosting; details, observed
  policy versus desired policy, operation history; no customer business data.
- New installation: approved server inventory target and catalog version, preflight,
  queued provisioning; successful only after real health evidence.
- Catalog: versioned compositions from validated module/feature registry; immutable published
  versions. No invented prices or commercial plan names.
- Operations: persisted stages, receipts, failure/intervention state and safe retry.
- Audit: authorized views of actor/action/target/time/reason; no raw child logs or secrets.
- Support: explicit grant expiry/revoke only if backed by a real enforcement mechanism;
  no fake impersonation button.

Billing/invoices/payment/self-service remain CP5/CP6. CRM and external customer portal need
explicit scope following clarification; they are not silently counted as shipped modules.

## Operation foundation (independent of UI choice)

Private local inventory maps opaque target IDs to exact scratch resources. No browser SQL,
URL, database names, paths or shell commands. Durable receipts and exclusive per-target
locks prevent duplicate side effects. A crashed/uncertain mutation requires reconciliation,
not automatic replay. Expected policy revision is rechecked under the mutation row lock.
Candidate backup stays UNVERIFIED; successful restore does not prove capture consistency.
All verification uses new scratch resources with explicit addons and independent ports.

## Acceptance

Tenant businesses keep working with control service unavailable. Non_saas has no billing
expiry. Customer installation cannot call vendor surface; revoked vendor grant rejects next
request; repeated request cannot repeat side effects or leak another target's receipt.
A real scratch create/inspect/entitle/backup/restore path is proven separately from unit tests.
Browser evidence includes Arabic RTL, English LTR, direct URL/refresh/back, permission denial,
empty/error/loading states and 390/768/1440 widths. No production readiness inferred.

## Scope resolution

User confirmed the internal company environment is not a SaaS subscription sold to itself.
It uses the same product with vendor-specific modules, with independent customer databases.
No external client login to company business records is included. CRM remains a future pillar.
Implementation through CP4 proceeds under the existing instruction to execute.
The implementation uses a headless Node/PostgreSQL service and signed private BFF requests;
this is internal machine authentication, not a new OAuth server or customer recovery flow.
