# Release command

`release.py` applies one commit to one LiwanOS server. An Openship job runs it; nothing else starts it (no timer, no
polling). The same file runs on staging and production.

```sh
python3 -B /opt/liwan/current/deploy/release/release.py run      --environment staging
python3 -B /opt/liwan/current/deploy/release/release.py status   --environment staging   # exit 3 when halted
python3 -B /opt/liwan/current/deploy/release/release.py rollback --environment staging
```

**Status: nothing here has run on a real server yet.** The tests use fake docker, git and psql commands
(`python3 -B -m unittest discover -s deploy/release -t . -p 'test_*.py'`). The first real run happens during the
staging bring-up.

## Candidate and release document

| Environment | Candidate commit |
| --- | --- |
| `staging` | the head of Forgejo `main` |
| `production` | the commit of the highest `release/19.0.X.Y.Z` tag (compared by version, not by text) |

The candidate is read with `git ls-remote https://git.liwanos.com/liwanos/liwan.git`. The command then fetches `main`
and the `release/*` tags into a bare repository in the state directory (`repo.git`) for ancestry checks and
`git archive`.

The release document is the image `git.liwanos.com/liwanos/liwan-release:<full commit sha>`, built `FROM scratch` with
one file `/release.json`. The command pulls it, copies the file out with `docker create` and `docker cp`, and removes
the container and the image. It accepts the document only when its `commit`, its `release.liwanCommit` and every image
reference (`git.liwanos.com/liwanos/<name>@sha256:...`) match, and `release` passes `deploy/releases/manifest.py`
validation. Each image is pulled by the digest of the host's architecture from the `platforms` map. A document
without that architecture is refused. Production also refuses a tag whose commit is not part of Forgejo `main`, a document without `linux/arm64` digests, and refuses
a candidate that does not contain the served commit or whose release version is not above the served one.

## Credential

The job command loads two environment variables from the root-only file `/etc/liwan-release/forgejo-read` (`set -a; . /etc/liwan-release/forgejo-read; set +a; python3 -B ...`); that file is the single source, not the job's secret store:

| Variable | Meaning |
| --- | --- |
| `LIWAN_FORGEJO_READ_USER` | the Forgejo user of the read-only token |
| `LIWAN_FORGEJO_READ_TOKEN` | a Forgejo token that can read the repository and the package registry, nothing more |

The token reaches git through the environment of a credential helper (the command line holds only the variable
names) and reaches `docker login` on stdin, into a docker config directory inside the private state directory. It is
never in an argument, a URL, a state file or the release document, and the job log replaces any occurrence with
`***`, as it does every value of the config file and the shared env file whose key contains PASSWORD, SECRET, TOKEN, KEY, PASS, DSN, URL or URI (surrounding quotes dropped; a URL value also hides its password). A missing variable ends the run with `RESULT: refused missing_credential` before any command runs.

## What a run does

Each phase is written to `run.json` before it acts, so a killed run resumes from real state.

1. Resolve the candidate, fetch it, check it is not older, pull and check the release document.
2. Prepare: extract the commit to `/opt/liwan/releases/<commit>`, install the shared worker's node dependencies
   (`npm ci --ignore-scripts --workspace apps/control-plane`), pull every image by digest and tag it with its local
   name from `deploy/image_pins.py --print-builds` (the document must list exactly those). Then the disk check:
   the run is refused when the free space on `LIWAN_RELEASE_DISK_PATH` is below 1.5 times the size of one snapshot of
   every tenant database, the control-plane database and every filestore (the snapshots all exist at once).
3. Quiesce: stop the shared worker, read the tenant list with `deploy/shared/backup-binding.mjs --list`.
4. Capture: an encrypted `backup_pipeline.py` backup of every tenant and the control plane.
5. Maintenance: create `<state root>/maintenance/active` (Caddy shows its maintenance page only while it exists), stop
   `guard`, `web`, `ai`, `odoo` and `control-api`.
6. Snapshot every database (`CREATE DATABASE ... TEMPLATE`) and hard-link every filestore.
7. Upgrade every tenant database (`tools/upgrade_log_guard.py` on its log, then `deploy/odoo/upgrade_smoke.py`), then
   migrate the control plane.
8. Start `proxy`, `odoo`, `web`, `ai` and `control-api`, wait for health, then start `guard` (the commit point). The
   phase `opened` is written, then the maintenance marker is removed. From `opened` on a failure never rolls back
   (customers may have written to the new release); the next run resumes.
9. Record `served.json`, start the shared worker, drop the snapshots, then prune: images and release folders of every
   release except the served one and the previous one are removed, with their `runs/<commit>/` folders.

A failure from step 5 onward rolls back: every snapshot and filestore copy is swapped back, owners, grants and
isolation are restored, the previous release starts, and the old worker starts. A failure before step 6 changes
nothing but the worker, which is restarted. The first deploy has no previous release, so it skips the backup, the
stop and the snapshots, and a failure leaves the environment stopped in maintenance and halted.

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
`LIWAN_SHARED_ENV_FILE`, `LIWAN_RELEASE_PG_DUMP`, `LIWAN_RELEASE_PG_HOST`, `LIWAN_RELEASE_PG_PORT`,
`LIWAN_RELEASE_CONTROL_PG_HOST`, `LIWAN_RELEASE_CONTROL_PG_PORT`, `LIWAN_RELEASE_ODOO_DATA_DIR`,
`LIWAN_RELEASE_DISK_PATH` (a path on the filesystem that holds the database volume and the filestores). Optional:
`LIWAN_RELEASE_BACKUP_STORE_ROOT`. Other keys in the file reach the backup pipeline through its environment. The
command runs from `/opt/liwan/current` (the first deploy needs a bootstrap checkout there).

## Halted

A halt record means the service may be in maintenance (the marker stays). Read `status` and the job log, fix the cause,
then run `rollback`: it clears the halt and failed-candidate records and finishes the rollback of the unfinished run. It refuses a run that
already committed. A run that stopped before the stop (phases `verified`, `quiescing`, `captured`) holds no snapshot and may have no
tenant inventory, so `rollback` only cancels it: no maintenance, no stop, the worker is restarted if it was stopped, and `run.json` is cleared. After a rolled-back failure there is no halt: the next job run tries the then-current candidate again.
Never delete `run.json` by hand.
