# Real shared SaaS lifecycle acceptance

This is an opt-in **local scratch** runtime. It proves worker-driven real Odoo
provisioning from the vendor browser UI. The restore profile additionally verifies real backup/restore and four-host
isolation; see docs/verification/shared-restore-acceptance.md for dated evidence.
It is not a production deployment, real payment integration or capacity certification.

The harness keeps vendor Odoo/Postgres, customer Odoo/Postgres and control
Postgres separate, with unique project-scoped volumes and explicitly owned
networks. The only seeded company is the vendor identity. Customers are created
exclusively by the application's shared worker. Empty registry startup stays
closed; the guard restarts until the first disabled customer binding exists.
The worker enables that binding only after independent real Odoo readback and
HTTP authentication. Generated passwords remain in private ignored files, never
HTTP responses, command arguments or logs. The operator reads those files for
local acceptance; customer invitation/password delivery is a later product step.

## Prepare and run

Run from this worktree's root. Requires Docker, local npm dependencies and the
Playwright Chromium runtime. Local ports 80, 443 and 55447 must be free.

```sh
# Rebuild these base images if the configured verified local images are absent.
docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" -t nasq-odoo:saas-life .
docker build -f deploy/shared/Dockerfile -t nasq-guard:saas-life .
docker build -f deploy/proxy/Dockerfile -t nasq-caddy:saas-life .
# Supply these only for prepare when using the rebuilt tags above.
export NASQ_LIFECYCLE_ODOO_IMAGE=nasq-odoo:saas-life
export NASQ_LIFECYCLE_GUARD_IMAGE=nasq-guard:saas-life
export NASQ_LIFECYCLE_CADDY_IMAGE=nasq-caddy:saas-life

docker build -f tools/shared_saas_lifecycle/Control.Dockerfile -t nasq-control:saas-life .
docker build -f apps/web/Dockerfile --build-arg NASQ_TENANCY_MODE=shared -t nasq-web:saas-life-shared .
docker build -f apps/web/Dockerfile --build-arg NASQ_TENANCY_MODE=dedicated -t nasq-web:saas-life-vendor .
python3 tools/shared_saas_lifecycle/lifecycle.py prepare
python3 tools/shared_saas_lifecycle/lifecycle.py compose up -d --wait db vendor-db control-db
python3 tools/shared_saas_lifecycle/lifecycle.py bootstrap-vendor
python3 tools/shared_saas_lifecycle/lifecycle.py compose up -d odoo vendor-odoo control-api control-worker web vendor-web guard proxy
python3 tools/shared_saas_lifecycle/lifecycle.py bootstrap-catalog
npx playwright test --config tools/shared_saas_lifecycle/playwright.config.mjs
# Run after the happy-path browser acceptance, on this isolated project only.
python3 -B -m tools.shared_saas_lifecycle.fault_acceptance
```

`prepare` refuses to replace `.state/current.json`. Resume with `state` and
`compose ps`; do not re-run `bootstrap-vendor` against an existing database.
`bootstrap-catalog` safely resumes fixture import/validate/publish through the
existing admin command and signed API. Wait for the API health check before it.
`compose up --wait` is suitable after the first binding; before that, the guard
intentionally cannot become healthy with an empty registry.

Playwright resolves `*.saas.accept.nasq.test` to loopback inside Chromium; normal
browsers require local DNS/host mapping. The script accepts the private local
certificate for browser automation only. Independently validate TLS using the
project's public Caddy root certificate:

```sh
python3 tools/shared_saas_lifecycle/lifecycle.py compose exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > /tmp/nasq-saas-lifecycle-ca.pem
curl --cacert /tmp/nasq-saas-lifecycle-ca.pem --resolve vendor.saas.accept.nasq.test:443:127.0.0.1 https://vendor.saas.accept.nasq.test/login -o /dev/null
```

Evidence is under `.state/<project>/evidence/`, outside Git and Docker build
contexts. Each browser rerun creates another fresh scratch customer; failed
attempts and their evidence are retained. The fault test kills only this
project's worker or briefly stops its control DB during an owned install. It
waits for natural lease expiry, expects intervention and disabled routing, and
never changes lease timestamps, resets a job, or retries a physical effect.

## Stop without destroying evidence

```sh
python3 tools/shared_saas_lifecycle/lifecycle.py compose stop
```

There is no automatic destructive teardown. Keep the worktree while this runtime
is needed: container mounts reference its absolute paths. The shared worker has
Docker socket access for this opt-in operator experiment; production isolation
and runtime packaging still require separate design/acceptance.

## Real restore profile (second acceptance stage)

The restore lane has its own Postgres and filestore volumes, private networks,
Odoo/web/guard services, session keys and proxy token. It uses
`*.restore.saas.accept.nasq.test`; original customer bindings are not replaced.
Prepare adds missing private settings and preserves committed credentials on
replay, including after an interrupted environment write.

```sh
python3 tools/shared_saas_lifecycle/lifecycle.py prepare-restore
python3 tools/shared_saas_lifecycle/lifecycle.py compose --profile restore config --quiet
python3 tools/shared_saas_lifecycle/lifecycle.py compose --profile restore up -d --wait restore-db restore-odoo restore-web
# Validate before applying the new restore include to the existing local edge.
python3 tools/shared_saas_lifecycle/lifecycle.py compose --profile restore run --rm --no-deps --entrypoint caddy proxy validate --config /etc/caddy/Caddyfile
python3 tools/shared_saas_lifecycle/lifecycle.py compose --profile restore up -d proxy
```

The empty restore registry remains closed. The restore test starts its guard
only after the operator helper publishes a verified target. Original services
remain the same project; capture temporarily pauses shared Odoo and therefore
briefly interrupts all original local customers. This is not an online backup
or a production availability guarantee.

After the real adapter migration and worker are loaded, run the second stage:

```sh
# Create another fresh browser-managed customer if only one successful proof exists.
npx playwright test --config tools/shared_saas_lifecycle/playwright.config.mjs
npx playwright test --config tools/shared_saas_lifecycle/lifecycle-checks.config.mjs
python3 -B -m tools.shared_saas_lifecycle.restore_readback
```

The stage selects the last two complete first-tenant browser proofs, triggers
backups and restores through the signed vendor BFF, rejects cross-tenant backup
approval and consumed-approval reuse, opens the restored copies with the
original administrators' credentials, compares attachment bytes, then tests
the four-host cookie matrix. `restore_readback` independently compares business
rows, installed modules, policy and physical file bytes on both original and
restored services. Artifacts and passwords stay private under `.state/`.
A test being present does not establish acceptance: use the dated verification
record and successful evidence from the actual run.
