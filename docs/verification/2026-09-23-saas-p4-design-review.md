# SaaS P4 backup/restore — prepared contract and Grok review conditions

**Status: DESIGN FROZEN / NOT IMPLEMENTED / GROK VERDICT: NEEDS_REVISION with final
conditions recorded / PENDING P2 ROLE + PROXY READINESS.**

This document records a prepared contract and the review conditions that must be
satisfied before any implementation. It is not an implementation, not a passing
review, not a test report, and not package or production acceptance. No code,
test, service, database, container, or secret was created, executed, or changed
for this document. Numeric RPO/RTO, retention, maintenance-window and offsite
decisions remain undefined.

Scope owner note: this file is written in the config-tests worktree
`/Users/tariq/code/nasq-saas-config-tests` (branch `codex/saas-config-tests`),
not in the contracts owner's worktree. The contracts lane's own documents are
left unchanged.

## 1. Baseline and evidence

- Base commit for both the research and this record: `main` =
  `abde67b64155250f015b8ad213c26609532a124c`. The roadmap is an untracked user
  document in canonical `main`; it was read as reference only and not modified.
- Read-only sources inspected: `deploy/backup.py`, `deploy/restore_verify.py`,
  `deploy/test_operations.py`, `deploy/test_restore_verify.py`,
  `deploy/OPERATIONS.md`, `deploy/docker-compose.yml`, `deploy/odoo.conf`,
  `apps/control-plane/src/config.ts`, `tools/nasq_cli/operator.py`,
  `.github/workflows/ci.yml`, `docs/operations/saas-runtime.md`,
  `docs/superpowers/specs/2026-09-23-saas-runtime-contracts.md`.
- Existing behaviour that is preserved and must not be redefined:
  `deploy/backup.py` always writes `consistency: "UNVERIFIED"` and
  `recovery_ready: false` and never emits `writer_stop_verified`,
  `consistency_verified`, or `live_consistent`; it declines boolean
  quiescence/consistency flags and refuses a password on argv.
  `deploy/restore_verify.py` writes a separate verification record and never
  edits `manifest.json`; the CI `restore-drill` job enforces that with `cmp`.
- Local tooling observations (presence/version only; nothing executed against a
  database or keystore): `pg_dump`/`pg_restore`/`psql` 16.14 with `--snapshot`
  and `--serializable-deferrable`; `age` v1.3.1; `gpg` 2.5.21; `/usr/bin/openssl`
  is LibreSSL 3.3.6 and `openssl enc -aes-256-gcm` fails (exit 1); Python
  `cryptography` and `nacl` are absent; ambient `/usr/bin/python3` is 3.9.6 while
  the Odoo venv `/Users/tariq/code/odoo/.venv/bin/python` is 3.12.13 and CI uses
  3.12; Docker 29.8.0 / Compose v5.5.1.
- Compose topology constraint: `POSTGRES_USER: odoo` makes the `odoo` role a
  **superuser**, and `deploy/odoo.conf` sets `db_user = odoo`. `deploy/backup.py`,
  `deploy/restore_verify.py`, and the Compose files do not create roles, revoke
  CONNECT, or read `pg_stat_activity` except the single observation query already
  in `tools/nasq_cli/operator.py` (`SESSIONS_SQL`).
- PostgreSQL 16 documentation used as the grounding source for the mechanisms
  below: [GRANT](https://www.postgresql.org/docs/16/sql-grant.html) (superusers
  bypass object privileges; the owner's privileges are revocable),
  [ALTER DATABASE](https://www.postgresql.org/docs/16/sql-alterdatabase.html)
  (`allowconn` false means "no one can connect"),
  [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html) (`--snapshot`
  synchronizes a dump with a concurrent session),
  [System administration functions](https://www.postgresql.org/docs/16/functions-admin.html)
  (`pg_export_snapshot` is importable only while the exporting transaction stays
  open; `pg_terminate_backend` needs `pg_signal_backend` or role membership and
  cannot terminate superuser backends),
  [Predefined roles](https://www.postgresql.org/docs/16/predefined-roles.html)
  (`pg_read_all_data`, `pg_signal_backend`, `pg_monitor`,
  `pg_read_all_stats`).

## 2. Capture contract

Three distinct identities are required. One superuser or dual-purpose role
invalidates the contract.

1. **Application role** — non-superuser owner/user of the customer database. A
   superuser application role cannot be fenced (superusers bypass object
   privileges) and a non-superuser maintenance actor cannot terminate its
   backends.
2. **Narrow reader role** — read-only, non-superuser. It must be able to read
   every dumped row, which requires either a **justified `BYPASSRLS`** grant or
   **proven all-table read policies** for RLS-enabled tables. The justification
   or the policy proof is part of the record; an unjustified bypass is not
   acceptable, and neither is an unproven assumption that no RLS applies.
3. **Maintenance actor** — a separate role that owns the exact-ACL and session
   actions (CONNECT enforcement, termination, ACL save/restore) and holds
   `pg_signal_backend` plus `pg_read_all_stats`/`pg_monitor`. Without the stats
   privilege the zero-session verification is not meaningful, because
   `pg_stat_activity` hides other sessions from unprivileged roles.

Ordered capture algorithm (write denial is proven, never assumed):

1. Preflight: fresh output directory; verify the roles to be fenced are not
   superusers; require a non-empty fenced-role set.
2. Stop every writer — application process and cron — and verify none is running.
   A closed port or reachable/unreachable TCP probe is not quiescence evidence.
3. Save the **exact** ACL/login state **before any change**: the database ACL and
   effective CONNECT state for every fenced role and for `PUBLIC`, persisted to
   the staging area with originally-denied roles recorded as denied. If this
   snapshot cannot be read, refuse before issuing any REVOKE.
4. Enforce allowed connections: revoke CONNECT from `PUBLIC` and from each fenced
   role, keeping CONNECT only for the maintenance/capture identity. Account for
   **inherited paths**: effective CONNECT can arrive through `PUBLIC`, through
   role membership/`INHERIT`, or through an owning role, so the check must
   enumerate effective holders and not only direct grants.
5. Drain: terminate remaining non-capture backends on that database, bounded
   retries, until none remain.
6. Verify the fence: zero non-capture sessions **and** a **deny probe** — a fresh
   connection attempt as each fenced role must fail. Both results are recorded.
7. Only after quiescence and a verified fence, export the snapshot on the
   maintenance connection (`REPEATABLE READ READ ONLY` + `pg_export_snapshot()`).
   Exporting before writer stop is a defect: a commit between the snapshot
   instant and the writer stop would appear in the filestore but not in the dump.
8. Copy the filestore into staging with matching before/after tree listing and
   digests.
9. Dump with `pg_dump -Fc --snapshot=<id>` as the reader.
10. Re-verify the fence (zero non-capture sessions, deny probe still failing).
11. Restore the **exact** saved ACL state: re-grant only what was granted before
    and keep originally-denied roles denied, including `PUBLIC`. Run this on
    success and failure paths alike; every restore error is surfaced with its own
    non-zero result and is never swallowed.
12. **Resume previously running writers only after the exact ACL is restored.**
    If the ACL restore fails, do not resume; quarantine the target and record the
    failure for an operator, because the fence is then still in force and the
    customer is effectively locked out.
13. Seal and freeze: seal the dump, filestore, and manifest **together**; the
    sealed manifest becomes immutable. No later step may rewrite it.

Legacy artifacts keep their existing semantics: any pre-existing `manifest.json`
with `consistency: "UNVERIFIED"` stays unchanged and is never reclassified,
rewritten, or promoted to recovery-ready by the new path.

## 3. Sealing and metadata authority

- Encryption path: `age` only, with file-based key references (recipients file to
  seal, identity file to open). No key bytes on argv, no second backend, no
  separately keyed manifest signature: the dump, the filestore copy, and the
  manifest are sealed as one authenticated payload.
- **Outer metadata is unauthenticated and therefore unauthoritative unless it is
  cryptographically bound to the sealed payload.** Any plaintext outer record may
  be used for discovery only; a claim taken from it must be rejected unless the
  binding (for example, the recorded ciphertext digest and the manifest digest
  inside the sealed payload) is verified first.

## 4. Restore and verification boundary

- The existing `deploy/restore_verify.py` **cannot be claimed as an unchanged
  full proof** for this contract. It must not be presented as already sufficient.
- Reuse is limited to its validated checks (installed module count, no
  modules stuck mid-transition, referenced attachment files present), applied
  only **after authenticated extraction** of the sealed payload and through an
  explicitly declared, compatible contract.
- `local_recovery_ready` may appear **only** in a separate verification record
  derived from the immutable sealed manifest — never in the captured manifest
  itself, and never as a rewrite of it.
- Production assurance remains separate and false: no offsite placement,
  replication, retention, RPO or RTO is defined or claimed.

## 5. Grok review conditions (blocking; verdict NEEDS_REVISION)

Recorded as final conditions from the independent review, attributed to the
orchestrator's review record; the raw review output was not reproduced in this
lane.

1. Three identities as in §2, including the justified-`BYPASSRLS` **or** proven
   all-table-policy requirement for the narrow reader.
2. A separate maintenance actor owns the exact-ACL and session actions.
3. Inherited CONNECT paths and `pg_stat_activity` visibility are covered, and the
   deny probe is mandatory evidence.
4. The snapshot is taken **after** quiescence.
5. Previously running writers resume **only** after exact ACL restoration; a
   restore failure quarantines instead of resuming.
6. Age seals dump, files, and manifest together; outer metadata is unauthoritative
   unless bound.
7. `restore_verify` is not claimed as an unchanged full proof; only its validated
   checks are reused, after authenticated extraction, under a compatible contract.
8. No physical fallback path; legacy `UNVERIFIED` artifacts are unchanged.

## 6. Exact limitations and unproven items

- Nothing is implemented. No code, schema, role, test, service, container, or
  database was created or run; this is a frozen design record only.
- The role model, CONNECT enforcement, termination rights, snapshot import, ACL
  round-trip, and resume/quarantine behaviour are grounded in PostgreSQL 16
  documentation and repository source, but were **not rehearsed** against a live
  database. There is no experiment database in this lane.
- `pg_stat_activity` visibility depends on `pg_read_all_stats`/`pg_monitor`;
  whether the intended maintenance actor actually sees all sessions is unverified.
- RLS behaviour is unresolved: the `BYPASSRLS` justification and the all-table
  policy proof are both pending.
- `age` presence in the runtime container and in CI is unverified; the local
  observation is a host binary only, and adding it to CI would be a workflow
  change owned by the integrator.
- Storage failure domain is single-host for any local Compose capture; the
  sealed artifact is produced by the same executor that reads the source, so a
  distinct-host or offsite claim cannot be attested by this path.
- Compose topology today is incompatible with the contract (superuser application
  role) and must not be used as evidence that the design works.
- Numeric RPO/RTO, retention, maintenance window, and cutover approval are human
  decisions and remain undefined. `skip` is never acceptance.
- This record has not been reviewed as a passing artifact; the design remains
  frozen until the dependencies below exist.

## 7. Freeze statement

The design is frozen at this revision to prevent further churn. Implementation
may start only when all of the following are real rather than assumed:

1. P2 role/proxy readiness: provisioned non-superuser application role, narrow
   reader role with resolved RLS handling, and a separate maintenance actor with
   the required privileges.
2. A verified `age` availability decision for the runtime and CI.
3. An agreed compatible restore contract for authenticated extraction and the
   separate verification record.
4. Explicit authorization for any change that touches production roles, CI, or
   shared files. Role separation for new synthetic tenant provisioning is treated
   as safe engineering, not as an extra business decision; production changes
   still require authorization.

Until then no implementation, no test run, and no consistency-verified capture
claim exists.
