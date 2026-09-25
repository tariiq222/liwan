# SaaS runtime contracts — Package 0 draft

**Status: GROK-REVIEWED LOCAL CONTRACT / LIVE PACKAGE 0 NOT PROVEN / PRODUCTION PENDING.** Grok gave a PASS for the local implementation contract only, not live package or production acceptance. Companion operator-facing draft: [`docs/operations/saas-runtime.md`](../../operations/saas-runtime.md). This document consolidates the Package 0 contract boundary for later implementation; it is not a runtime implementation, production runbook, or authorization to operate customer resources.

**Source basis:** canonical untracked roadmap `docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md` (read from canonical path), linked [company/vendor workspace design](2026-09-23-company-vendor-workspace-design.md), [CP0 commercial contracts](nasq-cp0-commercial-contracts.md), implementation/operator sources `apps/control-plane/src/worker.ts`, `tools/nasq_cli/operator.py`, `tools/nasq_cli/journal.py`, `tools/nasq_cli/adapters.py`, and [vendor local integration evidence](../../verification/2026-09-23-vendor-local-integration.md). Supervisor inventory now provides local Docker/Compose, image, tool-version, and candidate-port observations; production provider/hosting remains unspecified, image freshness/usability are unverified, and no services were started. This inventory evidence does not establish an operational environment.

## 1. Purpose and non-goals

Package 0 defines contracts to let Package 1+ proceed without weakening current safeguards. It fixes neither deployment provider nor actual server inventory. Scope includes opaque target resolution, adapter boundary, secret references, pinned releases, readiness evidence, mutation identity and locking, policy state, backup/restore semantics, non-SaaS protections, sequencing, and future CRM link semantics.

Not authorized or included: runtime code, tests, migrations, database/service operation, production credential use, provisioning, deployment, cutover, CRM implementation, billing, customer portal, auto-delete, or a claim that Package 0 passes. The roadmap is untracked user data and is not changed by this task.

## 2. Source-grounded baseline and invariants

At this source baseline, current worker/operator behavior is constrained to explicit scratch inventory targets. The general operator refuses non-scratch targets, guards database names, and requires explicit inventory; the legacy adapter is read-only and rejects mutations without the journaled operator path. These guards must remain intact. A later managed-runtime adapter must be a distinct, allowlisted boundary, not a bypass or broader interpretation of the general scratch guard. The operator's strict v2 inventory entry (all 16 keys) satisfies both the TypeScript worker's permissive v2 reader and the strict Python operator v2 reader; preserve that full canonical v2 entry for the new adapter. Legacy adapter v1 remains a separate compatibility lane, not a v2 incompatibility defect; document its boundary explicitly.

The operation foundation already has a PostgreSQL control queue, leases and advisory locks in the worker, plus a local SQLite journal, durable receipts, content/target binding, and OS target locks in the operator. Reuse and strengthen these; do not invent parallel queue/journal mechanisms. Existing receipts and checks do not imply that all package behaviors are complete.

Current evidence explicitly remains:

- Create can provision a database/module/policy state but reports `deployment_ready:false`; database existence is not customer service readiness.
- Backup capture remains `UNVERIFIED`; a separate restore drill cannot retrospectively prove capture-time consistency.
- Upgrade does not establish `application_health_verified:true` merely from process or module success.
- `non_saas` is local-policy mode, not an entitlement bypass. Preserve read-only expiry state and existing suspended-login denial; do not invent or silently change expiry, suspension, grace, extension, or recovery semantics.
- A `non_saas` registration/inventory row or visibility in an operations list does not imply an operations grant. Any non-SaaS operations binding is a separate unresolved human decision and cannot confer commercial authority. This does not make the existing `non_saas` classification, local-policy source, preserved expiry behavior, suspended-login denial, or default-off control-plane boundary open business decisions; those are preserved invariants.

None of the above certifies a server, deployment, or customer target.

## 3. Contract A — opaque targets, inventory and managed adapter

Every operation addresses an opaque, stable `target_id` that resolves only through a trusted server-side inventory. A browser/user request may refer to that ID only after target-scoped authorization; it must not supply or control database names, hosts, ports, URLs, filesystem paths, shell arguments, environment variables, connection details, release paths, or secrets. Missing, aliased, stale, ambiguous, disabled, or unauthorized inventory entries fail closed before effects.

Proposed inventory metadata (schema subject to future decision): opaque `target_id`; environment identity; adapter type/version; explicit `commercial_mode`; private resource references; secret-reference handles; immutable release/catalog reference and digest; allowed operations; inventory revision/fingerprint; enrollment/quarantine state. Raw resource addresses and database names stay server-side. Inventory mutation itself is privileged, audited, and invalidates preflight bound to an earlier revision.

Proposed candidate labels only, **not verified resource names or provisioned resources**: `nasq-mgmt-<env>-<region>-01`, `nasq-accept-<env>-<region>-01`, `nasq-accept-<env>-<region>-02`. Example opaque IDs: `tgt_mgmt_<random>`, `tgt_accept_<random>`. Do not infer the provider, region, domain, database names, machine capacity, or actual resources from these examples.

Supervisor inventory observed Docker Desktop Engine 29.8.0 (`desktop-linux`, Linux aarch64), Compose 5.5.1, images `nasq-odoo:dev`, `nasq-odoo:ci`, `nasq-web:dev`, and PostgreSQL tags `postgres:16` / `postgres:16-alpine`; image freshness/usability is unverified. Host PostgreSQL 16.14 and Docker occupy 5432. Local free-at-observation port candidates to recheck before any future use: control PostgreSQL 55432, API 14179, target A Odoo 18169/web 13100, target B Odoo 18170/web 13101, target PostgreSQL 55433 plus a distinct rechecked port (example 55434). Avoid 5432/5433/5434/5436 and do not share control PostgreSQL with customer databases. Host Python 3.12.13 (Odoo venv) is available; ambient `python3` is 3.9.6 and must not be assumed for P1. `/opt/homebrew/bin/node` and `/opt/homebrew/opt/node@22/bin/node` provide Node 22.22.2 with npm 10.9.7; harness-prepended PATH exposed Node 24.21, and earlier regression runs used 24 (record that evidence as-is). P1 selects the explicit Node 22.22.2 binary and an explicit Python 3.12.13 interpreter. `.nvmrc`/web Docker target Node 22. No services were started. Local isolated Compose is therefore a proposed first acceptance adapter, not a verified/ready stack or production hosting choice. Production provider is unspecified.

Local P1 source/test topology is selected: native loopback API and worker on the host; dedicated Compose PostgreSQL bound to `127.0.0.1:55432`; API candidate `14179`; Compose project `nasq-saas-control-local`; fresh runtime/test DB candidates `nasq_control_scratch_p1runtime` and `nasq_control_scratch_p1tests`. This is source/test authorization only, not a running stack, and permits no customer-adapter operations. Worker execution must use a trusted host executor arrangement without a Docker socket mount. The config rejects non-loopback `CONTROL_HOST` absent TLS and the BFF rejects plaintext HTTP to non-loopback upstream; preserve both guards. Production topology remains open. The service build currently uses `tsc --noEmit` while runtime scripts use `tsx`; no standalone `dist` artifact should be presumed. Local resource inventory exists, but live Package 0 and production readiness are not proven.

A managed adapter may be considered only after separate review. It must be independently allowlisted and authorized, leave the local/general scratch-only execution path and its guards unchanged, bind the resolved resource fingerprint to the request/receipt, and enforce mode and operation policy at effect time. Define any managed inventory descriptor as a separately versioned contract; do not force managed targets into the existing scratch-only 16-key operator v2 format or broaden that parser. No browser-selected target kind, wildcard fallback, arbitrary host/path, or weakening of the scratch guard is acceptable.

## 4. Contract B — pinned release and secret references

A release is immutable and verifiable: release/catalog ID, artifact digest, module composition, provenance, and migration compatibility are fixed before execution and recorded in the receipt. Mutable tags/branches, arbitrary path/URL input, or whatever source happens to be checked out are not a release pin. A release ID must resolve under the approved server-side registry/root and its digest must verify before the adapter acts.

Secrets are passed only as server-resolved opaque `secret_ref` handles to the approved adapter boundary. The inventory stores references, not secret bytes. No secret values, production credentials, access tokens, private keys, connection strings, raw subprocess output, or exception text may enter browser payloads, source control, command arguments, event logs, audit records, or receipts. Secret read authority differs from permission to request an operation. No secret-store provider, bootstrap identity, rotation/revocation, or recovery mechanism is selected or asserted here.

Administrative bootstrap and customer admin credentials need an approved short-lived, recipient-bound, audited handoff outside browser-visible receipts/logs, followed by recipient reset/rotation. Delivery channel and recovery procedure are unresolved; no mechanism is implemented.

## 5. Contract C — readiness evidence and stage-specific gates

An evidence item has at least: check ID/version; opaque target and environment; associated operation, release and policy revisions; observed-at and freshness/expiry; `pass | fail | skip`; sanitized summary; and evidence reference/digest. `skip` is never acceptance. Missing or stale evidence is not pass. A readiness aggregate must expose dimensions and freshness, not a synthetic percentage.

Applicability is stage/operation-specific. Do not make later backup/recovery evidence a prerequisite for an isolated local P1 contract/source-test gate or for an earlier create operation. Local P1 loopback validation needs only the evidence relevant to its isolated scope; DNS/TLS dimensions apply when evaluating a domain-routed environment. Create readiness, later recovery readiness, and full operational readiness are distinct claims. A create cannot be `deployment_ready` merely because a database exists, but it need not wait for a Package 4 backup drill to finish its own required checks. Full recovery/operational readiness requires the applicable backup, restore, isolation, and other later-stage evidence.

| Dimension | Applicability | Future pass requires |
| --- | --- | --- |
| Inventory/identity | All applicable stages | Unique enrolled target; exact resource resolution; environment, mode, target and allowlist revalidated. |
| Database/schema | Create and service readiness | Target-bound identity and reachability; compatible migrated schema; required modules in settled state. |
| Release/modules | Create, upgrade and service readiness | Pinned artifact digest/provenance; installed composition matches catalog; no pending/stuck module transition. |
| Desired/observed policy | Create, policy change and service readiness | Correct channel and complete feature/limit map/revision read back from target; no stale or unobserved state. |
| Runtime services | Create/service readiness | Required target-bound service checks pass; dependencies and restart status evidenced. |
| Domain/routing | Domain-routed environments | Approved domain resolves/routes to this target and no other; owner supplies authoritative evidence. Not a loopback local-P1 prerequisite. |
| TLS | Domain-routed environments | Correct hostname, valid chain/expiry and tested HTTPS; renewal owner/path identified. Not a loopback local-P1 prerequisite. |
| Login/access | Service and operational readiness | Synthetic authorized login succeeds; unauthorized login is denied; no cross-tenant/vendor authority leak. |
| Business path | Customer acceptance / full operational readiness | Synthetic isolated record and permitted attachment can be created/read with expected ACLs. Not prerequisite for P1 source/test gate. |
| File isolation | Customer acceptance / full operational readiness | Attachment is target-local, linked to exact record, retrievable, and inaccessible from another target. |
| Backup capture | Backup/recovery readiness (later package) | Declared consistency method, matching DB/file capture, manifest/checksums and protected storage evidence; `UNVERIFIED` fails. Not prerequisite for create or local P1 gate. |
| Restore drill | Recovery readiness (later package) | Restore into a distinct scratch destination; login, modules, policy, records and attachments verified. Does not prove capture consistency or authorize cutover. |
| Isolation | Multi-target acceptance | At least two distinct approved test targets show independent databases, file stores, secrets and identity; negative cross-access checks pass. Customer A/B remain future, not P1. |
| Operations/audit | Every mutation; full operational readiness | Durable target/request/payload/release-bound receipt, sanitized output, and safe failure/reconciliation state. |

Owner roles in the companion runtime guide are proposals; named owners and evidence are pending. `deployment_ready:true` and `active` must remain false until every applicable create/service-readiness dimension is a fresh pass under an approved definition; do not wait for later-package backup/recovery dimensions to begin or accept an earlier create operation. Full operational/recovery readiness has its own additional applicable evidence. Current create remains `deployment_ready:false`; current upgrade does not set application-health verification true. No RPO/RTO, availability, maintenance or retention target is invented. These production/service objectives are not prerequisites for isolated local P1 source/test work; domain/TLS evidence applies only to domain-routed readiness.

## 6. Contract D — mutation receipt, idempotency, locks and fencing

For each mutation, bind request identity to target ID and resource/inventory fingerprint, operation type, canonical payload digest, pinned release digest (where applicable), expected policy revision, and actor/authorization scope. Same identity plus same content returns the durable original result without duplicate effect; any target, operation, digest, release, or revision mismatch conflicts. Current authorization is checked even when returning a prior receipt. Receipt access is scoped to its target and actor permission.

Mutations serialize per target using existing worker advisory locks and operator OS locks/journal. PostgreSQL `hashtext(target_id)` advisory lock collisions can only cause unrelated targets to contend (availability); they are not target authorization or isolation evidence. Keep identity comparisons on the full opaque target ID/fingerprint. Preserve the local journal's uncertain-outcome behavior: `mutating` that is not authoritatively settled becomes `needs_intervention`; another mutation is blocked. A timeout, lost response, expired lease, or worker exit is never success and is never an automatic replay trigger.

Leases require fencing. A worker that loses heartbeat/lease ownership must not publish completion, even if its process remains alive or a replacement claims the operation. The future implementation must prove current lease/fencing ownership for each state-changing completion/write; late workers are rejected. This heartbeat-loss/late-worker gate is mandatory, not optional hardening.

## 7. Contract E — reconciliation across durable sources

Future reconciliation must jointly compare (1) PostgreSQL control-plane operation/queue/event/lease state, (2) SQLite operator-journal request binding and receipt, (3) current inventory revision/fingerprint, and (4) read-only observation of target resources. A recovered or restored stale control-plane database is not proof that an external effect did not occur. Reconcile it against the operator journal and actual target before allowing work to resume.

If evidence is inconsistent, incomplete, or unavailable, quarantine the target and leave `needs_intervention`; do not clear the queue row, invent success, replay create/restore/upgrade, or erase receipt history. Any resolution that promotes a verified outcome records evidence, actor, reason and timestamp. Approval roles/thresholds remain a human decision.

## 8. Contract F — desired versus observed policy

Keep desired and observed policy separate and versioned. Desired is a complete authorized state derived from an immutable catalog/policy input. Observed is a complete readback from the exact target, tied to successful receipt and measured time. A request queued, partially applied, or failing cannot update observed policy as if applied. Stale/mismatched revision is visible and blocks readiness; expected revision must be checked at the mutation boundary, not trusted from a previous UI/preflight snapshot.

SaaS policy uses its explicitly authorized control-plane channel. `non_saas` remains local-policy mode; no central commercial binding, commercial expiry, billing effect, or central policy write is implied. Module presence and policy enablement are distinct: neither implies the other. Removing allowance does not automatically uninstall a module or delete customer data. Preserve existing expiry as read-only and existing suspended-login denial; no new lifecycle semantics in Package 0.

## 9. Contract G — capture, restore verification and cutover

Capture and restore are distinct evidence claims. Until the consistency method is defined and proved, captured backup remains `UNVERIFIED` / not recovery-ready, with DB and file manifest, capture time, release/policy context, checksums, encryption/storage references, and known gaps. A restore drill targets a new, separate scratch resource and verifies login, module/policy state, representative records, and attachment linkage/integrity. It establishes only that this specific drill passed those checks; it cannot prove capture-time consistency, set RPO/RTO, or turn backup status into verified.

Operational cutover/switchover is a separate mutation from restore verification. It requires a separately authorized target, actor/reconfirmation, maintenance and write-suspension procedure, compatibility check, rollback plan, and explicit evidence; a successful restore drill never authorizes cutover. Approval model, exact consistency strategy, maintenance window, whether/when writes pause, backup retention, and data-loss objectives including RPO/RTO are unresolved human decisions.

## 10. Contract H — commercial modes and future CRM link

`saas` and `non_saas` are explicit and separate from hosting model, company identity and target registration. `non_saas` uses local policy and must remain functional without the control plane; it does not gain billing expiry or SaaS entitlement semantics. Existing expiry is read-only at this package boundary. Existing suspended-login denial stays intact. Do not change status, clear expiry, grant grace, or revive access through registration or operation flows.

A non-SaaS record can be visible in an inventory/registration list without any ability to operate it. Operations require a separate explicit grant/binding, scoped to target and approved operations; registration or `non_saas` mode alone grants nothing. Whether such a binding is allowed, who approves it, how it is revoked, and what data it may expose remain undecided. It never grants commercial authority.

Future CRM linkage may represent one commercial customer/account linked to multiple installations. Proposed key semantics: verified stable source-system ID + source-environment ID + record type + source record ID, with explicit verification/audit and uniqueness rules. No name/email matching, no treating Odoo user IDs as commercial customer IDs, and no duplicate invoice ledger. No CRM models, endpoints, UI or placeholder resources are part of this contract.

## 11. Shared-file ownership and independent modules

`tools/nasq_cli/operator.py`, `tools/nasq_cli/journal.py`, `apps/control-plane/src/worker.ts`, and shared inventory/configuration/operation contracts form one sequential single-writer surface, owned by the supervising integrator. No parallel agent should edit those shared files; queue shared changes one after another and re-read the resulting combined contract before proceeding.

Policy/entitlement and backup/restore work may be independently tested only behind declared adapter/module seams, with separate source/test ownership and isolated fixtures. They must not independently patch the shared operator, worker, journal, inventory/config, or cross-cutting receipt schema. Integrate one lane at a time through the shared-file owner. This sequencing is proposed coordination guidance for later packages, not authorization to implement them now.

## 12. Later-package evidence protocol

Every package acceptance report lists each criterion as `pass`, `fail`, or `skip` and cites exact command/check, isolated environment and target, release, evidence output/reference, and limitation. `skip` never counts as acceptance; absent runtime inventory, skipped DB/browser/security checks, or unverified resource availability cannot be converted into a pass. Local scratch evidence does not establish production readiness or deployment.

## 13. Stage-specific decisions and blockers

The local P1 topology is selected for isolated source/test work only: native loopback API and worker on host; dedicated Compose PostgreSQL on `127.0.0.1:55432`; API candidate `14179`; Compose project `nasq-saas-control-local`; fresh isolated runtime/test DB candidates `nasq_control_scratch_p1runtime` and `nasq_control_scratch_p1tests`. This selection authorizes no customer-adapter operation and is not a running or production deployment. It does not depend on production DNS/TLS, hosting provider, RPO/RTO, retention, or customer A/B acceptance. Current `non_saas` classification/local policy, existing expiry behavior, suspended-login denial, and default-off control-plane boundary are preserved invariants, not decision gates.

Before claiming local P1 runtime evidence, recheck selected ports and image usability; use explicit Node 22.22.2/npm 10.9.7 and Python 3.12.13 binaries; verify loopback-only API and DB isolation; select a trusted worker/executor arrangement without a Docker socket; and attach fresh evidence. Earlier regression runs used Node 24.21 and must be reported accurately. No service start authorization is implied beyond the supervisor's separate runtime task. Customer targets A/B remain future.

Production/domain-routed and later operational-readiness decisions remain open: actual target enrollment, production provider, approved domain/DNS/routing/TLS, secret broker and secure credential handoff, release provenance, readiness owners/freshness, backup consistency/storage/encryption/retention, restore/cutover approval, maintenance/write-suspension procedure, measured RPO/RTO and service objectives, human approval roles, and future CRM source/environment/type link semantics. Domain/TLS evidence applies when assessing a domain-routed environment, not to local loopback P1. Backup/restore gates apply to later recovery/operational readiness, not as a prerequisite to starting local P1 or earlier create.

Any optional `non_saas` operations binding remains a separate decision; registration/visibility is not authority. CRM remains unimplemented.

## 14. Package 0 disposition

**GROK REVIEW: PASS for local implementation contract only. LIVE PACKAGE 0: NOT PROVEN. PRODUCTION: PENDING.** This is not live package or production acceptance. Supervisor inventory supports the selected local topology but no services were started by this documentation task, and image freshness/usability/runtime readiness remain unverified. No production provider, RPO/RTO, or service objective is claimed. This refinement changed documentation only in the isolated worktree; no services, tests, databases, customer resources, or production secrets were operated or changed. Separate live P1 runtime work remains with its owner.
