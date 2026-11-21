# Environments: development, staging and production

Development, staging and production run the same compose set. The env file is the only per-environment input.

| Project | Files, in order |
| --- | --- |
| Shared stack | `deploy/docker-compose.yml`, `docker-compose.shared.yml`, `docker-compose.shared-commercial.yml`, `docker-compose.production.yml` |
| Control plane | `deploy/control-plane/compose.production.yml`, `compose.host-link.yml` |
| Shared worker | `deploy/control-plane/liwan-shared-worker.service`, which reads `shared-worker.env.example` (the same values as the control-plane env, see that file) |

Render without starting anything:

```sh
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.shared.yml \
  -f deploy/docker-compose.shared-commercial.yml -f deploy/docker-compose.production.yml \
  --env-file <env file> config --quiet
```

`development.env.example`, `staging.env.example` and `production.env.example` declare the same variable names. Copy one to a root-only file
(mode 0600, outside the checkout) on the host and replace every `REPLACE_WITH_...` value there. Nothing in the
repository is a secret. `test_environments.py` renders both projects with all three templates and fails when the
development or staging rendering differs from production anywhere except the variables marked "differs" below.

Two other env files stay separate, because the services read them directly: the control-plane env
(`control-plane/env.production.example`, path in `LIWAN_CONTROL_ENV_FILE`) and the vendor console env
(`LIWAN_VENDOR_ADMIN_ENV_FILE`). Both exist once per environment and carry that environment's own secrets.

## Rules

- Development and staging have no real customer data. Use test-mode payment and SMS keys only. Development runs on
  the Contabo x86 host and follows the head of Forgejo `main`. Staging runs on the Oracle Arm host `liwanos-staging`,
  apart from production, and follows the highest release tag (arm64 required, like production).
- No code or compose file tests which environment it runs in. A difference between environments is a variable.
- The compose set carries hard memory ceilings (about 9 GB for
  Odoo and 10 GB for PostgreSQL, plus the small services and the control plane, 24 GB in total), sized for the
  production Arm server. They are ceilings, not reservations. The Contabo host is shared with Forgejo, Openship, Sentry
  and the runners, so the development stack is held to about 8 GB there (plan D22); check free memory on the host before
  the first start and size the development Odoo and PostgreSQL limits to that. The staging host has 12 GB: its stack is
  capped at 6 GB and the build at 1.5 CPU / 5 GB (see the bring-up guide).
- Production binds every address on ports 80 and 443 and its own Caddy terminates TLS. Development and staging each sit
  behind an Openship edge on their own host: that edge owns 80 and 443, terminates TLS with a DNS-01 wildcard and forwards over HTTP to
  `127.0.0.1:18080`, where the stack's Caddy publishes on loopback only. Caddy believes the edge's `X-Forwarded-For`
  and nothing else (`LIWAN_TRUSTED_PROXIES`, the gateway of the pinned `edge` network), so every rate-limit zone still
  keys on the real client and a header the client sends cannot change it
  ([edge-rate-limit.md](../security/edge-rate-limit.md#shared-edge-behind-an-outer-edge)). The three `LIWAN_EDGE_*`
  variables stay required so a local acceptance stack can publish the same compose set on other ports.
- Whether production also moves behind an edge is decided with its bring-up. Until then its template trusts no proxy
  (an empty `LIWAN_TRUSTED_PROXIES` renders the reserved TEST-NET-1 address, which no peer has).
- Bring-up of all three environments: [environment-bringup.md](../../docs/operations/environment-bringup.md).

## Variables

Where a value comes from: **owner** (typed once), **host** (generated on the host, never copied between
environments), **release** (written by the release path), **fixed** (the same in both).

| Variable | Meaning | Development and staging shape | Production shape | Source | Differs |
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
| `LIWAN_RESTORE_DOMAIN` | Suffix of restore hosts, equal to the control plane's `domainSuffix` | `restore.<env>.<base>` | `restore.<base>` | owner | yes |
| `LIWAN_RESTORE_ALLOW` | Operator allowlist (`client_ip` syntax) for restore hosts; empty answers 404 | empty | empty | owner | no |
| `LIWAN_TIKTOK_RELAY_HOST` | TikTok relay host; empty disables it | empty | empty or the relay host | owner | no |
| `DB_NAME` | Name of the base database | a test name (`liwan_development`, `liwan_staging`) | the production name | owner | yes |
| `DB_PASSWORD` | PostgreSQL password | generated | generated | host | yes |
| `LIWAN_SHARED_PROXY_TOKEN` | Trust token between the edge tier and the guard | generated | generated | host | yes |
| `LIWAN_SESSION_KEYS` | Session signing keys, `kid:key` pairs | generated | generated | host | yes |
| `LIWAN_SESSION_ACTIVE_KID` | Key id used for new sessions | `k1` | `k1` | owner | no |
| `NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL` | HTTPS URL of the control plane API | that environment's control host | production control host | owner | yes |
| `CUSTOMER_COMMERCIAL_ISSUER` | Issuer name the web tier signs with, different from `CONTROL_INSTALLATION_ID` | `liwan-web` | `liwan-web` | fixed | no |
| `CUSTOMER_COMMERCIAL_SERVICE_KEY` | Web tier signing key, equal to the control-plane value | generated | generated | host | yes |
| `LIWAN_PUBLIC_SIGNUP` | Public sign-up switch | `false` until the environment is proven | `false` until launch | owner | no |
| `LIWAN_SHARED_ODOO_CONFIG` | Absolute path of the read-only Odoo config | `/srv/liwan-<name>/...` | `/srv/liwan/...` | host | yes |
| `LIWAN_MAINTENANCE_DIR` | Host directory mounted read-only into the proxy; the release command puts `active` there during an update | `/var/lib/liwan-release/maintenance` | same | fixed | no |
| `LIWAN_TENANT_REGISTRY_DIR` | Directory of the tenant registry | under that environment's root | under the production root | host | yes |
| `LIWAN_COMMERCIAL_CONTROL_NETWORK` | External network joining web and the control API | prefixed `liwan_<name>_` | `liwan_` | host | yes |
| `LIWAN_ADMIN_EDGE_NETWORK` | External network joining the edge and the vendor console | prefixed `liwan_<name>_` | `liwan_` | host | yes |
| `LIWAN_CONTROL_UID`, `LIWAN_CONTROL_GID` | Numeric account of the host `liwan-worker` user | its ids | its ids | host | no |
| `LIWAN_CONTROL_CONFIG_DIR` | Control-plane config directory | under that environment's root | under the production root | host | yes |
| `LIWAN_CONTROL_STATE_DIR` | Control-plane state directory | same | same | host | yes |
| `LIWAN_CONTROL_PRIVATE_DIR` | Directory with the database password, TLS key, certificate and CA files | same | same | host | yes |
| `LIWAN_CONTROL_ENV_FILE` | Path of the control-plane env file | same | same | host | yes |
| `LIWAN_VENDOR_ADMIN_ENV_FILE` | Path of the vendor console env file | same | same | host | yes |
| `LIWAN_SHARED_COMPOSE_FILE`, `LIWAN_SHARED_ENV_FILE` | Paths the shared worker uses for the rendered stack and this env file | same | same | host | yes |

In hostnames `<env>` is `dev` for development and `staging` for staging; in paths, networks and database names `<name>` is `development` or `staging`.

Optional variables with safe defaults (AI, TikTok, OCI mail, concurrency pools) are not in the templates. Add one
to both files together, with the same name, when an environment needs it.
