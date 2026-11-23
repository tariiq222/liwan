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
  |-- <CONTROL_WEBHOOK_DOMAIN> POST /v1/commercial/payment-events/moyasar ONLY
  |                    --control_api_edge--> [control-api :4187 TLS]   (everything else on this host: 404)
[web tier (shared stack)] --control_api_web--> [control-api :4187 TLS]  (signed customer BFF, sign-up, invitations)

[control-api] --control_data(internal)--> [control-db :5432]   (no published port)
[control-api] --control_egress--> SMTP, Moyasar, Authentica, Turnstile, Telegram
[control-api] --control_egress gateway 172.29.40.1:4188 TLS--> [shared worker on the host] (admin password effect)

Host (systemd): [shared worker] --127.0.0.1:15432 (compose.host-link.yml)--> [control-db]
                                --Docker socket, /etc/liwan, state dir--> shared stack, Odoo
```

All networks except `control_egress` are `internal: true`. Only the API has a route off the host. The console cannot reach the database or the web tier's network.

## Reaching the control plane

- Web tier: `NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL=https://control-api:4187`, signing with `CUSTOMER_COMMERCIAL_SERVICE_KEY` and issuer `CUSTOMER_COMMERCIAL_ISSUER`. HTTPS is required outside loopback, so the web container must trust the control CA; the overlay mounts `control-ca.pem` at `/etc/liwan-control/control-ca.pem` (outside `/etc/liwan`, which holds the read-only registry mount) and sets `NODE_EXTRA_CA_CERTS`. The existing overlay `deploy/docker-compose.shared-commercial.yml` joins `web` to `LIWAN_COMMERCIAL_CONTROL_NETWORK`, which `compose.production.yml` creates under the same name.
- Vendor console: `NUXT_CONTROL_URL=https://control-api:4187`, signing with `NUXT_SERVICE_KEY` (= `CONTROL_SERVICE_KEY`) and `NUXT_INSTALLATION_ID` (= `CONTROL_INSTALLATION_ID`). `ADMIN_ORIGIN` and `NUXT_ADMIN_ORIGIN` are the same origin.
- Payment provider: Moyasar posts to `https://<CONTROL_WEBHOOK_DOMAIN>/v1/commercial/payment-events/moyasar`. The edge forwards that one method and path (`deploy/control-plane/Caddyfile.snippet`); the adapter checks the secret token and the account, then re-reads the payment from Moyasar.
- Certificate: the API certificate is issued by an operator-private CA and its SAN must contain `control-api` (and, for the effect channel, `control-host.internal`).

## Files the API shares with the shared worker

`shared-runtime.json` names absolute host paths (`composeFile`, `envFile`, `stateDir`). The API loads it and must see the same paths, so `compose.production.yml` mounts them at identical paths: the config directory read-only, the state directory and the registry directory read-write (the API publishes registry mutations and restore routes). The compose file and env file of the shared stack are only checked for existence by the API, so an empty placeholder is mounted at those two paths; the shared stack's real env file, which holds its secrets, never enters the API container. The API and the host worker run under the same uid and gid (`LIWAN_CONTROL_UID`, `LIWAN_CONTROL_GID`, the `liwan-worker` account) so both can write those directories. The registry directory must also be traversable by the reading containers (mode `0755`), because the guard, web, tiktok-relay and ai read `registry.json` as other users.

## First deployment

On a host run by `deploy/release/release.py` (staging, production), do steps 1 and 2 and install the unit before the first release; the release run then migrates the control database and starts `control-api` (steps 3 to 5 and 7, which stay as the manual form for a host without it) and starts the shared worker (step 8). Steps 6 and 9 to 11 come after the first run. The order for a whole environment is in [environment-bringup.md](environment-bringup.md) section A.

1. Host preparation: the `liwan-worker` account (not in the `docker` group) and the `liwan-effect` account (the only `docker` member), and `/opt/liwan/current` as a symlink to a clone under `/opt/liwan/releases/<commit>` (`deploy/release/README.md` "Bootstrap"). Then run `deploy/control-plane/init-host.sh <shared stack env file> <liwan-shared-NAME>` (optional `LIWAN_WORKER_USER`). It creates the three control directories and the registry directory (mode 0755, because the guard, web, ai and tiktok-relay containers read it as other users; an existing registry directory without read and search access for everyone is refused, not changed), `shared-runtime.json`, `inventory-v2.json`, and in `LIWAN_CONTROL_PRIVATE_DIR` the private CA, `control-tls.*`, `effect-tls.*`, `control-ca.pem` and `control-db-password`. It never overwrites; do not create these files by hand. `control-db-password` belongs to uid 999 (the postgres user) with mode 0400 when run as root. It stops when `LIWAN_CONTROL_UID` or `LIWAN_CONTROL_GID` is not the worker account's id, and warns on stderr when a kept certificate ends within 60 days. Renewal: delete both files of the pair (the leaf `control-tls.*` or `effect-tls.*`, or `control-ca.key` and `control-ca.pem` together with both leaf pairs), run the script again, then restart the reader (`control-api`, and `liwan-shared-worker` for the effect pair). After `control-ca.pem` is replaced, also recreate `web` and `proxy` (`up -d --force-recreate web proxy` with the overlay loaded): they read it through a single-file bind mount that stays on the old file, so a Caddy reload or a plain restart of the old container is not enough.
   `shared-runtime.json` names `composeFile` (`LIWAN_SHARED_COMPOSE_FILE`); the script does not create it. `release.py` renders the shared stack into it at every activation, and again for the restored release on a rollback, always before the worker starts. It holds the shared env file's secrets, so it takes that file's owner and mode (`640 root:docker`: the effect account reads both through the group, the worker cannot). The path is read from `LIWAN_SHARED_COMPOSE_FILE` in the shared env file, by `init-host.sh` and by `release.py` alike.
2. Fill the private env files from the templates: `LIWAN_CONTROL_ENV_FILE` (`env.production.example`), `LIWAN_VENDOR_ADMIN_ENV_FILE` (`deploy/vendor-admin/env.example`), `/etc/liwan/shared-worker.env` (`shared-worker.env.example`). Generate each key with `openssl rand -hex 32`; the keys are distinct. Set the compose variables (`LIWAN_IMAGE_TAG`, the three `LIWAN_CONTROL_*` directories, `LIWAN_SHARED_COMPOSE_FILE`, `LIWAN_SHARED_ENV_FILE`, `LIWAN_COMMERCIAL_CONTROL_NETWORK`, `LIWAN_CONTROL_EDGE_NETWORK`, `LIWAN_ADMIN_EDGE_NETWORK`) in a compose env file.
3. Render: `docker compose -f deploy/control-plane/compose.production.yml -f deploy/control-plane/compose.host-link.yml --env-file <compose env> config`.
4. Database: `... up -d control-db`, wait for healthy.
5. Migrate: `... --profile migrate run --rm control-migrate`. It must exit 0.
6. Bootstrap the owner: `... --profile admin run --rm control-admin bootstrap-owner <email> "<name>" "<reason>"`. It prints a one-time enrollment link; hand it over directly, never through chat. Then `catalog-import <version> "<reason>"` and validate and publish the catalog in the console.
7. Start the API: `... up -d control-api`. Check health (below).
8. Shared worker: install the unit (`liwan-shared-worker.service` header) before the first release and do not start it; the release `commit` step starts it. After the API is up (so the internal effect certificate is in use), check `systemctl is-active liwan-shared-worker` and watch for `commercial_scheduler_tick` in `journalctl -u liwan-shared-worker`.
9. Start the console: `... up -d vendor-console`.
10. Edge: with `deploy/docker-compose.shared-commercial.yml` loaded, the shared proxy joins `LIWAN_CONTROL_EDGE_NETWORK` (compose network `control_api_edge`, created by the control project: its own internal network to the control API, so the edge and the web tier share no network; the web tier stays on `LIWAN_COMMERCIAL_CONTROL_NETWORK`, compose network `control_api_web`), mounts `control-ca.pem` at `/etc/liwan-control/control-ca.pem` and serves the payment webhook from `deploy/control-plane/Caddyfile.snippet`, which `deploy/shared/Caddyfile` imports. Set `CONTROL_WEBHOOK_DOMAIN` in the shared stack env file, then recreate the proxy with `up -d` (it is a container environment variable, so a reload does not pick it up). Unset, the site answers 404 to every request, including one that an outer edge forwards with `Host: control-webhook.invalid`. The site forwards only a `POST` whose raw request URI is exactly `/v1/commercial/payment-events/moyasar`; a query string, an encoded, upper-case, merged or dotted spelling, or any other method or path answers 404 at the edge. If `control-ca.pem` is missing in `LIWAN_CONTROL_PRIVATE_DIR`, `compose up` stops with a bind-source error and creates nothing on the host. The vendor console is served by the same proxy on `ADMIN_DOMAIN` (`deploy/vendor-admin/Caddyfile.snippet`, over `LIWAN_ADMIN_EDGE_NETWORK`) and only to the client addresses in `LIWAN_ADMIN_ALLOW` (Caddy `client_ip` syntax, space separated); an empty or unset list answers 404 to everyone, and an unset `ADMIN_DOMAIN` leaves a reserved name that matches no real host. The admin site decides in this order: a Host other than `ADMIN_DOMAIN` answers 404, an address outside the allowlist answers 404, then the rate limits, then the console, which receives `X-Forwarded-For` set to the client address with the other forwarded and `X-Liwan-*` headers stripped. The release starts and stops `vendor-console` together with `control-api` and refuses in `prepare` with `invalid_shared_env` when `LIWAN_VENDOR_ADMIN_ENV_FILE` is unset, not absolute or not a regular file; `NUXT_ADMIN_ORIGIN` in that file must equal `https://<ADMIN_DOMAIN>`. The DNS, outer edge route and checks for both hosts are in [environment-bringup.md](environment-bringup.md) section D.

    Exposure decision (coordinating session, 2026-11-21, from the owner's standing rules, pending the owner's confirmation): the console is served at `admin.staging.liwanos.com` and `admin.liwan.sa` through the shared edge, behind the per-environment allowlist on top of the console's own sign-in, and closed while the allowlist is empty. This is a setting: widening or narrowing access later means changing the value of `LIWAN_ADMIN_ALLOW` and recreating `proxy`, not changing code.
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
- Service health: the Services section of the console overview shows every component as running, and `systemctl list-timers liwan-service-health-alert.timer` lists the host alert timer (see Service health below).
- Console: `vendor-console` healthy; the admin host serves the sign-in page; sign in with the enrollment link.
- Webhook: from outside, `POST` to another path of the control host answers 404; `GET` of the event path answers 404; a Moyasar test event reaches the log as an accepted or a named rejection (`signature_invalid`, `merchant_mismatch`, `mode_mismatch`).
- Mail and alerts: no dry-run command exists. Use test recipients on a test customer, and one Telegram test event. Authentica SMS and Turnstile are exercised by one test sign-up on an authorized deployment.
- Backup: `deploy/control-plane/backup-control-plane.sh check` (see `control-plane-backup-restore.md`).

## Service health

The vendor console overview has a Services section, and a service that stops raises an attention item and a host alert. The design is `docs/superpowers/specs/2026-11-22-service-health-console-design.md`. It is read only: nothing in it starts, stops or restarts anything.

What reports, into the table `service_heartbeats` (one row per component, updated in place, no history):

| Component | Written by | When | Detail |
| --- | --- | --- | --- |
| `shared_worker` | a timer of the shared worker, independent of its job loop | at start, then every 30 s | none |
| `commercial_scheduler` | the start of the scheduler tick and between its jobs (and the end, when the failed job names changed) | at most every 30 s | tick count, last billing pass, names of the jobs that failed in the last tick |
| `payment_adapter`, `mail_adapter`, `alert_channel` | the shared worker at start-up | once per start | `available`, and the error code (never its message) when not |
| `api_payment_adapter` | the control API at start-up | once per start | the same |

A heartbeat that cannot be written is logged and never stops a tick or the worker. The worker's timer does not keep the process alive and ends on SIGTERM; a worker that is stopping writes no beat. An alert channel that is not configured at all is a choice and reports nothing.

Thresholds live in one place, the SQL function `service_health_states(at)` created by the migration: `shared_worker` is stale after 2 minutes without a beat; `commercial_scheduler` after 5 minutes without a tick, or after 2 hours while a `shared_jobs` row is `running` with an unexpired `lease_until` (the tick does not run then, the same grace as a running operation; a row left `running` by a worker that stopped renewing its lease gives no grace). The scheduler beats between its jobs, so a long tick is not mistaken for a stopped scheduler; only one job that itself runs longer than 5 minutes is; adapters are `ok` or `unavailable` as recorded and never stale. Every beat is stamped, and every read judged, with the control database's own clock (`now()`), so a host whose clock is fast or slow cannot make a dead service look alive or a healthy one stale, and the console and the host alert agree. A component that never wrote a row is `never_seen`, shown plainly and never alerted on (a fresh install, or dedicated mode without the shared worker). In shared mode (`LIWAN_TENANCY_MODE=shared`) the control API registers `shared_worker` and `commercial_scheduler` when it starts (a row dated then, never overwriting an existing beat), so a worker that never started, or cannot start, is `stale` after its threshold and alerted on, which a first shared deploy needs; the mode alone decides, not whether the runtime config is readable, because a worker that cannot start for its config is exactly the case to catch. A release that starts the API well before the worker can show one short `stale` and recovery. Dedicated mode registers nothing. The console and the host alert both read that function, so they cannot disagree. The adapters of the worker are shown as unknown while the worker is stale, and are not listed as down then: the worker is.

What the console shows: `GET /v1/overview` carries `health` for everyone with `vendor.read` (state and times); the reason codes and the scheduler's failed job names only for `vendor.operations.run` holders. An unreadable table gives `health: null` and the page says so; the counts and the attention list never fail because of health. A stale or unavailable component is an attention item of kind `service_down`, ahead of the customer items, named by the component, with no customer. The scheduler's owner alert (`vendor-alerts`) skips this kind: the host timer below is the only sender of a service alert, so an unavailable adapter is announced once, and it works when the worker or the mail adapter is down.

Host alert (works with the control API and the worker both down): `deploy/control-plane/service_health_alert.py`, run every minute by `liwan-service-health-alert.timer`, asks the control database with `psql` through the role `liwan_control_health` (password only through `PGPASSFILE`), which holds `EXECUTE` on `service_health_states(timestamptz)` and no table privilege: the function is `SECURITY DEFINER` with a pinned `search_path` and revoked from `PUBLIC`, because it also reads `shared_jobs` and a table grant would expose their payloads, so the host holds no read credential for the control plane's data. The operator creates the role (step A6.3) and sends the `service_down` and `service_recovered` events of `deploy/alerts.py`, one message per transition. What it already announced is kept in `/var/lib/liwan-service-health/service-health-alert.json`; a message that no channel delivered is sent again on the next run, while one that at least one channel delivered is recorded and never repeated (that run still exits 1 and the journal names the failed channel, which is the operator's to fix: the other channel is not spammed every minute). The monitor watches itself: when it cannot read the table (database down, `psql` or the credentials missing, a timeout) the run fails (exit 1) and says so in the journal, and after 3 failed runs in a row it announces once that `health_monitor` is `unavailable` (a `service_down` message) and once when it can read again (`service_recovered`); a single failed run announces nothing, and the count is kept in the state file. While it is blind, nothing else is announced or cleared. Install and variables: the unit files and `service-health-alert.env.example` in `deploy/control-plane/`, step A6.3 of `environment-bringup.md`. It is not installed on any server yet.

Not monitored: Odoo and tenant workspaces (the existing workspace check stays as it is), the edge and TLS, the database, the AI service, the ordinary worker of dedicated mode, whether the payment provider or the SMTP server answers (only whether the adapter was built), disk and backups (`deploy/alerts.py` covers them).

First action by state: `stale` worker or scheduler: `systemctl status liwan-shared-worker`, then `journalctl -u liwan-shared-worker`; a long backup, restore or provision legitimately holds the scheduler (up to 2 hours). `unavailable` adapter: read the one log line at start-up (`commercial payment adapter unavailable`, `commercial mail adapter unavailable`, `telegram alert channel unavailable`) and fix the environment variable it names, then restart the worker (or the API for `api_payment_adapter`).

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
2. `deploy/OPERATIONS.md`: add a link to this runbook next to the control plane backup section.
3. `deploy/ci/static.sh` already runs `python3 -B -m unittest deploy/control-plane/test_*.py`, which picks up `test_production_compose.py`. No change needed.

## What the owner must provide

- Domains and DNS: the admin host (`ADMIN_DOMAIN`: `admin.staging.liwanos.com`, `admin.liwan.sa`), the webhook host (`CONTROL_WEBHOOK_DOMAIN`: `hooks.staging.liwanos.com` and `hooks.liwan.sa` are suggestions until DNS exists), the outer edge routes and TLS for both (`environment-bringup.md` section D), the operator addresses for `LIWAN_ADMIN_ALLOW` (space separated, never commas), and the owner's confirmation of the vendor console exposure decision.
- A private CA and the control API certificate (SAN `control-api`) and the effect channel certificate (SAN `control-host.internal`).
- A container registry account, so the three images can be published and pinned by digest.
- Secrets from the operator's store: the database password, the four keys (`CONTROL_SERVICE_KEY`, `CUSTOMER_COMMERCIAL_SERVICE_KEY`, `ADMIN_SECRET_KEY`, `INTERNAL_EFFECT_KEY`), the Moyasar keys and webhook secret, the Authentica key and template, the Turnstile keys, SMTP credentials, the Telegram bot token and chat id.
- The public monthly plan (`LIWAN_SIGNUP_PLAN_ID`, the plan id, not a revision id; sign-up and public pricing serve its latest published, available revision), the legal pages URL and the terms version.
- The decision to publish a loopback database port for the host-run shared worker (`compose.host-link.yml`), or to move the worker's database access another way.
