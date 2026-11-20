# Environment bring-up: staging and production

How to bring up one LiwanOS server so that a merge or a tag reaches it with no manual step. It covers the two servers in
the deployment plan: staging on the Contabo x86 host and production on the Oracle Jeddah Arm host. It states what to
create and how to see that it works; it is not a release or deployment approval, and nothing here has run on a real
host yet. No secret value belongs on this page or in the checklists: record where a value lives, never the value.

Related files: [environments/README.md](../../deploy/environments/README.md) (the env templates and every variable),
[release/README.md](../../deploy/release/README.md) (the release command), [tooling-server.md](tooling-server.md) (the
Contabo host), [control-plane-deployment.md](control-plane-deployment.md) (control plane and shared worker),
[edge-rate-limit.md](../../deploy/security/edge-rate-limit.md#shared-edge-behind-an-outer-edge) (the trusted proxy).

## How it fits together

```
client --HTTPS--> Openship edge (host network, 80/443, DNS-01 wildcard certificate)
                    --HTTP, Host unchanged, X-Forwarded-For appended--> 127.0.0.1:18080
                       Caddy `proxy` (published on loopback only, trusts the edge gateway 172.29.50.1)
                          --> guard:8080 --> web / odoo
Forgejo Actions (publish) --POST hook--> Openship job `liwan-staging-release`
                                           --> deploy/release/release.py run --environment staging
```

- Openship owns TLS and the public ports. The stack's Caddy owns rate limits and the guard hop. The release command
  owns compose: nobody runs `docker compose up` by hand next to the job.
- Staging follows the head of Forgejo `main`. Production follows the highest `release/19.0.X.Y.Z` tag and its job has
  no hook: the owner starts it.

## Fixed values

| Item | Staging (Contabo) | Production (Oracle `liwanos-prod`) |
| --- | --- | --- |
| Host address | `158.220.75.44` | recorded at P7 |
| Hostnames | `staging.liwanos.com`, `*.staging.liwanos.com` | `liwan.sa`, `*.liwan.sa` (D15) |
| Prospect host | `app.staging.liwanos.com` | `app.liwan.sa` |
| Stack publishes | `127.0.0.1:18080` (HTTP), `127.0.0.1:18443` (published, nothing listens behind it) | decided at P7 (edge or Caddy on 80/443) |
| `edge` network | `172.29.50.0/24`, gateway `172.29.50.1` | same subnet (compose pins it) |
| `LIWAN_TRUSTED_PROXIES` | `172.29.50.1/32` | empty until production sits behind an edge |
| Release env file | `/etc/liwan-release/staging.env` | `/etc/liwan-release/production.env` |
| Shared stack env file | `/srv/liwan-staging/shared.env` | `/srv/liwan/shared.env` |
| Release state | `/var/lib/liwan-release/staging/` | `/var/lib/liwan-release/production/` |
| Checkout | `/opt/liwan/current` | `/opt/liwan/current` |
| Memory ceiling of the stack | about 8 GB (D22) | the full compose ceilings, 24 GB |

## How to use the checklists

Run each command, paste the observed result in the last column and sign the row. A row without an observed result is
not done. A secret never goes in the result column: write where it was stored.

---

## A. Staging on the Contabo host

### A1. DNS

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A1.1 | Record `staging` and `*.staging` to the host, DNS only (grey cloud) | Cloudflare dashboard or API; then `dig +short staging.liwanos.com` and `dig +short probe.staging.liwanos.com` | both answer `158.220.75.44` | |
| A1.2 | The two names stay unproxied, so the edge sees the client address | `dig +short staging.liwanos.com @1.1.1.1` | the host address, not a Cloudflare one | |

### A2. Openship credential and edge route

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A2.1 | The Cloudflare DNS credential exists (`cloudflare-liwanos-dns01`, scopes Zone:Read and DNS:Edit on `liwanos.com`) | MCP `get_dns_credentials` | one enabled Cloudflare entry | |
| A2.2 | Tracked edge project on port 18080 for the apex of staging | on the host: `openship edge domains add staging.liwanos.com --port 18080` | a tracked project bound to `127.0.0.1:18080` | |
| A2.3 | The wildcard on the same project, DNS-01, automatic provider | MCP `post_domains` with `*.staging.liwanos.com`, `sslChallenge: dns-01`, then `post_domains_by_id_dns_challenge` mode `automatic` | certificate issued for the wildcard; the credential stays enabled so it renews | |
| A2.4 | The edge forwards Host unchanged, appends `X-Forwarded-For`, passes WebSocket upgrade | read the generated vhost under `/var/lib/openship/edge/sites-enabled/` for `staging-liwanos-com` | `proxy_set_header Host $host`, `X-Forwarded-For $proxy_add_x_forwarded_for`, `Upgrade $http_upgrade` | |
| A2.5 | Body size and read timeout fit uploads and reports | MCP `get_projects_by_id_edge_config` | `clientMaxBodySize` and `proxyReadTimeout` set for the project; record the values | |

### A3. Host account, directories, checkout

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A3.1 | The `liwan-worker` account in the `docker` group | `id liwan-worker` | uid and gid recorded for `LIWAN_CONTROL_UID` and `LIWAN_CONTROL_GID` | |
| A3.2 | Directories of the staging root | `ls -ld /srv/liwan-staging/{config,state,state/registry,control/config,control/state,control/private}` | owned as [control-plane-deployment.md](control-plane-deployment.md) "First deployment" step 1 says | |
| A3.3 | Maintenance and state directories | `ls -ld /var/lib/liwan-release /var/lib/liwan-release/maintenance` | exist; the release command writes `active` in `maintenance` | |
| A3.4 | Bootstrap checkout of `main` at `/opt/liwan/current` (the first deploy needs it) | `git -C /opt/liwan/current rev-parse HEAD` | the `main` commit of Forgejo | |
| A3.5 | Free disk and memory before the first start | `df -h /var/lib/docker /srv; free -g` | disk well under the D22 alert (70%); memory for an 8 GB stack on top of the host's other services | |

### A4. Env files

Fill from the templates on the host, mode 0600, outside the checkout. Generate every secret there with `openssl rand
-hex 32`; staging values are never copied from production.

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A4.1 | Shared stack env file from `deploy/environments/staging.env.example` with the real hostnames: `DOMAIN="http://staging.liwanos.com, http://*.staging.liwanos.com"`, `LIWAN_PROSPECT_HOST=app.staging.liwanos.com`, `NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN=https://app.staging.liwanos.com`, `LIWAN_RESTORE_DOMAIN=restore.staging.liwanos.com`, `LIWAN_EDGE_BIND=127.0.0.1`, ports `18080` and `18443`, `LIWAN_TRUSTED_PROXIES=172.29.50.1/32`, `LIWAN_AUTO_HTTPS=off`, `LIWAN_SITE_SCHEME=http://` | `stat -c '%a %U' /srv/liwan-staging/shared.env`; `grep -c REPLACE_WITH /srv/liwan-staging/shared.env` | `600 root` (or the worker user); count `0` | |
| A4.2 | `LIWAN_RESTORE_ALLOW` stays empty (restore hosts closed on staging) | `grep '^LIWAN_RESTORE_ALLOW=' /srv/liwan-staging/shared.env` | empty value | |
| A4.3 | Test-mode keys only: Moyasar, Authentica, Turnstile, Meta, AI provider | read the key prefixes in the control and shared env files, never print values | every key is a test or sandbox key | |
| A4.4 | Release config `/etc/liwan-release/staging.env` with `LIWAN_RELEASE_PROJECT`, `LIWAN_SHARED_ENV_FILE`, `LIWAN_RELEASE_PG_DUMP`, `LIWAN_RELEASE_PG_HOST`, `LIWAN_RELEASE_PG_PORT`, `LIWAN_RELEASE_CONTROL_PG_HOST`, `LIWAN_RELEASE_CONTROL_PG_PORT`, `LIWAN_RELEASE_ODOO_DATA_DIR`, `LIWAN_RELEASE_DISK_PATH` (keys are in [release/README.md](../../deploy/release/README.md) "Config") | `stat -c '%a %U' /etc/liwan-release/staging.env` | `600` and the user the job runs as (root, see A7) | |
| A4.5 | The compose set renders with the staging env | `cd /opt/liwan/current/deploy && docker compose -f docker-compose.yml -f docker-compose.shared.yml -f docker-compose.shared-commercial.yml -f docker-compose.production.yml --env-file /srv/liwan-staging/shared.env config --quiet` | exit 0; `config` shows the proxy ports bound to `127.0.0.1` | |
| A4.6 | Control-plane env, vendor console env and `/etc/liwan/shared-worker.env` from their templates, with the same keys in each place | `ls -l` of the three files | present, mode 0600 | |

### A5. Forgejo read token

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A5.1 | A read-only Forgejo user and token (repository read and package read, nothing else); kept only in `/etc/liwan-release/forgejo-read` (root, 0600) as `LIWAN_FORGEJO_READ_USER=` and `LIWAN_FORGEJO_READ_TOKEN=` lines; it is not copied into the Openship job's secret store | `stat -c '%a %U' /etc/liwan-release/forgejo-read` | `600 root` | |
| A5.2 | The token can read but not write | `git ls-remote https://git.liwanos.com/liwanos/liwan.git main` with the token through a credential helper; a `docker pull` of one release document; a push attempt | the first two succeed, the push is refused | |

### A6. Shared worker unit

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A6.1 | Install `deploy/control-plane/liwan-shared-worker.service` (adjust the prefix and account), `systemctl daemon-reload` | `systemctl cat liwan-shared-worker` | the unit with `EnvironmentFile=/etc/liwan/shared-worker.env` | |
| A6.2 | Start it only after the first release has created the control database (A9); exactly one worker runs | `systemctl enable --now liwan-shared-worker; systemctl is-active liwan-shared-worker; pgrep -fc shared-worker-main` | `active`, count `1` | |

The release command stops and starts this worker itself during a release; do not manage it by hand afterwards.

### A7. Openship job and hook

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A7.1 | Job `liwan-staging-release` on the Contabo server, manual trigger, command `set -a; . /etc/liwan-release/forgejo-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py run --environment staging` (the entry point in [release/README.md](../../deploy/release/README.md); the checkout path is the one from A3.4) | MCP `post_jobs`, then `get_jobs_by_key` | the job exists with that command and no token among its secrets | |
| A7.2 | Jobs run as root, so the release config and the token files are root-owned | the P0 check: a run printing `id` | `uid=0` | |
| A7.3 | A hook of type job, token mode, attached to the staging tracked project from A2.2 | MCP `post_projects_by_id_incoming_webhooks` {actionType job, authMode token} | a hook URL of the form `https://openship.liwanos.com/api/proxy/api/webhooks/incoming/<hookId>` and a token | |
| A7.4 | The hook URL and token go into the secrets of `liwanos/liwan-publish` as `LIWAN_STAGING_HOOK_URL` and `LIWAN_STAGING_HOOK_TOKEN`, typed in the Forgejo web UI by the owner | Forgejo: repository `liwanos/liwan-publish`, Settings, Actions, Secrets | both names listed (values hidden) | |
| A7.5 | The hook rejects a missing or wrong token and accepts the right one | `curl -s -o /dev/null -w '%{http_code}' -X POST <hook url>` with no token, a wrong token, the right token | `404`, `404`, `200` | |

### A8. First release

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A8.1 | The `main` commit has a published release document | `docker manifest inspect git.liwanos.com/liwanos/liwan-release:<main sha>` with the read token | the manifest exists | |
| A8.2 | Run the job once from Openship | MCP `post_jobs_by_key_run`, then `get_jobs_runs_by_runId` | last log line `RESULT: committed <commit>`, exit 0 | |
| A8.3 | State written | `python3 -B /opt/liwan/current/deploy/release/release.py status --environment staging` | the served commit, no run, no halt | |
| A8.4 | Nothing of the stack listens beyond loopback | `ss -ltnp \| grep -E ':(18080\|18443)'` and `docker ps --format '{{.Names}} {{.Ports}}'` | only `127.0.0.1:18080` and `127.0.0.1:18443`; no other published port from the stack | |
| A8.4a | Restore and relay sites are on :80 with the tenant sites, and the closed restore route answers 404 through the edge | `docker exec <proxy> wget -qO- --server-response --header 'Host: rabc.restore.staging.liwanos.com' http://127.0.0.1:80/ 2>&1 \| head -3`; `ss -ltn` inside the container shows no :443 | `404`, no :443 listener | |
| A8.4b | The trust in `X-Forwarded-For` has no other way in: the runner guard drops loopback and Docker ranges for the runner users, and no container but the Openship edge uses the host network | `nft list table inet liwan_runner_guard`; `docker ps --filter network=host --format '{{.Names}}'` | drops for `127.0.0.0/8` and `172.16.0.0/12` for uids 1001 and 1002; only the Openship edge listed | |
| A8.5 | The stack answers through the edge with valid TLS | `curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.staging.liwanos.com/` | a 2xx or 3xx and `0` | |
| A8.6 | Caddy sees the real client | request `https://app.staging.liwanos.com/` from a machine with a known address and a spoofed header `X-Forwarded-For: 6.6.6.6`; read the Caddy access log or the signup path's `X-Liwan-Signup-Client` | the machine's own address, never `6.6.6.6` and never `172.29.50.1` | |
| A8.7 | Start the shared worker (A6.2) | `systemctl enable --now liwan-shared-worker` | `active` | |

### A9. P4 acceptance

| # | Acceptance | How | Observed |
| --- | --- | --- | --- |
| A9.1 | A self sign-up creates a tenant on its own hostname with valid TLS | open `https://app.staging.liwanos.com`, sign up with a test email (public sign-up is `LIWAN_PUBLIC_SIGNUP=false` until staging is proven: set it to `true` for the test, then back); `curl -sS https://<tenant>.staging.liwanos.com/` | tenant host answers with a valid certificate | |
| A9.2 | A test-mode payment completes | the Moyasar test card in the plan flow | subscription active, event recorded in the control plane | |
| A9.3 | An Arabic PDF renders | print an invoice or report in the tenant and open the file | Arabic text shaped and right to left | |
| A9.4 | Three tenants cannot read each other's data, files or AI context | create three tenants, then follow the isolation checks of [saas-commercial-runbook.md](saas-commercial-runbook.md) and `deploy/odoo/` | every cross read is refused | |
| A9.5 | Egress: from the `odoo` container a direct request to an outside host and to `169.254.169.254` fails; an allowlisted host through `odoo-egress` succeeds | `docker exec <odoo> python3 -c` with a short connect to `example.com:443` and `169.254.169.254:80`; the allowlisted check in [odoo-egress.md](odoo-egress.md) | the first two fail, the allowlisted one succeeds | |
| A9.6 | A host restart brings everything back | `reboot`, then `docker ps`, `systemctl is-active liwan-shared-worker` and A8.5 | all containers and the worker are back, the site answers | |
| A9.7 | A merge to `main` reaches staging with no manual step | merge a trivial change; watch the Forgejo publish run, the hook call and the Openship job | `RESULT: committed <new commit>` with no command typed | |
| A9.8 | A release with a deliberately failing upgrade rolls back by itself | publish a candidate whose upgrade fails on the second tenant (the failure fixtures in `deploy/release/test_release.py` show the shape) | `RESULT: rolled back ...`, the previous release serves, both tenants intact | |
| A9.9 | Rate limits key on the real client | send more than 20 requests a minute to `/api/auth/login` from one address and then from another | the first gets `429`, the second is unaffected | |

---

## B. Production on the Oracle Jeddah host

Scope and approval are in plan part P7: this section is its skeleton, to be completed there. The steps repeat section
A with these differences.

| # | Difference | Where |
| --- | --- | --- |
| B1 | The host is `liwanos-prod` (Arm). Oracle port 22 answers only `158.220.75.44`. The host is registered in the Openship on the Contabo host. | Oracle security list; MCP `post_system_servers` |
| B2 | Hostnames are `liwan.sa`, `*.liwan.sa`, with `app`, `admin` and `portal` (D15). Whether production sits behind an Openship edge or runs Caddy on 80/443 is decided at P7 (D18). With an edge, set `LIWAN_TRUSTED_PROXIES` to its gateway, `LIWAN_AUTO_HTTPS=off`, `http://` in `DOMAIN` and loopback bind, as staging does. Without one, leave `LIWAN_TRUSTED_PROXIES` empty and Caddy terminates TLS. | `deploy/environments/production.env.example` |
| B3 | The job is `liwan-production-release` with the command `python3 -B /opt/liwan/current/deploy/release/release.py run --environment production`, and it has no hook. The owner starts it from Openship after the tag exists (D19). | Openship |
| B4 | The release candidate is the highest `release/19.0.X.Y.Z` tag on Forgejo `main`; the arm64 images are published and the Arm pre-release check on `liwanos-staging` has passed for the commit. | [release/README.md](../../deploy/release/README.md) |
| B5 | No production credential in Forgejo secrets or on a runner. The read token is a separate read-only token for this server. | Forgejo, Openship |
| B6 | Backups go to a store inside the Kingdom. Public sign-up stays closed until the owner opens it. | P7 |

Production acceptance (P7): a tagged release reaches production from the release document staging ran; a forced failed
health check rolls back by itself; port 22 refuses any other address; no production credential exists on the runner or
in Forgejo secrets. Use the same row format as section A for each.

## Not covered here

- The control and admin hostnames (`control.*`, `admin.*`) and their routes: the shared Caddyfile has no site for
  them. They come from [control-plane-deployment.md](control-plane-deployment.md) and the vendor console snippet.
- Backups and monitoring of the tooling server (plan P6).
- The CI stages on Forgejo (plan P5).
