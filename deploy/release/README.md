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
| `LIWAN_RELEASE_TAG_POLICY=highest` (staging) | the commit of the highest `release/19.0.X.Y.Z` tag (compared by version, not by text) |
| `LIWAN_RELEASE_TAG_POLICY=explicit` (production) | the commit of the one tag given with `--tag release/19.0.X.Y.Z`; it never picks the highest tag itself |

Every environment shares every rule below; its name and its tag policy come from its config file and shared env file, not from code. Both run on Arm.

The production job command is `release.py run --environment production --tag <tag>`. Without `--tag` an `explicit` environment refuses
with `RESULT: refused tag_required`; a tag that does not match `release/19.0.X.Y.Z` is refused as
`invalid_tag`, and one GitHub does not have as `tag_not_found`, all before any fetch or image pull. The given tag then
passes every check below unchanged, even when a higher tag exists. This closes "production takes the highest tag".
`--tag` is refused for a `highest` environment (`tag_not_allowed`) and for `status` and `rollback`.

Staging's run is still confirmed by hand by the owner and the coordinator before the word «انشر على الإنتاج», because
the proof establishes that staging served the commit, not that it passed its checks. The gate around it is built end to
end. The environment that serves a commit signs `{tag, commit, releaseDocumentDigest, environment, at}` with Ed25519
(`deploy/release/proof.py`) and publishes `/_liwan/release-proof/<commit>.json` in `LIWAN_RELEASE_PROOF_DIR`; the stack's
edge serves exactly that name from the directory, read-only and with a five-minute public cache, and answers 404 for any
other name (`deploy/stack/Caddyfile`). The requirement follows the tag policy and never the environment name: an
environment with `LIWAN_RELEASE_TAG_POLICY=explicit` — production — always verifies, fetches the proof of the candidate
before it pulls the document image, and applies the candidate only when the signature and the signed tag, commit and
document digest match exactly. A proof that cannot be obtained (404, DNS, TLS, redirect, timeout, 5xx) is
`RESULT: refused staging_proof_missing`; one that does not establish the candidate is `RESULT: refused
staging_proof_invalid`; a missing or half-set pair on an `explicit` environment is `RESULT: refused invalid_config`, so
the gate is never silently off. An environment with `highest` may sign without verifying, and logs one line when it
applies a candidate without a proof. Nothing skips the gate, no environment name selects it, and a resumed run or a
`nothing to do` answer never asks for a proof. The signed `environment` is never compared: one environment's proof is not another's permission. Both
environments sign with their own key, so a dedicated customer environment can pin either. Setup is row A4.7a of
[environment-bringup.md](../../docs/operations/environment-bringup.md).

The candidate is read with `git ls-remote https://github.com/tariiq222/liwan.git`. The command then fetches `main`
and the `release/*` tags into a bare repository in the state directory (`repo.git`) for ancestry checks and
`git archive`.

The release document is the image `ghcr.io/tariiq222/liwan-release:<full commit sha>`, built `FROM scratch` with
one file `/release.json`. The command pulls it, copies the file out with `docker create` and `docker cp`, and removes
the container and the image. It accepts the document only when its `commit`, its `release.liwanCommit` and every image
reference (`ghcr.io/tariiq222/liwan-<name>@sha256:...`; any other host or namespace is refused) match, and `release` passes `deploy/release/manifest.py`
validation. The digest the proof signs is `sha256` of the file's own bytes, exactly as published (`sha256sum` of that
file), so the CRLF or LF endings it was stored with are part of it; the file is decoded only to be parsed.
Each image is pulled by the digest of the host's architecture from the `platforms` map. A document
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

1. Resolve the candidate, fetch it, check it is not older, verify the candidate's staging proof when the environment
   requires one, pull and check the release document.
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
   `invalid_shared_env` before anything stops. The host's `LIWAN_SHARED_ODOO_CONFIG` is also run through the candidate's `deploy/shared/validate_odoo_config.py` (as the container's launcher will), and a rejection is `RESULT: refused odoo_config_invalid` before anything stops (only the path is logged). When `LIWAN_RESTORE_ODOO_CONFIG` is set, that file is validated the same way as the restore profile (`LIWAN_RESTORE_ROLE=1`, zero cron threads); unset, it is skipped. Then the disk check:
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
   worker only after `RestartSec=10`, shown as not active until then; `worker_not_ready` otherwise), then sign the release
   when `LIWAN_RELEASE_PROOF_KEY_FILE` is set: `proof/<commit>.json` in the state directory and, atomically and mode 0644,
   `<LIWAN_RELEASE_PROOF_DIR>/<commit>.json`; a failure there is `RESULT: incomplete <commit> release_proof_failed` and the
   next run re-runs that step. Then drop the snapshots, then prune: images and release folders of every
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
| `RESULT: refused staging_proof_missing` | 2 | no proof of the candidate could be fetched; nothing changed |
| `RESULT: refused staging_proof_invalid` | 2 | a proof arrived but does not sign this tag, commit and document; nothing changed |
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
| `proof/<commit>.json` | the signed proof of a served release, written at the commit step and kept for good |
| `releases/<commit>.json` | the images pulled for a release, read by the prune |
| `repo.git` | bare repository of the fetched `main` and release tags |
| `docker-config/` | the private docker login |
| `runs/<commit>/` | backup work files and upgrade logs |

## The stack and the Odoo config

The shared stack is one definition, `deploy/stack/compose.yml`. Each release renders its own: the command runs
`python3 -B -m deploy.stack.render bundle --env-file <shared env> [--env-file <release.env>] --out <dir>` inside that release's
checkout (`PYTHONPATH` set to it; `<dir>` is `<state>/stack/<commit>/`, mode 0700, cleared before each render) and reads only the
`stack.json` manifest it writes (`{"contract": 1, "compose", "envFiles", "odooConf", "projectDirectory"}`, with `compose.yml`,
`sizing.env` and a 0600 `odoo.conf` beside it). No release's template is read by another release's code, so a candidate may change
the stack, the toggles or the Odoo config template and the served release is still stopped, and rolled back to, on its own render.
Every compose command is `docker compose --project-directory <checkout>/deploy -p <project> -f <bundle compose file>` with the env
files in this order, the last one winning: the bundle's `sizing.env`, the shared env file, `release.env`. A renderer that refuses
the shared env file (a toggle its own template uses that is missing or not exactly `true`/`false`, a missing secret key; stderr names keys, never values) is
`invalid_shared_env`; a checkout without `deploy/stack/render.py` is `previous_not_stack` (the served release) or
`candidate_not_stack`, and a manifest of another contract is `stack_contract_mismatch`, each refused in `prepare` before anything
stops. A served release that predates the stack definition is moved over once by hand: see "Pre-stack cutover (one time)" below.
A renderer requires exactly the toggles its own template uses and ignores any other `LIWAN_STACK_*` key (it names them once on stderr as `ignored: <names>`), so a toggle only a newer release uses may sit in the shared env file while the served release is still in charge; a misspelled known toggle still fails because the real one is then missing. Services are started by name, so a profile service such as `tenant-storage` never comes up with `up`.

`LIWAN_RELEASE_TAG_POLICY` in the shared env file is `highest` (the highest `release/19.0.X.Y.Z` tag; `--tag` is refused with
`tag_not_allowed`) or `explicit` (only the tag `--tag` gives; none is refused with `tag_required`); a missing or other value is
refused with `invalid_tag_policy`. An environment is any name (lowercase letters, digits, hyphens) with a config file in
`/etc/liwan-release/`.

`prepare` also takes the candidate's rendered `odoo.conf`, writes it to `<LIWAN_SHARED_ODOO_CONFIG>.next` with the live file's owner,
group and mode exactly, and validates it with the candidate's `deploy/shared/validate_odoo_config.py` (`odoo_config_invalid`); the
restore profile's `LIWAN_RESTORE_ODOO_CONFIG` is validated as before. The live file must exist: a missing one is `RESULT: refused
odoo_config_missing`, because a file the command made as root would not be readable by the container (the operator creates it as row
A4.7 says). A live file that does not carry the render marker (a hand-written one) must match the render option by option, secrets
included (compared in constant time) or the run stops with `RESULT: refused odoo_config_drift`, naming the differing option names
only, never a value. `activate` renames `.next` over the live file after the stop; a resumed run finds nothing left to rename. A
rollback runs the same install for the previous release (`install_odoo_config`: its own renderer, the same checks, the same owner
and mode) before it starts it, so there is one mechanism and no `.prev` copy: the previous release always rendered its own config
(a pre-stack one is refused before the run starts), and a hand-written file was adopted only because it said what the render says,
so the re-render is equivalent. `prepare` also refuses with `classification_dir_missing` when
`<LIWAN_CONTROL_STATE_DIR>/classifications` (bind-mounted read-only into Odoo, never created by Docker) is not a directory.

## Pre-stack cutover (one time)

A host whose served release predates the stack definition (it has `deploy/docker-compose*.yml` and no `deploy/stack/render.py`) is
refused with `previous_not_stack`: the release command could neither stop it nor roll back to it. Move it over by hand, once, as
root, with the owner's explicit go. This is one ordered list that follows the A4.4a procedure of
[environment-bringup.md](../../docs/operations/environment-bringup.md) (row A4.4b points here); staging has a `db` volume
whose bootstrap user is still `odoo`, so A4.4a is part of it. `<c>` is the served (pre-stack) commit, `<n>` the candidate commit,
`<project>` the compose project, `<state>` is `/var/lib/liwan-release/<env>`.

1. Delete the test tenants through the real deletion path and confirm none is left (A4.4a step 1): `node /opt/liwan/current/deploy/shared/backup-binding.mjs --list "$LIWAN_TENANT_REGISTRY_DIR/registry.json"` prints `[]` and `ls <odoo data dir>/filestore` lists no tenant folder. Stop here if either is not so.
2. Stop the worker first, so nothing provisions or charges meanwhile: `systemctl stop liwan-shared-worker.service`; `systemctl is-active liwan-shared-worker.service` prints `inactive`.
3. Keep what the manual rollback needs: `pg_dump` of every database you want to keep, and of the control database, which the first deploy migrates in its upgrade phase and reopens on the candidate's images in its start phase (the control project is `liwan-control`, outside the shared stack): as root, `PGPASSFILE=/etc/liwan-release/pgpass <LIWAN_RELEASE_PG_DUMP> -h 127.0.0.1 -p 15432 -U liwan_control -d liwan_control -f /root/liwan_control.pre-stack.dump`; `cp -p <LIWAN_SHARED_ODOO_CONFIG> <LIWAN_SHARED_ODOO_CONFIG>.pre-stack`; `cp -p <LIWAN_SHARED_COMPOSE_FILE> <LIWAN_SHARED_COMPOSE_FILE>.pre-stack` (the `composeFile` of `shared-runtime.json`; the first new activation overwrites it); `cp -p <state>/release.env <state>/release.env.pre-stack`.
4. Move the pre-stack release folder out of `releases/`: `mv /opt/liwan/releases/<c> /opt/liwan/pre-stack-<c>`.
5. Stop the old stack with its own five files and delete the two database volumes, exactly as A4.4a step 3, never `down -v`: `cd /opt/liwan/pre-stack-<c>/deploy && docker compose -p <project> -f docker-compose.yml -f docker-compose.shared.yml -f docker-compose.shared-commercial.yml -f docker-compose.production.yml -f docker-compose.host-link.yml --env-file <shared.env> --env-file <state>/release.env --profile restore down`, then `docker volume rm <project>_db_data` and, when it exists, `docker volume rm <project>_restore_db_data`. Check: `docker volume ls -q | grep -c -E '^<project>_(db_data|restore_db_data)$'` prints `0`.
6. `DB_ADMIN_PASSWORD` and the pgpass line, exactly as A4.4a step 4: put `DB_ADMIN_PASSWORD` (`openssl rand -hex 32`, different from `DB_PASSWORD`, never printed) in the shared env file and change the pgpass line for port 15433 to `postgres`. Check: `grep -c '^DB_ADMIN_PASSWORD=.' <shared.env>` prints `1`.
7. Move the release state aside, not deleting it: `mkdir <state>/pre-cutover && mv <state>/served.json <state>/release.env <state>/pre-cutover/` and `failed.json`, `halted.json`, `run.json` when present (`release.env` is already saved as `release.env.pre-stack` by step 3).
8. Put the candidate in place without building it by hand: `prepare` installs the worker dependencies and normalizes modes itself, so create no dependency marker. As the release user: `git clone --no-checkout https://github.com/tariiq222/liwan.git /tmp/liwan-src && mkdir -p /opt/liwan/releases/<n> && git -C /tmp/liwan-src archive --format=tar <n> | tar -x -C /opt/liwan/releases/<n> && rm -rf /tmp/liwan-src`, then `chmod 0755 /opt/liwan/releases && ln -sfn /opt/liwan/releases/<n> /opt/liwan/current`. Check: `python3 -B /opt/liwan/current/deploy/release/release.py status --environment <env>` prints `"served": null`.
9. Add the new keys to the shared env file: `LIWAN_RELEASE_TAG_POLICY`, `LIWAN_STACK_COMMERCIAL_EDGE`, `LIWAN_STACK_DB_HOST_LINK`, `LIWAN_ODOO_ADMIN_PASSWD`, `LIWAN_TENANT_STORAGE_FILES_DIR` and the `OCI_*` tenant-storage keys (empty); create `<LIWAN_CONTROL_STATE_DIR>/classifications` when it is missing; then check the host with `python3 -B /opt/liwan/current/deploy/release/bringup.py --environment <env>` (every line `ok <item>` except `MISSING tenant-storage-files`) and create that item as root with `python3 -B /opt/liwan/current/deploy/release/bringup.py --environment <env> --apply` (`created tenant-storage-files`: the directory and the naming key; the OCI signing key stays yours); `--apply` takes no item argument, so it also creates every other missing item it can create, and the check is re-run after it.
10. Install the Odoo config with the single recipe of row A4.7 (render the bundle from `/opt/liwan/current`, `install -o root -g 999 -m 0440`, validate on the host and in the container). The file from the pre-stack release stays as `.pre-stack`; the release adopts the new one and keeps its owner and mode.
11. Run the release job: `python3 -B /opt/liwan/current/deploy/release/release.py run --environment <env>`. With no `served.json` it is the first deploy; the `db` init scripts create `postgres` and `odoo` on the empty volume. Check: `RESULT: committed <n>` (the commit step starts the worker again).

Manual rollback (the first deploy failed or you stop before step 11 has committed): `systemctl stop liwan-shared-worker.service`. When `<state>/release.env` does not exist (`ls <state>/release.env`), the run stopped before `activate` wrote it, so nothing of the new stack started and the control database was not migrated: skip the next sentence and go to the state restore. Otherwise stop what the new stack started (`docker compose --project-directory /opt/liwan/current/deploy -p <project> -f <state>/stack/<n>/compose.yml --env-file <state>/stack/<n>/sizing.env --env-file <shared.env> --env-file <state>/release.env down`, without `-v`), then pause the control project, whose database the run migrated and whose services it may have reopened on the candidate's images: `docker compose -p liwan-control -f /opt/liwan/current/deploy/control-plane/compose.production.yml -f /opt/liwan/current/deploy/control-plane/compose.host-link.yml --env-file <shared.env> --env-file <state>/release.env stop control-api vendor-console`, and restore the control dump of step 3, because the old control API does not run on a schema migrated past it: `PGPASSFILE=/etc/liwan-release/pgpass psql -h 127.0.0.1 -p 15432 -U liwan_control -d postgres -v ON_ERROR_STOP=1 -c 'DROP DATABASE liwan_control' -c 'CREATE DATABASE liwan_control'`, then `PGPASSFILE=/etc/liwan-release/pgpass psql -h 127.0.0.1 -p 15432 -U liwan_control -d liwan_control -v ON_ERROR_STOP=1 -f /root/liwan_control.pre-stack.dump`. Restore the state: `rm -f <state>/run.json <state>/halted.json <state>/failed.json /var/lib/liwan-release/maintenance/active`, `mv <state>/pre-cutover/served.json <state>/`, `cp -p <state>/release.env.pre-stack <state>/release.env`; restore the files: `cp -p <LIWAN_SHARED_ODOO_CONFIG>.pre-stack <LIWAN_SHARED_ODOO_CONFIG>` and `cp -p <LIWAN_SHARED_COMPOSE_FILE>.pre-stack <LIWAN_SHARED_COMPOSE_FILE>` (the old `composeFile` of `shared-runtime.json`); put the folder back, `mv /opt/liwan/pre-stack-<c> /opt/liwan/releases/<c>` and `ln -sfn /opt/liwan/releases/<c> /opt/liwan/current`; start the old stack with its five files and `up -d --wait` (same files and env files as step 5); the old stack starts on empty volumes (step 5 deleted them), so when the upgrade phase ran or you need the data, restore the dumps of step 3 into it before the worker starts; start the control project again with the old release's own control files, `docker compose -p liwan-control -f /opt/liwan/releases/<c>/deploy/control-plane/compose.production.yml -f /opt/liwan/releases/<c>/deploy/control-plane/compose.host-link.yml --env-file <shared.env> --env-file <state>/release.env up -d --wait --no-build --pull never control-api vendor-console` (the restored `release.env` puts the old `LIWAN_IMAGE_TAG` back, so this starts the old images and pulls nothing); then `systemctl start liwan-shared-worker.service`. After the first deploy has committed, the normal rollback applies instead.

## Config

`/etc/liwan-release/<environment>.env`, mode `0600`, owned by the running user. Required keys: `LIWAN_RELEASE_PROJECT`,
`LIWAN_SHARED_ENV_FILE`, `LIWAN_RELEASE_PG_DUMP`, `LIWAN_RELEASE_PG_HOST`,
`LIWAN_RELEASE_CONTROL_PG_HOST`, `LIWAN_RELEASE_ODOO_DATA_DIR`,
`LIWAN_RELEASE_DISK_PATH` (a path on the filesystem that holds the database volume and the filestores) and
`LIWAN_BACKUP_PASSPHRASE_FILE`. A store is also required, in one of two forms: `LIWAN_RELEASE_BACKUP_STORE_ROOT`, or the five
`LIWAN_BACKUP_S3_*` keys. Once a tenant exists on the host, the absolute `LIWAN_TENANT_REGISTRY_PATH`
(`<LIWAN_TENANT_REGISTRY_DIR>/registry.json`, where `LIWAN_TENANT_REGISTRY_DIR` is the shared env file's key of that name) is
required too: the tenant capture reads the database and filestore binding from it. Other keys in the file reach the backup
pipeline through its environment.

The proof keys are three in this file — `LIWAN_RELEASE_REQUIRE_PROOF_URL`, `LIWAN_RELEASE_PROOF_PUBLIC_KEY` and
`LIWAN_RELEASE_PROOF_KEY_FILE` — because they configure the release command and no stack service. `LIWAN_RELEASE_PROOF_DIR`
is the fourth and the only one the shared env file also carries (`deploy/environments/*.env.example` lists it alone): the
proxy mounts that directory, so the two files must name the same path.
The two verifying keys — `LIWAN_RELEASE_REQUIRE_PROOF_URL` (the HTTPS proof base URL ending in `/_liwan/release-proof/`)
and `LIWAN_RELEASE_PROOF_PUBLIC_KEY` (one or more pinned public key files, comma separated for the rotation window, each a
regular file that group and others cannot write, `0644` root by convention) — are required on an environment with
`LIWAN_RELEASE_TAG_POLICY=explicit` and are a pair wherever they are set. A URL that is not HTTPS, one of the pair alone,
or the pair missing on an `explicit` environment, is `RESULT: refused invalid_config`: no image is pulled and nothing
stops. An environment with `highest` may leave both unset: it then verifies nothing and logs one line on every release
saying so.
The signing side is `LIWAN_RELEASE_PROOF_KEY_FILE` (the Ed25519 private key, mode `0600`, root) with
`LIWAN_RELEASE_PROOF_DIR` (the directory the edge serves); bring-up generates the key and its `.pub` beside it once and
never replaces them (row A4.7a). The directory is also the proxy's read-only mount, so the shared env file must name the
same path: the release writes `<LIWAN_RELEASE_PROOF_DIR>/<commit>.json` and the edge serves only that directory. A
signing config whose key is set and whose directory is absent is `RESULT: refused proof_dir_missing` in `prepare`, before
anything stops, and a signature that fails at the last step is `RESULT: incomplete <commit> release_proof_failed`. The
tests of the signer, the transport and every accepted outcome are in `deploy/release/test_proof.py`.

The first deploy of a host skips the backup, so a host can pass its first release and fail its second on any of the items
below. Each one ends the run with `RESULT: rolled back backup_failed`; the job log carries the symptom line.

| Item | Rule | Symptom in the job log |
| --- | --- | --- |
| `LIWAN_BACKUP_PASSPHRASE_FILE` | an absolute path to a file of mode `0600` or `0400` holding one line of 16 to 1022 bytes, for example the output of `openssl rand -hex 32`. It is the only key of these backups: keep a copy off the host. The rule is owned by [control-plane-backup-restore.md](../../docs/operations/control-plane-backup-restore.md) | `backup_pipeline: LIWAN_BACKUP_PASSPHRASE_FILE must name the passphrase file` (a wrong mode or length is refused with its own message) |
| `LIWAN_TENANT_REGISTRY_PATH` | the absolute path of the tenant registry file, `<LIWAN_TENANT_REGISTRY_DIR>/registry.json`. Required once a tenant exists; without it, or with a relative path, the tenant capture cannot name the database and filestore | `backup_pipeline: LIWAN_TENANT_REGISTRY_PATH must be an absolute tenant registry path` |
| store | `LIWAN_RELEASE_BACKUP_STORE_ROOT`: a directory path, created if absent; the release passes it as `--store-root` and the encrypted copy stays on the host's filesystem. Without it the pipeline uses a bucket and reads `LIWAN_BACKUP_S3_ENDPOINT`, `LIWAN_BACKUP_S3_REGION`, `LIWAN_BACKUP_S3_BUCKET`, `LIWAN_BACKUP_S3_ACCESS_KEY` and `LIWAN_BACKUP_S3_SECRET_KEY` from this file. The store root is optional only when all five S3 keys are present | `backup_pipeline: LIWAN_BACKUP_S3_ENDPOINT is required` (the first missing S3 key is named) |
| `LIWAN_RELEASE_PG_DUMP` | the real binary, for example `/usr/lib/postgresql/16/bin/pg_dump`, not `/usr/bin/pg_dump`. On Debian and Ubuntu the latter is a symlink to `/usr/share/postgresql-common/pg_wrapper`; the release resolves the symlink and so runs the wrapper under its own name, which exits 1. Check with `readlink -f` that the configured path is its own target | the tenant capture runs first when tenants exist, through `deploy/backup.py`: it exits 2, and the pipeline reports only `backup_pipeline: deploy/backup.py failed with exit code 2`. The control-plane capture runs `pg_dump` itself and reports only `backup_pipeline: pg_dump failed with exit code 1`. Both captures run their child with captured output and discard it, so neither `deploy/backup.py`'s `pg_dump failed; no success manifest written` nor `pg_dump`'s own stderr reaches the job log |

After a failed run the same commit is answered `nothing to do: <commit> failed before (...)` until `release.py rollback` clears
`failed.json` (see Result and exit code and State); then run the job again.

Alert channels are read from the same file. One complete channel is `LIWAN_ALERT_SMTP_HOST`, `LIWAN_ALERT_SMTP_FROM` and
`LIWAN_ALERT_SMTP_TO` (optional `LIWAN_ALERT_SMTP_PORT`, `_USER`, `_PASSWORD`, `_STARTTLS`), or `LIWAN_ALERT_TELEGRAM_BOT_TOKEN`
with `LIWAN_ALERT_TELEGRAM_CHAT_ID`. With none, `deploy/alerts.py` exits 2 and the alert is lost; the release logs the reason.

The path comes from `LIWAN_SHARED_COMPOSE_FILE` in the shared env file (the same key `init-host.sh` reads for the `composeFile` of the
worker's `shared-runtime.json`); it is not a release config key. Before anything stops (the `verified` phase), the run refuses with
`RESULT: refused invalid_shared_env` when the key is missing or not an absolute path, when its directory does not exist or is not
writable, or when the shared env file is owned by root and unreadable by group and others (the effect account, which reads the
rendered copy through the `docker` group, could never read it). At each activation, after `release.env` is written and before any service or the worker starts, the run renders the
shared stack (the one stack definition `deploy/stack/compose.yml` of the candidate, every profile) to that path with `docker compose config --format json`, through
a temporary file and an atomic replace. The file holds the shared env file's secrets, so it takes that file's owner, group and
mode. A rollback renders it again for the restored release, so the worker and the running stack always describe the same release.
A failed render fails the run (`shared_compose_render_failed`) and the usual rollback applies. In the rollback the previous
release's services start first and the maintenance marker goes; only then is the file rendered and the worker started, so a failed
render there halts the run (exit 5) with the previous release serving and the worker stopped.

Database access for the backup: the tenant `db` is published on `127.0.0.1` by the stack's `LIWAN_STACK_DB_HOST_LINK=true`
block (`deploy/stack/compose.yml`), and the control-plane database by `deploy/control-plane/compose.host-link.yml`. The ports are
read from the shared env file, not the release config: `LIWAN_DB_HOST_PORT` (default `15433`) and `LIWAN_CONTROL_DB_HOST_PORT`
(default `15432`), the same keys the stack interpolates. Set

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
inside a tenant database is the `pg_dump` of the capture. The release checks this with a single SQL assertion run as `postgres` (`runtime_role_assertion_sql`), in the prepare
step when a release is already served, before the first image pull and the first admin size query (`RESULT: refused runtime_role_rejected`, nothing stopped
and the served release untouched; the candidate is recorded in `failed.json`, so the schedule alerts once per candidate and `rollback` clears it), again at the capture step with the tenant
databases of the stopped worker, and in the start step before any application starts (the run rolls back). A volume that still has a privileged `odoo` or no
`postgres` role fails both checks. The refusal is recorded (`failed.json`) only when the output names the role problem (a rule of `RUNTIME_ROLE_RULES`, or
`role "postgres" does not exist` / a failed authentication of `postgres`); any other failure of that SQL (a `db` container that is restarting, a timeout) is the
ordinary `runtime_role_check_failed`, rolled back or retried by the next run, and never persisted.

The release does not convert such a volume: the cutover of an existing host is an operator step (bring-up guide, A4.4a) and MUST be done BEFORE the first release that carries
this change. That first release is driven by the release command that is already served (the job runs `/opt/liwan/current/deploy/release/release.py`), which has no
assertion, so `runtime_role_rejected` protects only releases that already run the new code. What protects an operator who forgot is different: the `db` health check in
both compose files requires the `postgres` role to log in (`psql -U postgres -d postgres`), so on an old volume (bootstrap role `odoo`) `db` never turns healthy,
`up --wait` fails and even the older command rolls back; and `ensure_secrets.sh` does not generate `DB_ADMIN_PASSWORD`, so a host without it is refused at the render check.

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
