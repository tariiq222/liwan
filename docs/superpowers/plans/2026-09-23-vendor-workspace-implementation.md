# Vendor workspace implementation plan

> Agentic workers: use subagent-driven-development with bounded ownership; coordinator alone runs final integrated checks. No commits without separate authorization.

Goal: complete local operations foundation and a real vendor administration section inside the vendor company's existing WebVue workspace.
Architecture: company business database stays separate from headless control-plane PostgreSQL and from every customer database. Existing Odoo login is checked server-side; explicit control-plane grants authorize vendor operations.
Tech stack: existing Nuxt UI/Vue, TypeScript/Zod, Node HTTP service, PostgreSQL, Python local CLI.
Spec: docs/superpowers/specs/2026-09-23-company-vendor-workspace-design.md plus existing CP0 contracts; shared execution contract .superpowers/vendor-control/contracts.md.

## Global constraints

- Database per customer; no product fork; non_saas has no commercial expiry.
- No odoo19 tests, live target mutation, upstream edits, commit/merge/push/deploy.
- No CRM, payments, customer portal, or revenue placeholders in CP4.
- No client-supplied operation target coordinates or authority.
- Scratch verification isolated; backup capture consistency distinguished from restore verification.

## Review focus

1. Spoofed actor/role/email or replayed signed request cannot obtain a vendor grant.
2. Revoked membership is denied even when retrying an existing request.
3. Worker crash after mutation cannot cause blind retry or false success.
4. Non_saas administrative operations never gain billing authority or clear support controls.
5. Control-plane outage or disabled customer config never blocks ordinary company/customer work.

## Task 1: CP2 execution foundation
Ownership: tools/webvue_cli/**, tools/test_webvue_cli*.py, tools/check_cp2_scratch.py.
Consumes: explicit commercial classification, existing backup/restore tools.
Produces: python -m webvue_cli.operator; private inventory, guarded policy, durable receipt.
- [x] Baseline unit checks and independent source review.
- [ ] Tests for journal replay/conflict, locks, revision race, sensitive-output redaction.
- [ ] Implement durable operation journal, explicit target execution, create/entitle/backup/restore/upgrade safely on scratch.
- [ ] Focused tests; coordinator actual scratch exercise and review.

## Task 2: Independent control-plane service
Ownership: apps/control-plane/**, packages/commercial-contracts/**.
Consumes: trusted identity assertion and Task1 operational entry; exact wire contract in shared execution contract.
Produces: /v1 API, explicit grants, tenant registry, catalog versions, queue/outbox/audit, worker.
- [ ] Failing auth/payload/membership/idempotency/queue tests.
- [ ] SQL migrations and transactional repositories, strict APIs, private worker.
- [ ] Focused service tests with explicit scratch PostgreSQL only; coordinator final runtime checks.

## Task 3: Company workspace vendor UI and BFF
Ownership: apps/web/app/pages/vendor/**, middleware/vendor.ts, composables/useVendor*.ts,
apps/web/server/api/vendor/**, server/utils/vendor*.ts, i18n/locales/{ar,en}/vendor.json, focused tests.
Consumes: fixed API contract, service signing helper.
Produces: real pages and live session-validated same-origin BFF; no second login or shell.
- [ ] Failing BFF authorization/disabled-surface/CSRF and UI permission tests.
- [ ] Add working pages/forms/actions, existing Storybook components, Arabic/English.
- [ ] Report required shared integration hooks to coordinator; no shared-file edits.

## Task 4: Integration and acceptance
Coordinator owns root package/lockfile, Nuxt config, DESIGN.md, shared navigation and module registry,
shared locales and story inventory, runtime and all final broad verification.
- [ ] Integrate explicit vendorWorkspaceEnabled config and context-based navigation without modifying Odoo role grants.
- [ ] Install isolated dependencies and run owning tool/web/contracts/service checks.
- [ ] Real CP1 scratch install tests; real CLI create/entitle/backup/restore/upgrade and worker receipt evidence.
- [ ] Browser direct URLs, forms, permissions, failures and RTL/LTR widths on isolated services.
- [ ] Independent integrated review and fix findings; document exact limits and deliver local branch without integration.

## Delivery status

Tasks 1-3 and local shared integration are implemented. Fresh scoped acceptance and
remaining rollout boundaries are recorded in `docs/verification/2026-09-23-vendor-workspace.md`.
The historical checklist above is retained as the plan; it is not proof that every
original acceptance gate passed. In particular, English LTR browser acceptance and
full customer application deployment remain unverified. No commit or integration
into canonical main was authorized or performed.
