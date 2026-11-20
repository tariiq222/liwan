# Environments: staging and production

Staging and production run the same compose set. The env file is the only per-environment input.

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

`staging.env.example` and `production.env.example` declare the same variable names. Copy one to a root-only file
(mode 0600, outside the checkout) on the host and replace every `REPLACE_WITH_...` value there. Nothing in the
repository is a secret. `test_environments.py` renders both projects with both templates and fails when the
renderings differ anywhere except the variables marked "differs" below.

Two other env files stay separate, because the services read them directly: the control-plane env
(`control-plane/env.production.example`, path in `LIWAN_CONTROL_ENV_FILE`) and the vendor console env
(`LIWAN_VENDOR_ADMIN_ENV_FILE`). Both exist once per environment and carry that environment's own secrets.

## Rules

- Staging has no real customer data. It runs on its own Oracle server in Jeddah, apart from production. Use
  test-mode payment and SMS keys only.
- No code or compose file tests which environment it runs in. A difference between environments is a variable.
- The compose set carries hard memory ceilings (about 9 GB for
  Odoo and 10 GB for PostgreSQL, plus the small services and the control plane, 24 GB in total), sized for the
  production Arm server. They are ceilings, not reservations. Check free memory on the host before the first start.
- Both environments bind every address on ports 80 and 443; no proxy sits in front of the stack's own Caddy. The three
  `LIWAN_EDGE_*` variables stay required so a local acceptance stack can publish the same compose set on other ports.

## Variables

Where a value comes from: **owner** (typed once), **host** (generated on the host, never copied between
environments), **release** (written by the release path), **fixed** (the same in both).

| Variable | Meaning | Staging shape | Production shape | Source | Differs |
| --- | --- | --- | --- | --- | --- |
| `LIWAN_IMAGE_TAG` | Tag of the images the stack runs | the staging release tag | the release tag | release | no |
| `ODOO_COMMIT` | Pinned Odoo revision, from `deploy/odoo/ODOO_COMMIT` | same | same | release | no |
| `LIWAN_EDGE_BIND` | Address the edge publishes on, required | `0.0.0.0` | `0.0.0.0` | fixed | no |
| `LIWAN_EDGE_HTTP_PORT` | Published HTTP port, required | `80` | `80` | fixed | no |
| `LIWAN_EDGE_HTTPS_PORT` | Published HTTPS port, required | `443` | `443` | fixed | no |
| `DOMAIN` | Site-address list of the tenant edge: base domain and wildcard | `staging.<base>, *.staging.<base>` | `<base>, *.<base>` | owner | yes |
| `LIWAN_PROSPECT_HOST` | Public sign-up and marketing host | `app.staging.<base>` | `app.<base>` | owner | yes |
| `NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN` | Public origin of that host | `https://app.staging.<base>` | `https://app.<base>` | owner | yes |
| `LIWAN_RESTORE_DOMAIN` | Suffix of restore hosts, equal to the control plane's `domainSuffix` | `restore.staging.<base>` | `restore.<base>` | owner | yes |
| `LIWAN_RESTORE_ALLOW` | Operator allowlist (`remote_ip` syntax) for restore hosts; empty answers 404 | empty | empty | owner | no |
| `LIWAN_TIKTOK_RELAY_HOST` | TikTok relay host; empty disables it | empty | empty or the relay host | owner | no |
| `DB_NAME` | Name of the base database | a test name | the production name | owner | yes |
| `DB_PASSWORD` | PostgreSQL password | generated | generated | host | yes |
| `LIWAN_SHARED_PROXY_TOKEN` | Trust token between the edge tier and the guard | generated | generated | host | yes |
| `LIWAN_SESSION_KEYS` | Session signing keys, `kid:key` pairs | generated | generated | host | yes |
| `LIWAN_SESSION_ACTIVE_KID` | Key id used for new sessions | `k1` | `k1` | owner | no |
| `NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL` | HTTPS URL of the control plane API | staging control host | production control host | owner | yes |
| `CUSTOMER_COMMERCIAL_ISSUER` | Issuer name the web tier signs with, different from `CONTROL_INSTALLATION_ID` | `liwan-web` | `liwan-web` | fixed | no |
| `CUSTOMER_COMMERCIAL_SERVICE_KEY` | Web tier signing key, equal to the control-plane value | generated | generated | host | yes |
| `LIWAN_PUBLIC_SIGNUP` | Public sign-up switch | `false` until staging is proven | `false` until launch | owner | no |
| `LIWAN_SHARED_ODOO_CONFIG` | Absolute path of the read-only Odoo config | `/srv/liwan-staging/...` | `/srv/liwan/...` | host | yes |
| `LIWAN_MAINTENANCE_DIR` | Host directory mounted read-only into the proxy; the release command puts `active` there during an update | `/var/lib/liwan-release/maintenance` | same | fixed | no |
| `LIWAN_TENANT_REGISTRY_DIR` | Directory of the tenant registry | under the staging root | under the production root | host | yes |
| `LIWAN_COMMERCIAL_CONTROL_NETWORK` | External network joining web and the control API | prefixed `liwan_staging_` | `liwan_` | host | yes |
| `LIWAN_ADMIN_EDGE_NETWORK` | External network joining the edge and the vendor console | prefixed `liwan_staging_` | `liwan_` | host | yes |
| `LIWAN_CONTROL_UID`, `LIWAN_CONTROL_GID` | Numeric account of the host `liwan-worker` user | its ids | its ids | host | no |
| `LIWAN_CONTROL_CONFIG_DIR` | Control-plane config directory | under the staging root | under the production root | host | yes |
| `LIWAN_CONTROL_STATE_DIR` | Control-plane state directory | same | same | host | yes |
| `LIWAN_CONTROL_PRIVATE_DIR` | Directory with the database password, TLS key, certificate and CA files | same | same | host | yes |
| `LIWAN_CONTROL_ENV_FILE` | Path of the control-plane env file | same | same | host | yes |
| `LIWAN_VENDOR_ADMIN_ENV_FILE` | Path of the vendor console env file | same | same | host | yes |
| `LIWAN_SHARED_COMPOSE_FILE`, `LIWAN_SHARED_ENV_FILE` | Paths the shared worker uses for the rendered stack and this env file | same | same | host | yes |

Optional variables with safe defaults (AI, TikTok, OCI mail, concurrency pools) are not in the templates. Add one
to both files together, with the same name, when an environment needs it.
