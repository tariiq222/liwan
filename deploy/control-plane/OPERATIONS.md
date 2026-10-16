# Local control-plane runtime (acceptance only)

This is a local management-service harness, not production hosting. It creates a dedicated PostgreSQL 16 Compose resource only; API and worker run natively on the host under a narrow PID-owning supervisor. No Docker socket is mounted. Control PostgreSQL is isolated from customer databases. Customer runtime/managed adapter and customer readiness are not implemented by this harness.

## Prerequisites / observed version

Use Node 22 (`.nvmrc` is 22). Node 22.22.2 is present at `/opt/homebrew/opt/node@22/bin/node`; host default `node` may resolve to Node 24.21.0, which this runtime refuses. Dependencies are installed in this worktree with the lockfile. The Odoo interpreter used if the worker reaches the existing CLI is `/Users/tariq/code/odoo/.venv/bin/python` (Python 3.12.13). This executor has an empty version-2 inventory, so it performs no target operation.

Recheck host ports immediately before use: control DB `127.0.0.1:55432`, API `127.0.0.1:14179`. Do not use ports 5432/5433/5434/5436. The DB is one dedicated container in Compose project `webvue-saas-control-local`, runtime database name `webvue_control` (not the contract suggested `webvue_control_scratch_p1runtime`), image `postgres:16` pinned to the observed local image digest. There is no automatic pull/build/update; `pull_policy: never` fails if the pinned image is not already cached. The digest records this Docker local image identity only, not portable registry provenance.

## Bootstrap / start / status / stop

```sh
export WEBVUE_CONTROL_HOME="$HOME/.local/share/webvue-saas-control-local"
export WEBVUE_NODE_BIN=/opt/homebrew/opt/node@22/bin
WEBVUE_CONTROL_HOME="$WEBVUE_CONTROL_HOME" WEBVUE_NODE_BIN="$WEBVUE_NODE_BIN" deploy/control-plane/init-local.sh
WEBVUE_CONTROL_HOME="$WEBVUE_CONTROL_HOME" WEBVUE_NODE_BIN="$WEBVUE_NODE_BIN" deploy/control-plane/run-local.sh
# From another terminal:
WEBVUE_CONTROL_HOME="$WEBVUE_CONTROL_HOME" deploy/control-plane/status-local.sh
WEBVUE_CONTROL_HOME="$WEBVUE_CONTROL_HOME" deploy/control-plane/stop-local.sh
```

Bootstrap creates synthetic local-only DB/service-key material under a mode-0700 directory, files mode 0600, plus an empty strict-v2 operator inventory and private state/log directories. No secrets are printed. Existing private files, ports, the dedicated container/network/volume, or conflicting runtime resources cause fail-closed refusal; never rerun bootstrap over existing data. Do not add an arbitrary target to this inventory. Control API binds loopback plaintext only, matching `getConfig()` and BFF guards; Compose PostgreSQL publishes loopback only on its dedicated network. The API/worker do not run in containers. Host-native execution accesses no Docker socket; no service-discovery bridge to a container customer runtime is implemented here.

`run-local.sh` validates the exact Compose project/service/config path, immutable local image ID, loopback port mapping, named volume, and private network before reusing an existing healthy DB; it refuses missing-container/retained-volume, stopped, unhealthy, or mismatched resources without recreating them. It creates a DB only when the expected container, volume, and network are all absent. It waits for `pg_isready`, applies existing versioned migrations through the one-shot migrate command, then starts independent API/worker processes with recorded PID, exact argv, process start-time and generation ownership. Duplicate start is refused. For a dead-generation recovery, `run-local.sh` requires all nine expected records, coherent generation markers, distinct recorded PIDs that are all absent, and no API listener, then, under one inherited private advisory lock held from generation reservation through complete runtime/API/worker owner-record publication, then explicitly releases it before readiness/steady-state waits; child processes close the inherited descriptor, and the supervisor trap releases it before nested stop. Recovery atomically renames the full process-record directory into a unique archive without signaling or deleting records; it requires ESRCH-only proof twice plus repeated listener checks immediately before archival. Mixed, partial, live/reused/uncertain, symlinked, or unexpected records fail closed. Runtime stop never falls back to archival. Status validates every owner and health; stop verifies all owned records before sending signals, and refuses uncertain identity/partial stop. Both entrypoints also call the idempotent/advisory-locked migrate function. Health success is `GET /healthz` → HTTP 200 and includes a database `SELECT 1`. The handler is designed to return unavailable when DB is down, but a database-down response was not successfully measured in this session. Logs are private at `$WEBVUE_CONTROL_HOME/logs/`; scripts never print their contents or service key/DSN. Supervisor PID/child records are used for status and ownership-checked stop. Stop leaves the DB container, named volume, synthetic credentials, inventory, state and logs intact. Never use `docker compose down`, `down -v`, `dropdb`, `docker rm`, or prune for this harness.

If stop reports an ownership mismatch or timeout, do not signal another PID; keep records and inspect process ancestry manually. No customer-facing activity is safe to infer from these local health checks.

## Local checks

```sh
WEBVUE_CONTROL_HOME="$WEBVUE_CONTROL_HOME" WEBVUE_NODE_BIN="$WEBVUE_NODE_BIN" deploy/control-plane/test-local.sh
```

This fail-closed wrapper requires the isolated control DB, refuses to run while the API/worker supervisor is active, creates only a new test DB named by `TEST_DB` in `test-local.sh` (the recorded successful 13/13 database-backed run used `webvue_control_scratch_p1tests2`; no `p1tests3` database was created) in that dedicated instance, verifies it differs from the runtime URL, and retains that DB and a private log. It runs the control-plane TypeScript build and tests with `CONTROL_TEST_DATABASE_URL` set for the new scratch DB. Logs are not echoed; inspect only locally if needed and do not paste credential-bearing data. No test command may target `odoo19` or a customer DB. The latest unconfigured run passed 3 unit tests while skipping the opt-in PostgreSQL integration suite. A prior ownership-stop attempt exited 10 because a child PID identity check refused signaling after a mismatch; subsequent fresh checks found task-owned processes exited. That is not database-outage evidence.

## Bootstrap access / audit

`apps/control-plane/src/admin.ts` CLI writes actor/action/subject/reason audit records. Its supported commands are `bootstrap-owner`, `reset-account`, `catalog-import`, `approve-restore`, and `migrate-saas-commercial`. Do not put service-key or database-password values on argv. `bootstrap-owner` and `reset-account` print a one-time enrollment link to stdout; send it by hand and never paste it into chat tools. Give a written reason for every command. This local bootstrap is not a production operator identity or audited handoff design.

Credential rotation for this local harness is not automated. A synthetic DB password and service key were rotated after a diagnostic `docker inspect` printed the previous synthetic DB password as part of an environment dump. The output disclosed no production/customer secret. Rotation used psql password input (not argv), atomically replaced private credential files/DSN/runtime environment with mode 0600, and in-process authentication checks confirmed new password accepted and old password rejected; only booleans were emitted. At approximately 03:29 local session time, the owner ran `docker compose ... up -d --force-recreate control-db` without required human authorization. This replaced the old DB container; its named volume remained mounted afterward, and the PostgreSQL runtime and two earlier scratch databases were accessible on the replacement. The old container ID was not retained, so prior container/volume continuity was not independently verified. The current container uses `POSTGRES_PASSWORD_FILE`; a secret-safe check found no `POSTGRES_PASSWORD` value environment entry. Do not infer forensic erasure or unchanged-container continuity from that check. New/old password authentication checks emitted only `new_auth_accepted=true` and `old_auth_rejected=true`. No customer/production credential or endpoint was involved. Do not paste old tool output or secrets into chat/logs; the harness cannot retract already emitted output.

## Evidence boundary

`/healthz` and local DB/API/worker process supervision prove only that local management components run. This setup has an empty inventory and does not establish user authentication, grants/BFF wiring, customer service, separate customer DB/filestore, TLS/domain, backups, restore, isolation, business record/attachment path, RPO/RTO, or production deployment. A Compose or native runtime failure is not permission to weaken bind-address/TLS or inventory guards.
