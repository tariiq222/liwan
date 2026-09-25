# SaaS P5 upgrade/recovery design review — 2026-09-23

**Status: REVIEWED REQUIREMENTS (Grok, source-backed) / NOT IMPLEMENTED / NOT
ACCEPTANCE / PENDING P2 AND P4 CONTRACTS.**

This is a read-only source audit of the upgrade and recovery path that exists today.
It is a findings document, not an implementation, not an acceptance record, and not
permission to build a full upgrade framework or multiple adapters. No test, service,
container, database or port was run; no source file was edited; no commit, merge, push
or deletion was performed; the moving P1 implementation and fixture worktrees were not
read. Only this file was written.

Governing instructions were inspected first: `AGENTS.md`, `CLAUDE.md`,
`docs/WORKSPACE.md`, `docs/parallel-work.md` (read-only). The roadmap Package 5
section — `docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md`
in canonical `main`, untracked user material, hash
`15e2804a419fd1a3da03cb9489a9142bfc6caaf22e1d757a28b822406557120d` — was read as
reference and left untouched.

Source basis: `main` = `abde67b6`. Files audited: `tools/nasq_cli/operator.py`,
`tools/nasq_cli/journal.py`, `tools/nasq_cli/cli.py`, `tools/nasq_cli/adapters.py`,
`apps/control-plane/src/worker.ts`, `apps/control-plane/src/db.ts`,
`apps/control-plane/src/http.ts`, `apps/control-plane/src/schema.sql`,
`apps/control-plane/src/__tests__/service.test.ts`, `.github/workflows/ci.yml`,
`deploy/odoo/upgrade_smoke.py`, `tools/upgrade_log_guard.py`, `docs/migrations.md`.

## 0. Grok review record

- Reviewed artifact: this document at
  `sha256 983f49a7f41f8d5cf4f0a0bee75a5f6218c95a3f43cbff390a4ab4f883d4a391` (the
  pre-update revision).
- Verdict: **requirements reviewed against the source. Not a runtime PASS, not an
  implementation review, and not acceptance.**
- Corrections Grok raised, all applied in this revision:
  1. The two-worker/late-completion statement was too broad — late `finishClaim`
     rejection and unresolved-lease blocking **are** covered by tests.
  2. Same-target exclusion **does** exist; what remains open is the lease-expiry
     uncertainty/fencing gap, not a proven simultaneous-claim defect.
  3. The existing scratch module-list upgrade must remain intact; no edits to the
     legacy operator/journal are prescribed by this audit. A managed image upgrade is
     the separate, reviewed P2 adapter.
  4. An `UNVERIFIED` backup cannot serve as recovery proof; no numeric RPO/RTO is
     imposed; the rollback copy implies no cutover and no automatic destructive
     downgrade.
  5. The future P5 work is bounded as listed in §5, and crash-injection evidence must
     not require rewriting the legacy path.

## 1. Actual sequencing today (upgrade)

1. **Enqueue validation** — `http.ts:131-135`: the target must have a `release_root` and
   a `release_id` matching `^[a-z][a-z0-9._-]{0,63}$`, and the release must be an
   existing file under that root. Then the operation row is inserted with a payload
   digest (`http.ts:138`), and the existing unresolved-mutation guard runs
   (`http.ts:114`).
2. **Claim** — `worker.ts:43-75`: a per-`inventory_target` PostgreSQL advisory lock
   (`hashtext`, `worker.ts:49-50`), a running-per-target check (`worker.ts:56-57`), an
   unresolved-mutation check that marks the operation `failed`/`reconciliation_required`
   (`worker.ts:58-63`), then `status='running'` with a 120 s lease (`worker.ts:11,64`).
3. **Pre-execution re-checks** — `worker.ts:195-208`: grant still active, tenant row
   fresh, target still `kind === 'scratch'` with matching mode and
   `operations_enabled`, and (for restore only) a persisted approval row.
4. **Operator call** — `worker.ts:159-163` builds
   `upgrade --target <t> --release <release_root>/<release_id> --request-id <id>`; the
   release root comes from trusted inventory, never from the browser.
5. **Release validation and digest binding** — `operator.py:603-617`: the release path
   must resolve inside `release_root` and not be a symlink; the file must be JSON with
   exactly `{schema_version: 1, modules}`; 1–32 unique modules, all locally available.
   `operator.py:628` binds the release bytes, classification bytes and target
   fingerprint into the journal digest (`journal.py:39-51`).
6. **Quiescence preflight** — `operator.py:716-719`: refuses with
   `needs_intervention`/`quiescence_unverified` if the target DB has any other session
   (`operator.py:53-54`) or any module not settled (`operator.py:51-52`). This is a SQL
   observation only; nothing is stopped.
7. **Candidate backup first** — `operator.py:720-724` → `_candidate_backup`
   (`operator.py:522-547`) writes `backup_root/<operation_id>` with the existing
   `backup.py` contract: `consistency: UNVERIFIED`, `recovery_ready: false`.
8. **Module upgrade** — `operator.py:727-728` runs Odoo with `-u <release modules>` and
   the target classification file.
9. **Post-upgrade health** — `operator.py:731-747`: profile read, installed module set
   equals the release set, no stuck modules, and profile `commercial_mode` /
   `entitlement_source` match the trusted classification.
10. **Outcome** — healthy: `ok`/`module_upgrade_verified` with
    `application_health_verified: false` and `deployment_ready: false`
    (`operator.py:760-765`). Not healthy: `needs_intervention` with an **isolated**
    rollback copy — `original_target_recovered: false`
    (`operator.py:748-759`).
11. **Durable receipt verification** — `worker.ts:213-219`: after a successful mutation
    the worker re-reads `status` and requires matching `operation_id`, `request_id` and
    `target`, else `needs_intervention`/`receipt_unverified`.
12. **Completion fencing** — `worker.ts:167-172`: `finishClaim` updates only while
    `status='running' AND lease_until > now()`; a late worker's completion is refused.

There is **no image switch in this path**: a release is a JSON module list
(`operator.py:608-617`), not an image identity. This existing scratch module-list
upgrade path is the shipped behaviour and must remain intact. A managed image upgrade
belongs to the separate, reviewed P2 adapter (whose gates G1/G2 are still open), not to
this legacy operator path. CI performs a release-to-HEAD module upgrade against a
baseline checkout (`.github/workflows/ci.yml:72-138`, install at `:120`,
`-u "$MODULES"` at `:129`) and gates it with `tools/upgrade_log_guard.py` (`:130`;
rejects ERROR/CRITICAL and final-schema warnings) and `deploy/odoo/upgrade_smoke.py`
(`:131-137`; modules settled and `nasq_platform` installed).

## 2. Failure windows identified

| # | Window | Current behaviour (path:line) | Gap |
| --- | --- | --- | --- |
| F1 | Lease expires while the operator is still upgrading | Heartbeat every 30 s extends only while `running` and unexpired (`worker.ts:193`); `expireLeases` flips an expired mutation to `needs_intervention`/`lease_expired` and the tenant to `needs_intervention` (`worker.ts:31-41`); a late `finishClaim` is refused (`worker.ts:171`, covered by `service.test.ts:117-130`) | Late-completion rejection and unresolved-lease blocking are **tested**, but only in-process: there is no live two-process case proving that the operator keeps running and mutating the target after its service lease expired, nor that the service fences it before publishing success |
| F2 | Effect applied, then process/worker dies before the receipt is stored | SQLite `journal.execute` catches `BaseException`, marks the row `mutating → needs_intervention` and re-raises (`journal.py:216-225`); inspection converts a lingering `mutating` row to `needs_intervention` (`journal.py:149-160`) | The authoritative receipt is never written; only the journal knows, and nothing compares it to actual target state |
| F3 | Grant revoked mid-operation | Checked once immediately before worker execution (`worker.ts:195`, `worker.ts:77-80`; tested at `service.test.ts:107-115`) | No re-check before the sensitive module step; a revoked grant does not (and cannot) stop a 2-hour Odoo upgrade (timeout `worker.ts:129` = 7 200 000 ms) |
| F4 | Customer/app connects during the upgrade | SQL session count is sampled once at preflight (`operator.py:716`, `operator.py:53-54`) | The application is never stopped; a connection after the sample is not blocked, and there is no process-level quiescence proof |
| F5 | Unhealthy upgrade | An isolated copy is restored into a **new** scratch DB `nasq_scratch_<purpose>_<opid12>` (`operator.py:550-569`, `:749-750`) and the payload states the original target is not recovered (`operator.py:751-759`) | No rollback of the original target, no module downgrade, no release/image switch back; recovery is manual and separate |
| F6 | Two workers, one target | Exclusion exists: the running-per-target row check (`worker.ts:56-57`), the per-target advisory lock (`worker.ts:49-50`, availability only — `hashtext` collisions merely cause unrelated targets to contend), and the operator's OS `flock` held for the entire mutation (`journal.py:114-126`) | The layers are not cross-verified, and the SQLite lock is host-local by design (`journal.py:2-8`). What is unproven is the **lease-expiry fencing gap**: an expired-lease worker whose operator keeps running, versus a replacement worker claiming the same target — no simultaneous-claim scenario has been demonstrated |
| F7 | Release/migration mismatch | Release JSON carries only `schema_version` and `modules` (`operator.py:610-617`); migrations are addon-versioned (`docs/migrations.md`) | No release→image identity, no release→schema compatibility declaration, no recorded "from" version in the receipt, and no downgrade migration (documented: rollback = restore) |
| F8 | Backup used for rollback | Candidate backup is `UNVERIFIED` and non-atomic (`deploy/backup.py:1-8`; `operator.py:761-762`) | An `UNVERIFIED` candidate cannot be recovery proof; the roadmap's "compatible version and data kept for rollback" is not satisfied by that copy alone |

## 3. Acceptance matrix — roadmap Package 5 requirements

Roadmap Package 5 bullets are quoted in substance; line references are to current
source.

| ID | Requirement (roadmap P5) | Existing behaviour | Missing / gap |
| --- | --- | --- | --- |
| R1 | Test a new release on an isolated copy of trial data, then run migrations, modules and functional checks | CI does release→HEAD `-u` on a scratch DB with a log guard and a settled-module smoke (`.github/workflows/ci.yml:120,129-137`); the operator performs quiescence preflight, candidate backup, `-u`, and post-upgrade health checks (`operator.py:716-747`) | No operator-level rehearsal against an isolated copy of the target's own data before mutating the target; upgrade mutates the target in place. Functional checks are limited to installed-module set, stuck modules and profile mode/source |
| R2 | Keep a compatible version and data for rollback; application rollback alone does not reverse an irreversible data migration | Candidate backup is taken before `-u` (`operator.py:720-724`); the unhealthy path restores it into a **separate** scratch DB (`operator.py:749-759`); `docs/migrations.md` states there are no downgrade migrations and rollback means restore DB + filestore | No paired "previous release" artifact identity, no version-compat declaration, no recorded pre-upgrade schema/addon version, and the rollback copy is never promoted or reconciled with the original target. The rollback copy carries no cutover authority |
| R3 | Inject worker crash after the effect and before the result is recorded; the operation becomes intervention and blocks another mutation on the target | The blocking half is implemented **and tested**: `expireLeases` → `needs_intervention`/`lease_expired`, `finishClaim` returns false, and new plus previously queued mutations are refused with `409 reconciliation_required` (`worker.ts:31-41`, `:167-172`, `:198-200`; `db.ts:29-38`; `http.ts:114`; `service.test.ts:117-145`); the journal marks uncertain outcomes (`journal.py:149-160,216-225`) | Crash **injection evidence** is still missing: no in-tree harness that kills the worker after the external effect and before the result is recorded, and no live proof of the resulting state. Closing it must not require rewriting the legacy path |
| R4 | Reconciliation comparing resource identity, receipt and actual state; accept the proven outcome or stay quarantined; no button clears error state without evidence | Only the blocking half exists (`db.ts:29-38`, `http.ts:114`); the retry endpoint explicitly allows only a failed **read** (`tenant.inspect`/`health`) to be retried (`http.ts:239-245`); `stage='reconciliation_required'` is set with no resolution path (`worker.ts:58-63`) | The entire reconciliation capability is missing: no command/endpoint that compares the SQLite receipt, the PG operation row and the observed target state, and no audited path that either confirms the proven outcome or keeps the quarantine |
| R5 | Two workers, one target lock, lease expiry, late completion — no write from a worker that lost ownership | Same-target exclusion exists: running-per-target row check plus advisory lock plus the operator `flock` (`worker.ts:49-57`, `journal.py:114-126`); completion requires an unexpired lease and late completion is refused (`worker.ts:171`; tested at `service.test.ts:117-130`); the journal deliberately has no lease takeover (`journal.py:2-8`) | No live two-process evidence of a continuing operator after lease expiry, and no proof that a replacement claim cannot run concurrently with it. `hashtext` collisions are an availability concern only and are not an isolation proof |
| R6 | Re-check authorization before the sensitive step; revocation must not kill a destructive in-flight operation without a safe path, and what started before revocation is documented | One check immediately before worker execution (`worker.ts:195`; tested at `service.test.ts:107-115`); revocation is recorded as an audit event on completion (`worker.ts:185`) | No pre-sensitive-step re-check, no documented in-flight-revocation policy, and no marker recording that a grant was valid at start but revoked mid-flight |

## 4. Preserved constraints

- **`non_saas` stays local policy.** `tenant.entitle` is refused for `non_saas`
  (`http.ts:120`); the upgrade flow never writes policy, and its health check requires
  the profile's `commercial_mode`/`entitlement_source` to match trusted classification
  (`operator.py:734-745`). No billing, expiry or suspension semantics are involved.
- **No destructive rollback and no cutover.** Rollback restores into a new scratch
  database whose destination must not already exist (`operator.py:550-554`); the
  original target is explicitly not recovered (`operator.py:755`); nothing is dropped,
  replaced or downgraded automatically, and the rollback copy carries no cutover
  authority.
- **No recovery claim from an `UNVERIFIED` copy.** A candidate backup cannot serve as
  recovery proof: upgrade results always carry `recovery_ready: false`,
  `deployment_ready: false` and `application_health_verified: false`
  (`operator.py:756-757,762,764-765`), and the public receipt schema permits
  `consistency` only as `UNVERIFIED` (`worker.ts:110`).
- **No invented RPO/RTO.** No numeric recovery objective, retention period or
  maintenance window is imposed or assumed anywhere in this audit.
- **Restore stays approval-gated.** A persisted, single-use, unexpired approval bound
  to tenant + backup + action is required at enqueue (`http.ts:127-130`,
  `schema.sql:67-75`) and again at execution (`worker.ts:205-208`).
- **Targets remain scratch-only.** `worker.ts:202` and `http.ts:118` refuse anything
  that is not `kind === 'scratch'`; `tools/nasq_cli/adapters.py:4-5,56` keeps the legacy
  adapter from running `upgrade`/`backup`/`restore` without the journal.

## 5. Bounded future P5 work (named audit findings, not prescribed edits)

These are the bounded items the source gaps point to. This audit does not prescribe
edits to the legacy operator, journal, worker or shared contracts, and it does not
authorize a general upgrade framework, an image-switch orchestrator, or more than the
single `compose-local` customer adapter. The existing scratch module-list upgrade path
stays intact; a managed image upgrade is the separate reviewed P2 adapter.

1. Reconciliation over the three durable sources — PG control state, SQLite operator
   receipt/journal, and read-only live target observation — run **before the next
   mutation**, producing either a proven outcome or a continuing quarantine, with no
   silent clearing and no automatic replay.
2. Fence a late owner before any success is published (the service must not record a
   success for an effect whose ownership was lost).
3. Record the from/to release and addon/schema compatibility identity used by rollback.
4. Isolated rehearsal of the new release on a copy of trial data as acceptance evidence.
5. Crash-injection evidence for the effect-before-result window, added without
   rewriting the legacy path.
6. Any cutover of a rollback/restored copy remains a separate, explicitly authorized
   action — never automatic.

## 6. Status and unverified items

- **REVIEWED REQUIREMENTS (Grok, source-backed) — NOT IMPLEMENTED — NOT ACCEPTANCE.**
  The review covers requirements against source only; it is not a runtime PASS and not
  an implementation review.
- **PENDING DEPENDENCIES.** P2 (managed adapter, enrollment identity, gates G1–G5) and
  P4 (capture/restore contract, identities, exact-ACL restore) must land first; P5
  recovery evidence depends on P4's capture contract being more than `UNVERIFIED`.
- **UNVERIFIED.** All findings are static source reading at `abde67b6`: the lease,
  crash, two-worker and late-completion behaviours were not exercised against a running
  service or database, and no CI upgrade run was observed. No ports, containers,
  databases or services were inspected. Numeric RPO/RTO, retention and maintenance
  windows remain undefined human decisions and are not invented here.
