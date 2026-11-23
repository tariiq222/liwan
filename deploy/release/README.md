# Release command

`release.py` applies one commit to one LiwanOS server. An Openship job runs it; nothing else starts it (no timer, no
polling). The same file runs on staging and production.

```sh
python3 -B /opt/liwan/current/deploy/release/release.py run      --environment staging
python3 -B /opt/liwan/current/deploy/release/release.py run      --environment production --tag release/19.0.X.Y.Z
python3 -B /opt/liwan/current/deploy/release/release.py status   --environment staging   # exit 3 when halted
python3 -B /opt/liwan/current/deploy/release/release.py rollback --environment staging
```

**Status: the command has run for real on staging, not on production yet.** `release/19.0.1.0.6` was served on staging on
2026-11-21 after one halt caused by the wrong group on the shared `odoo.conf` (row A4.7 of the bring-up guide). The tests use fake docker, git and psql commands
(`python3 -B -m unittest discover -s deploy/release -t . -p 'test_*.py'`). The first production run happens during the
production bring-up.

## Who builds and how each environment starts

GitHub is the only system for source, CI, image build and release. The GitHub Actions workflow
`.github/workflows/publish.yml` runs on `release/**` tags only. It builds the images, pushes them
to the private GHCR registry under `ghcr.io/tariiq222` and publishes the release document image
`ghcr.io/tariiq222/liwan-release:<commit>`.

A push to `main` builds and publishes nothing. A `release/**` tag builds arm64 only for its commit and publishes the
document `liwan-release:<commit>` covering `linux/arm64`; only then does the workflow start staging. Documents
published earlier may list both `linux/amd64` and `linux/arm64` and are still accepted. The command never reuses a
local copy: it pulls the document fresh for the candidate commit on every run and removes the image afterwards.

- staging: waits for the arm64 build that the release tag starts; the workflow's hook starts the job after it.
- production: only the owner starts the job from Openship, with the tag named in the command. There is no hook.

## Candidate and release document

| Environment | Candidate commit |
| --- | --- |
| `staging` | the commit of the highest `release/19.0.X.Y.Z` tag (compared by version, not by text) |
| `production` | the commit of the one tag given with `--tag release/19.0.X.Y.Z`; it never picks the highest tag itself |

Staging and production are the only environments and share every rule below. Both run on Arm.

The production job command is `release.py run --environment production --tag <tag>`. Without `--tag` the run refuses
with `RESULT: refused production_tag_required`; a tag that does not match `release/19.0.X.Y.Z` is refused as
`invalid_tag`, and one GitHub does not have as `tag_not_found`, all before any fetch or image pull. The given tag then
passes every check below unchanged, even when a higher tag exists. This closes "production takes the highest tag".
`--tag` is refused for staging and for `status` and `rollback`.

An automatic proof that staging already served and passed the tag is still not built: the owner and the coordinator
confirm it by hand before the word «انشر على الإنتاج». An enforced gate is designed in plan part P7 and is not
implemented here.

The candidate is read with `git ls-remote https://github.com/tariiq222/liwan.git`. The command then fetches `main`
and the `release/*` tags into a bare repository in the state directory (`repo.git`) for ancestry checks and
`git archive`.

The release document is the image `ghcr.io/tariiq222/liwan-release:<full commit sha>`, built `FROM scratch` with
one file `/release.json`. The command pulls it, copies the file out with `docker create` and `docker cp`, and removes
the container and the image. It accepts the document only when its `commit`, its `release.liwanCommit` and every image
reference (`ghcr.io/tariiq222/liwan-<name>@sha256:...`; any other host or namespace is refused) match, and `release` passes `deploy/releases/manifest.py`
validation. Each image is pulled by the digest of the host's architecture from the `platforms` map. A document
without that architecture is refused: an Arm server given an amd64-only document refuses with
`RESULT: refused document_invalid` (`has no linux/arm64 image`). Staging and production also refuse a tag whose commit is not part of GitHub `main`, a document without `linux/arm64` digests (even on an amd64 host), and refuse
a candidate that does not contain the served commit or whose release version is not above the served one.

## Credential

The job command loads the variables from the root-only file `/etc/liwan-release/github-read` (`set -a; . /etc/liwan-release/github-read; set +a; python3 -B ...`); that file is the single source, not the job's secret store. Each environment has its own file and production's token differs from staging's:

| Variable | Meaning |
| --- | --- |
| `LIWAN_GHCR_READ_USER` | required; the GitHub user of the registry token |
| `LIWAN_GHCR_READ_TOKEN` | required; a read-only token that can pull the private `ghcr.io/tariiq222` packages, nothing more |
| `LIWAN_GITHUB_READ_TOKEN` | optional; a read-only token for the source repository. The repository is public today, so when it is unset git runs with no credential. Set it the day the repository goes private |

The GitHub token reaches git through the environment of a credential helper (username `x-access-token`; the command
line holds only the variable name). The registry token reaches `docker login ghcr.io` on stdin, into a docker config
directory inside the private state directory. Neither is ever in an argument, a URL, a state file or the release document, and the job log replaces any occurrence with
`***`, as it does every value of the config file and the shared env file whose key contains PASSWORD, SECRET, TOKEN, KEY, PASS, DSN, URL or URI (surrounding quotes dropped; a URL value also hides its password). A missing `LIWAN_GHCR_READ_*` variable ends the run with `RESULT: refused missing_credential` before any command runs.

## What a run does

Each phase is written to `run.json` before it acts, so a killed run resumes from real state.

1. Resolve the candidate, fetch it, check it is not older, pull and check the release document.
2. Prepare: extract the commit to `/opt/liwan/releases/<commit>`, install the shared worker's node dependencies
   (`npm ci --ignore-scripts --include=dev --workspace apps/control-plane`; `tsx` is a dev dependency and the worker runs it;
   a release folder that already exists but lacks `node_modules/.package-lock.json`, npm's last write, gets the install too, and a
   failed install removes its `node_modules` so no later run takes it as complete; the reason is `worker_dependencies_failed`), pull every image by digest and tag it with its local
   name from `deploy/image_pins.py --print-builds` (the document must list exactly those). The third-party images
   (`deploy/image_pins.py --print-external`, the pins of `deploy/production-images.json`) are pulled by their pinned digest too,
   because every later compose step runs with `--pull never`; they are not recorded in `releases/<commit>.json`, so the prune
   never removes one. Each pull has a 10 minute timeout and up to 3 attempts 10 seconds apart; when the last attempt fails the
   run stops with `image_pull_failed` before anything is stopped. The run is also refused when the shared env file's
   `LIWAN_SHARED_ODOO_CONFIG` is unset, not absolute or not a regular file (`RESULT: refused invalid_shared_env`; Docker would create a directory at that path, and
   Odoo would die after the stop). The same refusal applies to `LIWAN_VENDOR_ADMIN_ENV_FILE`, the vendor console's env file (Compose would fail on it only after the
   stop); only the path is logged, never the content. Both compose projects of the candidate are also rendered with `config --quiet` (its own image
   tag in a temporary env file, nothing activated, nothing printed), so a required key the shared env file lacks (compose names the variable) is refused as
   `invalid_shared_env` before anything stops. Then the disk check:
   the run is refused when the free space on `LIWAN_RELEASE_DISK_PATH` is below 1.5 times the size of one snapshot of
   every tenant database, the control-plane database and every filestore (the snapshots all exist at once).
3. Quiesce: stop the shared worker, read the tenant list with `deploy/shared/backup-binding.mjs --list`.
4. Capture: first the database role check (below), then an encrypted `backup_pipeline.py` backup of every tenant and the control plane.
5. Maintenance: create `<state root>/maintenance/active` (Caddy shows its maintenance page only while it exists), stop
   `guard`, `web`, `ai`, `odoo`, `control-api` and `vendor-console`.
6. Snapshot every database (`CREATE DATABASE ... TEMPLATE`) and hard-link every filestore.
7. Upgrade every tenant database (`tools/upgrade_log_guard.py` on its log, then `deploy/odoo/upgrade_smoke.py`), then
   migrate the control plane, then create the AI service's control tables
   (`compose run --rm ai python -m liwan_ai_service.store --initialize-control`, idempotent; skipped when `AI_DATABASE_URL`
   is empty in every place compose reads it: the process environment and release config, then the shared env file). The `ai` service validates them when it starts and refuses to start without them, and the
   per-tenant provisioning creates them only after the first start; failure reason `ai_control_initialization_failed`.
8. Bring `db` up alone and run the database role check again (a first deploy included), so no application connects with a bad role. Then start `control-api` and `vendor-console` first (their project creates the networks the shared stack joins as external:
   the control ingress, the edge's own control network and the console's `admin_edge`, so a fresh host needs this
   order; the console waits for the API's health). The console's health gates the customer release: a console that fails
   its health check fails the start and rolls the release back, because it is the only service on `admin_edge`, which `proxy`
   joins as external, so the stack cannot start without it. Then `proxy`, `odoo`, `web` and `ai`, wait for health, then start `guard` (the commit point). The
   phase `opened` is written, then the maintenance marker is removed. From `opened` on a failure never rolls back
   (customers may have written to the new release); the next run resumes.
9. Record `served.json`, start the shared worker and check it is active after a 5 second settle (the unit restarts a crashed
   worker only after `RestartSec=10`, shown as not active until then; `worker_not_ready` otherwise), drop the snapshots, then prune: images and release folders of every
   release except the served one and the previous one are removed, with their `runs/<commit>/` folders.

A failure from step 5 onward rolls back: every snapshot and filestore copy is swapped back, owners, grants and
isolation are restored, the previous release starts, and the old worker starts. A failure before step 6 changes
nothing but the worker, which is restarted. The first deploy has no previous release, so it skips the backup, the
stop and the snapshots, and a failure leaves the environment stopped in maintenance and halted. Every failure sends an alert
through `deploy/alerts.py`; when it is not delivered the log line carries the reason alerts gave (for example that no channel
is configured).

## Result and exit code

The last log line of every run starts with `RESULT:`.

| Last line | Exit | Meaning |
| --- | --- | --- |
| `RESULT: committed <commit>` | 0 | the commit is served |
| `RESULT: nothing to do ...` | 0 | already serving it, no release tag yet, or another run holds the lock |
| `RESULT: nothing to do: <commit> failed before (...)` | 3 | that candidate failed after the stop; the job stays red until a new candidate or `rollback` |
| `RESULT: refused <reason>` | 2 | nothing changed (credential, document, older candidate, architecture, disk) |
| `RESULT: halted <reason>` | 3, 4 or 5 | stopped; see Halted |
| `RESULT: rolled back <reason>` | 4 | the previous release is served again |
| `RESULT: incomplete <commit> <reason>` | 4 | committed, but a last step failed; the next run resumes it |

The command never waits for input. A second start while one runs exits 0 at once; `status` takes no lock and always answers. An unexpected error ends with
`RESULT: failed unexpected_error <type>` (exit 4) and leaves `run.json` so the next run resumes.

## State: `/var/lib/liwan-release/<environment>/`

| File | Meaning |
| --- | --- |
| `lock` | one run at a time |
| `served.json` | the release currently served |
| `release.env` | `LIWAN_IMAGE_TAG` and `ODOO_COMMIT` of that release, read by Compose |
| `run.json` | the unfinished run and its phase |
| `failed.json` | the candidate that failed after the stop; the same commit is answered `nothing to do` (exit 3) until the candidate changes or `rollback` clears it |
| `halted.json` | set when a rollback failed or the first deploy failed; no run proceeds while it exists |
| `releases/<commit>.json` | the images pulled for a release, read by the prune |
| `repo.git` | bare repository of the fetched `main` and release tags |
| `docker-config/` | the private docker login |
| `runs/<commit>/` | backup work files and upgrade logs |

## Config

`/etc/liwan-release/<environment>.env`, mode `0600`, owned by the running user. Required keys: `LIWAN_RELEASE_PROJECT`,
`LIWAN_SHARED_ENV_FILE`, `LIWAN_RELEASE_PG_DUMP`, `LIWAN_RELEASE_PG_HOST`,
`LIWAN_RELEASE_CONTROL_PG_HOST`, `LIWAN_RELEASE_ODOO_DATA_DIR`,
`LIWAN_RELEASE_DISK_PATH` (a path on the filesystem that holds the database volume and the filestores). Optional:
`LIWAN_RELEASE_BACKUP_STORE_ROOT`. Other keys in the file reach the backup pipeline through its environment.

Alert channels are read from the same file. One complete channel is `LIWAN_ALERT_SMTP_HOST`, `LIWAN_ALERT_SMTP_FROM` and
`LIWAN_ALERT_SMTP_TO` (optional `LIWAN_ALERT_SMTP_PORT`, `_USER`, `_PASSWORD`, `_STARTTLS`), or `LIWAN_ALERT_TELEGRAM_BOT_TOKEN`
with `LIWAN_ALERT_TELEGRAM_CHAT_ID`. With none, `deploy/alerts.py` exits 2 and the alert is lost; the release logs the reason.

The path comes from `LIWAN_SHARED_COMPOSE_FILE` in the shared env file (the same key `init-host.sh` reads for the `composeFile` of the
worker's `shared-runtime.json`); it is not a release config key. Before anything stops (the `verified` phase), the run refuses with
`RESULT: refused invalid_shared_env` when the key is missing or not an absolute path, when its directory does not exist or is not
writable, or when the shared env file is owned by root and unreadable by group and others (the worker account could never read the
rendered copy). At each activation, after `release.env` is written and before any service or the worker starts, the run renders the
shared stack (the files of `SHARED_COMPOSE_FILES`, every profile) to that path with `docker compose config --format json`, through
a temporary file and an atomic replace. The file holds the shared env file's secrets, so it takes that file's owner, group and
mode. A rollback renders it again for the restored release, so the worker and the running stack always describe the same release.
A failed render fails the run (`shared_compose_render_failed`) and the usual rollback applies. In the rollback the previous
release's services start first and the maintenance marker goes; only then is the file rendered and the worker started, so a failed
render there halts the run (exit 5) with the previous release serving and the worker stopped.

Database access for the backup: the tenant `db` is published on `127.0.0.1` by `deploy/docker-compose.host-link.yml`
(part of the shared compose set), and the control-plane database by `deploy/control-plane/compose.host-link.yml`. The ports are
read from the shared env file, not the release config: `LIWAN_DB_HOST_PORT` (default `15433`) and `LIWAN_CONTROL_DB_HOST_PORT`
(default `15432`), the same keys the overlays interpolate. Set

```
LIWAN_RELEASE_PG_HOST=127.0.0.1
LIWAN_RELEASE_CONTROL_PG_HOST=127.0.0.1
PGPASSFILE=/etc/liwan-release/pgpass
```

`pg_dump` runs with `--no-password`, so the passwords come from the `PGPASSFILE` key: a root-owned file of mode `0600`
with one line per database user (`host:port:*:user:password`: the `postgres` admin role on port 15433 and `liwan_control`
on port 15432). The pgpass file necessarily repeats the two ports, so change them there too. The key reaches the backup
pipeline like every other key of the config.

## Database roles

The tenant database has two roles. `postgres` is the superuser the `db` image bootstraps with (password `DB_ADMIN_PASSWORD`); only tooling
uses it: every `psql` the release runs (snapshot, drop, rename, ACLs), the `pg_dump` of the capture and the pgpass line for port 15433.
`odoo` is a plain login role (no superuser, createdb, createrole, replication or bypassrls, no memberships, owns no tenant database); Odoo,
the `-u` upgrade run, the smoke run and pgbouncer connect as it, and the release grants it `CONNECT` on every tenant database. Its `CREATE`
on the `public` schema lives inside each tenant database and is carried by the snapshot copy, so a rollback needs no schema grant.

Session rule: no tenant-controlled code ever runs in a superuser session. Every `psql` of the release connects to the `postgres` database
only and never opens a session inside a tenant database. Whatever reads or writes tenant tables logs in as `odoo`. The one admin session
inside a tenant database is the `pg_dump` of the capture. The release checks this with a single SQL assertion run as `postgres` (`runtime_role_assertion_sql`), at the capture
step when a release is already served (`RESULT: refused runtime_role_rejected`, nothing stopped and the served release untouched, the worker
restarted) and in the start step before any application starts (the run rolls back). A volume that still has a privileged `odoo` or no
`postgres` role fails both checks. The release does not convert such a volume: the cutover is an operator step, see the bring-up guide.

## Bootstrap (first run on a fresh host)

`/opt/liwan/current` is always a symlink into `/opt/liwan/releases/<commit>`. `run` and `rollback` refuse with
`RESULT: refused current_not_symlink` when the path exists and is a real directory, and `RESULT: refused current_dangling` when it is a symlink to a folder that does not exist, before anything changes. Clone the
bootstrap commit into `/opt/liwan/releases/<commit>`, then `ln -s /opt/liwan/releases/<commit> /opt/liwan/current`.
The Openship job command path stays `/opt/liwan/current/deploy/release/release.py`; later runs move the symlink.

Install the `liwan-shared-worker.service` unit before the first run but do not start it: the commit step starts it.
The control-plane migration needs no manual start of `control-db`: `docker compose run` starts the dependency and waits
until it is healthy.

## Edge check (staging host)

`edge_check.py` is a standalone script (release.py never calls it). It checks a host behind the Openship edge, as staging is. Example:

```sh
python3 -B /opt/liwan/current/deploy/release/edge_check.py --host app.example.com --min-days 21 \
  --route-file /path/app.route.json --target http://127.0.0.1:18080 --vhost-file /etc/nginx/conf.d/app.conf \
  --cert-file /srv/liwan-staging/control/private/control-tls.crt
```

It prints one line per failed check (a network, TLS, file, JSON or `openssl` error is a failed check, not a traceback) and exits 1, or
prints `RESULT: edge ok` and exits 0. Passing none of `--host`, `--route-file`, `--vhost-file` and `--cert-file` is a usage error
(exit 2), so a job with an empty argument list cannot stay green. `--cert-file` is repeatable and names a PEM certificate that must
have `--min-days` left (read with `openssl x509 -enddate`); the daily job lists the control CA and the two internal leaf
certificates (`control-ca.pem`, `control-tls.crt`, `effect-tls.crt`), whose expiry `init-host.sh` only reports when someone runs it. `--host` is requested over
HTTPS at `/favicon.ico` (`HTTPS_PROBE_PATH` in `edge_check.py`) with certificate verification (2xx/3xx passes) and its certificate must have `--min-days` left;
the path is not `/` because the guard refuses `/` on the prospect host with 403 when no tenant is named, while `/favicon.ico` is allowed with or without a tenant and the web container serves it; `--route-file`
is an Openship `.route.json` whose `targetUrl` must equal `--target`; `--vhost-file` must contain
`proxy_set_header Host $host`, `$proxy_add_x_forwarded_for` and `$http_upgrade`.

## Halted

A halt record means the service may be in maintenance (the marker stays). Read `status` and the job log, fix the cause,
then run `rollback`: it clears the halt and failed-candidate records and finishes the rollback of the unfinished run. It refuses a run that
already committed. A run that stopped before the stop (phases `verified`, `quiescing`, `captured`) holds no snapshot and may have no
tenant inventory, so `rollback` only cancels it: no maintenance, no stop, the worker is restarted if it was stopped, and `run.json` is cleared. After a rolled-back failure there is no halt: the next job run tries the then-current candidate again.
Never delete `run.json` by hand.
