# Environment bring-up: development, staging and production

How to bring up one LiwanOS server so that a merge or a tag reaches it with no manual step. It covers the three
environments of the deployment plan: development on the Contabo x86 host, staging on the Oracle Arm host
`liwanos-staging`, and production on the Oracle Jeddah Arm host `liwanos-prod`. It states what to create and how to see
that it works; it is not a release or deployment approval, and nothing here has run on a real host yet. No secret value
belongs on this page or in the checklists: record where a value lives, never the value.

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
Forgejo Actions (publish) --POST hook--> Openship job `liwan-<environment>-release`
                                           --> deploy/release/release.py run --environment <environment>
```

- Openship owns TLS and the public ports. The stack's Caddy owns rate limits and the guard hop. The release command
  owns compose: nobody runs `docker compose up` by hand next to the job.
- Development follows the head of Forgejo `main`: the publish run of every merge calls its hook.
- Staging follows the highest `release/19.0.X.Y.Z` tag, arm64 required, and is updated only when the owner says to
  publish to staging: that creates the release tag, the arm64 leg builds, and the tag leg then calls the staging hook.
- Production follows the highest release tag too and its job has no hook: the owner starts it from Openship. It takes
  only a tag that staging already served and passed; the coordinator checks this by hand until the enforced gate of
  plan part P7 exists.

## Fixed values

| Item | Development (Contabo) | Staging (Oracle `liwanos-staging`) | Production (Oracle `liwanos-prod`) |
| --- | --- | --- | --- |
| Follows | head of Forgejo `main` | highest release tag, arm64 required | highest release tag, arm64 required |
| Host address | `158.220.75.44` | recorded at bring-up | recorded at P7 |
| Hostnames | `dev.liwanos.com`, `*.dev.liwanos.com` | `staging.liwanos.com`, `*.staging.liwanos.com` | `liwan.sa`, `*.liwan.sa` (D15) |
| Prospect host | `app.dev.liwanos.com` | `app.staging.liwanos.com` | `app.liwan.sa` |
| Stack publishes | `127.0.0.1:18080` (HTTP), `127.0.0.1:18443` (published, nothing listens behind it) | same | decided at P7 (edge or Caddy on 80/443) |
| `edge` network | `172.29.50.0/24`, gateway `172.29.50.1` | same | same subnet (compose pins it) |
| `LIWAN_TRUSTED_PROXIES` | `172.29.50.1/32` | `172.29.50.1/32` | empty until production sits behind an edge |
| Hook | called by the `main` leg of the publish run | called by the release tag leg, after the arm64 images | none |
| Release env file | `/etc/liwan-release/development.env` | `/etc/liwan-release/staging.env` | `/etc/liwan-release/production.env` |
| Shared stack env file | `/srv/liwan-development/shared.env` | `/srv/liwan-staging/shared.env` | `/srv/liwan/shared.env` |
| Release state | `/var/lib/liwan-release/development/` | `/var/lib/liwan-release/staging/` | `/var/lib/liwan-release/production/` |
| Checkout | `/opt/liwan/current` | `/opt/liwan/current` | `/opt/liwan/current` |
| Memory ceiling of the stack | about 8 GB (D22) | 6 GB (the host has 12 GB) | the full compose ceilings, 24 GB |

## How to use the checklists

Run each command, paste the observed result in the last column and sign the row. A row without an observed result is
not done. A secret never goes in the result column: write where it was stored.

---

## A. Development on the Contabo host

Order on a fresh host:

1. Before the first `release.py run`: A1 (DNS), A2 (edge route), A3 (account, host packages, directories, bootstrap
   checkout), A4 (env files), A5 (read token), A6 (unit installed, not started), A7 (job and hook).
2. The first run itself: A8 (`release.py run`). Its `commit` step starts the shared worker.
3. After the first run: the owner bootstrap, the catalog import, the vendor console, the edge snippets and the Moyasar
   webhook, from [control-plane-deployment.md](control-plane-deployment.md) "First deployment"; then A9 (acceptance).

### A1. DNS

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A1.1 | Record `dev` and `*.dev` to the host, DNS only (grey cloud) | Cloudflare dashboard or API; then `dig +short dev.liwanos.com` and `dig +short probe.dev.liwanos.com` | both answer `158.220.75.44` | |
| A1.2 | The two names stay unproxied, so the edge sees the client address | `dig +short dev.liwanos.com @1.1.1.1` | the host address, not a Cloudflare one | |

### A2. Openship credential and edge route

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A2.1 | The Cloudflare DNS credential exists (`cloudflare-liwanos-dns01`, scopes Zone:Read and DNS:Edit on `liwanos.com`) | MCP `get_dns_credentials` | one enabled Cloudflare entry | |
| A2.2 | Tracked project `dev.liwanos.com`, which only holds the two domains and their certificates. It has no deployment and is never deployed: a deploy would run `npm start` on port 18080. | on the host: `openship edge domains add dev.liwanos.com --port 18080` | a tracked project for `dev.liwanos.com`; no deployment | |
| A2.3 | The wildcard on the same project, DNS-01, automatic provider | MCP `post_domains` with `*.dev.liwanos.com`, `sslChallenge: dns-01`, then on the host `openship --local domain verify <id>` (the MCP DNS-challenge call is refused for a project without a deployment) | certificate issued for the wildcard; the credential stays enabled so it renews | |
| A2.3a | The two route files. Openship 1.0.1 writes a vhost only for a project with an active deployment, so the project alone never routes. As root, write `/var/lib/openship/edge/sites-enabled/dev-liwanos-com.route.json` and `/var/lib/openship/edge/sites-enabled/-dev-liwanos-com.route.json` (mode and owner copied from a neighbouring `.route.json`), one JSON line each: `{"domain":"<host>","tls":true,"terminatesTlsLocally":true,"targetUrl":"http://127.0.0.1:18080","proxy":{"clientMaxBodySize":"256m","clientBodyTimeout":"600s","proxyRequestBuffering":false,"proxyReadTimeout":"600s","proxySendTimeout":"600s"},"protection":null,"edgePages":null}` with `<host>` = `dev.liwanos.com` and `*.dev.liwanos.com`. Then force a verify of both domains. | `POST /api/domains/<id>/verify?force=1` for both domain ids (MCP `post_domains_by_id_verify` with `force: true`) | Openship renders `dev-liwanos-com.conf` and `-dev-liwanos-com.conf` itself and re-renders them on every certificate activation; never hand-write a `.conf` | |
| A2.4 | The edge forwards Host unchanged, appends `X-Forwarded-For`, passes WebSocket upgrade | read both generated files under `/var/lib/openship/edge/sites-enabled/`: `dev-liwanos-com.conf` and `-dev-liwanos-com.conf` | each has `proxy_set_header Host $host`, `X-Forwarded-For $proxy_add_x_forwarded_for`, `Upgrade $http_upgrade` | |
| A2.5 | Body size and read timeout fit uploads and reports | read `clientMaxBodySize` and `proxyReadTimeout` in the two `.route.json` files | `256m` and `600s`; record the values | |
| A2.6 | The route answers before the stack runs | `curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://dev.liwanos.com/` | `502` and `0` (valid certificate, nothing listening on 18080 yet) | |
| A2.7 | The edge check after every `openship update`, and daily as the Openship job `liwan-development-edge-check` | `python3 -B /opt/liwan/current/deploy/release/edge_check.py` with the arguments of [release/README.md](../../deploy/release/README.md) "Edge check" | `RESULT: edge ok` | |

### A3. Host account, directories, checkout

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A3.1 | The `liwan-worker` account in the `docker` group (the only member; no CI-runner user joins it) | `id -u liwan-worker; id -g liwan-worker` | the uid and gid the host gave; they fill `LIWAN_CONTROL_UID` and `LIWAN_CONTROL_GID` | |
| A3.2 | Control directories and files, created by `init-host.sh` once A3.4 and A4.1 are done (it lives in the checkout and reads the directory names from the shared stack env file). It stops when `LIWAN_CONTROL_UID` or `LIWAN_CONTROL_GID` is a placeholder or not the worker's id. It creates `shared-runtime.json`, `inventory-v2.json`, the private CA, `control-tls.*`, `effect-tls.*`, `control-ca.pem` and `control-db-password`, and never overwrites. | as root: `/opt/liwan/current/deploy/control-plane/init-host.sh /srv/liwan-development/shared.env liwan-shared-development` (optional `LIWAN_WORKER_USER`, default `liwan-worker`) | every path printed as `created` or `kept`, owned by the worker account; no secret value printed | |
| A3.3 | Maintenance and state directories | `ls -ld /var/lib/liwan-release /var/lib/liwan-release/maintenance` | exist; the release command writes `active` in `maintenance` | |
| A3.4 | Bootstrap checkout: `/opt/liwan/current` is a symlink to `/opt/liwan/releases/<commit>`, a clone of the bootstrap commit of `main`, made as [release/README.md](../../deploy/release/README.md) "Bootstrap" says. The release refuses with `current_not_symlink` when it is a real directory and with `current_dangling` when the link points at a folder that does not exist. | `readlink /opt/liwan/current; git -C /opt/liwan/current rev-parse HEAD` | the link target under `/opt/liwan/releases/`; the `main` commit of Forgejo | |
| A3.4a | Host packages for the release command | `node --version; npm --version; pg_dump --version; git --version; python3 --version` | Node 22 with npm; `pg_dump` of major version 16 (the `db` image is `pgvector/pgvector:pg16` in `deploy/docker-compose.yml`); git; python3 | |
| A3.5 | Free disk and memory before the first start | `df -h /var/lib/docker /srv; free -g` | disk well under the D22 alert (70%); memory for an 8 GB stack on top of the host's other services | |
| A3.6 | One host firewall rule for the tenant database bridge. `deploy/docker-compose.host-link.yml` puts `db` on a second bridge, fixed name `liwan-dbhost`, which (unlike the internal `database` network) can route to the internet. As root: `iptables -I DOCKER-USER -i liwan-dbhost -m conntrack --ctstate NEW -j DROP` (nftables backend: `nft insert rule ip filter DOCKER-USER iifname "liwan-dbhost" ct state new drop`). Also, as root: `iptables -I INPUT -i liwan-dbhost -m conntrack --ctstate NEW -j DROP` (nftables backend: `nft insert rule ip filter INPUT iifname "liwan-dbhost" ct state new drop`), so `db` cannot open new connections to host services through the bridge gateway either. Together they drop connections the `db` container starts, to anything. The host's own `pg_dump` to `127.0.0.1:15433` is not affected: its replies are established traffic, and locally generated traffic does not enter through `-i liwan-dbhost` as NEW. These rules do not survive a reboot unless persisted: load them from a unit at boot, as `liwan-runner-netguard.service` loads its nft table (`tooling-server.md`), and re-check after a reboot. Accepted risk that remains: any local process on the host can still open `127.0.0.1:15433`, so the `odoo` password is the only barrier there. The control database overlay `deploy/control-plane/compose.host-link.yml` has the same shape and no fixed bridge name yet (follow-up). | `iptables -C DOCKER-USER -i liwan-dbhost -m conntrack --ctstate NEW -j DROP && iptables -C INPUT -i liwan-dbhost -m conntrack --ctstate NEW -j DROP && echo present`; after A8.2: `docker exec <project>-db-1 timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'` | `present`; the second command fails (timeout or refused) | |

### A4. Env files

Fill from the templates on the host, mode 0600, outside the checkout. Generate every secret there with `openssl rand
-hex 32`; development values are never copied from production.

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A4.1 | Shared stack env file from `deploy/environments/development.env.example` with the real hostnames: `DOMAIN="http://dev.liwanos.com, http://*.dev.liwanos.com"`, `LIWAN_PROSPECT_HOST=app.dev.liwanos.com`, `NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN=https://app.dev.liwanos.com`, `LIWAN_RESTORE_DOMAIN=restore.dev.liwanos.com`, `LIWAN_EDGE_BIND=127.0.0.1`, ports `18080` and `18443`, `LIWAN_TRUSTED_PROXIES=172.29.50.1/32`, `LIWAN_AUTO_HTTPS=off`, `LIWAN_SITE_SCHEME=http://` | `stat -c '%a %U' /srv/liwan-development/shared.env`; `grep -c REPLACE_WITH /srv/liwan-development/shared.env` | `600 liwan-worker` (the rendered compose file takes this owner and mode, and the host worker must read both files); count `0` | |
| A4.2 | `LIWAN_RESTORE_ALLOW` stays empty (restore hosts closed on development) | `grep '^LIWAN_RESTORE_ALLOW=' /srv/liwan-development/shared.env` | empty value | |
| A4.3 | Test-mode keys only: Moyasar, Authentica, Turnstile, Meta, AI provider | read the key prefixes in the control and shared env files, never print values | every key is a test or sandbox key | |
| A4.4 | Release config `/etc/liwan-release/development.env` with `LIWAN_RELEASE_PROJECT`, `LIWAN_SHARED_ENV_FILE`, `LIWAN_RELEASE_PG_DUMP`, `LIWAN_RELEASE_PG_HOST=127.0.0.1`, `LIWAN_RELEASE_PG_PORT=15433` (published by `deploy/docker-compose.host-link.yml`, `LIWAN_DB_HOST_PORT`), `LIWAN_RELEASE_CONTROL_PG_HOST=127.0.0.1`, `LIWAN_RELEASE_CONTROL_PG_PORT=15432`, `LIWAN_RELEASE_ODOO_DATA_DIR`, `LIWAN_RELEASE_DISK_PATH` and `PGPASSFILE` pointing at a root 0600 pgpass file (keys and the pgpass format are in [release/README.md](../../deploy/release/README.md) "Config") | `stat -c '%a %U' /etc/liwan-release/development.env /etc/liwan-release/pgpass` | `600` and the user the job runs as (root, see A7), for both files | |
| A4.5 | The compose set renders with the development env | `cd /opt/liwan/current/deploy && docker compose -f docker-compose.yml -f docker-compose.shared.yml -f docker-compose.shared-commercial.yml -f docker-compose.production.yml -f docker-compose.host-link.yml --env-file /srv/liwan-development/shared.env config --quiet` | exit 0; `config` shows the proxy ports and the `db` port 15433 bound to `127.0.0.1` | |
| A4.6 | Control-plane env, vendor console env and `/etc/liwan/shared-worker.env` from their templates, with the same keys in each place | `ls -l` of the three files | present, mode 0600 | |

### A5. Forgejo read token

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A5.1 | A read-only Forgejo user and token (repository read and package read, nothing else); kept only in `/etc/liwan-release/forgejo-read` (root, 0600) as `LIWAN_FORGEJO_READ_USER=` and `LIWAN_FORGEJO_READ_TOKEN=` lines; it is not copied into the Openship job's secret store | `stat -c '%a %U' /etc/liwan-release/forgejo-read` | `600 root` | |
| A5.2 | The token can read but not write | `git ls-remote https://git.liwanos.com/liwanos/liwan.git main` with the token through a credential helper; a `docker pull` of one release document; a push attempt | the first two succeed, the push is refused | |

### A6. Shared worker unit

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A6.1 | Install `deploy/control-plane/liwan-shared-worker.service` (adjust the prefix and account), `systemctl daemon-reload`. Do not start it: the release `commit` step starts it. | `systemctl cat liwan-shared-worker` | the unit with `EnvironmentFile=/etc/liwan/shared-worker.env`, not running | |
| A6.2 | After the first release (A8) it runs, exactly once | `systemctl is-active liwan-shared-worker; pgrep -fc shared-worker-main` | `active`, count `1` | |

The release command stops and starts this worker itself during a release; do not manage it by hand afterwards.

### A7. Openship job and hook

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A7.1 | Job `liwan-development-release` on the Contabo server, manual trigger, command `set -a; . /etc/liwan-release/forgejo-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py run --environment development` (the entry point in [release/README.md](../../deploy/release/README.md); the checkout path is the one from A3.4) | MCP `post_jobs`, then `get_jobs_by_key` | the job exists with that command and no token among its secrets | |
| A7.2 | Jobs run as root, so the release config and the token files are root-owned | the P0 check: a run printing `id` | `uid=0` | |
| A7.3 | A hook of type job, token mode, attached to the development tracked project from A2.2 | MCP `post_projects_by_id_incoming_webhooks` {actionType job, authMode token} | a hook URL of the form `https://openship.liwanos.com/api/proxy/api/webhooks/incoming/<hookId>` and a token | |
| A7.4 | The hook URL and token go into the secrets of `liwanos/liwan-publish` as `LIWAN_DEVELOPMENT_HOOK_URL` and `LIWAN_DEVELOPMENT_HOOK_TOKEN`, wired by the coordinator through the Forgejo API (never printed) | Forgejo: repository `liwanos/liwan-publish`, Settings, Actions, Secrets | both names listed (values hidden) | |
| A7.5 | The hook rejects a missing or wrong token and accepts the right one | `curl -s -o /dev/null -w '%{http_code}' -X POST <hook url>` with no token, a wrong token, the right token | `404`, `404`, `200` | |

### A8. First release

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A8.1 | The `main` commit has a published release document | `docker manifest inspect git.liwanos.com/liwanos/liwan-release:<main sha>` with the read token | the manifest exists | |
| A8.2 | Run the job once from Openship | MCP `post_jobs_by_key_run`, then `get_jobs_runs_by_runId` | last log line `RESULT: committed <commit>`, exit 0 | |
| A8.2a | The file `shared-runtime.json` names as `composeFile` was rendered by the run, before the worker started, with the owner and mode of `shared.env` (`600 liwan-worker:liwan-worker`) | `stat -c '%a %U:%G' /srv/liwan-development/shared.compose.json /srv/liwan-development/shared.env` | both lines equal | |
| A8.3 | State written | `set -a; . /etc/liwan-release/forgejo-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py status --environment development` | the served commit, no run, no halt | |
| A8.4 | Nothing of the stack listens beyond loopback | `ss -ltnp \| grep -E ':(18080\|18443)'` and `docker ps --format '{{.Names}} {{.Ports}}'` | only `127.0.0.1:18080` and `127.0.0.1:18443`; no other published port from the stack | |
| A8.4a | Restore and relay sites are on :80 with the tenant sites, and the closed restore route answers 404 through the edge | `docker exec <proxy> wget -qO- --server-response --header 'Host: rabc.restore.dev.liwanos.com' http://127.0.0.1:80/ 2>&1 \| head -3`; `ss -ltn` inside the container shows no :443 | `404`, no :443 listener | |
| A8.4b | The trust in `X-Forwarded-For` has no other way in: the runner guard drops loopback and Docker ranges for the runner users, and no container but the Openship edge uses the host network | `nft list table inet liwan_runner_guard`; `docker ps --filter network=host --format '{{.Names}}'` | drops for `127.0.0.0/8` and `172.16.0.0/12` for uids 1001 and 1002; only the Openship edge listed | |
| A8.5 | The stack answers through the edge with valid TLS | `curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.dev.liwanos.com/` | a 2xx or 3xx and `0` | |
| A8.6 | Caddy sees the real client | request `https://app.dev.liwanos.com/` from a machine with a known address and a spoofed header `X-Forwarded-For: 6.6.6.6`; read the Caddy access log or the signup path's `X-Liwan-Signup-Client` | the machine's own address, never `6.6.6.6` and never `172.29.50.1` | |
| A8.7 | The shared worker was started by the release `commit` step (A6.2) | `systemctl is-active liwan-shared-worker` | `active` | |

### A9. P4 acceptance

| # | Acceptance | How | Observed |
| --- | --- | --- | --- |
| A9.1 | A self sign-up creates a tenant on its own hostname with valid TLS | open `https://app.dev.liwanos.com`, sign up with a test email (public sign-up is `LIWAN_PUBLIC_SIGNUP=false` until development is proven: set it to `true` for the test, then back); `curl -sS https://<tenant>.dev.liwanos.com/` | tenant host answers with a valid certificate | |
| A9.2 | A test-mode payment completes | the Moyasar test card in the plan flow | subscription active, event recorded in the control plane | |
| A9.3 | An Arabic PDF renders | print an invoice or report in the tenant and open the file | Arabic text shaped and right to left | |
| A9.4 | Three tenants cannot read each other's data, files or AI context | create three tenants, then follow the isolation checks of [saas-commercial-runbook.md](saas-commercial-runbook.md) and `deploy/odoo/` | every cross read is refused | |
| A9.5 | Egress: from the `odoo` container a direct request to an outside host and to `169.254.169.254` fails; an allowlisted host through `odoo-egress` succeeds | `docker exec <odoo> python3 -c` with a short connect to `example.com:443` and `169.254.169.254:80`; the allowlisted check in [odoo-egress.md](odoo-egress.md) | the first two fail, the allowlisted one succeeds | |
| A9.6 | A host restart brings everything back | `reboot`, then `docker ps`, `systemctl is-active liwan-shared-worker` and A8.5 | all containers and the worker are back, the site answers | |
| A9.7 | A merge to `main` reaches development with no manual step | merge a trivial change; watch the Forgejo publish run, the hook call and the Openship job | `RESULT: committed <new commit>` with no command typed | |
| A9.8 | A release with a deliberately failing upgrade rolls back by itself | publish a candidate whose upgrade fails on the second tenant (the failure fixtures in `deploy/release/test_release.py` show the shape) | `RESULT: rolled back ...`, the previous release serves, both tenants intact | |
| A9.9 | Rate limits key on the real client | send more than 20 requests a minute to `/api/auth/login` from one address and then from another | the first gets `429`, the second is unaffected | |

---

## B. Staging on the Oracle `liwanos-staging` host

Section A applies, except row A8.4b (replaced by B5a), with the names of staging (`staging.env`, `/srv/liwan-staging/`,
`/var/lib/liwan-release/staging/`, job `liwan-staging-release`, `--environment staging`, the hostnames in the fixed
values table). These are the differences.

| # | Difference | Where |
| --- | --- | --- |
| B1 | The host is `liwanos-staging`, an Arm server (2 OCPU, 12 GB). It is registered in the Openship on the Contabo host. | MCP `post_system_servers` |
| B2 | Oracle security list: port 22 answers only `158.220.75.44`; ports 80 and 443 are open to the internet. | Oracle security list |
| B3 | Openship is not installed on the Oracle hosts. Staging needs its own edge on this server for `staging.liwanos.com` and `*.staging.liwanos.com`; that edge is not designed yet (plan part P7), so A2 does not carry over. The stack publishes on loopback `18080` and `18443` as in A and the env file is `deploy/environments/staging.env.example`. | P7; A4 |
| B4 | DNS: the `staging` and `*.staging` records move from the Contabo host to this server's address, DNS only (grey cloud), as in A1. | Cloudflare |
| B5 | The same server also runs the `publish-arm64` runner. It runs under its own unix user with rootless Docker and has no access to the stack, the release config or the read token. | host accounts, runner registration |
| B5a | Replaces A8.4b. Any local process that can open `127.0.0.1:18080` reaches Caddy as the trusted `edge` gateway and could forge `X-Forwarded-For`, and the `publish-arm64` runner's user runs arbitrary job code on this host. Give that user an nftables outbound guard like `inet liwan_runner_guard` on Contabo: drop loopback (`127.0.0.0/8`), the Docker ranges (`172.16.0.0/12`), link-local (`169.254.0.0/16`) and the private ranges (`10.0.0.0/8`, `192.168.0.0/16`) for that user's uid. The runner unit must depend on the guard (`Requires=` and `After=` its unit) as on Contabo, so the runner never starts unguarded. Check: `nft list table inet liwan_runner_guard` shows the drops for the runner uid; `sudo -u <runner user> curl -sS --max-time 5 http://127.0.0.1:18080/` fails with a refused or timed-out connection (the same from a job step); `docker ps --filter network=host --format '{{.Names}}'` lists only the Openship edge. | host nftables, runner unit |
| B6 | A 4 GB swap file. The arm64 build is capped at 1.5 CPU and 5 GB; the stack is capped at 6 GB. | `/etc/fstab`, runner and compose limits |
| B7 | The candidate is the highest `release/19.0.X.Y.Z` tag, not `main`. The document must carry `linux/arm64` digests and the tag must be on Forgejo `main`. The server is updated only when the owner says to publish to staging: the tag is created, the arm64 leg builds, then the staging hook is called. | [release/README.md](../../deploy/release/README.md) |
| B8 | The job `liwan-staging-release` has a token hook, attached to the staging tracked project; its URL and token go into the secrets of `liwanos/liwan-publish` as `LIWAN_STAGING_HOOK_URL` and `LIWAN_STAGING_HOOK_TOKEN` (A7.3 to A7.5, with the staging project and job). The tag leg calls it as its last step. | Openship, Forgejo |
| B9 | A merge to `main` does not reach this server (replaces A9.7): publish a test tag and watch the arm64 leg, the hook call and the job end in `RESULT: committed <commit>`. | acceptance |

Staging acceptance: the A9 rows with the staging hostnames. Every production tag is served here first.

---

## C. Production on the Oracle Jeddah host

Scope and approval are in plan part P7: this section is its skeleton, to be completed there. The steps repeat section
A with these differences (staging, section B, is the model for an Arm host).

| # | Difference | Where |
| --- | --- | --- |
| C1 | The host is `liwanos-prod` (Arm). Oracle port 22 answers only `158.220.75.44`. The host is registered in the Openship on the Contabo host. | Oracle security list; MCP `post_system_servers` |
| C2 | Hostnames are `liwan.sa`, `*.liwan.sa`, with `app`, `admin` and `portal` (D15). Whether production sits behind an Openship edge or runs Caddy on 80/443 is decided at P7 (D18). With an edge, set `LIWAN_TRUSTED_PROXIES` to its gateway, `LIWAN_AUTO_HTTPS=off`, `http://` in `DOMAIN` and loopback bind, as development and staging do. Without one, leave `LIWAN_TRUSTED_PROXIES` empty and Caddy terminates TLS. | `deploy/environments/production.env.example` |
| C3 | The job is `liwan-production-release` with the command `set -a; . /etc/liwan-release/forgejo-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py run --environment production`, and it has no hook. The owner starts it from Openship after the tag exists (D19). | Openship |
| C4 | The release candidate is the highest `release/19.0.X.Y.Z` tag on Forgejo `main`; the arm64 images are published and staging served and passed this tag. | [release/README.md](../../deploy/release/README.md) |
| C5 | No production credential in Forgejo secrets or on a runner. The read token is a separate read-only token for this server, kept only in `/etc/liwan-release/forgejo-read` (root, 0600) on `liwanos-prod` as the `LIWAN_FORGEJO_READ_USER=` and `LIWAN_FORGEJO_READ_TOKEN=` lines the C3 command loads, and not copied into the Openship job's secret store (check as in A5.1). | Forgejo, Openship |
| C6 | Backups go to a store inside the Kingdom. Public sign-up stays closed until the owner opens it. | P7 |

Production acceptance (P7): a tagged release reaches production from the release document staging served; a forced failed
health check rolls back by itself; port 22 refuses any other address; no production credential exists on the runner or
in Forgejo secrets. Use the same row format as section A for each.

## Not covered here

- The control and admin hostnames (`control.*`, `admin.*`) and their routes: the shared Caddyfile has no site for
  them. They come from [control-plane-deployment.md](control-plane-deployment.md) and the vendor console snippet.
- Backups and monitoring of the tooling server (plan P6).
- The CI stages on Forgejo (plan P5).
