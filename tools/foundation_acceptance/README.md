# Worker provisioning acceptance

Explicit local operator proof that the real control-plane API and shared worker
create **two independent Odoo databases and filestores**, then each generated
administrator signs in through the current shared TLS edge, reads its own
`/api/v1/me` identity/company and cannot use its session on the other tenant.
No seeded tenant, copied addon or product behavior override is used.

Run from a clean committed checkout with its own installed dependencies
(`npm ci --ignore-scripts --prefer-offline`) and Node from `.nvmrc`:

```sh
WEBVUE_IMAGE_TAG=<matching-built-tag> \
  node --import tsx tools/foundation_acceptance/provision_two_tenants.mjs
```

The local images must already exist: `webvue-odoo`, `webvue-web` (shared build),
`webvue-guard`, `webvue-accept-caddy` (pinned rate-limit module) at that tag,
plus `postgres:16`. The harness neither builds nor pulls images. Image IDs,
source commit, commands' exit codes and result rows are recorded. The operator
must establish that these image IDs were built from that source; a matching tag
alone is not build provenance.

`FOUNDATION_SOURCE_ROOT` may point at a different clean committed checkout; the
API, worker, catalog and production Compose files come from that root. Its
packages/dependencies must be prepared independently. The harness code and its
override remain those next to this README. `FOUNDATION_OUTPUT_DIR` selects an
existing output parent; a new private per-run directory is always created.

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
login/step-up routes, catalog import/validate/publish, tenant creation and the
real `worker:shared`. It waits for the product's `active` state, reads back the
published database/filestore binding, independently checks each physical
database and filestore, and uses the worker-generated admin credentials.
Requests are not automatically retried after errors.

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

This is not deployment/release approval. It does not cover the first-admin
invitation, MFA, entitlement denial, fail-closed registry mutations, browser
pages, backups/restores, live updates, capacity, Linux acceptance or `non_saas`.
The old restore helper and output-suppression workaround were deliberately
excluded: no current product publication path is proved by calling an internal
library. Historical results
remain pinned to their original source and are not results for this tool.
