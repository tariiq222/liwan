# Isolated checks and manual backup

These tools are operator wrappers. They do not start, stop, restore, schedule,
or delete services. Local success is not production assurance.

## Odoo image

Build the Odoo image from the repository root with the pinned upstream source
revision:

```sh
docker build -f deploy/odoo/Dockerfile \
  --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" \
  --build-arg NASQ_REVISION="$(git rev-parse --short HEAD)" \
  -t "nasq-odoo:${NASQ_IMAGE_TAG:-dev}" .
```

`NASQ_IMAGE_TAG` selects the image tag used by Compose. `ODOO_COMMIT` selects
the immutable upstream Odoo revision fetched during the image build. The
Odoo source and Nasq addons are baked into the image and made read-only at
runtime; only `/var/lib/odoo` is writable customer data. Every container start
passes through `/opt/nasq/odoo_secure.py`, including provisioning shell runs.
The image replaces Debian's unpatched `wkhtmltopdf` with the architecture-
specific, vendored `wkhtmltox 0.12.6.1-3 bookworm` package after verifying the
matching entry in `deploy/odoo/vendor/SHA256SUMS`. The build fails when the
current architecture has no matching vendored package.

## Observed layout (this machine, 2026-09-06)

This is a description of paths that existed when the wrappers were written. It
is not a claim that backups, DNS, or a customer deployment are in place.

### Local development (canonical, do not target from these wrappers)

| Piece | Path / value |
| --- | --- |
| Nasq checkout | `/Users/tariq/code/nasq` on `main`; this worktree is `/Users/tariq/code/الاصلاحات` on `codex/الاصلاحات` |
| Odoo source (read-only) | `/Users/tariq/code/odoo`, `odoo-bin`, `.venv/bin/python` |
| Core `base` | `/Users/tariq/code/odoo/odoo/addons/base` (next to `odoo-bin`, not under extra `addons/`) |
| Extra official addons | `/Users/tariq/code/odoo/addons` (`project`, `hr`; no `base` here) |
| Odoo config | `/Users/tariq/code/odoo/odoo.conf` |
| Config `db_name` | `odoo19` (forbidden as a wrapper target) |
| Config `http_port` | `8069` (forbidden as a wrapper port) |
| Config `data_dir` | `/Users/tariq/code/odoo/.local` |
| Filestore | `/Users/tariq/code/odoo/.local/filestore/<dbname>` (includes `odoo19` and historical scratch names) |
| PostgreSQL | `localhost:5432`, peer/ident as the local OS user; databases include `odoo19` and many `nasq_*` scratch names |
| Default Nuxt | port `3000` (`apps/web/playwright.config.ts` still defaults `E2E_BASE_URL` to `http://localhost:3000` if unset — the E2E wrapper exists so that default is never used) |

### Docker Compose template (`deploy/docker-compose.yml`)

Not started by these tools. Named volumes, not bind mounts:

| Service | Image | Data |
| --- | --- | --- |
| `db` | `postgres:16` | volume `db_data` → `/var/lib/postgresql/data` |
| `odoo` | `nasq-odoo:${NASQ_IMAGE_TAG}` | baked Odoo and Nasq addons; volume `odoo_data` → `/var/lib/odoo` (`data_dir`); filestore inside the volume at `filestore/${DB_NAME}` |
| `web` | apps/web image | listens on container port `3000` |
| `proxy` | `nasq-caddy:${NASQ_IMAGE_TAG}` from `deploy/proxy/Dockerfile` | `80`/`443`; official Caddy plus `http.handlers.rate_limit` |

`deploy/odoo.conf` uses `data_dir = /var/lib/odoo`, `db_host = db`, `dbfilter = ^${DB_NAME}$`. Provisioning (`deploy/provision.sh`) validates all three secrets, selects the pinned baked image, then installs and seeds through its guarded entrypoint. The manual backup wrappers do not invoke provisioning.

To back up a Compose customer, the operator must supply **host paths** for
`pg_dump` output and for `<data_dir>/filestore/<db_name>` after copying or
mounting the volume themselves. This tool does not `docker exec`, `docker cp`,
`docker compose stop`, or read secrets from `deploy/.env`.

## Isolated Odoo / E2E (`deploy/check_isolated.py`)

Fail-closed. Every isolation value is a required flag. There is no default
database, port, or base URL.

```sh
python3 deploy/check_isolated.py odoo \
  --worktree /absolute/worktree \
  --addons-path /absolute/worktree/odoo-addons \
  --stock-addons /Users/tariq/code/odoo/addons \
  --python /Users/tariq/code/odoo/.venv/bin/python \
  --odoo-bin /Users/tariq/code/odoo/odoo-bin \
  --odoo-conf /Users/tariq/code/odoo/odoo.conf \
  --scratch-db nasq_scratch_example \
  --scratch-lifecycle CREATE_NEW_SCRATCH \
  --http-port 8169 \
  --modules nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  --test-tags /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat

python3 deploy/check_isolated.py e2e \
  --worktree /absolute/worktree \
  --addons-path /absolute/worktree/odoo-addons \
  --scratch-db nasq_scratch_example \
  --scratch-lifecycle CREATE_NEW_SCRATCH \
  --base-url http://127.0.0.1:3100 \
  --odoo-url http://127.0.0.1:8169 \
  --ws-url ws://127.0.0.1:8169/websocket
```

`--stock-addons` is the official extra addons directory (`project`, `hr`).
Core `base` is not there; it is validated as `<odoo-bin-dir>/odoo/addons/base`
and prepended on `--addons-path`. Passing the core `odoo/addons` directory as
`--stock-addons` is rejected.

E2E `--base-url` / `--odoo-url` / `--ws-url` must be loopback
(`127.0.0.1`, `localhost`, or `::1`) with an explicit non-default port.
HTTP(S) URLs may not carry a path, query, or fragment. The websocket URL path
must be exactly `/websocket`. Remote hosts are refused.

Refuses: `odoo19` / `production` / `postgres` names, names without `scratch`,
scratch names without `--scratch-lifecycle CREATE_NEW_SCRATCH`, ports
`80/443/3000/5432/8069/8072`, non-loopback URLs, credentialed URLs, relative
paths, missing nasq/project/hr/base manifests, `shell=True`.

`--scratch-lifecycle CREATE_NEW_SCRATCH` is an operator attestation only. The
wrapper does not query PostgreSQL, does not `createdb`/`dropdb`, and does not
verify that the database is new, empty, or unused. A name containing `scratch`
plus this token is not a proven new database.

The E2E wrapper overwrites `E2E_BASE_URL`, `NUXT_ODOO_URL`, `NUXT_ODOO_DB`, and
`NUXT_PUBLIC_WS_URL` from flags. Inherited `http://localhost:3000` or `odoo19`
values are discarded, not used as fallbacks.

Quality integration: merge `deploy/verification-checks.json` only after replacing
every `REPLACE_WITH_*` token. Leave `required: true`. Do not introduce `${ENV}`
substitution.

## Manual backup (`deploy/backup.py`)

Opt-in candidate copy only. Produces `database.dump` (pg_dump `-Fc`), a
`filestore/` copy, and `manifest.json` with `consistency: "UNVERIFIED"` and
`recovery_ready: false`, or fails without a success manifest.

This is **not** a consistent backup and **not** recovery-ready. A closed HTTP
port (`connect_ex != 0`) is not proof that Odoo, cron, remote writers, or
PostgreSQL sessions have stopped. This tool does not inspect processes or
database sessions and does not stop anything.

```sh
python3 deploy/backup.py \
  --opt-in MANUAL_BACKUP_OPT_IN \
  --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED \
  --db-name customerdb \
  --filestore /absolute/data_dir/filestore/customerdb \
  --output-dir /absolute/empty-parent/backup-id \
  --pg-dump /opt/homebrew/bin/pg_dump \
  --pg-host 127.0.0.1 \
  --pg-port 5432 \
  --pg-user tariq
```

Optional `--observe-http-port HOST:PORT` records TCP reachability. If that port
accepts connections, the candidate copy is refused. If it does not accept
connections, the manifest still stays `UNVERIFIED`. `--verify-port`,
`--pid-file`, `--consistent`, `--quiesced`, `--assume-stopped`, and `--live`
are declined.

### Operator evidence required

1. `--opt-in MANUAL_BACKUP_OPT_IN`. `true` / `yes` / `1` is rejected.
2. `--acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED`. This is an admission
   that the artifact is a non-atomic candidate, not a certified snapshot.
3. Independently verified maintenance window and a restore test, outside this
   tool. The wrapper will not claim those were done.
4. Filestore path must be `<data_dir>/filestore/<db_name>`.
5. Output directory must not already exist (no overwrite/delete).
6. No password flag. Do not put secrets on the argv list.

The manifest never sets `writer_stop_verified`, `consistency_verified`, or
`live_consistent`. `recovery_ready` is always false.

### What this tool will not do

- restore or declare recovery-ready
- schedule / cron / retention jobs
- delete backups or databases
- stop or start Odoo, PostgreSQL, Nuxt, Caddy, or Compose
- drain sessions or certify quiescence
- backup `odoo19` / `production` / `postgres`
- claim encryption, offsite copy, RPO, RTO, or live/stopped consistency

## Restore and verification (`deploy/restore_verify.py`)

Restore a candidate backup into a new scratch database and a new filestore
directory. Supply absolute paths to the PostgreSQL client tools:

```sh
ODOO_ROOT=/Users/tariq/code/odoo
WORKTREE=/Users/tariq/code/nasq/.worktrees/phase-0-reliability
ODOO_CONF=/absolute/path/to/scratch-only.conf
# Use a separate scratch config, never the live/upstream config. Disable
# configured tests and log files; CLI flags below override DB, data and ports.
export PYTHONDONTWRITEBYTECODE=1
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-tariq}
# Set PGPASSWORD through the environment when local PostgreSQL auth requires it;
# do not put a password on an argv list.
PGBIN=$(dirname "$(command -v pg_dump)"); WORK=$(mktemp -d)
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d nasq_drill_src_scratch --db-filter='^nasq_drill_src_scratch$' \
  --data-dir="$WORK/data" --without-demo=all \
  -i nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  --http-port=8169 --http-interface=127.0.0.1 --workers=0 --max-cron-threads=0 --stop-after-init
python3 deploy/backup.py --opt-in MANUAL_BACKUP_OPT_IN --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED \
  --db-name nasq_drill_src_scratch --filestore "$WORK/data/filestore/nasq_drill_src_scratch" \
  --output-dir "$WORK/backup" --pg-dump "$PGBIN/pg_dump" \
  --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"
python3 deploy/restore_verify.py --backup-dir "$WORK/backup" --target-db nasq_drill_restored_scratch \
  --target-filestore "$WORK/restored-data/filestore/nasq_drill_restored_scratch" \
  --pg-restore "$PGBIN/pg_restore" --createdb "$PGBIN/createdb" --psql "$PGBIN/psql" \
  --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"; echo exit=$?
```

Success writes `restore-verification.json` beside the backup with
`"restore_verified": true` and no missing attachment files. This is a
separate verification record; the tool never changes `manifest.json`, so its
capture-time `consistency: "UNVERIFIED"` claim remains unchanged.

Start Odoo against the restored scratch database without `-i`, `-u`, or
`--stop-after-init`, then check its health endpoint:

```sh
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d nasq_drill_restored_scratch --db-filter='^nasq_drill_restored_scratch$' \
  --data-dir="$WORK/restored-data" --http-port=8169 --http-interface=127.0.0.1 \
  --workers=0 --max-cron-threads=0 &
RESTORED_PID=$!
sleep 25; curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8169/web/health
```

The expected response is `200`. Stop only that process with
`kill "$RESTORED_PID"; wait "$RESTORED_PID"` after the check. Delete one
SQL-referenced attachment from the candidate filestore and repeat the restore
into another scratch database to prove the verifier returns exit `1` and names
the missing file in `missing_attachment_files`:

```sh
STORE_FNAME=$("$PGBIN/psql" --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  -d nasq_drill_src_scratch -At \
  -c "SELECT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY store_fname LIMIT 1")
test -n "$STORE_FNAME"
rm -- "$WORK/backup/filestore/$STORE_FNAME"
python3 deploy/restore_verify.py --backup-dir "$WORK/backup" --target-db nasq_drill_restored2_scratch \
  --target-filestore "$WORK/restored-data/filestore/nasq_drill_restored2_scratch" \
  --pg-restore "$PGBIN/pg_restore" --createdb "$PGBIN/createdb" --psql "$PGBIN/psql" \
  --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"; echo exit=$?
```

After the drill, drop the three scratch databases created above and remove only
the temporary `$WORK` directory. Never reuse an existing database or filestore.

## Unresolved (do not invent answers)

| Topic | Status |
| --- | --- |
| Retention | Not defined. This tool does not prune or age backups. |
| Encryption at rest / in transit for backup files | Not implemented. |
| Offsite / object-storage replication | Not implemented. |
| RPO | Not defined. |
| RTO | Not defined. |
| Compose volume export procedure | Not implemented; operator must present host paths. |
| Point-in-time PostgreSQL recovery | Not implemented (`pg_dump -Fc` only). |

## Verification of these files

Use mock tests only. Do not run a real dump, restore, or Odoo/E2E wrapper except
`--help`:

```sh
python3 -m unittest discover -s deploy -p test_operations.py
ruff check deploy/check_isolated.py deploy/backup.py deploy/test_operations.py
python3 deploy/check_isolated.py --help
python3 deploy/backup.py --help
```
