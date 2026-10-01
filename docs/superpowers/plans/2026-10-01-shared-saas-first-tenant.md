# Shared SaaS first real tenant implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development, with the project constraints below overriding automatic commits and cleanup.

**Goal:** Create a shared SaaS tenant in the vendor browser UI, automatically provision real Odoo through the durable worker, then log in and create a project/task/attachment.

**Architecture:** Preserve the durable shared registry and queue. Add an opt-in local Docker runtime adapter and an idempotent shared onboarding service. Persist admin identity separately from generated private credentials; only verified real Odoo state enables customer routing. Dedicated behavior and reference storage tests remain supported.

**Tech Stack:** TypeScript, PostgreSQL 16, Python 3.12, Odoo 19, Nuxt 4, Docker Compose, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-shared-saas-real-lifecycle-design.md` (user authorized starting the first milestone on 2026-10-01).

## Global Constraints

- Worktree `/Users/tariq/.codex/worktrees/saas-real-lifecycle/nasq`, branch `codex/saas-real-lifecycle`, baseline `3899a095a3e6f608c90697faaead0b371ecbc9a3`.
- No commits, merges, pushes, deployment, deletion, or changes to existing runtimes/databases. Never use `odoo19`. Stock `/Users/tariq/code/odoo` is read-only.
- Odoo tests/runtime only on the new explicitly isolated Docker project and scratch databases; orchestrator owns runtime. Workers run only the named focused diagnostics.
- First milestone only: real provisioning and admin browser journey. Backup/restore and second-tenant lifecycle are subsequent milestones, not success claims in this plan.
- No payment or business modules added. Server derives policy from published catalog. Initial administrator gets existing system/PMO/HR role assignments appropriate to installed modules.
- Preserve the reference adapter and its contracts; real adapter selection is explicit. Never use marker-table readiness as real Odoo proof.
- Arabic/English copy, SharedCreatePanel, draft protection, permission checks, and existing Storybook components apply to UI edits.
- Routing: native GPT-6 Astra; implementation high effort for coupled behavior, review medium/high. No child delegation by workers.

## Stable interfaces

- Shared UI onboarding: signed `POST /v1/shared/tenants`, strict body `{ request_id: UUID, name: string, catalog_version: string, catalog_tier: string, admin_name: string, admin_login: string, reason: string }`. Response `{ tenant_id: UUID, job_id: UUID|null, status: string, host: string, replay: boolean }`. A partial failure remains visible and retryable by the same request, without a second tenant or blind effect retry.
- Shared progress: signed `GET /v1/shared/tenants/:id/provisioning`; whitelisted `{ tenant_id, job_id, status, host, admin_login, stage, error_code }`, nullable fields explicitly typed. No password/path/log in HTTP.
- Context adds `shared_onboarding_enabled: boolean` only when the shared runtime is explicitly configured. UI leaves the dedicated form unchanged when false.
- Server derives tenantId/DB from request identity, using `nasq_scratch_` DB prefix compatible with `tools/nasq_cli/managed_verify.py`; hostname uses configured local suffix, never caller filesystem paths.
- Runtime config is private JSON selected by `NASQ_SHARED_RUNTIME_CONFIG`, initially `{schemaVersion:1, projectName, composeFile, envFile, stateDir, domainSuffix}` with absolute file paths and explicit project validation. Compose service names `db` and `odoo`; mounted operator files at `/run/nasq-runtime`. Runtime state contains private `credentials/`, `classifications/`, and operation reservations. Backend implementer documents any necessary schema additions before harness integration.
- `tools/shared_saas_lifecycle/odoo_effect.py` is the bounded physical runner. It consumes validated JSON on stdin and emits one bounded, whitelisted JSON result. No shell interpolation or caller-selected executable. Reuse existing managed policy/credential helpers where their contracts fit.
- Provision database binding is durably reserved before enqueue; customer route stays closed until real checks pass. Keep existing enabled-binding semantics for reference jobs; do not globally permit disabled customers. Provisioning exception must be tied to the server-created onboarding record and exact request/digest.
- A fresh route publication after readiness increments registry revision; reconciliation must deliberately handle completed job binding revision without weakening general binding immutability.

## Review Focus

1. Replay by another actor or changed admin identity must fail without revealing private credentials.
2. Registry publication interruption must remain closed; retry cannot create a second job or database.
3. Worker lease expiry/control disconnect must never permit competing physical actors or route activation from stale evidence.
4. Existing database, symlink, foreign Compose project or unsupported module must be refused before mutation.
5. Ready state requires real module/policy/admin readback and authentication; synthetic rows or successful child exit are insufficient.

### Task 1: Shared onboarding and real provisioning backend

**Ownership:** `apps/control-plane/**`, `packages/commercial-contracts/src/**`, `tools/shared_saas_lifecycle/odoo_effect.py`, `tools/shared_saas_lifecycle/test_odoo_effect.py`, supporting Python modules in that new directory. No other `tools/shared_saas_lifecycle` files, UI files, lockfile, Docker runtime, or existing Odoo addon changes without coordinator discussion.

**Interfaces:** implement the stable HTTP/config contracts above, explicit shared worker entry point, and progress readback. Existing shared queue/runtime functions are the starting point, not a replacement queue.

- [x] Add focused tests for identical replay, changed payload/actor rejection, disabled-unready routing, published-catalog derivation, unavailable adapter, stale ownership and ready gating. Example assertion: `expect(replayed.tenant_id).toBe(first.tenant_id)` with `SELECT count(*) FROM shared_jobs` equal to one; tampered body must reject.
- [x] Add schema migration 009 for onboarding identity/state, register it in `db.ts`; keep secrets out of it. Extend config and strict commercial schemas; handle registry publication as recoverable multi-step state.
- [x] Implement service/API and shared progress; preserve capability checks. A request needs both manage and operations capability; default runtime stays disabled.
- [x] Trace policy, credentials, company and role Odoo symbols in a Context Brief before generating ORM script. Reuse `managed_verify.py` and `managed_credentials.py` where safe; never initialize SaaS via the legacy non-catalog policy shortcut.
- [x] Implement physical adapter with exclusive non-reclaimable resource reservation, authoritative claim recheck, bounded known Compose commands, per-attempt child ownership, cancellation/fail-closed unknown state, and real independent readback/authentication. Existing scratch target refuses adoption. Do not return verified for backup/restore until separately implemented.
- [x] Compose existing `runSharedWorker` through an opt-in entrypoint. Provide bounded lease handling for long installs; stale actor cannot activate. Distinguish effect verification from route activation, persist failures visibly, and make observation/recovery read-only.
- [x] Focused diagnostics only: selected new Vitest files (no live DB unless coordinator supplies URL), `python3 -m unittest tools.shared_saas_lifecycle.test_odoo_effect -v`, syntax checks. No full build/lint/test run in worker. Report exact commands and unrun cases.

### Task 2: Vendor browser creation and status

**Ownership:** vendor tenant pages, vendor composables/types, Arabic/English vendor locales, relevant existing Storybook/tests. Depends on Task 1 API contracts.

- [x] In shared-enabled context show company name, published catalog/tier and admin name/login; omit legacy inventory target. Keep stable request UUID through retry, clear only after accepted navigation.
- [x] Submit via existing signed BFF using the shared endpoint; route to tenant details, poll progress, show Arabic stage/failure and usable host link only after ready. Never display internal path, raw error or password.
- [x] Preserve existing dedicated behavior and draft/permission protections. Test shared/dedicated form selection, retained idempotency key and failed status, using focused existing harness only.

### Task 3: Isolated Docker acceptance and integration

**Ownership:** orchestrator `tools/shared_saas_lifecycle` Compose/config/lifecycle/Playwright files, docs verification, integration-only fixes through assigned worker.

- [x] Create unique Compose project, private secrets, vendor identity and published fixture catalog only. Customer DB must start absent; only worker may create it.
- [x] Start new Postgres/Odoo/guard/web/edge plus control API/worker; verify health with bounded waits. Reuse verified base image content where unchanged and record image IDs/source hashes; build changed UI from this worktree.
- [x] Drive vendor form in real browser, watch queued→running→ready, log in as generated admin, create project/task and upload/download attachment; compare bytes. Record screenshots, job id, DB/module/policy readback and source hashes without credentials.
- [x] Run integrated control-plane typecheck/focused changed suites, meaningful live PG tests on a dedicated `nasq_control_scratch_*`, Python diagnostics, web applicable checks and browser journey. Diagnose baseline separately. No claim of overall SaaS readiness.
- [x] Independent review of actual changed/untracked diff; fix actionable issues and recheck affected paths. Retain worktree and volumes; no commit or merge. Record first milestone achieved only if browser journey passes.

## Completion evidence

First milestone accepted locally on 2026-10-01; see [fresh acceptance](../../verification/shared-first-tenant-acceptance.md). All modifications remain uncommitted in the task worktree. No release or main-integration claim.
