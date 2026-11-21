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
GitHub Actions (publish.yml) --POST hook--> Openship job `liwan-<environment>-release`
                                           --> deploy/release/release.py run --environment <environment>
```

- Openship owns TLS and the public ports. The stack's Caddy owns rate limits and the guard hop. The release command
  owns compose: nobody runs `docker compose up` by hand next to the job.
- Development follows the head of GitHub `main`: the publish run of every merge (amd64 only) calls its hook.
- Staging follows the highest `release/19.0.X.Y.Z` tag, arm64 required, and is updated only when the owner says to
  publish to staging: that creates the release tag; the tag run builds arm64 for that commit on `ubuntu-24.04-arm`
  (about 17 to 18 minutes for the nine images), reuses the amd64 digests already published, republishes the release
  document for both architectures and calls the staging hook. Staging waits for that build.
- Production job has no hook: the owner starts it from Openship with an explicit `--tag <tag>` and it never picks the highest tag by itself. It takes
  only a tag that staging already served and passed; the coordinator checks this by hand until the enforced gate of
  plan part P7 exists.

## Fixed values

| Item | Development (Contabo) | Staging (Oracle `liwanos-staging`) | Production (Oracle `liwanos-prod`) |
| --- | --- | --- | --- |
| Follows | head of GitHub `main` | highest release tag, arm64 required | the one tag it is given with `--tag release/19.0.X.Y.Z`, arm64 required |
| Host address | `158.220.75.44` | recorded at bring-up | recorded at P7 |
| Hostnames | `dev.liwanos.com`, `*.dev.liwanos.com` | `staging.liwanos.com`, `*.staging.liwanos.com` | `liwan.sa`, `*.liwan.sa` (D15) |
| Prospect host | `app.dev.liwanos.com` | `app.staging.liwanos.com` | `app.liwan.sa` |
| Stack publishes | `127.0.0.1:18080` (HTTP), `127.0.0.1:18443` (published, nothing listens behind it) | same | decided at P7 (edge or Caddy on 80/443) |
| `edge` network | `172.29.50.0/24`, gateway `172.29.50.1` | same | same subnet (compose pins it) |
| `LIWAN_TRUSTED_PROXIES` | `172.29.50.1/32` | `172.29.50.1/32` | empty until production sits behind an edge |
| Hook | called by the `main` leg of the publish run (amd64 only) | called by the release tag run, after the arm64 images | none |
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

### A0. Owner-side GitHub preparation (before the first `main` publish; not done)

The publish workflow refuses to push unless each of the ten packages (`liwan-odoo`, `liwan-web`, `liwan-caddy`,
`liwan-guard`, `liwan-ai-service`, `liwan-ai-egress`, `liwan-odoo-mail`, `liwan-control-plane`,
`liwan-vendor-admin`, `liwan-release`) already exists under `ghcr.io/tariiq222` and is private. The workflow never
creates a package, so a package cannot appear public by accident.

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A0.1 | Pre-create each of the ten packages as private, grant the repository `tariiq222/liwan` Actions write access to each, and confirm visibility | GitHub, package settings of each package; `gh api /user/packages/container/<name> --jq .visibility` | `private` for all ten; the repository listed with write role | |
| A0.2 | A tag ruleset protects `release/**` (only the owner creates, updates or deletes those tags) and write access to the repository stays with the owner. Reason: the release document is not signed, so anyone who can push a branch or a `release/**` tag carrying a changed workflow could publish a document for a `main` commit. Fork pull requests cannot. Attestation may be revisited later. | GitHub, repository Settings, Rules | the ruleset is active; collaborators with write access: the owner only | |
| A0.3 | The hook secrets exist in the repository Actions secrets: `LIWAN_DEVELOPMENT_HOOK_URL`, `LIWAN_DEVELOPMENT_HOOK_TOKEN`, `LIWAN_STAGING_HOOK_URL`, `LIWAN_STAGING_HOOK_TOKEN` (see A7 and B8) | GitHub, Settings, Secrets and variables, Actions | four names listed (values hidden) | |

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
| A2.7 | The edge check after every `openship update`, and daily as the Openship job `liwan-development-edge-check` | `python3 -B /opt/liwan/current/deploy/release/edge_check.py` with the arguments of [release/README.md](../../deploy/release/README.md) "Edge check", including `--cert-file` for `control-ca.pem`, `control-tls.crt` and `effect-tls.crt` in the control private directory (their expiry is only seen by this job) | `RESULT: edge ok` (the HTTPS probe requests `/favicon.ico`, which the guard allows with or without a tenant and the web container serves) | |

### A3. Host account, directories, checkout

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A3.1 | The `liwan-worker` account in the `docker` group (the only member; no CI-runner user joins it) | `id -u liwan-worker; id -g liwan-worker` | the uid and gid the host gave; they fill `LIWAN_CONTROL_UID` and `LIWAN_CONTROL_GID` | |
| A3.2 | Control directories (the registry directory 0755, refused if it already exists narrower) and files, created by `init-host.sh` once A3.4 and A4.1 are done (it lives in the checkout and reads the directory names from the shared stack env file). It stops when `LIWAN_CONTROL_UID` or `LIWAN_CONTROL_GID` is a placeholder or not the worker's id. It creates `shared-runtime.json`, `inventory-v2.json`, the private CA, `control-tls.*`, `effect-tls.*`, `control-ca.pem` and `control-db-password`. It also creates the deny-all `registry.json` (`{"schemaVersion":1,"snapshotRevision":0,"targets":[]}`, mode 0644, owned by the worker) in the registry directory, so the guard can start before the first tenant, and the AI platform directory `LIWAN_AI_PLATFORM_DIR` (empty, mode 2750, owner the worker, group 10001; an existing one is kept only when it already has exactly that owner, group and mode, otherwise the script stops and prints the `chown` and `chmod` that fix it). It never overwrites, so a host initialised before `LIWAN_RESTORE_DOMAIN` became the base domain (the development server) still has the old `restore.` prefix in `domainSuffix` of `shared-runtime.json`: correct `LIWAN_RESTORE_DOMAIN` in the shared env file and `domainSuffix` in that file by hand, then compare the two values (neither is a secret). | as root: `/opt/liwan/current/deploy/control-plane/init-host.sh /srv/liwan-development/shared.env liwan-shared-development` (optional `LIWAN_WORKER_USER`, default `liwan-worker`); `grep '^LIWAN_RESTORE_DOMAIN=' /srv/liwan-development/shared.env; python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['domainSuffix'])" /srv/liwan-development/control/config/shared-runtime.json` | every path printed as `created` or `kept`, owned by the worker account; no secret value printed; the two domain values are equal (`dev.liwanos.com`, no `restore.` prefix) | |
| A3.3 | Maintenance and state directories | `ls -ld /var/lib/liwan-release /var/lib/liwan-release/maintenance` | exist; the release command writes `active` in `maintenance` | |
| A3.4 | Bootstrap checkout: `/opt/liwan/current` is a symlink to `/opt/liwan/releases/<commit>`, a clone of the bootstrap commit of `main`, made as [release/README.md](../../deploy/release/README.md) "Bootstrap" says. The release refuses with `current_not_symlink` when it is a real directory and with `current_dangling` when the link points at a folder that does not exist. | `readlink /opt/liwan/current; git -C /opt/liwan/current rev-parse HEAD` | the link target under `/opt/liwan/releases/`; the `main` commit of GitHub | |
| A3.4a | Host packages for the release command | `node --version; npm --version; pg_dump --version; git --version; python3 --version` | Node 22 with npm; `pg_dump` of major version 16 (the `db` image is `pgvector/pgvector:pg16` in `deploy/docker-compose.yml`); git; python3 | |
| A3.5 | Free disk and memory before the first start | `df -h /var/lib/docker /srv; free -g` | disk well under the D22 alert (70%); memory for an 8 GB stack on top of the host's other services | |
| A3.6 | One host firewall rule for the tenant database bridge. `deploy/docker-compose.host-link.yml` puts `db` on a second bridge, fixed name `liwan-dbhost`, which (unlike the internal `database` network) can route to the internet; the file sets `enable_ip_masquerade: "false"`, so replies from outside never reach `db` (verified on OrbStack, not on a Linux host: the second command below checks it there), and the host rules below remain the required second layer. As root: `iptables -I DOCKER-USER -i liwan-dbhost -m conntrack --ctstate NEW -j DROP` (nftables backend: `nft insert rule ip filter DOCKER-USER iifname "liwan-dbhost" ct state new drop`). Also, as root: `iptables -I INPUT -i liwan-dbhost -m conntrack --ctstate NEW -j DROP` (nftables backend: `nft insert rule ip filter INPUT iifname "liwan-dbhost" ct state new drop`), so `db` cannot open new connections to host services through the bridge gateway either. Together they drop connections the `db` container starts, to anything. The host's own `pg_dump` to `127.0.0.1:15433` is not affected: its replies are established traffic, and locally generated traffic does not enter through `-i liwan-dbhost` as NEW. These rules do not survive a reboot unless persisted: load them from a systemd unit at boot, and re-check after a reboot. Accepted risk that remains: any local process on the host can still open `127.0.0.1:15433`, so the `odoo` password is the only barrier there. The control database overlay `deploy/control-plane/compose.host-link.yml` has the same shape and no fixed bridge name yet (follow-up). | `iptables -C DOCKER-USER -i liwan-dbhost -m conntrack --ctstate NEW -j DROP && iptables -C INPUT -i liwan-dbhost -m conntrack --ctstate NEW -j DROP && echo present`; after A8.2: `docker exec <project>-db-1 timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'` | `present`; the second command fails (timeout or refused) | |

### A4. Env files

Fill from the templates on the host, mode 0600, outside the checkout. Generate every secret there with `openssl rand
-hex 32`; development values are never copied from production.

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A4.1 | Shared stack env file from `deploy/environments/development.env.example` with the real hostnames: `DOMAIN="http://dev.liwanos.com, http://*.dev.liwanos.com"`, `LIWAN_PROSPECT_HOST=app.dev.liwanos.com`, `NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN=https://app.dev.liwanos.com`, `LIWAN_RESTORE_DOMAIN=dev.liwanos.com` (the base domain, not a `restore.` host: Caddy adds the `restore.` label and the control plane's `domainSuffix` takes the same value), `LIWAN_EDGE_BIND=127.0.0.1`, ports `18080` and `18443`, `LIWAN_TRUSTED_PROXIES=172.29.50.1/32`, `LIWAN_AUTO_HTTPS=off`, `LIWAN_SITE_SCHEME=http://` | `stat -c '%a %U' /srv/liwan-development/shared.env`; `grep -c REPLACE_WITH /srv/liwan-development/shared.env` | `600 liwan-worker` (the rendered compose file takes this owner and mode, and the host worker must read both files); count `0` | |
| A4.2 | `LIWAN_RESTORE_ALLOW` stays empty (restore hosts closed on development) | `grep '^LIWAN_RESTORE_ALLOW=' /srv/liwan-development/shared.env` | empty value | |
| A4.3 | Test-mode keys only: Moyasar, Authentica, Turnstile, Meta, AI provider | read the key prefixes in the control and shared env files, never print values | every key is a test or sandbox key | |
| A4.4 | Release config `/etc/liwan-release/development.env` with `LIWAN_RELEASE_PROJECT`, `LIWAN_SHARED_ENV_FILE`, `LIWAN_RELEASE_PG_DUMP`, `LIWAN_RELEASE_PG_HOST=127.0.0.1`, `LIWAN_RELEASE_CONTROL_PG_HOST=127.0.0.1` (the ports are not config keys: the release reads `LIWAN_DB_HOST_PORT`, default `15433`, and `LIWAN_CONTROL_DB_HOST_PORT`, default `15432`, from the shared env file; only the pgpass lines repeat them), `LIWAN_RELEASE_ODOO_DATA_DIR`, `LIWAN_RELEASE_DISK_PATH` and `PGPASSFILE` pointing at a root 0600 pgpass file (keys and the pgpass format are in [release/README.md](../../deploy/release/README.md) "Config") | `stat -c '%a %U' /etc/liwan-release/development.env /etc/liwan-release/pgpass` | `600` and the user the job runs as (root, see A7), for both files | |
| A4.5 | The compose set renders with the development env | `cd /opt/liwan/current/deploy && docker compose -f docker-compose.yml -f docker-compose.shared.yml -f docker-compose.shared-commercial.yml -f docker-compose.production.yml -f docker-compose.host-link.yml --env-file /srv/liwan-development/shared.env config --quiet` | exit 0; `config` shows the proxy ports and the `db` port 15433 bound to `127.0.0.1` | |
| A4.6 | Control-plane env, vendor console env and `/etc/liwan/shared-worker.env` from their templates, with the same keys in each place | `ls -l` of the three files | present, mode 0600 | |
| A4.7 | The shared Odoo config file named by `LIWAN_SHARED_ODOO_CONFIG` (`/srv/liwan-development/config/odoo.conf`), created by hand outside the checkout. Start from `deploy/shared/odoo.conf`, which is an incomplete reference that the validator refuses. The validator `deploy/shared/validate_odoo_config.py` accepts only: a regular file (not a symlink) of at most 64 KiB, mode `0400` or `0440`, and an owner that is root or the effective uid of the process that checks it. The container checks and reads it as uid 10001 (the `odoo` user, `deploy/odoo/Dockerfile`) and the check below runs as root on the host, so use the one setup that passes in both places: owner `root`, group `10001`, mode `0440` (`chown root:10001 <file>; chmod 440 <file>`). A root-owned `0400` file passes on the host but the container cannot read it; a file owned by uid 10001 passes in the container but fails the host check; one section `[options]` and no other; non-empty `db_host` (`db`), `db_user` (`odoo`), `db_password` (the `DB_PASSWORD` of the shared env file) and `admin_passwd`, none of them `false`, `none`, `admin`, `changeme` or containing `${`; exactly `dbfilter = ^%h$`, `list_db = False`, `proxy_mode = False`, `data_dir = /var/lib/odoo`; `workers` from 1 to 9 (above 2 only together with `db_maxconn` of at most 8, `limit_memory_soft` below `limit_memory_hard` and `limit_memory_hard` of at most 800 MiB (the validator does not cap `limit_memory_soft` by itself; the sizing plan in `deploy/odoo_sizing.py` uses 640 MiB), so that (workers + max_cron_threads) x db_maxconn is at most 88); no `db_name`. If the path does not exist when the stack starts, Docker creates a directory there and the release refuses in `prepare` with `RESULT: refused invalid_shared_env` (the path is not a regular file, or the key is unset or not absolute); remove that directory and write the file. Never print the file. | `stat -c '%a %U:%G %F' /srv/liwan-development/config/odoo.conf; python3 -B /opt/liwan/current/deploy/shared/validate_odoo_config.py /srv/liwan-development/config/odoo.conf; echo $?` | mode `440`, owner and group `root:10001`, `regular file`; exit `0` and no output (a rejection prints only `shared_config_rejected`) | |
| A4.8 | The AI service values in the shared env file. The release always starts `ai` (`APP_SERVICES` in `deploy/release/release.py`), so `AI_SERVICE_TOKEN`, `AI_TOKEN_KEY`, `AI_DB_PASSWORD`, `AI_DATABASE_URL` and `AI_KEY_ENCRYPTION_KEYS` must hold real values before the first release. Order matters: the shared `db` volume runs `deploy/ai/init-db.sh` only when it is first initialised, and that script creates the role and database `liwan_ai` only when `AI_DB_PASSWORD` is non-empty at that moment. The release itself creates the AI control tables in its upgrade phase (`initialize_ai_control`, skipped when `AI_DATABASE_URL` is empty), so no manual `--initialize-control` is needed. Set the values before A8.2; if `db` already started with an empty password, create the role by hand as `deploy/OPERATIONS.md` (Database isolation) shows. `deploy/ai/ensure_secrets.sh` fills only names that are absent or empty, so blank the four placeholder values first. As root: `f=/srv/liwan-development/shared.env; sed -i -E 's/^(AI_SERVICE_TOKEN\|AI_TOKEN_KEY\|AI_DB_PASSWORD\|AI_KEY_ENCRYPTION_KEYS)=.*/\1=/' $f; sh /opt/liwan/current/deploy/ai/ensure_secrets.sh $f; umask 077; awk -F= '$1=="AI_DB_PASSWORD"{pw=$2} {line[NR]=$0} END{for(i=1;i<=NR;i++) if(line[i] ~ /^AI_DATABASE_URL=/) print "AI_DATABASE_URL=postgresql://liwan_ai:" pw "@db:5432/liwan_ai"; else print line[i]}' $f > $f.new && cat $f.new > $f; rm -f $f.new; chown liwan-worker:liwan-worker $f; chmod 600 $f` (the script rewrites the file as the user who runs it, hence the `chown`; it prints no value). The `awk` step reads `AI_DB_PASSWORD` from the file itself and rewrites the existing `AI_DATABASE_URL` line, so the password is never on a command line or in `ps`; `cat $f.new > $f` writes into the same file, which keeps its owner and mode, and the `umask` keeps the temporary file private. The password is hex (`openssl rand -hex 32` in `ensure_secrets.sh`), so it needs no URL encoding; one with other characters would have to be percent-encoded before it goes into the URL. Keep `NUXT_AI_SERVICE_URL=http://ai:8600` and `AI_KEY_ENCRYPTION_KEY_ID=k1`. | `stat -c '%a %U' /srv/liwan-development/shared.env; grep -cE '^(AI_SERVICE_TOKEN\|AI_TOKEN_KEY\|AI_DB_PASSWORD\|AI_KEY_ENCRYPTION_KEYS)=.+' /srv/liwan-development/shared.env; grep -c 'REPLACE_WITH' /srv/liwan-development/shared.env; grep -o '^AI_DATABASE_URL=postgresql://liwan_ai:' /srv/liwan-development/shared.env` | `600 liwan-worker`; `4`; `0`; the prefix printed once, never the password. After A8.2: `docker exec <project>-db-1 psql -U odoo -d postgres -tAc "select count(*) from pg_roles where rolname='liwan_ai'"` prints `1` | |
| A4.9 | The AI platform provider file. Nobody writes it by hand. Two keys decide where it lives: `LIWAN_AI_PLATFORM_DIR=/srv/liwan-development/control/state/ai-platform` in the shared env file (the `ai` service reads this directory read-only; `init-host.sh` creates it, A3.2) and `LIWAN_AI_PLATFORM_PROVIDER_PATH=<that directory>/platform-provider.json` in the control env file (the control API writes the file there). Without the first key compose falls back to `./data/ai` inside the per-commit release checkout and the file is lost at the next release. Until the vendor saves a provider in the vendor console there is no file, the `ai` service still starts, and platform AI runs are refused with `ai_platform_unconfigured`; the service loads the file within seconds of its appearance. An invalid file stops the service at start. The provider's public host reaches `ai-egress` by itself: when the service loads the file it writes `platform.hosts` into the `ai_tenant_hosts` volume and the proxy applies it within about five seconds, so `AI_EGRESS_HOSTS` stays unset in shared mode; it only lists an internal host such as a self-hosted Ollama. | after the vendor saved a provider: `stat -c '%a %U:%G' /srv/liwan-development/control/state/ai-platform/platform-provider.json; python3 -c "import json,sys; print(sorted(json.load(open(sys.argv[1]))))" /srv/liwan-development/control/state/ai-platform/platform-provider.json`; docker exec <project>-ai-egress-1 cat /egress/platform.hosts | `640` with group `10001`; the key names only (`margin_bps`, `models`, `providers`, `revision`, `routes`); then the provider's host name, one per line | |
| A4.10 | Alert channel for the release command. On a halt or failure the release runs `deploy/alerts.py`, which refuses with exit 2 ("no alert channel is configured") when no channel is set, so the alert is lost; the job log then carries `alert <event> was not delivered (exit 2): <reason alerts.py gave>`. Put the keys of at least one complete channel in `/etc/liwan-release/development.env` (the release passes its config to `alerts.py`): email needs `LIWAN_ALERT_SMTP_HOST`, `LIWAN_ALERT_SMTP_FROM` and `LIWAN_ALERT_SMTP_TO` (optional `LIWAN_ALERT_SMTP_PORT`, `LIWAN_ALERT_SMTP_USER`, `LIWAN_ALERT_SMTP_PASSWORD`, `LIWAN_ALERT_SMTP_STARTTLS`); Telegram needs `LIWAN_ALERT_TELEGRAM_BOT_TOKEN` and `LIWAN_ALERT_TELEGRAM_CHAT_ID`. A channel with only some of its required keys is refused. | `grep -oE '^LIWAN_ALERT_[A-Z_]+=' /etc/liwan-release/development.env` | the key names of one complete channel; no values printed | |
| A4.11 | `LIWAN_SESSION_KEYS` is a JSON object (key id to a secret of at least 32 bytes), in single quotes in the env file, and contains `LIWAN_SESSION_ACTIVE_KID`; `AI_KEY_ENCRYPTION_KEYS` is `id:secret` pairs separated by commas and `AI_KEY_ENCRYPTION_KEY_ID` names one of them. `ensure_secrets.sh` writes the second one as `k1:<hex>`; the first is generated by hand, for example `printf "LIWAN_SESSION_KEYS='{\"k1\":\"%s\"}'\n" $(openssl rand -hex 32)` appended to the file in place of the placeholder line. | `python3 -c "import json,sys,re; line=[l for l in open(sys.argv[1]) if l.startswith('LIWAN_SESSION_KEYS=')][0].split('=',1)[1].strip().strip(chr(39)); k=json.loads(line); print(sorted(k), all(len(v.encode())>=32 for v in k.values()))" /srv/liwan-development/shared.env` | `['k1'] True` (key ids and a boolean only, never a value) | |

### A5. GitHub read credentials

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A5.1 | A dedicated machine GitHub account with read on the LiwanOS packages only (the account is the owner's to create and does not exist yet), a different token per environment; kept only in `/etc/liwan-release/github-read` (root, 0600) as `LIWAN_GHCR_READ_USER=` and `LIWAN_GHCR_READ_TOKEN=` lines. While the repository is private, the same file also holds `LIWAN_GITHUB_READ_TOKEN` (fine-grained, Contents read on this one repository). The file is not copied into the Openship job's secret store | `stat -c '%a %U' /etc/liwan-release/github-read` | `600 root` | |
| A5.2 | The credential can read but not write | `git ls-remote https://github.com/tariiq222/liwan.git main` (with `LIWAN_GITHUB_READ_TOKEN` through a credential helper once the repository is private); `docker pull` of one release document from `ghcr.io/tariiq222/liwan-release`; a push attempt | the first two succeed, the push is refused | |

### A6. Shared worker unit

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A6.1 | Install `deploy/control-plane/liwan-shared-worker.service` (adjust the prefix and account), `systemctl daemon-reload`. Do not start it: the release `commit` step starts it. | `systemctl cat liwan-shared-worker` | the unit with `EnvironmentFile=/etc/liwan/shared-worker.env`, not running | |
| A6.2 | After the first release (A8) it runs, exactly once | `systemctl is-active liwan-shared-worker; pgrep -fc shared-worker-main` | `active`, count `1` | |

The release command stops and starts this worker itself during a release; do not manage it by hand afterwards.

### A7. Openship job and hook

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A7.1 | Job `liwan-development-release` on the Contabo server, manual trigger, command `set -a; . /etc/liwan-release/github-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py run --environment development` (the entry point in [release/README.md](../../deploy/release/README.md); the checkout path is the one from A3.4) | MCP `post_jobs`, then `get_jobs_by_key` | the job exists with that command and no token among its secrets | |
| A7.2 | Jobs run as root, so the release config and the token files are root-owned | the P0 check: a run printing `id` | `uid=0` | |
| A7.3 | A hook of type job, token mode, attached to the development tracked project from A2.2 | MCP `post_projects_by_id_incoming_webhooks` {actionType job, authMode token} | a hook URL of the form `https://openship.liwanos.com/api/proxy/api/webhooks/incoming/<hookId>` and a token | |
| A7.4 | The hook URL and token go into the secrets of the GitHub repository `tariiq222/liwan` as `LIWAN_DEVELOPMENT_HOOK_URL` and `LIWAN_DEVELOPMENT_HOOK_TOKEN` (never printed; the owner or the coordinator types them in the repository settings). Openship job `liwan-development-release` is the hook's target | GitHub: repository Settings, Secrets and variables, Actions | both names listed (values hidden) | |
| A7.5 | The hook rejects a missing or wrong token and accepts the right one | `curl -s -o /dev/null -w '%{http_code}' -X POST <hook url>` with no token, a wrong token, the right token | `404`, `404`, `200` | |

### A8. First release

| # | Step | Command | Expected | Observed |
| --- | --- | --- | --- | --- |
| A8.1 | The `main` commit has a published release document | `docker manifest inspect ghcr.io/tariiq222/liwan-release:<main sha>` with the read token | the manifest exists | |
| A8.2 | Run the job once from Openship | MCP `post_jobs_by_key_run`, then `get_jobs_runs_by_runId` | last log line `RESULT: committed <commit>`, exit 0 | |
| A8.2a | The file `shared-runtime.json` names as `composeFile` was rendered by the run, before the worker started, with the owner and mode of `shared.env` (`600 liwan-worker:liwan-worker`) | `stat -c '%a %U:%G' /srv/liwan-development/shared.compose.json /srv/liwan-development/shared.env` | both lines equal and the owner is `liwan-worker`, not root (the release refuses a root-owned `shared.env` that group and others cannot read, before anything stops) | |
| A8.2b | The AI role exists, so the `ai` service could connect (A4.8) | `docker exec <project>-db-1 psql -U odoo -d postgres -tAc "select count(*) from pg_roles where rolname='liwan_ai'"; docker ps --filter name=-ai-1 --format '{{.Status}}'` | `1`; the `ai` container `Up` and healthy | |
| A8.3 | State written | `set -a; . /etc/liwan-release/github-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py status --environment development` | the served commit, no run, no halt | |
| A8.3a | The host `pg_dump` reaches the tenant database over loopback with masquerade disabled on the `liwan-dbhost` bridge | `PGPASSFILE=/etc/liwan-release/pgpass <pg_dump path from the release config> -h 127.0.0.1 -p 15433 -U odoo --schema-only <one existing database> > /dev/null; echo $?`; also record `docker info \| grep -iE 'userland|firewall'` | `0`; Observed: record Docker's `userland-proxy` setting and firewall backend (the `docker info` lines) | |
| A8.4 | Nothing of the stack listens beyond loopback | `ss -ltnp \| grep -E ':(18080\|18443)'` and `docker ps --format '{{.Names}} {{.Ports}}'` | only `127.0.0.1:18080` and `127.0.0.1:18443`; no other published port from the stack | |
| A8.4a | Restore and relay sites are on :80 with the tenant sites, and the closed restore route answers 404 through the edge | `docker exec <proxy> wget -qO- --server-response --header 'Host: rabc.restore.dev.liwanos.com' http://127.0.0.1:80/ 2>&1 \| head -3`; `ss -ltn` inside the container shows no :443 | `404`, no :443 listener | |
| A8.4b | The trust in `X-Forwarded-For` has no other way in: no self-hosted runner is registered for the repository, and no container but the Openship edge uses the host network | `docker ps --filter network=host --format '{{.Names}}'`; the repository's Settings, Actions, Runners page | only the Openship edge listed; no runner | |
| A8.5 | The stack answers through the edge with valid TLS (the path is `/favicon.ico` because the guard refuses `/` on the prospect host with 403 when no tenant is named) | `curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.dev.liwanos.com/favicon.ico` | a 2xx or 3xx and `0` | |
| A8.6 | Caddy sees the real client | request `https://app.dev.liwanos.com/` from a machine with a known address and a spoofed header `X-Forwarded-For: 6.6.6.6`; read the Caddy access log or the signup path's `X-Liwan-Signup-Client` | the machine's own address, never `6.6.6.6` and never `172.29.50.1`. The request itself answers 403 (the guard refuses `/` on the prospect host with no tenant); it is only there to produce the log line, so a 2xx is not expected | |
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
| A9.7 | A merge to `main` reaches development with no manual step | merge a trivial change; watch the GitHub publish run (amd64), the hook call and the Openship job | `RESULT: committed <new commit>` with no command typed | |
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
| B5 | No self-hosted runner is registered for the repository while it is public (a fork pull request could run code on it), so nothing on this host builds images or runs job code. | GitHub runner settings |
| B5a | Replaces A8.4b. Any local process that can open `127.0.0.1:18080` reaches Caddy as the trusted `edge` gateway and could forge `X-Forwarded-For`. Check that no other process runs untrusted code here: `docker ps --filter network=host --format '{{.Names}}'` lists only the edge, and the repository has no registered runner. | host |
| B6 | A 4 GB swap file; the stack is capped at 6 GB (the host has 12 GB). | `/etc/fstab`, compose limits |
| B7 | The candidate is the highest `release/19.0.X.Y.Z` tag, not `main`. The document must carry `linux/arm64` digests and the tag commit must be on GitHub `main`. The server is updated only when the owner says to publish to staging: the tag is created, the tag run builds arm64 (about 17 to 18 minutes), then calls the staging hook. | [release/README.md](../../deploy/release/README.md) |
| B8 | The job `liwan-staging-release` has a token hook; its URL and token go into the repository secrets `LIWAN_STAGING_HOOK_URL` and `LIWAN_STAGING_HOOK_TOKEN` (A7.3 to A7.5, with the staging job). The tag run calls it as its last step. | Openship, GitHub |
| B9 | A merge to `main` does not reach this server (replaces A9.7): publish a test tag and watch the arm64 build, the hook call and the job end in `RESULT: committed <commit>`. | acceptance |

Staging acceptance: the A9 rows with the staging hostnames. Every production tag is served here first.

---

## C. Production on the Oracle Jeddah host

Scope and approval are in plan part P7: this section is its skeleton, to be completed there. The steps repeat section
A with these differences (staging, section B, is the model for an Arm host).

| # | Difference | Where |
| --- | --- | --- |
| C1 | The host is `liwanos-prod` (Arm). Oracle port 22 answers only `158.220.75.44`. The host is registered in the Openship on the Contabo host. | Oracle security list; MCP `post_system_servers` |
| C2 | Hostnames are `liwan.sa`, `*.liwan.sa`, with `app`, `admin` and `portal` (D15). Whether production sits behind an Openship edge or runs Caddy on 80/443 is decided at P7 (D18). With an edge, set `LIWAN_TRUSTED_PROXIES` to its gateway, `LIWAN_AUTO_HTTPS=off`, `http://` in `DOMAIN` and loopback bind, as development and staging do. Without one, leave `LIWAN_TRUSTED_PROXIES` empty and Caddy terminates TLS. | `deploy/environments/production.env.example` |
| C3 | The job is `liwan-production-release` with the command `set -a; . /etc/liwan-release/github-read; set +a; python3 -B /opt/liwan/current/deploy/release/release.py run --environment production --tag <tag>` (an explicit tag; the job never picks the highest tag by itself, owner decision 2026-11-21), and it has no hook. The owner starts it from Openship after the tag exists (D19). | Openship |
| C4 | The release candidate is the explicit tag `release/19.0.X.Y.Z` given to the job, on GitHub `main`, never the highest tag by itself; the arm64 images are published and staging served and passed this tag. | [release/README.md](../../deploy/release/README.md) |
| C5 | No production credential in GitHub secrets or on any runner. The read credential is a separate machine-account token for this server, kept only in `/etc/liwan-release/github-read` (root, 0600) on `liwanos-prod`, not copied into the Openship job's secret store (check as in A5.1). | GitHub, Openship |
| C6 | Backups go to a store inside the Kingdom. Public sign-up stays closed until the owner opens it. | P7 |

Production acceptance (P7): a tagged release reaches production from the release document staging served; a forced failed
health check rolls back by itself; port 22 refuses any other address; no production credential exists on a runner or
in GitHub secrets. Use the same row format as section A for each.

## When the repository goes private (checked 2026-11-21, not permanent facts)

- Servers need `LIWAN_GITHUB_READ_TOKEN` in `github-read` (A5.1).
- GitHub-hosted runner minutes become paid (arm64 Linux 2-core 0.005 USD per minute against a monthly included
  amount). arm64 is built only on a release tag, so the cost applies per tag. The build then moves to a self-hosted
  runner on `liwanos-staging` (self-hosted minutes are free today; GitHub postponed a 0.002 USD per minute fee it
  announced in December 2025, without a new date).
- GHCR container storage and transfer are free today, with one month's notice promised before billing.
- Packages stay private always, also while the repository is public.

## Not covered here

- The control and admin hostnames (`control.*`, `admin.*`) and their routes: the shared Caddyfile has no site for
  them. They come from [control-plane-deployment.md](control-plane-deployment.md) and the vendor console snippet.
- Backups and monitoring of the tooling server (plan P6).
