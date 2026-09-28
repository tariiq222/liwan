# Single-target managed bundle — TDD evidence

## Scope

This child owns only the three new files `tools/nasq_cli/managed_bundle.py`,
`tools/test_managed_bundle.py`, and this document. Worktree:
`/Users/tariq/code/nasq-managed-saas-acceptance`, branch
`codex/managed-saas-acceptance`. Existing runtime/probe and prior verifier files
were not edited. `deploy/managed-local/generate.py` was read but left untouched.
No Docker command, database/network access, provisioning, commit or merge was
performed. Temporary test files contained synthetic fixture tokens only.

## API and security contract

```python
from nasq_cli.managed_bundle import BundleError, CADDYFILE, render_bundle

outputs = render_bundle(
    descriptor,
    postgres_image=immutable_postgres_reference,
    db_password=database_secret,
    admin_password=database_manager_secret,
)
```

The pure renderer returns exactly four UTF-8 text contents by basename:
`compose.json`, `odoo.conf`, `commercial.json`, `Caddyfile`. It does not read or
write files, invoke a process, discover resources, allocate ports, or mutate the
descriptor. `BundleError.code` is limited to `descriptor_invalid`, `image_invalid`,
and `secret_invalid`; diagnostic text never includes input values.

Inputs require:

- An explicitly SaaS descriptor, a safe project and explicit `nasq_scratch_*`
  database, and an absolute `compose.json` destination path without traversal or
  control/interpolation characters.
- Three distinct unprivileged integer loopback ports, excluding canonical and
  control-plane ports. No bool/string coercion.
- Three descriptor image references matching `identity_kind` (`image_id` or
  `repo_digest`), plus an explicitly immutable PostgreSQL reference. The renderer
  validates shape only; the parent/probe must inspect actual image identity.
- Distinct database and database-manager secrets, each 24–256 characters from
  `[A-Za-z0-9_-]`. Newlines, INI delimiters, whitespace, shell/Compose interpolation,
  Unicode and empty/short values are refused. Length/alphabet validation does not
  establish entropy: the parent must generate cryptographically random values.

The Compose document pins four services (`db`, `odoo`, `web`, `edge`). Only
PostgreSQL 5432, Odoo 8069 and edge 80 are published, using the corresponding
explicit descriptor ports on `127.0.0.1`. Web is internal on 3000; Odoo websocket
is internal on 8072. The only network is `tenant_net` named `<project>-private`.
Named volumes are exactly `db_data` → `<project>-db` and `odoo_data` →
`<project>-odoo`, matching the current probe's absence checks. No arbitrary
entrypoint, command, build, privilege, external mount or proxy setting is copied
from the descriptor.

Compose's database environment uses the literal `${POSTGRES_PASSWORD}`. **The
parent must pass the exact same database secret as `POSTGRES_PASSWORD` when
running Compose.** No `.env` file or generated credential file is added. The
Odoo configuration contains actual `db_password` and `admin_passwd`, fixed
`db_host=db`, `db_port=5432`, `db_user=odoo`, exact database/filter,
`list_db=False`, `proxy_mode=True`, `workers=2`, `max_cron_threads=0`, and fixed
image paths/ports. Odoo config, commercial classification and Caddy config are
read-only binds. Classification is explicit SaaS/control-plane, no expiry,
preserve semantics, bound to the exact scratch database.

**`admin_passwd` controls Odoo database management, not the application admin
login.** Before starting reachable services, the parent must separately
initialize the application administrator's non-default login credential. This
renderer neither performs nor proves that step. `list_db=False` alone does not
replace credential initialization.

The exported `CADDYFILE` constant is the one fixed template that the probe can
import/pin. It disables automatic HTTPS and Caddy's admin endpoint; serves
container port 80; routes `/api/v1` and descendants plus `/web/content` and
descendants to Odoo 8069; routes `/websocket` and descendants to Odoo 8072; and
routes all remaining requests to Nuxt 3000. No TLS, rate-limit plugin, dynamic
imports, arbitrary upstreams, or vendor-console expansion is included. This is
local acceptance configuration, not production ingress.

## Persistence and operational boundaries

The parent owns exclusive file creation and permission checks: target root
0700, Compose 0600, configs 0444 for container readability as agreed. Even a
read-only 0444 `odoo.conf` contains secrets; the enclosing private directory must
remain 0700. Never publish any rendered bundle contents or embed them in logs,
receipts, documentation, or diagnostics. Tests assert credentials occur only in
`odoo.conf`, not Compose, commercial JSON or Caddy text.

The renderer does not authenticate descriptor digests, inspect filesystem
symlinks/ownership, assert resource absence, check port availability, reserve
resources, or wait for PostgreSQL readiness. Parent/probe must perform those
checks, execute the initial-only policy and independent snapshot verification,
initialize application credentials, and only then start/declare services ready.

## RED → GREEN

Journeys: an authorized operator renders a deterministic single-target bundle;
a runtime probe accepts its exact static shape; malformed inputs cannot inject
configuration or disclose credentials through errors.

Command run from the assigned worktree:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools python3 -B -m unittest discover -s tools -p test_managed_bundle.py -v
```

1. **RED before implementation:** 13 tests, 13 expected failures, exit 1:
   `managed_bundle implementation missing (RED)`.
2. First implementation run found 10 errors: the reserved-token check mistakenly
   considered the required `nasq_` prefix a reserved suffix. Corrected the check
   to inspect only the suffix after `nasq_scratch_`; tests were not weakened.
3. **GREEN:** 13 tests passed, exit 0, including current `DockerProbe` compatibility.
4. `python3 -B -m ruff check --no-cache tools/nasq_cli/managed_bundle.py tools/test_managed_bundle.py`:
   `All checks passed!`, exit 0.
5. `git diff --check`: exit 0 (tracked whitespace check; the new Python files
   additionally pass Ruff).

| Guarantee | Test | Result |
| --- | --- | --- |
| Deterministic four-file output, unchanged input, no I/O | exact-output and pure-render tests | PASS |
| Exact service/port/network/named-volume contract | exact-compose and service-environment tests | PASS |
| Correct Odoo options and explicit classification | config and classification tests | PASS |
| Fixed API/content/websocket/frontend proxy template | Caddy constant test | PASS |
| Probe accepts actual persisted bundle with named volumes | current `DockerProbe('compose_file', path)` with fake immutable image runner | PASS |
| Unsafe secrets, injection, tags, targets and ports fail safely | secret/image/descriptor/port/error tests | PASS |

The compatibility test persists the four outputs in a disposable private
fixture directory and invokes the current probe. Its runner accepts only the
expected `docker image inspect --format '{{json .}}' <pinned-postgres>` argv and
returns a synthetic matching identity; **no Docker process runs**.

## Coverage and self-review

The environment lacks `coverage`; an in-memory standard-library `trace.Trace`
run executed the same unittest discovery and compared executed lines for
`managed_bundle.py` to `trace._find_executable_linenos(path)`. Result:
**95/95 executable lines, 100.0%**, uncovered `[]`, 13 tests passing. No coverage
artifacts were written. This is line coverage, not branch or live-runtime proof.

Self-review: accuracy 4/5 (probe fixture compatibility, not real Compose/Caddy
execution); completeness 4/5 (requested renderer/tests complete, live acceptance
intentionally delegated); clarity 4/5 (sensitive output and admin-login boundary
explicit, parent integration still required); actionability 4/5 (API and fixed
constant shared early, no persistence helper by design); conciseness 4/5 (single
pure renderer plus focused tests, validations duplicate a narrow subset of
runtime guards). Overall **4.0/5**. Highest-value remaining check is authorized
parent acceptance against the actual pinned images, after credential setup.
