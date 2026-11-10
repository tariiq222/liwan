# Isolated checks and manual backup

These tools are operator wrappers. They do not start, stop, restore, schedule,
or delete services. Local success is not production assurance.

Production sizing (Odoo workers, PostgreSQL connections, pgbouncer pools and the
memory budget for the Jeddah 4 OCPU / 24 GB server) is computed, not typed:
[operations/odoo-sizing.md](../docs/operations/odoo-sizing.md) records the
arithmetic and `deploy/odoo_sizing.py` reproduces it (`--render odoo` prints the
`[options]` lines, `--render json` prints the whole plan with its invariants).
`deploy/docker-compose.production.yml` applies the box-level envelope.

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
| `db` | `pgvector/pgvector:pg16` (postgres 16 plus the `vector` extension) | volume `db_data` → `/var/lib/postgresql/data` |
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

Tenancy is set per deployment. In the dedicated stack the service serves the one tenant database from `DB_NAME` (`LIWAN_TENANCY_MODE=dedicated`, `AI_TENANT_DATABASE="${DB_NAME}"`). In the shared stack it maps a tenant id to its database from the tenant registry (`LIWAN_TENANCY_MODE=shared`, `LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json`), and an unknown tenant is refused with 403 before any connection. A database name must match `^[a-z][a-z0-9_]{0,62}$`; the service refuses to start otherwise, and so does `deploy/provision.sh` for every tenant, before it does any install work.

Provisioning creates each tenant database empty and isolates it before any install: `tenant_isolation_sql` in `deploy/releases/postgres.py` revokes `CONNECT` from `PUBLIC`, grants it to `odoo` and fails if `PUBLIC` still holds it. It then applies `deploy/ai/tenant_schema.sql`, then, when the `ai` profile is enabled, runs the operator bootstraps that create the tables in schema `liwan_ai` of that database, after the control state:

```sh
docker compose exec -T db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -v tenant_db="$DB_NAME" < ai/tenant_schema.sql
docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-control
docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-tenant "$DB_NAME"
```

The control bootstrap runs once per deployment, and the tenant bootstrap once per tenant. The runtime validates state and never runs DDL.

The role `liwan_ai` can connect to each tenant database and use (with CREATE) schema `liwan_ai` there. It holds no grant on any Odoo table or sequence and loses its own schema-`public` privileges, so it can read no Odoo table; PostgreSQL still gives every role USAGE on schema `public` and EXECUTE on functions through `PUBLIC`, and Odoo grants nothing on its tables to `PUBLIC`.

The `ai` container has no direct internet access: it sits on internal networks only, and every outbound call, Ollama included, goes through `ai-egress`, a Squid forward proxy that allows CONNECT to port 443 for the hosts in `AI_EGRESS_HOSTS` (comma separated; `host:port` allows exactly that port for a local model server such as `ollama:11434`) and denies everything else, logging each refusal by host. `deploy/provision.sh` fills `AI_EGRESS_HOSTS` from `AI_PROVIDER` (and `AI_BASE_URL`) when it is empty, via `deploy/ai/egress_hosts.sh` (for `anthropic` it always resolves to `api.anthropic.com`, because that provider ignores `AI_BASE_URL`); to allow another host, add it to that line in `deploy/.env` and restart `ai-egress`. It also adds the embedding host (`AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_BASE_URL`) when it differs from the chat host; an `AI_EGRESS_HOSTS` you set yourself is kept as it is, so list the embedding host there too.

Tenants' own provider hosts are not listed in `AI_EGRESS_HOSTS`. A tenant on its own key may use a named provider or the generic `openai_compatible` one with an `https` base URL (port 443, no credentials, a public host name). When a key is saved or removed, and once at startup for the tenant databases it serves, the `ai` service writes the hosts that key needs into one file per tenant database, `<database>.hosts` (one lowercase hostname per line, written atomically), in the named volume `ai_tenant_hosts`: mounted read-write at `/egress` in `ai`, read-only in `ai-egress`. At save the service refuses a base URL whose host resolves to any private, loopback, link-local, CGNAT, multicast or reserved address (422 `ai_base_url_not_public`, field `base_url`); inside the internal network a public name does not resolve, so there the proxy is the check. `ai-egress` reads those files at start and every `AI_EGRESS_WATCH_SECONDS` (default 5) seconds: when they change it renders the configuration again, has squid check it, and reloads squid with SIGHUP; an invalid line is logged (`ai-egress: skipping invalid tenant host`) and skipped, and a configuration squid rejects is not applied. Tenant hosts allow CONNECT to port 443 only, and squid denies the connection when the host resolves to a private address (checked at connect time, so a name that later resolves privately is refused as well); the static `AI_EGRESS_HOSTS` entries are unaffected. A new key's host is therefore reachable a few seconds after the save. To withdraw a tenant's host by hand, delete its `.hosts` file from the volume.

Notes on this mechanism. (1) A published tenant host is reachable by any request the `ai` container makes, not only by that tenant's calls; this is acceptable because a tenant's key is only ever sent to its own host, and the host stays limited to port 443 and to public addresses. (2) An operator who lists an internal dotted host on port 443 in `AI_EGRESS_HOSTS` (for example `llm.corp.example`) makes it allowed by the static rule, which squid evaluates before the tenant rules, so a tenant base URL naming it is reachable too; in a sovereign single-tenant deployment that is the intended way to reach an internal model server, and elsewhere such a host should not be listed on 443. (3) The private-destination check is squid's `dst` ACL, evaluated when it connects. It denies a host when any address it resolves to is private; this was confirmed on the live image with a name that has one public and one private address. That a name which resolves privately only later (DNS rebinding) is refused rests on squid connecting to the address set it just checked, as it does through its own DNS cache; a time-varying DNS answer was not reproduced. (4) At start `ai-egress` has squid check the configuration; if the tenant files make it invalid it starts with the static hosts only and logs `starting with the static hosts only`, and the watcher applies the tenant hosts once the files are valid. (5) The watcher is supervised by the entrypoint and restarted with a log line if it stops. (6) After upgrading a deployment that already has tenant schemas, run `--initialize-tenant <db>` for each (idempotent): it adds the `key_base_url` column; until then reading the tenant configuration fails.

Platform provider: the `ai` service reads the provider LiwanOS pays for from one JSON file, `AI_PLATFORM_PROVIDER_FILE` (`provider`, `model`, `base_url`, `api_key`, `revision`), never from its environment. In a dedicated or customer-hosted deployment `deploy/provision.sh` writes it to `platform-provider.json` in the directory Compose mounts into `ai`: `LIWAN_AI_PLATFORM_DIR` from the shell environment or `deploy/.env`, default `deploy/data/ai` (relative paths are relative to `deploy/`) (**mode `600`, owned by uid 10001**: provisioning must run as root, otherwise the writer exits non-zero without writing and says so, unless `LIWAN_AI_PLATFORM_FILE_UNOWNED=1` accepts an unowned file where bind-mount ownership is ignored, such as Docker Desktop; replaced atomically, `revision` raised only when a value changes, no value printed; `deploy/.env` is read like Compose reads it, so the last assignment of a name wins and a trailing ` # comment` is not part of the value; `provision.sh` stops at once, naming `AI_MODEL`, when the `ai` profile is on and it is empty) through `deploy/ai/platform_provider.py`, from the operator variables `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` and `AI_BASE_URL` of `deploy/.env`; no container receives those four. `docker-compose.yml` mounts the directory read-only at `/etc/liwan-ai` (override the host directory with `LIWAN_AI_PLATFORM_DIR`); the directory is mounted, not the file, so an atomic replacement is seen. To change the provider, edit the variables and run `python3 ai/platform_provider.py .env data/ai/platform-provider.json` from `deploy/`: the service checks the file every 5 seconds, rebuilds its model when the content is valid, and otherwise keeps the last valid configuration and logs the rejection by reason (never the key). A missing or invalid file stops `ai` at start, naming the field. In shared SaaS (`docker-compose.shared.yml`) the directory is `LIWAN_AI_PLATFORM_DIR`, which the control plane writes (`LIWAN_AI_PLATFORM_PROVIDER_PATH`, an absolute path to `platform-provider.json` in that directory) when the vendor saves the provider in the vendor console (AI provider page): the same one-way, file-based pattern as the tenant registry, so the product keeps running on the last configuration when the control plane is down. The control plane runs as its own user and writes the file **mode `640`** (the dedicated file is mode `600` owned by 10001, see above); give the directory the group of uid/gid 10001 (for example `chgrp 10001` with the setgid bit) so `ai` can read it and no other user can. `LIWAN_AI_PLATFORM_DIR` has a default (`./data/ai`) in the shared overlay too, so `tools/shared_acceptance_live` keeps rendering; if it points at a directory without `platform-provider.json`, `ai` stops at start with `AI_PLATFORM_PROVIDER_FILE: unreadable` and a message naming `LIWAN_AI_PLATFORM_DIR`. A custom endpoint chosen in the vendor console must be a public https address on port 443: ai-egress opens no other port for a published host, so the control plane refuses another port with `invalid_base_url_port`. The vendor console page needs `vendor.ai.manage` (owner only by default); the control plane contacts providers only at public addresses, except for the self-hosted Ollama preset, and audits every save, model list and connection test (preset, host, outcome, never the key). The platform provider's public host is published to `ai-egress` by the service itself as `platform.hosts` in the tenant-host volume, so a new public provider needs no `AI_EGRESS_HOSTS` edit; an internal host (a self-hosted Ollama) still does.

Variables (see `deploy/ai/.env.example`): `AI_PROVIDER` (`anthropic`, `openai`, `ollama`, `openrouter` or `openai_compatible`, which needs `AI_BASE_URL`), `AI_MODEL` (required once enabled; `provision.sh` refuses to write the file when it is empty), `AI_API_KEY` (required for anthropic/openai/openrouter/openai_compatible), `AI_BASE_URL`, `AI_STREAM_USAGE` (optional `true`/`false`: ask the provider's stream for token counts; a custom `AI_BASE_URL` is not asked unless this is `true`, and then its calls carry no token counts and the token limits cannot be enforced), `AI_OPENROUTER_REFERER` and `AI_OPENROUTER_TITLE` (optional, openrouter only), `AI_RUN_RETENTION_DAYS` (default 30), `AI_DB_PASSWORD`, `AI_SERVICE_TOKEN`. The last two are generated by `deploy/ai/ensure_secrets.sh`, which `deploy/provision.sh` calls when `COMPOSE_PROFILES` in `deploy/.env` contains `ai`; other variables stay operator-set, so a deployment that never enables AI needs none of them. `AI_DEV_INSECURE` is not a deployment variable: see the note after the enabling steps.

OpenRouter: set `AI_PROVIDER=openrouter`, `AI_API_KEY` to the OpenRouter key and `AI_MODEL` to an OpenRouter model id such as `anthropic/claude-sonnet-4.5`; the optional `AI_OPENROUTER_REFERER` and `AI_OPENROUTER_TITLE` are sent as `HTTP-Referer` and `X-Title` for attribution. Any other OpenAI-compatible endpoint needs only `AI_PROVIDER=openai` with `AI_BASE_URL`.

Enabling:

1. `AI_DB_PASSWORD` and `AI_SERVICE_TOKEN` are generated by `deploy/ai/ensure_secrets.sh`, which `deploy/provision.sh` runs right after it finds `deploy/.env` and only when `COMPOSE_PROFILES` there contains `ai`: a name that is absent or empty gets a 64-character hex value written into `deploy/.env` (mode `600`), a value that already exists is kept byte-for-byte, and no value is ever printed. An existing `AI_DB_PASSWORD` must stay URL-safe (hex or base64url) because it is placed inside `AI_DATABASE_URL`, the control database URL, which you set to `postgresql://liwan_ai:<AI_DB_PASSWORD>@db:5432/liwan_ai`. `AI_SERVICE_TOKEN` is at least 24 characters; `web` sends it as `X-Liwan-Service-Token` (`NUXT_AI_SERVICE_TOKEN`) and the service rejects any other caller. `AI_TOKEN_KEY` is generated the same way and given to `web` only (`NUXT_AI_TOKEN_KEY`): it opens the tokens that carry mobile numbers and emails past the provider, so the `ai` service never holds it; rotating it leaves the tokens already in conversations unrestored. Set `AI_DATABASE_URL` to `postgresql://liwan_ai:<AI_DB_PASSWORD>@db:5432/liwan_ai` after reading the generated password from `deploy/.env`.
2. In `deploy/.env` set `COMPOSE_PROFILES=ai`, `NUXT_AI_SERVICE_URL=http://ai:8600`, `AI_MODEL`, the provider variables (written to the platform provider file by `provision.sh`) and `AI_DATABASE_URL`. `AI_SERVICE_TOKEN` and `AI_DB_PASSWORD` come from step 1; Compose refuses to start the `ai` service when the token is empty, and so does the service itself. `AI_DATABASE_URL` is mandatory: the service refuses to start without it (only `AI_ALLOW_MEMORY_STATE=true` allows in-memory state, for development). A claimed write whose executor crashed is never executed twice: after the stale window the run reports `failed` and only a new user message continues it.
3. Bootstrap the AI state once per deployment and once per tenant: `python -m liwan_ai_service.store --initialize-control` (`docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-control`), then `--initialize-tenant <db>` for each tenant. Both are idempotent, and `provision.sh` runs them itself, in that order, when the `ai` profile is enabled; a tenant database created by another route still needs the tenant schema and the tenant bootstrap described under Database isolation below.
4. `docker compose up -d`. Without `NUXT_AI_SERVICE_URL` the `/ai` page stays hidden; outside development an AI URL with an empty token also keeps it hidden (the server logs one line naming the variable).

AI usage recorder key (issue #557): once a run ends, `web` reports its provider calls (the usage ledger, which feeds `ai.tokens.monthly`) to `POST /api/v1/ai/usage/service` as the tenant's technical account `liwan_ai.user_ai_usage`, with an Odoo API key, instead of with the user's session, so a logout, an expired cookie or a revoked `ai.use` during a run no longer drops its rows. Dedicated deployments only; the shared SaaS key is a later step and shared deployments keep reporting with the session. `deploy/provision.sh` mints the key after the install when `COMPOSE_PROFILES` has `ai` and `LIWAN_AI_USAGE_KEY` is empty in `deploy/.env` (`deploy/seed_ai_usage_key.py` prints one line the script filters; `deploy/ai/write_env_secret.sh` stores it, mode `600`, never echoed or logged), and `docker-compose.yml` hands it to `web` alone. Account: active but with no password and no sign-in (every credential check refuses it), in no user type so it is not a seat, hidden from the access administration, holding the one capability `ai.usage.record` in every company and nothing else. Key: hex, no expiry, accepted by Odoo only on that one route (`odoo-addons/liwan_platform/models/ir_http.py` answers every other bearer request 404 before looking at the key), forwarded by `web` and the shared guard only on that exact `POST` target, and never sent with a session cookie. The route validates each batch's `user_id` as an internal user (a leaver's calls still count) of `user_company_id`, so a row cannot be attributed to another user or company; a re-sent batch is settled by `(user_id, conversation_id, call_id)`. Rotate with `deploy/provision.sh --rotate-ai-usage-key <domain> <db>` (revokes the old key, writes the new one, recreates `web`; until `web` restarts, usage reports are refused 401, kept and retried). Rows Odoo has not accepted yet wait in `web`'s memory and are retried when the next AI run ends, within an hour; they are lost if `web` restarts first (a refused or unreachable Odoo is logged by status or class and row count, never silently). No durable store is added on purpose: `web` runs read-only with no volume, and a file or database for a few rows would be a new infrastructure dependency.

AI usage recorder key, blast radius and incident procedure (issue #557): the key can only add usage rows, and only within bounds the route enforces in `liwan_ai/models/ai_usage.py`: a row reports at most the tenant's per-run input ceiling (2,000,000 tokens) and the AI service's per-run output cap (1,000,000) because no single call can consume more; a request at most four full runs of tokens (12,000,000); `called_at` no older than 24 hours (the web spool gives a row up after one hour) and no more than 5 minutes ahead, so a row cannot be moved into another month; and at most 600 rows a minute for the recorder, counted from the ledger itself (no counter store). Refusals are a structured 422 (`items.<i>.<field>`) or a 429 `rate_limited` with `retry_after_seconds`; `web` splits its requests by the same ceilings (shared numbers in `packages/contracts` `AI_USAGE_SERVICE_LIMITS`, checked against the Odoo constants by a test), keeps the rows of a 429 and of a 401/403 and retries them after the back-off Odoo asked for, and drops a row only when Odoo names that row itself as invalid (a count above the per-row ceiling, a `called_at` older than the window) or already held under another company, or refuses its user or company as a whole; each drop is logged by count, and the other rows of the request are sent again at once. A row is never refused for age after an outage: the web spool gives a row up after one hour, the server window is 24 hours. The row ceiling is the recorder's across every company of the tenant. The worst a leaked key can still do is fill the ledger with rows inside those bounds, at most 600 a minute, for any internal user of the tenant. If you suspect a leaked or abused key: (1) `deploy/provision.sh --rotate-ai-usage-key <domain> <db>` revokes it at once and restarts `web` with a new one; (2) find the rows: they were created by the user `liwan_ai_usage` (`create_uid`) after the suspected time; (3) there is NO route or capability to void usage rows yet. Removing them today is an operator database intervention (delete from `liwan_ai_usage` where `create_uid` is the recorder and `create_date` is in the suspect window, after a backup, in a maintenance window), because the monthly counter sums the ledger. A voiding path (a capability plus an audited route that archives rows) is a follow-up of #557 and is not built. Until the shared registry delivers a per-tenant recorder key (tracked in #557), the older cookie route `POST /api/v1/ai/usage` stays for shared SaaS deployments and for any run reported without the key; remove it, and the cookie spool in `apps/web/server/utils/ai/usage.ts`, in the change that delivers that key. The browser's `Authorization` header is dropped by the dedicated proxy on every path (`legacyTenantResponse`), by `tenantTransport` (which sends only an explicit option) and by the shared guard (which passes only the server's header on the one POST target).

`AI_DEV_INSECURE=true` removes the service token requirement, so it is for development only. The service accepts it only together with `AI_ALLOW_MEMORY_STATE=true` and no `AI_DATABASE_URL`, and it must stay unset in any deployment.

Do not rotate `AI_SERVICE_TOKEN` or `AI_DB_PASSWORD` casually. The token is one shared secret: rotating it means restarting `web` and `ai` together, otherwise the old token still held by `web` is rejected and `/ai` fails until both run the same value. The password belongs to the `liwan_ai` role on a fresh `db_data` volume and to `AI_DATABASE_URL`, so rotating it needs the role, the URL and the `ai` service updated together. Re-running `deploy/provision.sh` never rotates either one.

Tenant provider keys: a tenant administrator may run the AI on the tenant's own provider key (AI settings page). The key is stored only in that tenant's `liwan_ai.ai_tenant_config`, encrypted inside PostgreSQL with `pgcrypto` (AES-256), which `deploy/ai/tenant_schema.sql` installs in schema `liwan_ai`. The secret is `AI_KEY_ENCRYPTION_KEYS` (`id:secret` pairs) with `AI_KEY_ENCRYPTION_KEY_ID` naming the one new keys use; `ensure_secrets.sh` generates `k1` once and never rotates it. Every ciphertext records its key id. To rotate: add a new pair (`k1:<old>,k2:<new>`), set `AI_KEY_ENCRYPTION_KEY_ID=k2`, restart `ai`, then run `docker compose exec ai python -m liwan_ai_service.tenant_config --rotate` (it prints counts only and exits 1 if a tenant failed). Keep the old pair while any backup taken before the rotation may still be restored: restoring a tenant needs every key id its ciphertext names. Without the keyring the tenant-key mode answers `ai_key_unavailable` and the platform provider keeps working.

Knowledge retrieval (AI phase 5): the assistant can search company records through a vector index kept in each tenant's `liwan_ai` schema. It needs three things. First, the `db` image must be `pgvector/pgvector:pg16` (pinned by digest in `deploy/docker-compose.yml`); on an existing deployment, replace the image and restart `db`, the data volume is unchanged because the image is the official `postgres:16` plus one extension. Second, the `vector` extension must exist in each tenant database. The `liwan_ai` role is not a superuser and the extension is not marked trusted, so the extension is created by the privileged tenant step (`deploy/ai/tenant_schema.sql`, run as the `odoo` superuser by `provision.sh`), not by the service. Third, the embedding provider, set in `deploy/.env`: `AI_EMBEDDING_PROVIDER` (`openai` for any OpenAI-compatible endpoint, or `ollama`), `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_BASE_URL` (optional) and `AI_EMBEDDING_API_KEY` (optional for `ollama`). With `AI_EMBEDDING_PROVIDER` unset, knowledge is off and the search tool answers `knowledge_unavailable`; nothing else changes. The embedding host also leaves through `ai-egress`, so add it to `AI_EGRESS_HOSTS` when it differs from the chat provider host. After upgrading to this release, run `--initialize-tenant <db>` again for each tenant (idempotent; it creates the queue and index tables). A tenant administrator then switches knowledge on in the AI settings page (section Knowledge). Changing `AI_EMBEDDING_MODEL` makes old vectors stale (a search compares only rows of the configured model): use the same page's "rebuild the index" action, which clears the cursors and re-queues every declared record.

Retention: each tenant keeps runs for its own `retention_days` (1 to 365, AI settings page). `AI_RUN_RETENTION_DAYS` is only the window a tenant starts with when its schema is bootstrapped; the scheduled cleanup deletes each tenant's runs past its own window.

Database isolation: the service connects as the dedicated role `liwan_ai`, which owns the `liwan_ai` control database and can connect to each tenant database with USAGE and CREATE on schema `liwan_ai` only. It is not the `odoo` superuser and holds no grant on any Odoo table or sequence, having lost its own schema-`public` privileges, so it can read no Odoo table; PostgreSQL still gives every role USAGE on schema `public` and EXECUTE on functions through `PUBLIC`, and Odoo grants nothing on its tables to `PUBLIC`. `deploy/ai/init-db.sh` (mounted into `/docker-entrypoint-initdb.d/20-liwan-ai.sh`) runs on a fresh `db_data` volume only and, when `AI_DB_PASSWORD` is non-empty, creates the role and database, revokes `CONNECT` on `liwan_ai` from `PUBLIC`, and revokes `CONNECT` on every other existing database from `PUBLIC` and from `liwan_ai`. Every tenant database is closed to `PUBLIC` by the shared isolation step above on every creation path: `deploy/provision.sh`, the operator `tenant.create`, shared provisioning and restore in `tools/shared_saas_lifecycle`, the release restore in `deploy/releases/backup.py` and the restore check in `deploy/restore_verify.py`. Each creates the database with the same recipe as Odoo (`tenant_create_database_sql`: `unicode`, `LC_COLLATE 'C'`, `template0`). `deploy/ai/tenant_schema.sql` then grants `CONNECT` selectively: when the `liwan_ai` role exists it grants `CONNECT` there, creates schema `liwan_ai`, and revokes `public` from the role; it does nothing when the role does not exist. A tenant database created by another route needs the isolation step first, then the same script once: `docker compose exec -T db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -v tenant_db="<tenant_db>" < ai/tenant_schema.sql`, then the tenant bootstrap below.

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

- Retention cleanup of old runs: `docker compose exec ai python -m liwan_ai_service.cleanup`, scheduled by the host cron; it visits every tenant database in the directory. The same sweep applies the offboarding events and deletes a leaver's conversations once the tenant's leaver retention (default 30 days) has passed.
- Memory and offboarding: employee and company notes live in `liwan_ai.ai_memory`. Odoo reports a user's deactivation and reactivation through `liwan_ai.ai_outbox`, the only table of the AI schema its database role may write (`INSERT`), granted by `--initialize-tenant`; the service drains it before every run, so a leaver's notes are gone before any later request. After upgrading the AI service, run `--initialize-tenant` again for every tenant: it is idempotent and adds the tables a newer release needs; until then the service refuses that tenant with `ai_state_incompatible`.
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

Opt-in candidate copy only. Produces `database.dump` (pg_dump `-Fc
--serializable-deferrable`), a `filestore/` copy, and `manifest.json` with
`consistency: "UNVERIFIED"` and `recovery_ready: false`, or fails without a
success manifest. `--serializable-deferrable` makes the dump one snapshot of
the database; the filestore is still copied separately and the result stays
`UNVERIFIED`.

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

Optional `--lock-dir DIR` moves the lock file directory (see "One backup per
database" below). Optional `--observe-http-port HOST:PORT` records TCP reachability. If that port
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

### What the manifest pins

The manifest records the bytes it copied, computed on the copy in the output
directory:

| Field | Meaning |
| --- | --- |
| `database_dump_sha256` | SHA-256 of `database.dump` |
| `filestore_sha256` | tree digest of `filestore/` |
| `filestore_file_count` | number of regular files under `filestore/` |

The tree digest is the SHA-256 of one `sha256sum` line per regular file,
`<file sha256>  <relative path>`, in sorted path order. It changes when a
file's bytes or name change, or a file is added or removed. Empty directories
and file metadata are not part of it. To reproduce it by hand, from inside the
filestore directory:

```sh
find . -type f | sed 's|^\./||' | LC_ALL=C sort | while read -r f; do echo "$(shasum -a 256 "$f" | cut -d' ' -f1)  $f"; done | shasum -a 256
```

A manifest without these three fields is not a backup manifest and is refused
by `restore_verify.py`.

The filestore must hold only regular files and directories. A symlink (to a
file, to a directory, or dangling), a special file (fifo, socket, device) or a
filestore path that is itself a symlink is refused before anything is copied:
a restore cannot reproduce it, and a link can point outside the copy. The copy
never carries links. `restore_verify.py` refuses the same entries in a backup
directory and refuses a symlinked `database.dump`.

### One backup per database

A run takes a non-blocking `flock` on `<db_name>.lock` and holds it until it
exits, on every path including failure. A second run for the same database,
whatever its output directory, is refused at once with `another backup of
database <db_name> is already running` and exit code 2. Runs for different
databases do not wait on each other. The lock is released if the process dies.

The lock file lives in `liwan-backup-locks/` under the system temporary
directory, created `0700`; it is refused unless the current user owns it. Two
users, or a service with a private `/tmp`, do not share that directory: give
every caller the same absolute `--lock-dir`.

A shared `--lock-dir` must be an existing directory on a local filesystem that
every caller can create files in (for example a group-writable directory with
the sticky bit). The lock file is created `0644`, whatever the umask, and is
opened read-only, because `flock` needs no write access; the file holds no
data. So the first caller creates it and every other user can lock it later,
whoever created it. Callers need read access to the file: if another user
left it unreadable, or replaced it with a symlink, a FIFO or any non-regular
file, the run stops with `cannot open the backup lock` or `is not a regular
file` instead of waiting. NFS is not supported for the lock directory, since
an exclusive `flock` on NFS needs a file opened for writing.

### Verifying the copy

`restore_verify.py` compares `database.dump` and `filestore/` with the
manifest before it can report `restore_verified: true`. A mismatch is listed
in `checks.backup_integrity_mismatches` (`database_dump_sha256`,
`filestore_sha256`, `filestore_file_count`), the file counts are in
`checks.filestore_files_expected` and `checks.filestore_files_actual`, and
`restore_verified` is `false`.

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
  --pg-restore "$PGBIN/pg_restore" --psql "$PGBIN/psql" \
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
  --pg-restore "$PGBIN/pg_restore" --psql "$PGBIN/psql" \
  --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"; echo exit=$?
```

After the drill, drop the three scratch databases created above and remove only
the temporary `$WORK` directory. Never reuse an existing database or filestore.

## Automated encrypted backups (owner decisions 2026-11-06)

The scheduled path is `deploy/backup_pipeline.py`; the manual `deploy/backup.py`
above stays the capture primitive it calls, and keeps its own `UNVERIFIED`
contract. The owner decided (2026-11-06): **RPO 1 hour, RTO 4 hours**, hourly
backups kept **7 days**, daily backups kept **30 days**, **encrypted before they
leave the server**, stored in an **S3-compatible bucket in Riyadh** (Oracle Object
Storage), and restore is performed by support on request.

| Concern | Where it lives |
| --- | --- |
| Schedule and retention | `deploy/backup_pipeline.py` (`capture`, `prune`, `status`) |
| Encryption | `deploy/backup_pipeline.py` (`encrypt_file`/`decrypt_file` through the `openssl` CLI) |
| Offsite transport | `deploy/s3_client.py` (SigV4; a real S3 store and a filesystem store) |
| Restore drill | `deploy/restore_drill.py` (restores the newest artifact into a scratch database) |
| Alerts | `deploy/alerts.py` (email and Telegram; five events) |

Every credential is an environment variable, never a repository file:

```sh
LIWAN_BACKUP_S3_ENDPOINT   # the Object Storage endpoint, for example the Riyadh namespace host
LIWAN_BACKUP_S3_REGION     # the Object Storage region
LIWAN_BACKUP_S3_BUCKET     # the backup bucket
LIWAN_BACKUP_S3_ACCESS_KEY # Customer Secret Key access key
LIWAN_BACKUP_S3_SECRET_KEY # Customer Secret Key secret
LIWAN_BACKUP_PASSPHRASE_FILE # mode 0600 or 0400; one strong line (for example 32 random bytes as hex)
LIWAN_TENANT_REGISTRY_PATH # absolute path to the trusted shared tenant registry snapshot
```

Run capture from this checkout with the repository's Node version on PATH. The CLI
uses the tenant's published registry binding to derive the database and filestore.
Suspension does not stop backups for a tenant that still has a binding. Point `--data-dir` and the PostgreSQL connection options at the same trusted
deployment; keep that scheduler configuration and the registry outside tenant control.
The CLI refuses a missing or pending registry, a missing tenant, and a linked filestore.
For example:

```sh
python3 -B deploy/backup_pipeline.py capture --tenant <tenant-id> --kind hourly \
  --work-root /path/to/private/capture-volume --data-dir /path/to/odoo-data \
  --pg-dump /path/to/pg_dump --pg-host <host> --pg-user <role>
```

The capture uses a private temporary directory for the dump and archive, then removes
it on exit. Size the staging disk for the copied database and filestore, the archive,
and its ciphertext at once. Ciphertext is uploaded in parts of up to 32 MiB (at most
10,000 parts). A keyed HMAC binds the tenant, backup kind, timestamp, digests and
lengths. The manifest carries this tag and is written last. Test multipart completion and its
no-overwrite condition against the selected provider before scheduling captures.

## Restore drill

`deploy/restore_drill.py` authenticates the newest manifest for one tenant before
downloading its artifact, then restores it
into a **new scratch database** through `deploy/restore_verify.py` (same checks: Liwan
modules installed, none stuck mid-transition, every referenced attachment present, and
the dump and filestore matching the digests in the artifact's own `manifest.json`),
measures the backup's age at drill start against the 1-hour RPO and the elapsed
restore time against the 4-hour RTO, and writes an atomic record. Both budgets must
pass for a verified result. The status command also requires a record that finished
in the last hour; it reports the backup's current age separately. Use a fresh private
scratch directory and an explicit PostgreSQL role with permission to create the
scratch database. The scratch database and restored files remain for inspection.

```sh
python3 -B deploy/restore_drill.py run --tenant <tenant-id> \
  --scratch-root /path/to/private/drill --target-db liwan_restore_scratch \
  --pg-host <scratch-host> --pg-user <scratch-role>
```

## Alerts (owner decisions 2026-11-06)

Alerts reach the owner by **email and Telegram** (never WhatsApp). `deploy/alerts.py`
emits exactly five events — failed backup, backup older than the RPO, disk above the
threshold, container unhealthy, restore drill failed — and nothing else. A channel
that fails to deliver is reported, never silently dropped, and one failing channel
does not stop the other. The bot token, chat id and SMTP credentials are environment
values the owner provides.

The operator procedure and the per-alert first action are in
[operations/saas-commercial-runbook.md](../docs/operations/saas-commercial-runbook.md) §5.

## Unresolved (do not invent answers)

| Topic | Status |
| --- | --- |
| Retention | Decided by the owner (hourly 7 days, daily 30 days) and enforced by `deploy/backup_pipeline.py prune`; not yet exercised against a real bucket. |
| Encryption at rest / in transit for backup files | Implemented as AES-256-CBC with PBKDF2 through the `openssl` CLI, with SHA-256 of plaintext and ciphertext pinned in the manifest. The manifest's HMAC authenticates its metadata and checksums before the drill reads the archive. The HMAC uses a separate key derived from the passphrase. |
| Offsite / object-storage replication | Implemented (`deploy/s3_client.py`); no real bucket has been written yet, so it is unproven live. |
| RPO | Decided: 1 hour. Proven by a drill only when the drill record exists. |
| RTO | Decided: 4 hours. Proven by a drill only when the drill record exists. |
| Compose volume export procedure | Not implemented; operator must present host paths. |
| Point-in-time PostgreSQL recovery | Not implemented (`pg_dump -Fc` only). The 1-hour RPO rests on hourly full dumps, not WAL archiving. |

## Verification of these files

Use mock tests only. Do not run a real dump, restore, or Odoo/E2E wrapper except
`--help`:

```sh
python3 -m unittest discover -s deploy -p test_operations.py
ruff check deploy/check_isolated.py deploy/backup.py deploy/test_operations.py
python3 deploy/check_isolated.py --help
python3 deploy/backup.py --help
```

The production sizing, the backup pipeline, the restore drill, the alerts and the
image pins have their own offline suites:

```sh
PYTHONPATH=deploy python3 -m unittest deploy.test_odoo_sizing deploy.test_s3_client \
  deploy.test_backup_pipeline deploy.test_restore_drill deploy.test_alerts \
  deploy.test_image_pins deploy.staging.test_staging
```
