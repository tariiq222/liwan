# Environments: staging and production

Staging and production run the same compose set. The env file is the only per-environment input.

| Project | Files, in order |
| --- | --- |
| Shared stack | `deploy/docker-compose.yml`, `docker-compose.shared.yml`, `docker-compose.shared-commercial.yml`, `docker-compose.production.yml`, `docker-compose.host-link.yml` |
| Control plane | `deploy/control-plane/compose.production.yml`, `compose.host-link.yml` |
| Shared worker | `deploy/control-plane/liwan-shared-worker.service`, which reads `shared-worker.env.example` (the same values as the control-plane env, see that file). The worker has no docker access: it reaches the tenant effects through `liwan-effect.socket` and `liwan-effect@.service` in the same folder, which run as the `liwan-effect` account, the only `docker` member (see the bring-up guide, A3 and A6) |

Render without starting anything:

```sh
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.shared.yml \
  -f deploy/docker-compose.shared-commercial.yml -f deploy/docker-compose.production.yml \
  --env-file <env file> config --quiet
```

`staging.env.example` and `production.env.example` declare the same variable names. Copy one to a root-only file
(mode 0600, outside the checkout) on the host and replace every `REPLACE_WITH_...` value there. Nothing in the
repository is a secret. `test_environments.py` renders both projects with both templates and fails when the
staging rendering differs from production anywhere except the variables marked "differs" below.

Two other env files stay separate, because the services read them directly: the control-plane env
(`control-plane/env.production.example`, path in `LIWAN_CONTROL_ENV_FILE`) and the vendor console env
(`LIWAN_VENDOR_ADMIN_ENV_FILE`). Both exist once per environment and carry that environment's own secrets.

## Rules

- Staging has no real customer data. Use test-mode payment and SMS keys only. It runs on the Oracle Arm host
  `liwanos-staging`, apart from production, and follows the highest `release/19.0.X.Y.Z` tag. It waits for the arm64
  build that the release tag starts (arm64 required, like production). A release tag builds arm64 only; nothing follows
  `main`. Production applies only the tag its job command names (`release.py run --environment production --tag <tag>`);
  it never takes the highest tag by itself. An automatic proof that staging served that tag is not built yet.
- Each environment reads releases with its own read-only GitHub credentials (`LIWAN_GHCR_READ_USER`,
  `LIWAN_GHCR_READ_TOKEN`, optional `LIWAN_GITHUB_READ_TOKEN`; see `deploy/release/README.md`). Production holds its own
  read token, different from staging, so a leak on one host never reaches the other.
- No code or compose file tests which environment it runs in. A difference between environments is a variable.
- The compose set carries hard memory ceilings (about 9 GB for
  Odoo and 10 GB for PostgreSQL, plus the small services and the control plane, 24 GB in total), sized for the
  production Arm server. They are ceilings, not reservations. The staging host has 12 GB and also hosts the Openship
  panel and its edge; nothing caps the stack below the compose ceilings and nothing on the host builds images (row A3.5 of
  [environment-bringup.md](../../docs/operations/environment-bringup.md)).
- Production binds every address on ports 80 and 443 and its own Caddy terminates TLS. Staging sits
  behind the Openship edge on its own host: that edge owns 80 and 443, terminates TLS with a DNS-01 wildcard and forwards over HTTP to
  `127.0.0.1:18080`, where the stack's Caddy publishes on loopback only. Caddy believes the edge's `X-Forwarded-For`
  and nothing else (`LIWAN_TRUSTED_PROXIES`, the gateway of the pinned `edge` network), so every rate-limit zone still
  keys on the real client and a header the client sends cannot change it
  ([edge-rate-limit.md](../security/edge-rate-limit.md#shared-edge-behind-an-outer-edge)). The three `LIWAN_EDGE_*`
  variables stay required so a local acceptance stack can publish the same compose set on other ports.
- Whether production also moves behind an edge is decided with its bring-up. Until then its template trusts no proxy
  (an empty `LIWAN_TRUSTED_PROXIES` renders the reserved TEST-NET-1 address, which no peer has).
- The owner cancelled the development server environment on 2026-11-21 (see
  [integration-rules.md](../../docs/agents/integration-rules.md)); staging and production are the only server environments.
  Bring-up: [environment-bringup.md](../../docs/operations/environment-bringup.md).

## Variables

Where a value comes from: **owner** (typed once), **host** (generated on the host, never copied between
environments), **release** (written by the release path), **fixed** (the same in both).

| Variable | Meaning | Staging shape | Production shape | Source | Differs |
| --- | --- | --- | --- | --- | --- |
| `LIWAN_IMAGE_TAG` | Tag of the images the stack runs | the release tag served by that environment | the release tag | release | no |
| `ODOO_COMMIT` | Pinned Odoo revision, from `deploy/odoo/ODOO_COMMIT` | same | same | release | no |
| `LIWAN_EDGE_BIND` | Address the stack's Caddy publishes on, required | `127.0.0.1` | `0.0.0.0` | fixed | yes |
| `LIWAN_EDGE_HTTP_PORT` | Published HTTP port, required | `18080` | `80` | fixed | yes |
| `LIWAN_EDGE_HTTPS_PORT` | Published HTTPS port, required | `18443` (loopback; nothing listens behind it) | `443` | fixed | yes |
| `LIWAN_EDGE_SUBNET` | Subnet of the pinned `edge` network. Docker gives its gateway the first address, which `LIWAN_TRUSTED_PROXIES` must name as a `/32`. A second stack from this compose file on the same Docker host needs a different value, or the pools overlap and the network fails to create | `172.29.50.0/24` | `172.29.50.0/24` | fixed | no |
| `LIWAN_TRUSTED_PROXIES` | Outer edge Caddy trusts for `X-Forwarded-For`, as the `edge` network gateway; empty trusts nothing | `172.29.50.1/32` | empty | fixed | yes |
| `LIWAN_SITE_SCHEME` | Scheme prefix of the restore and relay site addresses (`DOMAIN` carries its own); `http://` puts them on :80 with the tenant sites | `http://` | empty (TLS, :443) | fixed | yes |
| `LIWAN_AUTO_HTTPS` | Caddy `auto_https` mode; `off` when an outer edge terminates TLS | `off` | `ignore_loaded_certs` (no change) | fixed | yes |
| `DOMAIN` | Site-address list of the tenant edge: base domain and wildcard (`http://` when an outer edge terminates TLS) | `http://<env>.<base>, http://*.<env>.<base>` | `<base>, *.<base>` | owner | yes |
| `LIWAN_PROSPECT_HOST` | Public sign-up and marketing host | `app.<env>.<base>` | `app.<base>` | owner | yes |
| `NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN` | Public origin of that host | `https://app.<env>.<base>` | `https://app.<base>` | owner | yes |
| `LIWAN_RESTORE_DOMAIN` | Base domain under which Caddy serves the restore sites `*.restore.<value>`; equal to the control plane's `domainSuffix`, so tenant hosts are `t<hex>.<value>` and restore hosts `r<hex>.restore.<value>` | `<env>.<base>` | `<base>` | owner | yes |
| `LIWAN_RESTORE_ALLOW` | Operator allowlist (`client_ip` syntax) for restore hosts; empty answers 404 | empty | empty | owner | no |
| `LIWAN_TIKTOK_RELAY_HOST` | TikTok relay host; empty disables it | empty | empty or the relay host | owner | no |
| `CONTROL_WEBHOOK_DOMAIN` | Host of the payment webhook site; the edge forwards only `POST /v1/commercial/payment-events/moyasar` there. Empty (or unset) means the reserved name `control-webhook.invalid`: nothing is exposed | empty until its DNS and edge route exist (staging and production only) | empty until its DNS and edge route exist | owner | no |
| `ADMIN_DOMAIN` | Host of the vendor console, served by the shared edge. Empty means the reserved name: nothing is exposed | empty until its DNS and edge route exist (staging and production only) | empty until its DNS and edge route exist | owner | no |
| `LIWAN_ADMIN_ALLOW` | Operator allowlist (`client_ip` syntax: CIDRs or bare addresses, space separated, never commas; one malformed entry stops Caddy from loading its whole configuration, so validate before recreating `proxy`, see `docs/operations/environment-bringup.md` D4) for the vendor console host, on top of the console's own sign-in; empty answers 404 to everyone. Change it and recreate `proxy` | empty | empty | owner | no |
| `DB_NAME` | Name of the base database | a test name (`liwan_staging`) | the production name | owner | yes |
| `DB_PASSWORD` | Password of the `odoo` runtime role (no superuser; Odoo, its release run and pgbouncer connect as it); the `db` init script creates the role from it on a fresh volume | generated | generated | host | yes |
| `DB_ADMIN_PASSWORD` | Password of the `postgres` admin role, the image bootstrap superuser used by release and lifecycle tooling only; it reaches the `db` and `restore-db` services and no other service | generated | generated | host | yes |
| `LIWAN_SHARED_PROXY_TOKEN` | Trust token between the edge tier and the guard | generated | generated | host | yes |
| `LIWAN_SESSION_KEYS` | Session signing keyring: a JSON object mapping key id to a secret of at least 32 bytes, in single quotes in the env file, e.g. `'{"k1":"<secret>"}'`; it must contain `LIWAN_SESSION_ACTIVE_KID` | generated | generated | host | yes |
| `LIWAN_SESSION_ACTIVE_KID` | Key id used for new sessions | `k1` | `k1` | owner | no |
| `NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL` | HTTPS URL of the control plane API; the certificate SAN is `control-api` and no `control.*` host exists ([control-plane-deployment.md](../../docs/operations/control-plane-deployment.md) "Reaching the control plane") | `https://control-api:4187` | `https://control-api:4187` | fixed | no |
| `CUSTOMER_COMMERCIAL_ISSUER` | Issuer name the web tier signs with, different from `CONTROL_INSTALLATION_ID` | `liwan-web` | `liwan-web` | fixed | no |
| `CUSTOMER_COMMERCIAL_SERVICE_KEY` | Web tier signing key, equal to the control-plane value | generated | generated | host | yes |
| `LIWAN_PUBLIC_SIGNUP` | Public sign-up switch | `false` until the environment is proven | `false` until launch | owner | no |
| `NUXT_AI_SERVICE_URL` | Address of the AI service as the web tier reaches it; empty hides `/ai` | `http://ai:8600` | `http://ai:8600` | fixed | no |
| `AI_EGRESS_HOSTS` | Hosts `ai-egress` allows besides the platform chat providers, whose hosts the ai service publishes itself: an internal endpoint (a self-hosted Ollama), the embedding host when `AI_EMBEDDING_PROVIDER` is set, the Sentry host when a DSN is set. Comma separated `host`, `.domain` or `host:port` | empty | empty | owner | no |
| `AI_SERVICE_TOKEN` | Shared token the web tier sends to the AI service (at least 24 characters); generated by `deploy/ai/ensure_secrets.sh` | generated | generated | host | yes |
| `AI_TOKEN_KEY` | Key the web tier alone uses to open AI tokens that carry phone numbers and emails; generated by `ensure_secrets.sh` | generated | generated | host | yes |
| `AI_DB_PASSWORD` | Password of the `liwan_ai` database role; must be set before the first start of `db`, which creates the role only on a fresh volume; generated by `ensure_secrets.sh` | generated | generated | host | yes |
| `AI_DATABASE_URL` | Control database URL of the AI service, `postgresql://liwan_ai:<AI_DB_PASSWORD>@db:5432/liwan_ai` | built from `AI_DB_PASSWORD` | built from `AI_DB_PASSWORD` | host | yes |
| `AI_KEY_ENCRYPTION_KEYS`, `AI_KEY_ENCRYPTION_KEY_ID` | comma-separated `id:secret` pairs (secret of at least the length the service checks) that encrypt tenant provider keys, and the id new keys use; `ensure_secrets.sh` writes `k1:<64 hex characters>` | generated, `k1` | generated, `k1` | host | yes (pairs) |
| `LIWAN_SHARED_ODOO_CONFIG` | Absolute path of the read-only Odoo config | `/srv/liwan-<name>/...` | `/srv/liwan/...` | host | yes |
| `LIWAN_MAINTENANCE_DIR` | Host directory mounted read-only into the proxy; the release command puts `active` there during an update | `/var/lib/liwan-release/maintenance` | same | fixed | no |
| `LIWAN_TENANT_REGISTRY_DIR` | Directory of the tenant registry | under that environment's root | under the production root | host | yes |
| `LIWAN_COMMERCIAL_CONTROL_NETWORK` | External network joining web and the control API | prefixed `liwan_<name>_` | `liwan_` | host | yes |
| `LIWAN_ADMIN_EDGE_NETWORK` | External network joining the edge and the vendor console | prefixed `liwan_<name>_` | `liwan_` | host | yes |
| `LIWAN_CONTROL_EDGE_NETWORK` | Internal network joining the edge and the control API, so the edge and the web tier do not share the control network | prefixed `liwan_<name>_` | `liwan_` | host | yes |
| `LIWAN_CONTROL_UID`, `LIWAN_CONTROL_GID` | Numeric account of the host `liwan-worker` user (`id -u liwan-worker`, `id -g liwan-worker`); the template holds a `REPLACE_WITH_WORKER_UID` placeholder | its ids | its ids | host | no |
| `LIWAN_CONTROL_CONFIG_DIR` | Control-plane config directory | under that environment's root | under the production root | host | yes |
| `LIWAN_CONTROL_STATE_DIR` | Control-plane state directory | same | same | host | yes |
| `LIWAN_CONTROL_PRIVATE_DIR` | Directory with the database password, TLS key, certificate and CA files | same | same | host | yes |
| `LIWAN_AI_PLATFORM_DIR` | Directory the control plane writes the AI platform provider file into and the `ai` service reads; `<LIWAN_CONTROL_STATE_DIR>/ai-platform`, created by `init-host.sh`. The control env file's `LIWAN_AI_PLATFORM_PROVIDER_PATH` is `<this>/platform-provider.json`. Unset, compose uses `./data/ai` in the per-commit checkout and the file is lost at the next release | under that environment's state directory | under the production state directory | host | yes |
| `LIWAN_CONTROL_ENV_FILE` | Path of the control-plane env file | same | same | host | yes |
| `LIWAN_VENDOR_ADMIN_ENV_FILE` | Path of the vendor console env file | same | same | host | yes |
| `LIWAN_DB_HOST_PORT` | Loopback port the tenant database publishes for the host `pg_dump` (`docker-compose.host-link.yml`); the release reads it from this file for the backup (the control database's `LIWAN_CONTROL_DB_HOST_PORT` is read the same way and defaults to `15432`) | `15433` | `15433` | fixed | no |
| `LIWAN_SHARED_COMPOSE_FILE`, `LIWAN_SHARED_ENV_FILE` | Paths the shared worker uses for the rendered stack and this env file | same | same | host | yes |

In hostnames `<env>` is `staging`; in paths, networks and database names `<name>` is `staging`.

Optional variables with safe defaults (AI provider and tuning, TikTok, OCI mail, concurrency pools) are not in the templates. Add one
to both files together, with the same name, when an environment needs it.
