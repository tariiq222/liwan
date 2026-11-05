# Isolated checks and manual backup

These tools are operator wrappers. They do not start, stop, restore, schedule,
or delete services. Local success is not production assurance.

## Odoo image

Build the Odoo image from the repository root with the pinned upstream source
revision:

```sh
docker build -f deploy/odoo/Dockerfile \
  --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" \
  --build-arg LIWAN_REVISION="$(git rev-parse --short HEAD)" \
  -t "liwan-odoo:${LIWAN_IMAGE_TAG:-dev}" .
```

`LIWAN_IMAGE_TAG` selects the image tag used by Compose. `ODOO_COMMIT` selects
the immutable upstream Odoo revision fetched during the image build. The
Odoo source and LiwanOS addons are baked into the image and made read-only at
runtime; only `/var/lib/odoo` is writable customer data. Every container start
passes through `/opt/liwan/odoo_secure.py`, including provisioning shell runs.
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
| LiwanOS checkout | `/Users/tariq/code/webvue` on `main`; this worktree is `/Users/tariq/code/الاصلاحات` on `codex/الاصلاحات` |
| Odoo source (read-only) | `/Users/tariq/code/odoo`, `odoo-bin`, `.venv/bin/python` |
| Core `base` | `/Users/tariq/code/odoo/odoo/addons/base` (next to `odoo-bin`, not under extra `addons/`) |
| Extra official addons | `/Users/tariq/code/odoo/addons` (`project`, `hr`; no `base` here) |
| Odoo config | `/Users/tariq/code/odoo/odoo.conf` |
| Config `db_name` | `odoo19` (forbidden as a wrapper target) |
| Config `http_port` | `8069` (forbidden as a wrapper port) |
| Config `data_dir` | `/Users/tariq/code/odoo/.local` |
| Filestore | `/Users/tariq/code/odoo/.local/filestore/<dbname>` (includes `odoo19` and historical scratch names) |
| PostgreSQL | `localhost:5432`, peer/ident as the local OS user; databases include `odoo19` and many `liwan_*` scratch names |
| Default Nuxt | port `3000` (`apps/web/playwright.config.ts` still defaults `E2E_BASE_URL` to `http://localhost:3000` if unset — the E2E wrapper exists so that default is never used) |

### Docker Compose template (`deploy/docker-compose.yml`)

Not started by these tools. Named volumes, not bind mounts:

| Service | Image | Data |
| --- | --- | --- |
| `db` | `postgres:16` | volume `db_data` → `/var/lib/postgresql/data` |
| `odoo` | `liwan-odoo:${LIWAN_IMAGE_TAG}` | baked Odoo and LiwanOS addons; volume `odoo_data` → `/var/lib/odoo` (`data_dir`); filestore inside the volume at `filestore/${DB_NAME}` |
| `web` | apps/web image | listens on container port `3000` |
| `ai` (profile `ai`, optional) | apps/ai-service image | LiwanOS AI service on container port `8600`, no published port; release control state in the `liwan_ai` database, tenant run state in schema `liwan_ai` of each tenant database under the `liwan_ai` role |
| `proxy` | `liwan-caddy:${LIWAN_IMAGE_TAG}` from `deploy/proxy/Dockerfile` | `80`/`443`; official Caddy plus `http.handlers.rate_limit` |

Every Compose service drops all Linux capabilities (`cap_drop: [ALL]`) and none can gain privileges
(`no-new-privileges`), except `proxy`: it runs as the non-root `caddy` user (uid 10002) and keeps only
`NET_BIND_SERVICE` (owner decision 2026-10-31, issue #26) to bind `80`/`443`. `proxy`, `web`, `ai` and `db` also
have a read-only root filesystem with `tmpfs` for `/tmp` (Caddy's `/config` too, Postgres' socket directory too);
the writable state stays in the named volumes. `db` starts as the `postgres` user. `odoo` keeps a writable root
filesystem until its read-only boot has a recorded check. `deploy/test_container_hardening.py` guards the pins,
the non-root users and these settings.

Upgrading a deployment whose `caddy_data` volume was created by the earlier root proxy: the volume holds the issued
certificates and is owned by root, so the non-root proxy cannot write it and would request new certificates (Let's
Encrypt rate limits apply). Before starting the new proxy, once, hand the volume to uid 10002 using the pinned proxy image:
`docker compose run --rm --no-deps --user root --cap-add CHOWN --entrypoint chown proxy -R 10002:10002 /data`
(the compose file already mounts `caddy_data` on `/data`; the shared overlay uses the same volume, so the same command applies).
A fresh volume needs nothing: it is initialised from the image directory, already owned by `caddy`.

`deploy/odoo.conf` uses `data_dir = /var/lib/odoo`, `db_host = db`, `dbfilter = ^${DB_NAME}$`. Provisioning (`deploy/provision.sh`) validates all three secrets, selects the pinned baked image, then installs and seeds through its guarded entrypoint. The manual backup wrappers do not invoke provisioning.

The install makes the root company Saudi (country SA, currency SAR) before `account`, so stock loads the `sa` chart and VAT 15 % and creates any later pricelist in SAR; there is no chart step afterwards. Provisioning then pins the public origin: `web.base.url` = `https://$DOMAIN` with `web.base.url.freeze` (`deploy/seed_public_origin.py`), because stock builds payment return/webhook URLs and mail links from it and would otherwise rewrite it at an administrator's sign-in. After a domain change, set `DOMAIN` in `deploy/.env`, recreate the proxy (`docker compose up -d proxy`) and pin the origin again with the running image tag (the running Odoo is signalled and rereads it): `LIWAN_IMAGE_TAG=<tag> deploy/provision.sh --public-origin <domain> <db name>`.

To back up a Compose customer, the operator must supply **host paths** for
`pg_dump` output and for `<data_dir>/filestore/<db_name>` after copying or
mounting the volume themselves. This tool does not `docker exec`, `docker cp`,
`docker compose stop`, or read secrets from `deploy/.env`.

## LiwanOS AI

The `ai` service (`apps/ai-service`, port `8600`, `/healthz`) is optional and off by default: it sits under the Compose profile `ai`, so it does not exist unless `COMPOSE_PROFILES=ai` is set. Only `web` reaches it, through `NUXT_AI_SERVICE_URL=http://ai:8600`; it publishes no port. In the shared overlay it sits on `guard_web` (reachable from `web`), `database` (reaches `db`) and `ai_internal`, all three internal, while `ai-egress` sits on `ai_internal` and `edge`; it reads the same read-only tenant registry as `guard` and `web`.

AI state has two parts. The `liwan_ai` database holds release control state only: the deployment `state_id` (`ai_state_schema`) and the generation draining flags (`ai_generations`). It holds no tenant content. Each tenant's runs and LangGraph checkpoints live in schema `liwan_ai` inside that tenant's own database, so a tenant backup, restore or deletion carries its AI state with it.

Tenancy is set per deployment. In the dedicated stack the service serves the one tenant database from `DB_NAME` (`LIWAN_TENANCY_MODE=dedicated`, `AI_TENANT_DATABASE="${DB_NAME}"`). In the shared stack it maps a tenant id to its database from the tenant registry (`LIWAN_TENANCY_MODE=shared`, `LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json`), and an unknown tenant is refused with 403 before any connection. A database name must match `^[a-z][a-z0-9_]{0,62}$`; the service refuses to start otherwise, and so does `deploy/provision.sh` when the `ai` profile is enabled, before it does any install work.

Provisioning applies `deploy/ai/tenant_schema.sql` to each tenant database it creates, then, when the `ai` profile is enabled, runs the operator bootstraps that create the tables in schema `liwan_ai` of that database, after the control state:

```sh
docker compose exec -T db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -v tenant_db="$DB_NAME" < ai/tenant_schema.sql
docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-control
docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-tenant "$DB_NAME"
```

The control bootstrap runs once per deployment, and the tenant bootstrap once per tenant. The runtime validates state and never runs DDL.

The role `liwan_ai` can connect to each tenant database and use (with CREATE) schema `liwan_ai` there. It holds no grant on any Odoo table or sequence and loses its own schema-`public` privileges, so it can read no Odoo table; PostgreSQL still gives every role USAGE on schema `public` and EXECUTE on functions through `PUBLIC`, and Odoo grants nothing on its tables to `PUBLIC`.

The `ai` container has no direct internet access: it sits on internal networks only, and every outbound call, Ollama included, goes through `ai-egress`, a Squid forward proxy that allows CONNECT to port 443 for the hosts in `AI_EGRESS_HOSTS` (comma separated; `host:port` allows exactly that port for a local model server such as `ollama:11434`) and denies everything else, logging each refusal by host. `deploy/provision.sh` fills `AI_EGRESS_HOSTS` from `AI_PROVIDER` (and `AI_BASE_URL`) when it is empty, via `deploy/ai/egress_hosts.sh` (for `anthropic` it always resolves to `api.anthropic.com`, because that provider ignores `AI_BASE_URL`); to allow another host, add it to that line in `deploy/.env` and restart `ai-egress`.

Variables (see `deploy/ai/.env.example`): `AI_PROVIDER` (`anthropic`, `openai`, `ollama` or `openrouter`), `AI_MODEL` (required once enabled; the service fails at start with its own error when it is empty), `AI_API_KEY` (required for anthropic/openai/openrouter), `AI_BASE_URL`, `AI_OPENROUTER_REFERER` and `AI_OPENROUTER_TITLE` (optional, openrouter only), `AI_RUN_RETENTION_DAYS` (default 30), `AI_DB_PASSWORD`, `AI_SERVICE_TOKEN`. The last two are generated by `deploy/ai/ensure_secrets.sh`, which `deploy/provision.sh` calls when `COMPOSE_PROFILES` in `deploy/.env` contains `ai`; other variables stay operator-set, so a deployment that never enables AI needs none of them. `AI_DEV_INSECURE` is not a deployment variable: see the note after the enabling steps.

OpenRouter: set `AI_PROVIDER=openrouter`, `AI_API_KEY` to the OpenRouter key and `AI_MODEL` to an OpenRouter model id such as `anthropic/claude-sonnet-4.5`; the optional `AI_OPENROUTER_REFERER` and `AI_OPENROUTER_TITLE` are sent as `HTTP-Referer` and `X-Title` for attribution. Any other OpenAI-compatible endpoint needs only `AI_PROVIDER=openai` with `AI_BASE_URL`.

Enabling:

1. `AI_DB_PASSWORD` and `AI_SERVICE_TOKEN` are generated by `deploy/ai/ensure_secrets.sh`, which `deploy/provision.sh` runs right after it finds `deploy/.env` and only when `COMPOSE_PROFILES` there contains `ai`: a name that is absent or empty gets a 64-character hex value written into `deploy/.env` (mode `600`), a value that already exists is kept byte-for-byte, and no value is ever printed. An existing `AI_DB_PASSWORD` must stay URL-safe (hex or base64url) because it is placed inside `AI_DATABASE_URL`, the control database URL, which you set to `postgresql://liwan_ai:<AI_DB_PASSWORD>@db:5432/liwan_ai`. `AI_SERVICE_TOKEN` is at least 24 characters; `web` sends it as `X-Liwan-Service-Token` (`NUXT_AI_SERVICE_TOKEN`) and the service rejects any other caller. Set `AI_DATABASE_URL` to `postgresql://liwan_ai:<AI_DB_PASSWORD>@db:5432/liwan_ai` after reading the generated password from `deploy/.env`.
2. In `deploy/.env` set `COMPOSE_PROFILES=ai`, `NUXT_AI_SERVICE_URL=http://ai:8600`, `AI_MODEL`, the provider variables and `AI_DATABASE_URL`. `AI_SERVICE_TOKEN` and `AI_DB_PASSWORD` come from step 1; Compose refuses to start the `ai` service when the token is empty, and so does the service itself. `AI_DATABASE_URL` is mandatory: the service refuses to start without it (only `AI_ALLOW_MEMORY_STATE=true` allows in-memory state, for development). A claimed write whose executor crashed is never executed twice: after the stale window the run reports `failed` and only a new user message continues it.
3. Bootstrap the AI state once per deployment and once per tenant: `python -m liwan_ai_service.store --initialize-control` (`docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-control`), then `--initialize-tenant <db>` for each tenant. Both are idempotent, and `provision.sh` runs them itself, in that order, when the `ai` profile is enabled; a tenant database created by another route still needs the tenant schema and the tenant bootstrap described under Database isolation below.
4. `docker compose up -d`. Without `NUXT_AI_SERVICE_URL` the `/ai` page stays hidden; outside development an AI URL with an empty token also keeps it hidden (the server logs one line naming the variable).

`AI_DEV_INSECURE=true` removes the service token requirement, so it is for development only. The service accepts it only together with `AI_ALLOW_MEMORY_STATE=true` and no `AI_DATABASE_URL`, and it must stay unset in any deployment.

Do not rotate `AI_SERVICE_TOKEN` or `AI_DB_PASSWORD` casually. The token is one shared secret: rotating it means restarting `web` and `ai` together, otherwise the old token still held by `web` is rejected and `/ai` fails until both run the same value. The password belongs to the `liwan_ai` role on a fresh `db_data` volume and to `AI_DATABASE_URL`, so rotating it needs the role, the URL and the `ai` service updated together. Re-running `deploy/provision.sh` never rotates either one.

Tenant provider keys: a tenant administrator may run the AI on the tenant's own provider key (AI settings page). The key is stored only in that tenant's `liwan_ai.ai_tenant_config`, encrypted inside PostgreSQL with `pgcrypto` (AES-256), which `deploy/ai/tenant_schema.sql` installs in schema `liwan_ai`. The secret is `AI_KEY_ENCRYPTION_KEYS` (`id:secret` pairs) with `AI_KEY_ENCRYPTION_KEY_ID` naming the one new keys use; `ensure_secrets.sh` generates `k1` once and never rotates it. Every ciphertext records its key id. To rotate: add a new pair (`k1:<old>,k2:<new>`), set `AI_KEY_ENCRYPTION_KEY_ID=k2`, restart `ai`, then run `docker compose exec ai python -m liwan_ai_service.tenant_config --rotate` (it prints counts only and exits 1 if a tenant failed). Keep the old pair while any backup taken before the rotation may still be restored: restoring a tenant needs every key id its ciphertext names. Without the keyring the tenant-key mode answers `ai_key_unavailable` and the platform provider keeps working.

Retention: each tenant keeps runs for its own `retention_days` (1 to 365, AI settings page). `AI_RUN_RETENTION_DAYS` is only the window a tenant starts with when its schema is bootstrapped; the scheduled cleanup deletes each tenant's runs past its own window.

Database isolation: the service connects as the dedicated role `liwan_ai`, which owns the `liwan_ai` control database and can connect to each tenant database with USAGE and CREATE on schema `liwan_ai` only. It is not the `odoo` superuser and holds no grant on any Odoo table or sequence, having lost its own schema-`public` privileges, so it can read no Odoo table; PostgreSQL still gives every role USAGE on schema `public` and EXECUTE on functions through `PUBLIC`, and Odoo grants nothing on its tables to `PUBLIC`. `deploy/ai/init-db.sh` (mounted into `/docker-entrypoint-initdb.d/20-liwan-ai.sh`) runs on a fresh `db_data` volume only and, when `AI_DB_PASSWORD` is non-empty, creates the role and database, revokes `CONNECT` on `liwan_ai` from `PUBLIC`, and revokes `CONNECT` on every other existing database from `PUBLIC` and from `liwan_ai`. A tenant database created later gets `CONNECT` granted selectively by `deploy/ai/tenant_schema.sql`, which `deploy/provision.sh` applies to each tenant database it creates, right after the install and before the services start: when the `liwan_ai` role exists it grants `CONNECT` there, creates schema `liwan_ai`, and revokes `public` from the role; it does nothing when the role does not exist. A tenant database created by another route (shared-mode tenant databases) needs the same script once: `docker compose exec -T db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -v tenant_db="<tenant_db>" < ai/tenant_schema.sql`, then the tenant bootstrap below.

Existing `db_data` volume (init scripts do not rerun): create the role and database once, by hand, with the password passed as a psql variable:

```sh
docker compose exec -T db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -v ai_password="$AI_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE liwan_ai LOGIN PASSWORD %L', :'ai_password') \gexec
CREATE DATABASE liwan_ai OWNER liwan_ai;
REVOKE CONNECT ON DATABASE liwan_ai FROM PUBLIC;
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', datname) FROM pg_database WHERE datname <> 'liwan_ai' \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM liwan_ai', datname) FROM pg_database WHERE datname <> 'liwan_ai' \gexec
SQL
```

Then, for each tenant database, apply `ai/tenant_schema.sql` as shown above and run the control and tenant bootstraps:

```sh
docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-control
docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-tenant "<tenant_db>"
```

(`docker compose exec` forwards the host shell's `AI_DB_PASSWORD` through the `-v` argument, so export it first; the value never appears in SQL text.)

- Retention cleanup of old runs: `docker compose exec ai python -m liwan_ai_service.cleanup`, scheduled by the host cron; it visits every tenant database in the directory.
- Stopping `ai`, or never enabling the profile, changes nothing else: `web`, `odoo` and `proxy` do not depend on it (works in `saas` and `non_saas`).
- Threat model: the service holds no LiwanOS credential (no Odoo session or token, no `odoo` database password), only its own database role and the shared service token; all LiwanOS data reaches it per request through `web`, under the caller's own permissions.

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
  --scratch-db liwan_scratch_example \
  --scratch-lifecycle CREATE_NEW_SCRATCH \
  --http-port 8169 \
  --with-oca \
  --modules liwan_core,liwan_platform,liwan_api,liwan_ai,liwan_ai_notify,liwan_directory,liwan_documents,liwan_notify,liwan_meetings,liwan_operations,liwan_pmo,liwan_meetings_pmo,liwan_operations_pmo,liwan_pmo_ai,liwan_hr,liwan_access_hr,liwan_documents_hr,liwan_hr_operations,liwan_integrations_sa,liwan_finance,liwan_hr_finance,liwan_pmo_finance,liwan_payments,liwan_chat,liwan_tasks,liwan_tasks_pmo,liwan_crm,liwan_appointments,liwan_appointments_payments,liwan_inbox,liwan_inbox_payments,liwan_hr_ai,liwan_crm_ai,liwan_meetings_ai,liwan_tasks_ai,liwan_operations_ai,liwan_finance_ai \
  --test-tags /liwan_core,/liwan_platform,/liwan_api,/liwan_ai,/liwan_ai_notify,/liwan_directory,/liwan_documents,/liwan_notify,/liwan_meetings,/liwan_operations,/liwan_pmo,/liwan_meetings_pmo,/liwan_operations_pmo,/liwan_pmo_ai,/liwan_hr,/liwan_access_hr,/liwan_documents_hr,/liwan_hr_operations,/liwan_integrations_sa,/liwan_finance,/liwan_hr_finance,/liwan_pmo_finance,/liwan_payments,/liwan_chat,/liwan_tasks,/liwan_tasks_pmo,/liwan_crm,/liwan_appointments,/liwan_appointments_payments,/liwan_inbox,/liwan_inbox_payments,/liwan_hr_ai,/liwan_crm_ai,/liwan_meetings_ai,/liwan_tasks_ai,/liwan_operations_ai,/liwan_finance_ai

python3 deploy/check_isolated.py e2e \
  --worktree /absolute/worktree \
  --addons-path /absolute/worktree/odoo-addons \
  --scratch-db liwan_scratch_example \
  --scratch-lifecycle CREATE_NEW_SCRATCH \
  --base-url http://127.0.0.1:3100 \
  --odoo-url http://127.0.0.1:8169 \
  --ws-url ws://127.0.0.1:8169/websocket
```

`--with-oca` appends the pinned OCA addons (`deploy/oca-addons.json`, fetched with `python3 -B tools/oca_addons.py fetch`):
`liwan_finance` depends on them, so the `odoo` check cannot install it without them.
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
paths, missing liwan/project/hr/base manifests, `shell=True`.

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

## Release-routed tenant backup (`deploy/releases`)

Separate from the manual `UNVERIFIED` tool above, and documented in
[releases/README.md](releases/README.md). `backup-current` is the only path that
may claim a quiescent tenant window, and only inside its own contract:

| Claim | Status |
| --- | --- |
| Writer window | Proven by source: every declared writer role (current and candidate) is denied `CONNECT` for the whole dump/archive, existing work is drained and idle sessions retired, candidate is never granted admission. An unsupported principal refuses the window, including any login that is a member (directly or transitively) of a declared writer; retirement and the window recheck cover those member sessions too. |
| Previous-state restore | Durable intent before the first effect, including each owned cron's inspected container id; only previously granted writers are reopened and only a previously running cron is restarted, by that recorded id. A same-name replacement refuses (`cron_container_replaced`). |
| Pending operation | A new request id is refused (`backup_operation_pending`) while the tenant has a maintenance marker or an unresolved backup intent; only the owning request id recovers it. A request killed after its intent but before `prepared` is still `planned` with nothing fenced: recover it with the same command and the same `--request-id` (`python3 -B -m deploy.releases.cli backup-current --state … --binding … --runtime … --request-id <owning id> --output <same output>`), which replaces that unacted intent from a fresh preflight instead of failing with `backup_intent_conflict`. |
| One budget | Every window, resume and reconciliation step, including each guard ACK (status, headers and body read under the absolute deadline, bounded body) and each Docker inspect/exec/stop/start (timeout = time left at dispatch, none after expiry), ends by its budget; an overrun fails closed. |
| Interruption | A crash (SIGKILL) or failure leaves the durable intent; a re-run of the same request, from any stage, reconciles the previous state without capturing again and refuses when the fence is no longer intact. Every failure recreates the maintenance marker before re-fencing (ACK, lease drain, writer fence, cron stop) and keeps it if fencing fails. |
| Consistency / restore | `consistency: quiescent_gate` and `restoreVerified: false`. Hash-valid capture is not a business restore, and the manual tool's `UNVERIFIED` claim is never upgraded. |
| Coverage boundary | Not proven against a privileged DBA/root, a host-side writer outside the declared model, a shared volatile mount, or any target outside `liwan_scratch_*`. |
| Release path | `prepare`/`quiesce`/`capture`/`migrate`/`verify`/`retire` are unchanged from `main`; the candidate keeps `CONNECT` through verify. Only `backup-current` uses the writer window and `capture_window`. |
| Live proof | Opt-in `test_backup_live` (scratch `liwan_scratch_backup_*`, loopback PostgreSQL) exercises `fence_writers`, recheck, dump/archive capture and scratch restore of a one-row table. It refuses existing fixture roles or restore target, restores into a fresh `liwan_scratch_backup_restore_<random>` database and drops only the roles and database it created. Docker/Odoo runtime, cron containers and a non-zero business restore stay separate gates. |

Setup keys the runtime reads: `backup.totalDeadlineSeconds` (one absolute monotonic budget per
operation, fixed before the first effect and covering the initial guard ACK, lease drain, every
writer-fence connection/statement, the cron stop, filestore walk, dump, archive, hashes, fsyncs,
every recheck connection/statement, the final artifact validation, the resume and the final ACK;
default 600; a blocking call is bounded by the remaining time, not preempted mid-call; an overrun
fails closed and is never `verified`), `backup.timeoutSeconds` (per-child cap; the separate budget
of a later same-id reconciliation through its final ACK, and of each fail-closed re-fence) and
`backup.allowedPrincipals` (closed operator allowance beside `postgres.adminUser`).
Never reuse an existing artifact directory, database or filestore: a refused or
interrupted run preserves partial artifacts for investigation.

## Restore and verification (`deploy/restore_verify.py`)

Restore a candidate backup into a new scratch database and a new filestore
directory. Supply absolute paths to the PostgreSQL client tools:

```sh
ODOO_ROOT=/Users/tariq/code/odoo
WORKTREE=/Users/tariq/code/webvue/.worktrees/phase-0-reliability
ODOO_CONF=/absolute/path/to/scratch-only.conf
# Use a separate scratch config, never the live/upstream config. Disable
# configured tests and log files; CLI flags below override DB, data and ports.
export PYTHONDONTWRITEBYTECODE=1
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-tariq}
# Set PGPASSWORD through the environment when local PostgreSQL auth requires it;
# do not put a password on an argv list.
PGBIN=$(dirname "$(command -v pg_dump)"); WORK=$(mktemp -d)
# The pinned OCA repositories come last (liwan_finance depends on them).
OCA_PATH=$(cd "$WORKTREE" && python3 -B tools/oca_addons.py path --check)
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons,$OCA_PATH" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d liwan_drill_src_scratch --db-filter='^liwan_drill_src_scratch$' \
  --data-dir="$WORK/data" --without-demo=all \
  -i liwan_core,liwan_platform,liwan_api,liwan_ai,liwan_ai_notify,liwan_directory,liwan_documents,liwan_notify,liwan_meetings,liwan_operations,liwan_pmo,liwan_meetings_pmo,liwan_operations_pmo,liwan_pmo_ai,liwan_hr,liwan_access_hr,liwan_documents_hr,liwan_hr_operations,liwan_integrations_sa,liwan_finance,liwan_hr_finance,liwan_pmo_finance,liwan_payments,liwan_chat,liwan_tasks,liwan_tasks_pmo,liwan_crm,liwan_appointments,liwan_appointments_payments,liwan_inbox,liwan_inbox_payments,liwan_hr_ai,liwan_crm_ai,liwan_meetings_ai,liwan_tasks_ai,liwan_operations_ai,liwan_finance_ai \
  --http-port=8169 --http-interface=127.0.0.1 --workers=0 --max-cron-threads=0 --stop-after-init
python3 deploy/backup.py --opt-in MANUAL_BACKUP_OPT_IN --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED \
  --db-name liwan_drill_src_scratch --filestore "$WORK/data/filestore/liwan_drill_src_scratch" \
  --output-dir "$WORK/backup" --pg-dump "$PGBIN/pg_dump" \
  --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"
python3 deploy/restore_verify.py --backup-dir "$WORK/backup" --target-db liwan_drill_restored_scratch \
  --target-filestore "$WORK/restored-data/filestore/liwan_drill_restored_scratch" \
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
  -d liwan_drill_restored_scratch --db-filter='^liwan_drill_restored_scratch$' \
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
  -d liwan_drill_src_scratch -At \
  -c "SELECT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY store_fname LIMIT 1")
test -n "$STORE_FNAME"
rm -- "$WORK/backup/filestore/$STORE_FNAME"
python3 deploy/restore_verify.py --backup-dir "$WORK/backup" --target-db liwan_drill_restored2_scratch \
  --target-filestore "$WORK/restored-data/filestore/liwan_drill_restored2_scratch" \
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
