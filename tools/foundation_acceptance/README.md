# Worker provisioning acceptance

Explicit local operator proof that the real control-plane API and shared worker
create **two independent Odoo databases and filestores**, then each generated
administrator signs in through the current shared TLS edge, reads its own
`/api/v1/me` identity/company and cannot use its session on the other tenant.
No seeded tenant, copied addon or product behavior override is used.

Run from a clean committed checkout with its own installed dependencies
(`npm ci --ignore-scripts --prefer-offline`) and Node from `.nvmrc`:

```sh
LIWAN_IMAGE_TAG=<matching-built-tag> \
  node --import tsx tools/foundation_acceptance/provision_two_tenants.mjs
```

The local images must already exist at that tag: `liwan-odoo`, `liwan-web` (shared build),
`liwan-guard`, `liwan-caddy` (pinned rate-limit module), `liwan-ai-egress` and
`liwan-odoo-mail` (build commands: `tools/shared_acceptance_live/README.md`), plus `postgres:16`. The harness neither builds nor pulls images. Image IDs,
source commit, commands' exit codes and result rows are recorded. The operator
must establish that these image IDs were built from that source; a matching tag
alone is not build provenance.

`FOUNDATION_SOURCE_ROOT` may point at a different clean committed checkout; the
API, worker, catalog and the stack definition (`deploy/stack/compose.yml`) come from that
root. Its packages/dependencies must be prepared independently. The harness code and
`control-db.yml` remain those next to this README.

The stack is the one every environment runs: `tools/shared_acceptance_live/stack_render.py`
renders it from `deploy/environments/local.env.example` plus the harness values (image tag,
domain, ports, subnets, secrets) and `docker compose config` resolves it into the run's
`compose.yml`. `control-db.yml` only adds the scratch control database; nothing is layered
over a stack service, no source file is mounted into a container and there is no Caddyfile of
the harness. The harness domain is `foundation.liwan.localhost`: a `.localhost` name never
qualifies for a public certificate, so Caddy issues it from its internal CA. In `--commercial`
mode the stack's `odoo-mail` relay (STARTTLS only) is replaced by a Mailpit container that
answers to the `odoo-mail` name on the stack's internal mail network, so the first
administrator's email code reaches the capture. `FOUNDATION_OUTPUT_DIR` selects an
existing output parent; the default is the operating system's temporary
directory. A new private per-run directory is always created below it, and its
parent and every ancestor must belong to the operator's account or root and not
be group- or world-writable: `effect_gate.py` enforces that trust on the runtime
paths inside the run directory, so the macOS default under `/private/var/folders`
qualifies while `/tmp` on Linux does not, and there `FOUNDATION_OUTPUT_DIR` must
name a private parent.

Four free high loopback ports are chosen automatically. To pin reserved values,
set `FOUNDATION_HTTPS_PORT`, `FOUNDATION_HTTP_PORT`, `FOUNDATION_CONTROL_PORT` and
`FOUNDATION_CONTROL_DB_PORT`. They must be distinct non-development ports above
1023; standard edge, PostgreSQL and development ports are refused. The control
database lives in the **run's own PostgreSQL container and named volume**; host
PostgreSQL is never used. Project names and Docker subnets are isolated per run.

The API client connects to the selected loopback TLS port with verified local
CA trust, tenant SNI and an explicit tenant `Host` without a port. This tests the
current production Host contract without changing Caddy/guard or occupying
80/443. It is an **API edge proof**; it does not prove browser routing at a high
port. The separate shared browser harness owns that evidence.

The shared services, including guard/proxy, must become healthy with a real
empty revision-zero registry **before** onboarding. The edge must reject an
unknown host. A source/image that cannot bootstrap this way fails acceptance;
the harness does not postpone guard startup or insert a fake tenant.

Provisioning uses the supported development-only vendor owner CLI, signed dev
login/step-up routes, catalog import/publish, tenant creation and the
real `worker:shared`. It waits for the product's `active` state, reads back the
published database/filestore binding, independently checks each physical
database and filestore, and uses the worker-generated admin credentials.
Requests are not automatically retried after errors.

## Commercial acceptance

With a local Mailpit image (`axllent/mailpit:latest`) and OpenSSL, pass
`--commercial` to run one vendor-created paid customer instead of the
two-tenant fixture. The script records the actual Mailpit image ID and only
opens SMTP and mail capture on loopback. The payment provider is the simulator.

```sh
LIWAN_IMAGE_TAG=<matching-built-tag> \
  node --import tsx tools/foundation_acceptance/provision_two_tenants.mjs --commercial
```

The signed vendor calls create the customer, quote, order, and simulator
attempt. A real worker settles fulfillment, provisions Odoo, and sends the
first administrator's invitation. The harness accepts the invitation through
the public control API, tests that it cannot be reused, and signs into the
tenant through the TLS edge with the email code captured by Mailpit. The
operator then requests a backup, approves restoration into an independent
PostgreSQL and Odoo pair, and asks the worker to publish the verified recovery
route. The test checks the source and restored subscription revision and
attachment bytes, as well as the recovered login page.

This mode starts from a vendor-created customer. Public self-registration,
the browser invitation form, and real payment processing have their own
acceptance criteria.

At success, failure or the first interrupt, the tool stops its control processes,
captures Compose diagnostics and stops the Compose services. **Containers,
volumes, databases, logs, generated credentials and runtime state are retained.**
There is no `--down`, volume deletion or database-drop action. Any later cleanup
is a separate authorized operator operation. The console shows the private run
directory and project; `run.json`, `result.json` and private `logs/` contain the
evidence. Logs and Compose configuration can contain secrets: keep the run
directory private and do not attach it to a public review. Public classifications
and registry files are readable inside their bind mounts; their host parent is
mode 0700. Linux config ownership must match the runtime uid (root may set that
ownership); otherwise the tool fails and requests operator provisioning, without
relaxing the product config validator.

Focused checks require no Docker, Odoo, PostgreSQL or model API:

```sh
node --test tools/foundation_acceptance/lib.test.mjs
node --check tools/foundation_acceptance/provision_two_tenants.mjs
```

These results are for the local shared stack. Browser pages beyond the recovered
login route, live updates, capacity, Linux acceptance, and `non_saas` need
separate evidence. Historical results stay pinned to their source and images.
