# SaaS runtime operations (Package 0 contract draft)

**Status: GROK-REVIEWED LOCAL CONTRACT / LIVE PACKAGE 0 NOT PROVEN / PRODUCTION PENDING.** Grok gave a PASS for the local implementation contract only; this is not live package acceptance or production acceptance. It is not an operational runbook or proof that any environment is ready. Supervisor inventory confirms local Docker Desktop Engine 29.8.0 (`desktop-linux`, Linux aarch64), Compose 5.5.1, and existing local images; image freshness/usability remain unverified. Local PostgreSQL 16.14 and Docker both occupy 5432. No services were started by the inventory lane. Local P1 topology has been selected for isolated source/test work only: native loopback API and worker on the host; dedicated Compose control-plane PostgreSQL bound to `127.0.0.1:55432`; API candidate `14179`; Compose project `nasq-saas-control-local`; fresh runtime/test DB candidates `nasq_control_scratch_p1runtime` and `nasq_control_scratch_p1tests`. The P1 worker has no Docker socket and no customer-adapter operations are authorized. This selection does not establish runtime readiness or production provider/hosting. Do not use this document to operate production resources.

**Scope:** establish the target, adapter, readiness-evidence, and operator boundaries for later packages. No resource is provisioned, migrated, or tested here. CRM, billing, customer portal, support impersonation, automated deletion, and runtime implementation are out of scope. Read alongside the [company/vendor workspace design](../superpowers/specs/2026-09-23-company-vendor-workspace-design.md), [Package 0 commercial contracts](../superpowers/specs/nasq-cp0-commercial-contracts.md), and [roadmap](../superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md) in the canonical checkout.

## 1. Evidence and current boundary

The roadmap baseline is canonical `main` commit `abde67b64155250f015b8ad213c26609532a124c`; the package worktree was created from that exact commit. The roadmap file itself is untracked user material in canonical `main`; it is reference input, not owned output.

Read source and delivery evidence establishes these constraints, not a production-ready runtime:

- The worker currently authorizes only local inventory entries of kind `scratch`; it validates mode against inventory, uses operation rows/leases and per-target advisory locks, and checks a durable operator receipt for successful mutations.
- `tools/nasq_cli/operator.py` also refuses non-scratch targets and database names outside its bounded scratch guard. Legacy adapter reads are read-only; mutation without the journal is rejected. **Do not remove or weaken these guards to make a customer target work.** A complete strict operator v2 entry (all 16 keys) satisfies both the TypeScript worker's permissive v2 reader and the strict Python operator v2 reader; keep that canonical full v2 shape for the new adapter. Legacy adapter v1 remains a separate compatibility lane; document its explicit boundary rather than treating it as a v2 schema defect.
- The local operator journal binds request identity to operation, payload digest, and target fingerprint; it serializes each target with an OS lock. An uncertain mutation is marked `needs_intervention`, blocks a subsequent mutation, and must be inspected/reconciled rather than blindly replayed.
- The present control worker and operator do not establish managed-customer readiness. Local integration evidence records `deployment_ready:false`; backup capture is `UNVERIFIED`. A successful restore does not retroactively prove capture-time consistency.
- `saas` and `non_saas` are separate commercial modes. `non_saas` uses local policy and is not to acquire commercial expiry or billing behavior. Any optional remote operations binding for non-SaaS is a separate, explicit future decision and must not grant commercial authority. A non-SaaS registration or inventory entry is not itself an operations grant.
- Preserve existing expiry as read-only runtime behavior: do not clear, extend, or reinterpret it in this package. Preserve the current suspended-login denial; this draft invents no new suspension, expiry, grace-period, or recovery semantics.
- Current create reports `deployment_ready:false`; backup capture remains `UNVERIFIED`; upgrade does not establish `application_health_verified:true`. These are explicit blockers, not values to infer or override in documentation.

These are code/doc observations at the stated baseline. Supervisor local inventory and topology selection provide local Docker/Compose/image/port facts for isolated P1 source/test work only; image freshness/usability remain unverified and no tenant/customer runtime is ready. This selection does not establish any production server, domain, secret store, backup destination, TLS certificate, or production target.

## 2. Proposed target and inventory contract

A target is an **opaque stable identifier** resolved only by a trusted server-side inventory. The browser, BFF payload, and user-supplied API fields must never select a database name, host, port, filesystem path, URL, shell command, environment variable, or secret value. The server resolves the opaque ID, confirms the actor's target-scoped grant, validates the inventory record and operation allowlist, and passes only the resolved target to a bounded adapter.

Proposed logical inventory fields (not a claim about existing schema):

| Field | Contract intent |
|---|---|
| `target_id` | Opaque, immutable identifier; no meaning or address encoded in it. |
| `environment_id` | Explicit environment boundary (e.g. management or isolated acceptance); exact values await decision. |
| `adapter_kind` | Allowlisted adapter implementation/version; never a caller-selected executable. |
| `commercial_mode` | Explicit `saas` or `non_saas`; independent of hosting model and company identity. |
| `resource_refs` | Private references to database, file storage, network/service endpoints and domain resources; not exposed to browser or public receipts. |
| `secret_refs` | Names/IDs resolved by the server-side secret broker; no credential bytes in inventory metadata, argv, logs, or receipts. |
| `release_ref` | Immutable release/catalog reference and digest; not a floating tag or arbitrary path. |
| `allowed_operations` | Per-target operation set; every operation checked again immediately before effect. |
| `inventory_revision` | Monotonic revision/fingerprint input; change invalidates stale preflight and requires reauthorization. |
| `state` | Explicitly provisioned/disabled/quarantined state; absence or ambiguity is deny. |

**Proposed candidate naming only, not verified resource names:** `nasq-mgmt-<env>-<region>-01`, `nasq-accept-<env>-<region>-01`, `nasq-accept-<env>-<region>-02`; corresponding opaque IDs could be `tgt_mgmt_<random>` and `tgt_accept_<random>`. These examples do not assert a provider, machine, domain, database, available capacity, or actual naming approval. Database names and addresses remain private inventory details and must not be derived from the candidate labels.

**Observed local port candidates from supervisor inventory only (recheck before any future use):** P1 control-plane PostgreSQL `127.0.0.1:55432` and API `14179` are selected for isolated P1 source/test work; Compose project name `nasq-saas-control-local`; fresh runtime/test DB candidates `nasq_control_scratch_p1runtime` and `nasq_control_scratch_p1tests`. Customer acceptance targets A Odoo `18169` / web `13100`, B Odoo `18170` / web `13101`, with separate customer PostgreSQL ports `55433` and another rechecked free port (example `55434`), remain future targets—not authorized by the P1 selection. Avoid `5432`, `5433`, `5434`, and `5436`; local PostgreSQL and Docker already occupy 5432. These are observed/selected candidates, not proof of configured/running services or permission beyond isolated P1 source/test work. Never share the control-plane PostgreSQL instance as customer databases.

For isolated P1 source/test work the supervisor selected native loopback API and worker processes on the host, plus a dedicated Compose PostgreSQL bound only to `127.0.0.1:55432`; API candidate `14179`, Compose project `nasq-saas-control-local`, and separate fresh runtime/test DBs `nasq_control_scratch_p1runtime` / `nasq_control_scratch_p1tests`. This is not a running stack, managed customer adapter, or production deployment. It authorizes no customer-target operations and no Docker socket mount. The current config rejects non-loopback `CONTROL_HOST` without TLS; the BFF rejects plaintext HTTP to a non-loopback upstream. Keep those guards: the supported local choice is loopback API, not plaintext `0.0.0.0` inside Compose. Production topology remains open. The control-plane build uses `tsc --noEmit` while runtime scripts use `tsx`; do not claim standalone `dist` artifacts exist. Pin/version evidence must state actual versions: `/opt/homebrew/bin/node` and `/opt/homebrew/opt/node@22/bin/node` provide Node 22.22.2/npm 10.9.7; P1 selects the explicit Node 22 binary. Harness-prepended PATH exposed Node 24.21, and earlier regression runs used 24—report that evidence accurately. Odoo venv Python 3.12.13 is available and selected explicitly; ambient `python3` is 3.9.6 and must not be assumed. Docker Engine 29.8.0 and Compose 5.5.1 are inventory versions, not proof the stack runs.

The current scratch-only operator remains the safety boundary until a separately reviewed managed adapter exists. Keep the existing local/general scratch execution path and guard unchanged. Any managed inventory descriptor must be separately versioned rather than broadening the strict scratch inventory parser; managed targets require a distinct explicit capability and operation allowlist. No permissive fallback, wildcard inventory, or browser-controlled target-kind switch.

## 3. Adapter and pinned release boundary

The control plane calls a small adapter contract, not shell commands constructed from browser data. The adapter receives validated operation identity, opaque target ID, immutable release/policy references, and a scoped server-resolved secret handle where absolutely necessary. It returns a schema-validated receipt with no raw child output. The adapter must:

1. Resolve exact private resources from inventory and reject missing, duplicate, aliased, stale, or disallowed entries before side effects.
2. Enforce operation-specific preflight, target authorization, commercial-mode invariants, and revision checks at the mutation boundary.
3. Use argv arrays / structured APIs (never shell interpolation), bounded process groups/timeouts/output, and sanitized public errors.
4. Keep management plane dependencies out of the customer request path: customer business operations must not require the control plane to remain available.
5. Report incomplete deployment as incomplete; `active`/`deployment_ready` requires all approved readiness dimensions with fresh evidence, not merely database creation or module installation.

A release is a **pinned immutable artifact**: catalog version, source/artifact digest, module composition, migration compatibility declaration, and build provenance are recorded in the operation/receipt. Resolve a requested release ID only under a trusted release root/registry and verify its digest before execution. Never accept arbitrary paths, URLs, branch names, mutable tags, or unverified current checkout contents as a release. Release promotion and rollback compatibility are future-package behavior and remain unimplemented here.

## 4. Secret references and exposure rules

Use opaque `secret_ref` handles resolved only in the server/adapter boundary by an approved secret-management mechanism. The mechanism/provider, bootstrap identity, access policy, rotation, revocation, backup, and recovery are **human decisions pending**. Do not write secret material, sample production credentials, tokens, private keys, or connection strings into these docs, Git, browser payloads, operation events, command-line arguments, process output, exception text, or receipts. Do not claim a secret manager exists. Local acceptance fixtures, if separately authorized later, must be synthetic and isolated.

Public audit records may identify a secret reference by a non-sensitive opaque ID and operation result; they must not contain secret values or raw child logs. Access to read the secret is separate from permission to request an operation.

Administrative bootstrap credentials and customer administrator credentials must never be handed off in a browser-visible receipt, chat transcript, operation log, or long-lived shared secret. The future delivery mechanism must be short-lived, recipient-bound, auditable, and require recipient reset/rotation on first use; choose an approved secure channel and recovery path before Package 2. No handoff mechanism is implemented or selected here.

## 5. Durable mutation, idempotency, locks, and reconciliation

For each mutation, bind `request_id` to exactly one target, operation type, canonical payload digest, target/inventory fingerprint, release digest, and expected policy revision. Replaying the same identity and payload returns the original durable receipt without repeating effects. Reusing the request ID with any changed binding conflicts. Replaying a receipt still requires current actor/target authorization; one target's receipt is never visible through another target.

Serialize mutation per target with the existing journal/worker lock mechanisms; a lock key is the opaque target identity/fingerprint, not caller input. A worker lease is not by itself sufficient fencing: completion writes must prove current ownership/lease/fencing state, and late workers must be rejected. A heartbeat renewal failure is an ownership-loss event: the worker must stop issuing additional effects where safely possible, cannot publish success, and any in-flight uncertain mutation requires reconciliation. A merely expired lease cannot let an old live process write after a replacement claim. Before starting another mutation, unresolved `running`, expired, or `needs_intervention` work blocks the target pending reconciliation.

Reconciliation is evidence-led and auditable across **both** durable layers: the control-plane PostgreSQL queue/operation/event records and the local SQLite operator receipt/journal, plus inventory identity/revision and actual resource state from read-only inspection. Compare these facts, then either record a proved outcome or keep the target quarantined / `needs_intervention`. A restored stale control-plane database is not authoritative evidence that external effects did not happen; reconcile it against the operator journal and target state before resuming any worker. Never infer success from timeout, worker disappearance, HTTP status alone, or a desired state. Never automatically replay a non-idempotent effect or erase a failure state to unblock the queue. Human approval requirements for reconciliation and high-impact restore remain open decisions.

## 6. Desired and observed policy

Maintain distinct `desired_policy` and `observed_policy`, each with schema version, complete feature/limit set, revision, source/reference, and timestamps. Desired policy is the authorized target state derived from a pinned catalog/policy input; observed policy is read from the target only after a successful, identity-verified inspect/application receipt. A queued or partially applied request changes neither observed truth nor readiness. Mismatch is visible and stale; it is not silently overwritten or reported as applied.

`saas` may use the authorized control-plane policy channel. `non_saas` remains on local policy and must not receive a commercial binding, billing expiry, or SaaS entitlement writes. Do not equate module installation with entitlement or feature allowance: a feature cannot be presented as usable until both required module composition and observed policy are verified. No module removal/data deletion follows policy revocation without a separately approved contract.

## 7. Stage-specific readiness evidence matrix (proposed)

Every row yields an evidence item with target ID, environment ID, operation/release/policy identity as applicable, check ID/version, observed-at timestamp, freshness/expiry rule, `pass | fail | skip`, safe summary, and evidence reference/digest. **`skip` is never acceptance.** Missing/stale evidence is not pass. Evaluate only checks applicable to the operation/stage: later-package backup/recovery is not a prerequisite for local P1 source/test work or an earlier create. Create readiness, recovery readiness, and full operational readiness are distinct claims. A create still cannot be `deployment_ready` from database creation alone. Domain/TLS rows apply only to domain-routed environments; customer acceptance targets A/B remain future.

| Dimension | Applicability | Minimum evidence for a future pass | Primary evidence owner (proposed) |
|---|---|---|---|
| Target/inventory | Every applicable stage | Unique opaque target resolves to exactly the enrolled resources; environment/mode/allowlist match; no aliases. | Runtime inventory owner |
| Database | Create and service readiness | Correct target identity, reachable with scoped credentials, schema/migrations/modules in declared state; no production test data mutation. | Adapter/DB operator |
| Module composition | Create, upgrade and service readiness | Installed module set matches immutable release/catalog; pending/failed module transitions are zero; compatibility check passes. | Release/operator owner |
| Desired/observed policy | Create, policy change and service readiness | Exact revision and full feature/limit map read back; source matches mode; no unobserved policy mutation. | Policy owner |
| Service processes | Create/service readiness | Required services report healthy from target-bound checks; dependencies and restart behavior are evidenced. | Runtime/service operator |
| Domain / routing | Domain-routed readiness | Approved hostname resolves/routs to intended target; no cross-target routing; authoritative evidence attached. Not needed for loopback P1. | DNS/network owner |
| TLS | Domain-routed readiness | Certificate identity, validity, chain, renewal path and HTTPS behavior verified for the approved domain. Not needed for loopback P1. | Security/network owner |
| Login / authorization | Service and operational readiness | Authorized synthetic test identity can authenticate; denied identity is rejected; no shared/global vendor grant leaks to customer. | Identity/access owner |
| Core business path | Customer acceptance / full operational readiness | Isolated synthetic acceptance tenant can create/read an allowed business record and attachment with expected ACLs; not a P1 source/test prerequisite. | Product acceptance owner |
| Attachment/file store | Customer acceptance / full operational readiness | Uploaded file is target-local, retrievable and linked to exact record; cross-target read denied. | Storage/security owner |
| Backup capture | Backup/recovery readiness (later package) | Database and filestore capture point and manifest prove a defined consistency method; checksums and encrypted storage evidence recorded. `UNVERIFIED` fails this row; not a create/P1 prerequisite. | Backup operator |
| Restore verification | Recovery readiness (later package) | Restore to a distinct isolated target; login, module/policy state, records and attachments checked; duration and measured data-loss window recorded. Separate from capture consistency and separately authorized cutover; drill never authorizes cutover. | Recovery verifier |
| Isolation | Multi-target acceptance | Two distinct approved test targets show independent DB/files/secrets/identity; negative cross-target access tests pass. A/B remain future. | Security reviewer |
| Audit/receipt | Every mutation; full operational readiness | Operation receipt binds request, target, digest, release, revisions and outcome; secret scan/sanitization check passes. | Control-plane operator |

No RPO, RTO, retention duration, maintenance window, availability target, or production hosting/provider commitment is specified here. Those values require human agreement and measured rehearsal evidence; do not invent targets from test durations or local scratch runs. They are not prerequisites for starting isolated local P1 source/test work. Domain/TLS and routing evidence apply only when evaluating a domain-routed environment, not the loopback P1 selection. They may also be outside the applicability of a local create gate; backup/restore remain later recovery gates. Create/service-ready may proceed on its own approved applicable criteria, not wait for Package 4 recovery evidence. Full operational/recovery readiness adds its own applicable gates.

## 8. Capture versus restore proof

The receipt must represent backup capture separately from restore verification. Capture evidence states what was captured, when, by which consistency method, with database and file manifests/checksums, encryption/storage references, release and policy context, and any known gaps. Until a consistency method is established and validated, status stays `UNVERIFIED` and cannot be called recovery-ready.

Restore verification references a specific captured backup and a **new, distinct scratch destination**. It records observed health, data/module/policy checks, attachment integrity, missing items, and elapsed time. `restore_verified=true` means that specific restore drill passed its stated checks; it does not change capture consistency or establish production RPO/RTO. Never restore over an existing customer target for a drill.

## 9. Existing commercial modes, CRM, and non-goals

Preserve database-per-tenant isolation and existing product pillars. `non_saas` remains independent from commercial subscription expiry and central billing. Hosting identity does not infer commercial mode. Operations access, if later granted to a non-SaaS deployment, is a separate binding/grant and does not alter its local policy or grant billing authority.

Future CRM integration may link a commercial customer/account to one or more installations using an explicit stable source-system identifier plus source-environment identifier and record type. The link must be explicitly verified and auditable; no email/name matching, no reuse of Odoo user IDs as customer IDs, and no duplicate central invoice ledger. CRM is not implemented by this contract: no fake CRM table, API, UI, or placeholder resource is authorized.

## 10. Ownership and package sequencing

The operator path is shared mutable state. **One sequential writer** owns `tools/nasq_cli/operator.py`, `tools/nasq_cli/journal.py`, `apps/control-plane/src/worker.ts`, shared inventory/configuration, and cross-cutting operation contracts at any given time. Changes requiring those files serialize through the supervising integrator; do not assign parallel writers or have separate policy/backup branches modify them concurrently.

Policy/entitlement and backup/restore may be independently designed and tested only behind explicit module/adapter boundaries with distinct file/test ownership, fixtures, and no shared-file edits. Integrate their changes sequentially into the shared operator/worker path; document dependency and evidence handoff. This is a proposed coordination constraint, not permission for Package 1+ implementation in this task.

Later package evidence reports each acceptance criterion as `pass`, `fail`, or `skip`, with command/environment/target/version and evidence reference. A skipped command, missing environment, unrun browser flow, or unavailable target never counts as accepted. Package 0 itself is a draft and must not be labeled passed.

## 11. Stage-specific decisions and blockers

The local P1 topology is selected for isolated source/test work; it is not conditional on production domain/TLS, hosting provider, RPO/RTO, retention, or customer acceptance targets. Current `non_saas` classification/local-policy behavior, existing expiry semantics, suspended-login denial, and default-off boundary are preserved invariants, not new decision gates.

Before local P1 runtime evidence: verify image freshness/usability, explicitly use Node 22.22.2/npm 10.9.7 and Odoo venv Python 3.12.13 (ambient `python3` is 3.9.6), selected loopback API and DB configuration, isolated DB naming/boundaries, and trusted worker execution. Prior regression test evidence used Node 24.21 and should remain accurately described. No customer adapter operation or Docker socket is authorized here.

Before claiming local Package 0 acceptance, obtain reviewed contract approval and bounded local evidence required by the supervisor (not just inventory observations), including the safe worker/executor arrangement and evidence schema. Grok review of the local implementation contract is PASS; live Package 0 has not been proven.

Production/domain-routed and later operational readiness require decisions/evidence for: actual management/customer target identities and isolation; provider/hosting model; approved domains, DNS authority, routing and TLS issuance/renewal; secret broker/bootstrap/rotation/recovery and secure credential handoff; immutable release provenance and migration compatibility; readiness definitions/owners; backup consistency/storage/encryption/retention and restore/cutover approvals; maintenance and write-suspension procedure; agreed/measured RPO/RTO and service objectives; approval roles; and future CRM source/environment/type link semantics. None is a prerequisite for isolated local P1 source/test work, and none is implied by local topology. Domain/TLS applies to domain-routed readiness; backup/restore apply to later recovery readiness, not as prerequisites to earlier create.

Optional `non_saas` operations binding, if ever considered, requires a separate decision and explicit scoped grant; registration/visibility never grants operations authority or commercial authority. CRM stays unimplemented.

## 12. Package 0 status

**GROK REVIEW: PASS for local implementation contract only. LIVE PACKAGE 0: NOT PROVEN. PRODUCTION: PENDING.** This is not a live package/production acceptance. The canonical untracked roadmap remains untouched. This refinement changed documentation only in its existing isolated worktree. No service, test suite, database, production secret, deployment, or customer resource was operated or mutated. Local P1 selection permits only isolated source/test work; it does not establish running services, acceptance target readiness, or production hosting.
