# Tooling server (Contabo)

The Contabo host (`158.220.75.44`) runs Openship (deploy control), Forgejo (`git.liwanos.com`), Sentry and the CI and
publish runners. This page describes the host configuration that the CI and release files depend on. It states what is
installed and where; it is not a release or deployment approval. The workflow and release files live in
[`deploy/ci/publish-zone/README.md`](../../deploy/ci/publish-zone/README.md) and
[`deploy/release/README.md`](../../deploy/release/README.md); this page does not repeat them.

## What runs here and why

| Part | Why it is on this host |
| --- | --- |
| Forgejo, organization `liwanos` | Holds the private source copy, the container registry and the release documents (`liwan-release:<commit>`) that servers pull. The trust anchor of the release path. |
| One-way sync (`liwan-sync`) | Copies GitHub `main` and `release/*` tags to Forgejo so servers never read GitHub. |
| Two runner zones | Build and test (CI zone) and publish images (publish zone), kept apart so the registry write token is never in a job that runs pull-request code. |
| Network guard, disk guard, prune and retention timers | Keep the host from growing or stalling (limits below). |
| Openship, Sentry | Not covered here; Openship starts staging and production releases, Sentry has its own notes. |

## Forgejo

| Item | Setting |
| --- | --- |
| `liwanos/liwan` (private) | One-way copy of GitHub `main` and `release/*` tags. Branch `main` and tags `release/*` are protected: only the bot `liwan-sync` may push, the merge whitelist is empty, protection applies to admins. Actions are off until `.forgejo/workflows/` is on `main` (see below). |
| `liwanos/liwan-publish` (private) | Admin-only (team permissions: Owners only). Holds the publish workflow and the registry write secret. Actions on. |
| `app.ini` `[actions]` | `ARTIFACT_RETENTION_DAYS = 14`, `LOG_RETENTION_DAYS = 14`. |

Forgejo 17 has no repository-level secrets API. Repository Actions secrets are typed in the web UI.

## One-way sync

`liwan-sync.timer` runs `liwan-sync.service` every 2 minutes as the system user `liwan-sync`
(`/usr/local/lib/liwan-sync/sync.sh`). It fetches GitHub `+refs/heads/main` and `+refs/tags/release/*` into the bare
repository `/var/lib/liwan-sync/liwan.git`, then pushes both to Forgejo without force over
`http://127.0.0.1:20000/liwanos/liwan.git` (loopback, because the public edge refuses large pushes with HTTP 413).

- Failure alert: a diverged Forgejo ref makes the push fail, the unit shows failed and `OnFailure` raises
  `liwan-alert@liwan-sync.service` (see Alerts). A rewritten or deleted `release/*` tag on GitHub fails this way too.
- Tags deleted on GitHub are not deleted on Forgejo; the sync never prunes.
- The unit is hardened: `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`, `PrivateTmp=yes`,
  `ReadWritePaths=/var/lib/liwan-sync`.

## Runner zones

Two zones, split by repository and by Unix user. Each user has its own rootless Docker daemon, so a job in one zone
cannot see the other zone's containers, socket or files.

| | Publish zone | CI zone |
| --- | --- | --- |
| Registered at (repository scope) | `liwanos/liwan-publish` | `liwanos/liwan` |
| Unix user, uid | `forgejo-runner`, 1001 | `forgejo-ci`, 1002 |
| Runner, label | `publish-amd64`, `publish-amd64:docker://node:22-bookworm` | `ci-amd64`, `ci-amd64:docker://node:22-bookworm` |
| Capacity | 1 | 2 |
| Slice limits (`user-<uid>.slice`) | 3 CPU, 10 GB memory, 4096 tasks | 5 CPU, 14 GB memory, 8192 tasks |
| Job containers | `privileged: false`, `docker_host: "-"` (no socket in jobs), `valid_volumes` allows only `/run/user/1001/docker.sock`, which the build job mounts itself | `privileged: true` (root only inside uid 1002's user namespace), `valid_volumes: []`; a job that needs Docker starts its own daemon |
| Actions secrets | `LIWAN_REGISTRY_USER`, `LIWAN_REGISTRY_TOKEN`, `LIWAN_SOURCE_READ_TOKEN`, `LIWAN_STAGING_HOOK_URL`, `LIWAN_STAGING_HOOK_TOKEN` | `LIWAN_PUBLISH_TRIGGER_TOKEN` only |

Why the split: the registry write credential exists only as a secret of `liwan-publish`, and only a runner that no CI
job can reach runs that repository. A job asking for the other zone's label stays `waiting` and never starts. The
automatic job token of a CI job cannot write packages or create `release/*` tags (HTTP 401 and 422 when tested). Slice
limits are read from the cgroup (`cpu.max`, `memory.max`, `pids.max`); a 60 second 16-loop burn held the zone at its CPU
cap while Openship and Forgejo kept answering in under 2 seconds.

Notes:

- Both runners are systemd user units (`~/.config/systemd/user/`): `forgejo-runner.service` for uid 1001,
  `forgejo-runner@<dir>.service` for uid 1002 (config in `~forgejo-ci/<dir>/config.yml`). Binary
  `/usr/local/bin/forgejo-runner` was installed after checking its sha256 and GPG signature. Both users have linger on.
- Docker inside a CI job: use upstream static `docker-27.x` binaries and the moby `hack/dind` wrapper
  (`dind dockerd --storage-driver=vfs`, `iptables` installed). The distro `docker.io` package fails when nested
  (`deploy/ci/lib/start_dockerd.sh` does this).
- AppArmor: Ubuntu 24.04 keeps `kernel.apparmor_restrict_unprivileged_userns=1`; the packaged
  `/etc/apparmor.d/rootlesskit` profile is enough. No local profile is added.
- Trigger: bot `liwan-publish-trigger` (team `publish-trigger`: Actions write and Code read on `liwan-publish` only).
  It can dispatch the publish workflow and nothing else (no push, no tag, no other repository).

### Register a runner

Registration is at repository scope. Generate the token inside the Forgejo container and pass it straight to the
runner without printing it:

```sh
forgejo actions generate-runner-token --scope <owner>/<repo>   # value piped into forgejo-runner register --token
```

If a token is ever printed or pasted, rotate it at once: set it inactive in the Forgejo database
(`action_runner_token`) or reset it in the repository's Actions settings, then register again.

### Temporary registration `liwan-ci-trial`

While the CI port (P5) is under way, a second CI-zone daemon `ci-amd64-trial` (user `forgejo-ci`, directory
`/home/forgejo-ci/runner-trial`) is registered on the throwaway repository `liwanos/liwan-ci-trial`, with labels
`ci-amd64` and, temporarily, `contabo-amd64`, so workflows that still say `contabo-amd64` are picked up. Remove it after
P5 is accepted:

1. As `forgejo-ci`: `systemctl --user disable --now forgejo-runner@runner-trial`.
2. Delete `/home/forgejo-ci/runner-trial`.
3. Delete the runner through the API (`DELETE /api/v1/repos/liwanos/liwan-ci-trial/actions/runners/<id>`).

## Network guard

`liwan-runner-netguard.service` loads `/etc/liwan-runner-netguard.nft` (table `inet liwan_runner_guard`) for uid 1001
and 1002, which also covers containers nested in a job.

- Allowed: DNS only to `127.0.0.53` and `127.0.0.54`; ports 80 and 443 only to the host's own public address
  (the edge, so `git.liwanos.com` works); the rest of the internet is open.
- Dropped: every other local address, loopback, private, link-local (including the cloud metadata address), CGNAT,
  multicast, reserved and IPv4-mapped IPv6 range, so a job cannot reach SSH, Forgejo's port, Openship or the databases.
- Watchdog: the service writes `/run/liwan-runner-guard.ok`. Both runner units require that file (`ExecStartPre`).
  `liwan-netguard-watch.timer` (every minute) stops both runners and their job containers, removes the marker and
  restarts the guard when the table is missing, then lets the runners start again once it is back. A runner with the
  marker missing stays "activating" and runs nothing.

## Limits (D22)

The host must not grow or stall. Each limit is enforced by a unit and was tested.

| Limit | How it is enforced |
| --- | --- |
| Runner CPU and memory | The slices in the zone table (publish 3 CPU and 10 GB, CI 5 CPU and 14 GB, 8 CPU and 24 GB in all). Capacity 1 and 2 jobs. |
| Actions logs and artifacts | Expire after 14 days (`app.ini` `[actions]`). |
| Registry retention | `liwan-registry-retention.timer`, daily 03:30, as user `liwan-retention`. Per package it keeps the 5 newest existing versions named by a full 40-character commit SHA (optional `-suffix`) that is in `main` history, the versions of every `release/*` tag commit, names starting `release-`, and `sha256:` digest versions; it deletes every other tagged version. It refuses to run when the bare repository's `main` differs from Forgejo's, and skips a package whose keep set is empty. `retain.sh --dry-run` prints the plan. |
| Docker prune | `liwan-runner-prune.timer`, daily 04:15, as root; prunes each zone's rootless daemon as that zone's user. |
| Disk guard | `liwan-disk-guard.timer`, every 5 minutes. At 70% of `/` the unit fails (alert). At 85% it stops every runner of both zones and kills their job containers, so publishing stops. Runners start again below 80%. State in `/var/lib/liwan-disk-guard/state`, journal tag `liwan-disk-guard`. |
| Manual stop | `/var/lib/liwan-disk-guard/manual-stop` blocks every restart by the guard and the watchdog. Do not touch the file by hand; use `liwan-runners`. |

`liwan-runners stop|start|status` (`/usr/local/sbin/liwan-runners`) stops or starts the runners of both zones. `stop` sets
the manual-stop marker, `start` clears it.

### Alerts

Every timer unit above (sync, disk guard, registry retention, prune, netguard watch) has `OnFailure=liwan-alert@%n.service`.
That unit logs with tag `liwan-alert`, writes `/var/lib/liwan-alert/last` and appends `/var/lib/liwan-alert/history`.
Delivery of the alert to a person (notification or mail) is part of P6 and is not wired yet; until then read the journal
or the `last` file.

## Tokens and secrets

Values are never in this repository. Paths only:

| Token | Where it lives | Scope | Rotate |
| --- | --- | --- | --- |
| Sync push token | `/etc/liwan-sync/forgejo-token` (0400, `liwan-sync`) | bot `liwan-sync`, write:repository | Create a new token for the bot in Forgejo, write it to the file, delete the old one. |
| Optional GitHub read token | `/etc/liwan-sync/github-read-token` | read on the GitHub repository; used for the fetch when the file is non-empty | Replace the file content. |
| Retention write token | `/etc/liwan-registry-retention/forgejo-token` (0400, `liwan-retention`) | write:package | As above, for bot `liwan-retention`. |
| Retention read token | `/etc/liwan-registry-retention/forgejo-read-token` (0400, `liwan-retention`) | read:repository on `liwanos/liwan` | As above. |
| Publish trigger token | `/etc/liwan-publish-trigger/token` (0400, root) | bot `liwan-publish-trigger` | Create a new token for the bot, write the file, then paste the new value into the `liwanos/liwan` secret `LIWAN_PUBLISH_TRIGGER_TOKEN` and delete the old token. |
| Runner registrations | `/home/forgejo-runner/runner/.runner`, `/home/forgejo-ci/runner-ci/.runner`, `/home/forgejo-ci/runner-trial/.runner` (0600, owner) | one repository each | Delete the runner in Forgejo, register again. |
| Registry write, source read, staging hook | Actions secrets of `liwanos/liwan-publish` only | see below | The owner creates a new token, types it into the secret and deletes the old token. |
| Read-only pull tokens for this host and `liwanos-prod` | Created by the owner; the release command reads them from its job secret store (`deploy/release/README.md`) | read on the repository and the package registry | The owner. |

Actions secrets (names only). The owner types every value in the Forgejo web UI; nobody else holds them and none is
created from the host:

| Repository | Secrets |
| --- | --- |
| `liwanos/liwan-publish` | `LIWAN_REGISTRY_USER`, `LIWAN_REGISTRY_TOKEN` (write:package), `LIWAN_SOURCE_READ_TOKEN` (read on `liwanos/liwan`), `LIWAN_STAGING_HOOK_URL`, `LIWAN_STAGING_HOOK_TOKEN` |
| `liwanos/liwan` | `LIWAN_PUBLISH_TRIGGER_TOKEN` (contents of `/etc/liwan-publish-trigger/token`) |

## Procedures

### Enable Actions on `liwanos/liwan`

Do this only after `.forgejo/workflows/` is on GitHub `main` and the sync has copied it; otherwise Forgejo reads
`.github/workflows/`. As a Forgejo admin or repository admin, with the token read from the admin's own store (not from
this host's files):

```sh
curl -X PATCH -H "Authorization: token $FORGEJO_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"has_actions":true}' https://git.liwanos.com/api/v1/repos/liwanos/liwan
```

Then type `LIWAN_PUBLISH_TRIGGER_TOKEN` into the repository's Actions secrets.

### Install or update the publish workflow

The workflow in `liwan-publish` is a copy; the source is `deploy/ci/publish-zone/publish.yml`. Steps are in
[`deploy/ci/publish-zone/README.md`](../../deploy/ci/publish-zone/README.md): copy the file to
`.forgejo/workflows/publish.yml` of `liwanos/liwan-publish` (admin token, from a checkout of `liwanos/liwan` at the
commit to install) and push it to its `main`. Change the file through a normal pull request first, then repeat the copy.

### Check the host

```sh
systemctl list-timers 'liwan-*'          # sync, disk guard, retention, prune, netguard watch
systemctl is-failed liwan-sync liwan-disk-guard liwan-registry-retention liwan-runner-prune
liwan-runners status
cat /var/lib/liwan-alert/last
```
