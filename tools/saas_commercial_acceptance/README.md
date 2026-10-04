# Nasq SaaS commercial acceptance stack (`nasq-saas-commercial-acceptance`)

Isolated local Docker project for commercial C2 acceptance. Derived from
`tools/shared_saas_lifecycle` (same service names `db odoo guard web vendor-* control-* proxy`
so `odoo_effect.py`/`subscription_effect.py` label checks hold). **Local scratch only; not production.**

## Simulated / not real
- Payment: `NASQ_PAYMENT_PROVIDER=simulator` (no Moyasar, no real money).
- Mail: `NASQ_MAIL_MODE=smtp` to the local Mailpit container (capture only; UI http://127.0.0.1:55428, SMTP 127.0.0.1:55427). Nothing leaves the host.
- TLS: Caddy local CA (`.state/<project>/caddy-root.crt` once exported). No real DNS.

## Ports and hostnames
- Edge HTTPS 127.0.0.1:8443, HTTP 127.0.0.1:8080, control DB 127.0.0.1:55449, Mailpit 55427/55428.
- Hosts: `vendor.saas.commercial.nasq.test`, tenants `t<hex>.saas.commercial.nasq.test`
  (+ `*.restore.saas.commercial.nasq.test` for the restore profile). Public URLs are **portless**
  (the guard rejects a Host with a port; payment return origins are `https://vendor.saas.commercial.nasq.test`).
  Chromium maps them with `--host-resolver-rules=MAP *.saas.commercial.nasq.test 127.0.0.1:8443`;
  curl uses `--connect-to ::127.0.0.1:8443` (`sca_curl` in `acceptance-env.sh`).
- Networks use explicit 10.241.x.0/24 subnets (Docker address pools are exhausted on this host).
- Volumes are named `nasq-sca-*`. Private state: `.state/` and `.secrets/` (git-ignored, 0600).

## Prepare / up (run from the worktree root)
```sh
docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" -t nasq-odoo:sca .
docker build -f deploy/shared/Dockerfile -t nasq-guard:sca .
docker build -f deploy/proxy/Dockerfile -t nasq-caddy:sca .
docker build -f tools/shared_saas_lifecycle/Control.Dockerfile -t nasq-control:sca .
docker build -f apps/web/Dockerfile --build-arg NASQ_TENANCY_MODE=shared -t nasq-web:sca-shared .
docker build -f apps/web/Dockerfile --build-arg NASQ_TENANCY_MODE=dedicated -t nasq-web:sca-vendor .
L=tools/saas_commercial_acceptance/commercial_lifecycle.py
python3 $L prepare
python3 $L compose up -d --wait db vendor-db control-db
python3 $L bootstrap-vendor
python3 $L compose up -d odoo vendor-odoo control-api control-worker web vendor-web mailpit guard proxy
python3 $L bootstrap-catalog
source tools/saas_commercial_acceptance/acceptance-env.sh
python3 $L compose exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > "$NASQ_SCA_CA"
sca_curl https://vendor.saas.commercial.nasq.test/login -o /dev/null -w '%{http_code}\n'
npx playwright test --config tools/saas_commercial_acceptance/playwright.config.mjs
```
`status`: `python3 $L state` and `python3 $L compose ps`. `prepare` refuses to overwrite `.state/current.json`.
The guard stays unhealthy until the first tenant binding exists (empty registry fails closed), so do not `--wait` it.

## Restore profile (E14: real DB + filestore backup/restore with reconciliation)
Kept from the shared compose, inactive by default; `prepare` also runs the restore preparation.
```sh
python3 $L compose --profile restore up -d --wait restore-db restore-odoo restore-web
python3 $L compose --profile restore up -d proxy   # applies the restore.Caddyfile include
```
Backup/restore drivers: `tools/shared_saas_lifecycle/odoo_backup.py` via the worker (runtime scope = project name).

## Policy
No `down`/`rm` (`compose` refuses them). Stop only with `python3 $L compose stop`; evidence lives in
`.state/nasq-saas-commercial-acceptance/evidence/`. Never touch other projects' containers/volumes/networks
(`nasq-saas-life-*`, `nasq-saas-commercial` control-pg 55491, `nasq-saas-commercial-mail` 55425/55426, etc.).
The worker mounts the Docker socket and the worktree path; keep the worktree while the stack is used.
