# Control plane deployment

The control plane is where sign-up, billing, renewals, customer notices, owner alerts and tenant suspension run. This runbook defines how it and the vendor console run in production. Files: `deploy/control-plane/compose.production.yml`, `compose.host-link.yml`, `Dockerfile`, `env.production.example`, `shared-worker.env.example`, `Caddyfile.snippet`, `liwan-shared-worker.service`, and `deploy/vendor-admin/{env.example,Caddyfile.snippet}`.

Status: the definition is written and checked statically (`python3 -B -m unittest deploy/control-plane/test_production_compose.py`, and `docker compose config` renders it). It has not been started on any host. No image is published, no certificate exists, and the items under "What the owner must provide" are open. Nothing here is deployment authorization.

## Processes

| Process | Entry point | Runs as | Instances |
| --- | --- | --- | --- |
| API | `src/main.ts` (migrates, then listens) | Compose `control-api` | One. Rate limits for invitations are in memory per instance. |
| Ordinary worker | `src/worker-main.ts` | Compose `control-worker`, profile `operator-jobs` | Off by default. With `LIWAN_TENANCY_MODE=shared` it claims nothing (`claimNext` returns null) and only expires leases; it matters in dedicated mode only. At most one. |
| Shared worker | `src/shared-worker-main.ts` via `run-shared-worker.sh` | systemd `liwan-shared-worker.service` on the host | **Exactly one.** It owns the commercial scheduler (billing, trial, cancellation and delay notices, invitation issue and re-issue, vendor alerts, free-base locks, renewals, dunning, refunds), the tenant status push to Odoo, the shared job runner and the internal effect listener. Nothing takes a lock, so a second copy would run every job twice. |
| Migrate | `src/migrate.ts` | Compose `control-migrate`, profile `migrate` | One-shot. |
| Admin CLI | `src/admin.ts` | Compose `control-admin`, profile `admin` | One-shot. |
| Vendor console | `apps/vendor-admin` (Nuxt server, port 3100) | Compose `vendor-console` | One. |

Why the shared worker stays a systemd unit: it runs `tools/shared_saas_lifecycle` effects through a Docker client and reads and writes the shared stack's host files. A container for it would need the Docker socket, which no container in this design gets. The unit was already the chosen mechanism (`saas-commercial-runbook.md`, "Running the shared worker"); the compose file does not duplicate it, and a test fails if it does.

## Topology

```
Internet
  |  443
[edge: Caddy from the shared stack]
  |-- admin.<domain>   --admin_edge-->      [vendor-console :3100] --control_api_admin--> [control-api :4187 TLS]
  |-- control.<domain> POST /v1/commercial/payment-events/moyasar ONLY
  |                    --control_api_web-->  [control-api :4187 TLS]   (everything else on this host: 404)
[web tier (shared stack)] --control_api_web--> [control-api :4187 TLS]  (signed customer BFF, sign-up, invitations)

[control-api] --control_data(internal)--> [control-db :5432]   (no published port)
[control-api] --control_egress--> SMTP, Moyasar, Authentica, Turnstile, Telegram
[control-api] --control_egress gateway 172.29.40.1:4188 TLS--> [shared worker on the host] (admin password effect)

Host (systemd): [shared worker] --127.0.0.1:15432 (compose.host-link.yml)--> [control-db]
                                --Docker socket, /etc/liwan, state dir--> shared stack, Odoo
```

All networks except `control_egress` are `internal: true`. Only the API has a route off the host. The console cannot reach the database or the web tier's network.

## Reaching the control plane

- Web tier: `NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL=https://control-api:4187`, signing with `CUSTOMER_COMMERCIAL_SERVICE_KEY` and issuer `CUSTOMER_COMMERCIAL_ISSUER`. HTTPS is required outside loopback, so the web container must trust the control CA (`NODE_EXTRA_CA_CERTS`). The existing overlay `deploy/docker-compose.shared-commercial.yml` joins `web` to `LIWAN_COMMERCIAL_CONTROL_NETWORK`, which `compose.production.yml` creates under the same name.
- Vendor console: `NUXT_CONTROL_URL=https://control-api:4187`, signing with `NUXT_SERVICE_KEY` (= `CONTROL_SERVICE_KEY`) and `NUXT_INSTALLATION_ID` (= `CONTROL_INSTALLATION_ID`). `ADMIN_ORIGIN` and `NUXT_ADMIN_ORIGIN` are the same origin.
- Payment provider: Moyasar posts to `https://<CONTROL_WEBHOOK_DOMAIN>/v1/commercial/payment-events/moyasar`. The edge forwards that one method and path (`deploy/control-plane/Caddyfile.snippet`); the adapter checks the secret token and the account, then re-reads the payment from Moyasar.
- Certificate: the API certificate is issued by an operator-private CA and its SAN must contain `control-api` (and, for the effect channel, `control-host.internal`).

## Files the API shares with the shared worker

`shared-runtime.json` names absolute host paths (`composeFile`, `envFile`, `stateDir`). The API loads it and must see the same paths, so `compose.production.yml` mounts them at identical paths: the config directory read-only, the state directory and the registry directory read-write (the API publishes registry mutations and restore routes). The compose file and env file of the shared stack are only checked for existence by the API, so an empty placeholder is mounted at those two paths; the shared stack's real env file, which holds its secrets, never enters the API container. The API and the host worker run under the same uid and gid (`LIWAN_CONTROL_UID`, `LIWAN_CONTROL_GID`, the `liwan-worker` account) so both can write those directories.

## First deployment

1. Host preparation: the `liwan-worker` account in the `docker` group; directories `LIWAN_CONTROL_CONFIG_DIR`, `LIWAN_CONTROL_STATE_DIR`, `LIWAN_TENANT_REGISTRY_DIR` owned by it; `shared-runtime.json` and `inventory-v2.json` in the config directory. A secrets directory (`LIWAN_CONTROL_PRIVATE_DIR`, mode 0750, group `liwan-worker`) with `control-db-password`, `control-tls.key`, `control-tls.crt`, `control-ca.pem`.
2. Fill the private env files from the templates: `LIWAN_CONTROL_ENV_FILE` (`env.production.example`), `LIWAN_VENDOR_ADMIN_ENV_FILE` (`deploy/vendor-admin/env.example`), `/etc/liwan/shared-worker.env` (`shared-worker.env.example`). Generate each key with `openssl rand -hex 32`; the keys are distinct. Set the compose variables (`LIWAN_IMAGE_TAG`, the three `LIWAN_CONTROL_*` directories, `LIWAN_SHARED_COMPOSE_FILE`, `LIWAN_SHARED_ENV_FILE`, `LIWAN_COMMERCIAL_CONTROL_NETWORK`, `LIWAN_ADMIN_EDGE_NETWORK`) in a compose env file.
3. Render: `docker compose -f deploy/control-plane/compose.production.yml -f deploy/control-plane/compose.host-link.yml --env-file <compose env> config`.
4. Database: `... up -d control-db`, wait for healthy.
5. Migrate: `... --profile migrate run --rm control-migrate`. It must exit 0.
6. Bootstrap the owner: `... --profile admin run --rm control-admin bootstrap-owner <email> "<name>" "<reason>"`. It prints a one-time enrollment link; hand it over directly, never through chat. Then `catalog-import <version> "<reason>"` and validate and publish the catalog in the console.
7. Start the API: `... up -d control-api`. Check health (below).
8. Start the shared worker: install and enable the unit (`liwan-shared-worker.service` header), after the API so the internal effect certificate exists. Watch for `commercial_scheduler_tick` in `journalctl -u liwan-shared-worker`.
9. Start the console: `... up -d vendor-console`.
10. Edge: add `deploy/vendor-admin/Caddyfile.snippet` and `deploy/control-plane/Caddyfile.snippet` to the shared edge, join the edge to `LIWAN_COMMERCIAL_CONTROL_NETWORK` and `LIWAN_ADMIN_EDGE_NETWORK`, mount `control-ca.pem` at `/etc/liwan/control-ca.pem`, set `ADMIN_DOMAIN` and `CONTROL_WEBHOOK_DOMAIN`, and reload.
11. Register the webhook URL and secret token in Moyasar (test mode first).

## Fail-closed behaviour and checks after deploy

| Missing or wrong | What happens | Check |
| --- | --- | --- |
| Any required value of group 1 (`CONTROL_DATABASE_URL`, `CONTROL_INSTALLATION_ID`, `CONTROL_SERVICE_KEY` of 32 bytes or more, the three `LIWAN_CLI_*`/`LIWAN_REPOSITORY_ROOT` paths) | the process exits at start | container exit code and logs |
| `CONTROL_HOST` not loopback without TLS key and certificate | refuses to start | start-up log |
| `ADMIN_SECRET_KEY` unset | nobody can sign in to the console | console sign-in page answers; `bootstrap-owner` fails with "ADMIN_SECRET_KEY ... required" |
| `ADMIN_SECRET_KEY` equal to a service key, or `ADMIN_ORIGIN` not the https origin of `ADMIN_RP_ID` | refuses to start | start-up log |
| `ADMIN_DEV_LOGIN_EMAIL` with `NODE_ENV=production` | refuses to start | never set it |
| `CUSTOMER_COMMERCIAL_SERVICE_KEY` equal to `CONTROL_SERVICE_KEY` or shorter than 32 bytes | refuses to start | start-up log |
| `INTERNAL_EFFECT_KEY` unset | every invitation acceptance answers 503 | accept a test invitation |
| Public sign-up values (plan revision, Authentica key and template, legal URL and version, both Turnstile values, mail) incomplete | sign-up stays off; the log says "public signup configuration invalid" | `POST /api/commercial/signup/...` from the web tier |
| `LIWAN_PAYMENT_PROVIDER=simulator` in production, a missing Moyasar value, or a webhook secret under 32 bytes | the payment adapter is unavailable and payment routes fail closed; the rest of the API runs | start-up log "commercial payment adapter unavailable" |
| Mail adapter incomplete | the scheduler keeps the jobs that need no mail; notices and invitations do not go out | start-up log "commercial mail adapter unavailable" |
| Neither alert channel configured | alert rows complete as `skipped: no_channel_configured`; later configuration does not replay them | send a test event, see the Telegram message |
| Shared runtime config or registry path missing, or `LIWAN_TENANCY_MODE` not `shared` | the shared worker exits with `shared_adapter_unavailable`; the API reports shared onboarding disabled | `GET /v1/context` shows `shared_onboarding_enabled` |
| A second shared worker | not detected; jobs run twice | `systemctl` shows one unit; no container runs `shared-worker-main` |

Health checks:

- Database: `docker compose ... ps` shows `control-db` healthy.
- API: `docker compose ... ps` shows `control-api` healthy (the probe calls `GET /healthz`, which includes `SELECT 1`). From the web tier network, `GET https://control-api:4187/healthz` returns 200.
- Migrate: exits 0; running it again is a no-op.
- Shared worker: `systemctl status liwan-shared-worker`; `journalctl -u liwan-shared-worker | grep commercial_scheduler_tick` shows ticks.
- Console: `vendor-console` healthy; the admin host serves the sign-in page; sign in with the enrollment link.
- Webhook: from outside, `POST` to another path of the control host answers 404; `GET` of the event path answers 404; a Moyasar test event reaches the log as an accepted or a named rejection (`signature_invalid`, `merchant_mismatch`, `mode_mismatch`).
- Mail and alerts: no dry-run command exists. Use test recipients on a test customer, and one Telegram test event. Authentica SMS and Turnstile are exercised by one test sign-up on an authorized deployment.
- Backup: `deploy/control-plane/backup-control-plane.sh check` (see `control-plane-backup-restore.md`).

## Upgrade

1. Take a fresh control database backup (`backup-control-plane.sh daily`), and confirm it is complete.
2. Build and tag the new images; set `LIWAN_IMAGE_TAG`.
3. Migrate first: `... --profile migrate run --rm control-migrate`. Migrations are additive and advisory-locked; the old API keeps working against the new schema between steps 3 and 5.
4. Stop the scheduler cleanly: `systemctl stop liwan-shared-worker`. It stops claiming work, finishes the mail in flight and exits (`TimeoutStopSec=300`). Do not kill it. If it does not exit, wait; a repeated stop is harmless.
5. Update the code the unit runs (`/opt/liwan/current`), then recreate the API: `... up -d control-api` (30 seconds to drain), then `up -d vendor-console`.
6. Start the scheduler again: `systemctl start liwan-shared-worker`. Only one scheduler runs at any time, and during steps 4 and 5 none does: renewals, notices and refunds wait and then run, nothing is lost.
7. If the ordinary worker is in use (dedicated mode only), stop it first with `docker compose stop control-worker`; it finishes the running operation (grace up to 2 hours) and never aborts one.

## Rollback

- Images: set the previous `LIWAN_IMAGE_TAG`, recreate API and console, restart the unit on the previous code. Migrations are not reversed; the previous release must run against the newer schema, so a release with a breaking migration needs the database restore below instead.
- Database: restore the pre-upgrade backup with `deploy/control-plane/restore_control_plane.py` and follow the reconciliation in `control-plane-backup-restore.md`.
- Never run `docker compose down -v`: it deletes `control_db_data`.

## While the control plane is down

| Component down | Tenants see | Vendor sees |
| --- | --- | --- |
| API | Existing workspaces keep working (R5: the product runs without the control plane). The subscription page, upgrade, payment start, public sign-up and invitation acceptance answer an error. | The console answers 503. Moyasar retries the webhook; payments are re-read once the API is back. |
| Shared worker | Workspaces work. Suspensions, renewals, notices and refunds are not applied and no mail or alert goes out, until it returns; then they run in order. Registry changes made by the API are not pushed to Odoo. | Console works; scheduler lag is visible by the missing `commercial_scheduler_tick`. |
| Database | Same as the API, and the worker retries on transient errors. | Console 503. Restore from backup if the volume is lost (RPO one hour, RTO four hours, owner decision 2026-11-06). |
| Console only | No effect. | No console; the API, billing and alerts continue, and Telegram and email alerts still arrive. |

Tenant registry recovery without the control plane is in `deploy/shared/README.md` (`registry-recover.mjs`).

## What this change could not do

These live in files outside this change's ownership and are listed with the exact edit each needs.

1. `deploy/ci/image.sh`: add `"control-plane:deploy/control-plane/Dockerfile:."` to `OTHER_IMAGES`, and a smoke line after `smoke_started vendor-admin`: `PROBE=(node -e "process.exit(0)")` is not enough, use `docker run --rm --entrypoint node liwan-control-plane:<tag> --import tsx -e "await import('/app/apps/control-plane/src/config.ts')"` to prove the image loads its code. Without it the image is never built in CI.
2. `deploy/docker-compose.shared.yml` (or a new overlay owned by the shared stack): join `proxy` to the networks `${LIWAN_COMMERCIAL_CONTROL_NETWORK}` and `${LIWAN_ADMIN_EDGE_NETWORK}` (declared `external: true`), mount `control-ca.pem` into `proxy` at `/etc/liwan/control-ca.pem`, and pass `ADMIN_DOMAIN` and `CONTROL_WEBHOOK_DOMAIN`. Add the two snippets to `deploy/shared/Caddyfile` with `import`.
3. `deploy/docker-compose.shared-commercial.yml`: give `web` `NODE_EXTRA_CA_CERTS` pointing at the control CA so it trusts `https://control-api:4187`.
4. `deploy/production-images.json` and `deploy/image_pins.py`: they cover the customer stack only. Add entries for `liwan-control-plane` and `liwan-vendor-admin` (unpublished until the registry exists), and either list `deploy/control-plane/compose.production.yml` in `COMPOSE_FILES` or leave them out deliberately. The `postgres:16` digest in `compose.production.yml` is the one the local harness recorded; resolve and record it with `docker buildx imagetools inspect` first.
5. `deploy/OPERATIONS.md`: add a link to this runbook next to the control plane backup section.
6. `deploy/ci/static.sh` already runs `python3 -B -m unittest deploy/control-plane/test_*.py`, which picks up `test_production_compose.py`. No change needed.

## What the owner must provide

- Domains and DNS: the admin host (`ADMIN_DOMAIN`), the webhook host (`CONTROL_WEBHOOK_DOMAIN`), and TLS for both at the edge.
- A private CA and the control API certificate (SAN `control-api`) and the effect channel certificate (SAN `control-host.internal`).
- A container registry account, so the three images can be published and pinned by digest.
- Secrets from the operator's store: the database password, the four keys (`CONTROL_SERVICE_KEY`, `CUSTOMER_COMMERCIAL_SERVICE_KEY`, `ADMIN_SECRET_KEY`, `INTERNAL_EFFECT_KEY`), the Moyasar keys and webhook secret, the Authentica key and template, the Turnstile keys, SMTP credentials, the Telegram bot token and chat id.
- The published public monthly plan revision (`LIWAN_SIGNUP_PLAN_REVISION_ID`), the legal pages URL and the terms version.
- The decision to publish a loopback database port for the host-run shared worker (`compose.host-link.yml`), or to move the worker's database access another way.
