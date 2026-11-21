# Tooling server (Contabo)

The Contabo host (`158.220.75.44`) runs Openship (deploy control), Sentry and the development environment. Source,
CI, image build and release live on GitHub only (owner decision 2026-11-21, see
[integration-rules.md](../agents/integration-rules.md#from-task-branch-to-each-environment-owner-decision-2026-11-21)).
This page states what is installed on the host and what is still to be removed from it; it is not a release or
deployment approval. The release command is in [`deploy/release/README.md`](../../deploy/release/README.md); this page
does not repeat it.

## What runs here and why

| Part | Why it is on this host |
| --- | --- |
| Openship | Deploy control. It holds the job `liwan-development-release` and its hook, which the GitHub `publish` workflow calls after a `main` build. It also holds the staging and production jobs. |
| Sentry | Error tracking, with its own notes. |
| Development environment | The LiwanOS stack (amd64) that follows `main`, behind the Openship edge. Details below and in [environment-bringup.md](environment-bringup.md) section A. |

No self-hosted GitHub runner is registered for the repository while it is public: a pull request from a fork could run
code on it. Builds run on GitHub-hosted runners. No production credential exists on this host's runners or on GitHub.

## Development environment on this host

| Item | Fact |
| --- | --- |
| Edge route | Openship 1.0.1 writes a vhost only for a project with an active deployment. The tracked project `dev.liwanos.com` holds the domains and certificates and is never deployed (a deploy would run `npm start` on port 18080). The route comes from two files, `/var/lib/openship/edge/sites-enabled/dev-liwanos-com.route.json` and `-dev-liwanos-com.route.json`; steps in [environment-bringup.md](environment-bringup.md) A2.3a. |
| Docker group | `liwan-worker` is the only member of the `docker` group. |
| Database ports | The tenant `db` is published on loopback `15433` and the control database on `15432`. The `db` bridge `liwan-dbhost` (fixed name) has two host rules, `iptables -I DOCKER-USER -i liwan-dbhost -m conntrack --ctstate NEW -j DROP` and `iptables -I INPUT -i liwan-dbhost -m conntrack --ctstate NEW -j DROP`, so the database container cannot start connections out or to host services (the compose file also turns masquerade off on that bridge, so replies from outside never reach it; the rules stay required for the host side); they do not survive a reboot unless a boot unit loads them (check and persistence: [environment-bringup.md](environment-bringup.md) A3.6). Accepted risk: any local process on the host can still reach the loopback port, with the database password as the only barrier. The control database overlay has the same shape and no fixed bridge name yet. |
| Release credentials | The release command reads `/etc/liwan-release/github-read` (root, 0600), see [environment-bringup.md](environment-bringup.md) A5. |

## Removed on 2026-11-21: the old self-hosted git service

On the owner's word «نعم احذفه», after a check that `main` and the six release tags matched GitHub and that it held no
issues or pull requests, the old self-hosted git service of the earlier plan was removed from this host. Removed:

- Its Openship project and data volume: the three repositories, the ten image packages, run logs, accounts and tokens.
- The three runners with their two system users and home directories.
- The sync, registry-retention, runner-prune, runner-netguard and netguard-watch units with their scripts, the sync
  and retention system users, and the token files of those services.
- The `git` DNS record of `liwanos.com`.

Not recoverable: the two small repositories that existed only there (a hand-installed copy of the publish workflow
and a CI trial), the run logs and the images built there. The old read-credential file for the release job is no
longer referenced: the job `liwan-development-release` now sources `/etc/liwan-release/github-read`, which does not
exist yet (see the pending list).

The Oracle hosts `liwanos-prod` and `liwanos-staging` are registered in Openship, each with its own key. SSH to them is
allowed only from the tooling server address.

## Pending

None of these is done:

- The GitHub secrets for the two hooks (`LIWAN_DEVELOPMENT_HOOK_URL`, `LIWAN_DEVELOPMENT_HOOK_TOKEN`,
  `LIWAN_STAGING_HOOK_URL`, `LIWAN_STAGING_HOOK_TOKEN`).
- The machine GitHub account and one read token per environment, written to `/etc/liwan-release/github-read`.
- The ten private GHCR packages and the `release/**` tag ruleset ([environment-bringup.md](environment-bringup.md)
  A0.1 and A0.2).
- Simplify the disk guard (`liwan-disk-guard`): it still carries logic to stop the removed runners. It is harmless.

## Check the host

```sh
systemctl list-timers --all     # expected: the host's own timers only, none of the removed units
docker ps --format '{{.Names}}'
```
