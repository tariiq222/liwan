# Real SaaS backup, restore and two-tenant acceptance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. No commit, merge, push or cleanup is authorized.

**Goal:** Capture real Odoo database and filestore artifacts for two browser-created tenants, restore each to a new isolated target and prove data, attachment bytes and isolation.
**Architecture:** Preserve the shared queue and immutable source binding. Extend only the opt-in real Odoo adapter with artifact authority, once-only new-target approvals and a permanent physical runtime gate. Source capture briefly stops shared Odoo; restore uses separate PG, Odoo and ingress.
**Tech Stack:** TypeScript/PostgreSQL, Python, Docker Compose, Nuxt/Playwright.
**Spec:** ../specs/2026-10-01-shared-saas-real-lifecycle-design.md

## Global Constraints

- Local synthetic Docker resources only, project webvue-saas-life-1790879392; never odoo19 or the PMO stack.
- Preserve milestone-one work and original tenant bindings/data. No commit, merge, push, deployment or deletion.
- Restore targets are new database + filestore only. Never reclaim an unknown effect on lease expiry.
- No credentials, cookies, private artifact paths or raw process output in HTTP responses/evidence.
- Stock Odoo and addons remain unchanged. Independent session/proxy keys for restore ingress.
- Coordinator owns runtime and final suite; worker runs only explicitly permitted focused diagnostics.

## Review Focus

1. Capture cannot race provisioning or a detached old writer; add a real-adapter global gate regression.
2. Revoked authority/control loss prevents subsequent effects and verification; test stage permits and quarantine.
3. Corrupt/link/traversal/oversized archive is rejected before target mutation; test archive validator.
4. Expired or consumed approval cannot authorize a new effect or reuse target; test live authority and registry reservation.
5. Restored attachment HTTP 200 must match bytes and all referenced files; browser and physical readback required.

### Task 1: Real artifact and restore authority (backend worker)

**Files:** schema_010.sql, db.ts, shared/odoo-backup.ts and tests; shared/odoo-adapter.ts, shared/job-store.ts, shared/registry-store.ts and focused tests; tools/shared_saas_lifecycle/odoo_backup.py and tests, odoo_effect.py (global gate).
**Interfaces:** Keep SharedJob/SharedReceipt wire schemas. Fixed service names restore-db and restore-odoo. Internal canonical stateDir/backups/<backupId>, stateDir/restore-registry/registry.json. Detailed source-grounded contract and Odoo Context Brief: .superpowers/sdd/2026-10-01-shared-saas-restore/discovery-report.md.

- [x] Write focused tests covering real-only artifact authority, exact source/approval binding, immutable target reservations, global gate, corrupt archives and interrupted effects; observe expected red with pure focused diagnostics.
- [x] Add additive metadata and real-only approval/precheck path; preserve reference adapter behavior.
- [x] Implement named-child dump/archive/restore with bounded streaming and complete validation before mutation. Pause original writers for capture, resume and verify source availability. Authenticate restored administrator without password rotation.
- [x] Integrate stage-specific claim/capability checks and physical observations, generic receipt and once-only approval finalization. All real provisions also acquire the global gate.
- [x] Provide operator helper for approval and verified restore-registry publication; accepts tenant/backup/approval IDs, derives target and paths. Parent will run it. No new UI required for this operator acceptance.
- [x] Self-review actual diff and report exact tests, files and residual concerns; no full suite/build/runtime.

### Task 2: Isolated restore runtime (coordinator; independent after fixed names)

**Files:** compose.yml, Caddyfile, lifecycle.py, prepare_restore.py, README.md.
**Interfaces:** Fixed services from Task 1; restore-db has its own PG volume, restore-odoo its own files volume and stateDir/restore-odoo.conf; original stateDir mount remains /run/webvue-runtime. Separate networks and session/proxy secrets. Restore host r<approval UUID hex>.restore.saas.accept.webvue.test.

- [x] Extend optional restore profile with four services and distinct networks/volumes.
- [x] Add replay-safe preparation that verifies existing state and never replaces secrets; generate restore edge include from current shared ingress policy.
- [x] Start new services only; validate Caddy config before reloading current edge. Empty restore registry stays closed.

### Task 3: Acceptance, review and evidence (coordinator; depends on Task 1/2)

**Files:** browser-helpers.mjs, isolation.spec.mjs, restore.spec.mjs, lifecycle-checks.config.mjs, docs/verification/shared-restore-acceptance.md.
**Interfaces:** Original sources are last two complete first-tenant browser proofs; all subsequent results name those exact tenant/job IDs.

- [x] Create tenant B through existing browser journey (1/1 fresh pass, 53.4s); read physical filestore independently.
- [x] Confirm both original tenants reject swapped sessions/selectors and return own records/bytes for colliding IDs (1/1 fresh pass, 3.8s).
- [x] Through signed vendor BFF request actual queued backups and restore jobs for A/B, with once-only approvals. Record IDs and verified receipts.
- [x] Fresh restored browser login, project/task display, attachment SHA-256 match; then recheck originals and cross-source/restore sessions.
- [x] Run negative approval/target/artifact checks through HTTP and focused automated tests without overwriting original resources. Preserve failure artifacts. Live forced interruption during capture/restore remains a separately documented acceptance gap.
- [x] Independent code review, address actionable findings, run appropriate focused + full owning suites, collect final runtime/diff state.
- [x] Update acceptance record with exact outcomes and local-only boundaries; preserve resources and all source edits.
