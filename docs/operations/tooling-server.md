# Tooling server (Contabo) and where Openship runs

The Contabo host (`158.220.75.44`) now runs only Sentry, the registry that serves Sentry's images and an old Openship
panel that manages Sentry only. Source, CI, image build and release live on GitHub only (owner decision 2026-11-21, see
[integration-rules.md](../agents/integration-rules.md#from-task-branch-to-each-environment-owner-decision-2026-11-21)).
LiwanOS has two server environments, staging and production, both on Oracle (arm64); the owner's machine is development.
This page states what is installed on the Contabo host and what is still to be removed from it; it is not a release or
deployment approval. The release command is in [`deploy/release/README.md`](../../deploy/release/README.md); this page
does not repeat it.

## What runs on the Contabo host

| Part | Why it is on this host |
| --- | --- |
| Sentry | Error tracking at `sentry.liwanos.com`, with its own notes. |
| Registry | Serves Sentry's images. |
| Old Openship panel | Manages Sentry only. It lost its public name and is reached by an SSH tunnel. |

The host reaches neither Oracle host: its address was removed from port 22 of both security lists and from the key
lines. No self-hosted GitHub runner is registered for the repository while it is public: a pull request from a fork
could run code on it. Builds run on GitHub-hosted runners. No production credential exists on this host or on GitHub.

## Where Openship runs

On 2026-11-21 Openship moved from this host to `liwanos-staging` (fresh install of Openship 1.0.1, compose mode,
`openship.liwanos.com`, reserved public address). Its edge sits in front of the staging stack and routes to loopback
`127.0.0.1:18080`. It holds the tracked project `staging.liwanos.com` (domains, certificates and the job hook only;
never deploy or save it), the job `liwan-staging-release`, and the server record of `liwanos-prod`. On that host its
CLI is `sudo -H openship --local ...`. The rows to install and wire it are in
[environment-bringup.md](environment-bringup.md) (section A and the production sections).

## Removed on 2026-11-21

The development environment was deleted on the owner's word: its stack, volumes, networks, images, host users, units
and firewall rules on this host, its DNS records, its Openship project and jobs, its Turnstile widget and the two
`LIWAN_DEVELOPMENT_HOOK_*` repository secrets.

The old self-hosted git service of the earlier plan was removed after a check that `main` and the six release tags
matched GitHub and that it held no issues or pull requests. Removed:

- Its Openship project and data volume: the three repositories, the ten image packages, run logs, accounts and tokens.
- The three runners with their two system users and home directories.
- The sync, registry-retention, runner-prune, runner-netguard and netguard-watch units with their scripts, the sync
  and retention system users, and the token files of those services.
- The `git` DNS record of `liwanos.com`.

Not recoverable: the two small repositories that existed only there (a hand-installed copy of the publish workflow
and a CI trial), the run logs and the images built there.

## Pending

None of these is done:

- The `git.liwanos.com` certificate leftover on this host.
- The old Cloudflare DNS token `openship-liwanos-dns01`, which only the owner can delete.
- Sentry answers 502 (since 2026-11-21, before the changes above); it is outside this task.
- The `release/**` tag ruleset ([environment-bringup.md](environment-bringup.md) A0.2). The ten private GHCR packages
  exist (A0.1).
- The staging host preparation and the first staging release ([environment-bringup.md](environment-bringup.md) section A).

## Check the host

```sh
systemctl list-timers --all     # expected: the host's own timers only
docker ps --format '{{.Names}}' # expected: Sentry, the registry, the old Openship panel, none of LiwanOS
```
