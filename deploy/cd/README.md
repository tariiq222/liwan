# Host deploy script

`deploy.py` updates one LiwanOS server from the newest signed release document of its channel. The same file runs on
staging and production; only `/etc/liwan-deploy/<environment>.env` differs.

**Status: nothing here has run on a real server yet.** The tests use a fake command runner (`python3 -B -m unittest
discover -s deploy/cd -t . -p 'test_*.py'`). The first real run happens during the staging bring-up.

## What a run does

| Channel (`LIWAN_DEPLOY_CHANNEL`) | Candidate |
| --- | --- |
| `main` (staging) | the head of `main`, only if its signed document exists; a missing document ends the run quietly |
| `release` (production) | the highest `release/19.0.X.Y.Z` tag |

Steps, each phase written to `run.json` before it acts:

1. Verify: cosign attestation of the channel's type, signer identity and issuer, document commit equals the candidate,
   every image `@sha256`. A candidate that is not newer than the served one is refused.
2. Pull the images by digest.
3. Capture: an encrypted `backup_pipeline.py` backup of every tenant database (listed with
   `deploy/shared/backup-binding.mjs --list`) and of the control plane. A failure aborts before anything stops.
4. Maintenance: create `/var/lib/liwan-deploy/maintenance/active` (Caddy shows the maintenance page only while it
   exists), then stop `guard`, `web`, `ai`, `odoo`, `control-api` and the shared worker. Caddy and PostgreSQL stay up, so
   visitors get the Arabic 503 with `Retry-After`.
5. Snapshot every database (`ALLOW_CONNECTIONS false`, end its sessions, `CREATE DATABASE ... TEMPLATE`, reopen) and
   hard-link the filestores. A database counts as snapshotted in `run.json` only after the copy succeeded.
6. Upgrade every tenant database and the control plane, then check the upgrade log and run the smoke check.
7. Start, wait for health, start `guard` (the commit point), remove the maintenance marker, record
   `served.json`, delete the snapshots.

Rollback (health or upgrade failure): swap the snapshots and filestores back for all tenants, restore owners and grants,
restart the previous release, send `deploy_failed`, and halt. If the rollback itself fails the service stays in
maintenance (the marker stays) and `deploy_rollback_failed` is sent. The encrypted backup from step 3 is the last resort.

### First deploy

With no `served.json` there is nothing to roll back to. The run skips the backup, the stop and the snapshots, and
refuses (`bootstrap_with_tenants`) if the tenant registry already lists tenants. If the first release fails, its
services are stopped, the maintenance marker stays, `deploy_failed` is sent and the environment is halted.

## State: `/var/lib/liwan-deploy/<environment>/`

| File | Meaning |
| --- | --- |
| `lock` | one run at a time |
| `served.json` | the release currently served |
| `release.env` | `LIWAN_IMAGE_TAG` and `ODOO_COMMIT` of that release, read by Compose |
| `run.json` | the unfinished run and its phase; a killed run resumes from it |
| `halted.json` | set after a failed deploy; no run proceeds while it exists |
| `runs/<commit>/` | backup work files and upgrade logs |

## Commands

```sh
python3 -B /opt/liwan/current/deploy/cd/deploy.py run    --environment staging
python3 -B /opt/liwan/current/deploy/cd/deploy.py status --environment staging   # exit 3 when halted
python3 -B /opt/liwan/current/deploy/cd/deploy.py clear  --environment staging
```

## Install on a host

```sh
install -m 0644 deploy/cd/units/liwan-deploy@.service deploy/cd/units/liwan-deploy@.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now liwan-deploy@staging.timer      # or liwan-deploy@production.timer
```

The config file `/etc/liwan-deploy/<environment>.env` is mode `0600`, owned by root, and holds the keys listed in
`CONFIG_KEYS` in `deploy.py`. No credential goes into command arguments or logs.

## Halted

A halted environment is serving the previous release (or is in maintenance if `deploy_rollback_failed` was sent). The
timer keeps ticking but each run exits 3 without touching anything. Read `status`, the journal
(`journalctl -u liwan-deploy@<environment>`) and `runs/<commit>/`, fix the cause, then run `clear`. After a rolled-back failure the
next tick retries the same commit (it is still the newest candidate); after a failed rollback it resumes the rollback. Never delete `run.json` by hand.
