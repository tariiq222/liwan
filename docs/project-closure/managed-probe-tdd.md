# Managed read-only probe: bounded TDD handoff

## Scope and ownership

Worktree `/Users/tariq/code/nasq-managed-saas-acceptance`, branch
`codex/managed-saas-acceptance`, baseline `d780862e`. This slice owns only
`tools/nasq_cli/managed_probe.py`, `tools/test_managed_probe.py`, and this document.
The parent owns `managed_runtime.py`, secret resolution, provisioning and any
separately authorized real acceptance run. `generate.py` is unchanged.

One explicitly read-only Docker list-format compatibility check was performed;
no database action, connection, image pull, install, commit, merge, deployment or
live-resource modification was performed. Every runner and port socket in the
unit tests is a fixture/mock.

## Integration API

```python
from nasq_cli.managed_probe import DockerProbe, ProbeError

probe = DockerProbe(descriptor, catalog_path=explicit_catalog_file, runner=runner)
# runner(argv, env=None, stdin_text=None) -> (exit_code, stdout, stderr)
# probe(check, value=None) -> digest / identity / strict bool
```

Supported checks are exactly the existing preflight names: `catalog_sha256`,
`image_identity`, `compose_file`, `database_exists`, `project_exists`,
`volume_exists`, `network_exists`, `port_in_use`. Arguments must match the bound
descriptor. Unknown/unavailable/malformed observations raise `ProbeError`; its
`.code` and string are sanitized constants and do not include private paths,
Docker output, config content or secrets. Map this exception to a **pre-effect
conflict**, not journal uncertainty/quarantine. Constructor makes no observations
and copies the descriptor; the parent still validates full enrollment/digest.

After secret resolution and before any effect call
`probe.validate_runtime_inputs(secrets)` with `db_password`/`admin_password`.
It statically revalidates all Compose/config files, compares INI password values
with `hmac.compare_digest`, and returns `{absolute_path: "sha256:..."}` for
Compose, Odoo INI, commercial classification and Caddyfile. It runs no Docker.
Before each mutation/readback call `probe.assert_unchanged(snapshot)` on the
**same** probe instance: it only accepts its own nonempty approved map and
re-reads file bytes, rejecting missing, unsafe or changed inputs. Snapshots and
secret values must not be put in public receipts. This mitigates normal edits,
not an adversarial file replacement in the read/exec micro-race.

The runner must enforce shell=False, a hard timeout and bounded output. **A
truncated output must be a failure, never a successful tail:** truncated JSONL
could falsely omit an existing resource. The original runtime runner returned a
successful output tail; the parent was notified to fix this integration seam.
The probe itself rejects outputs over 1 MiB and listings over 10,000 rows. No
unbounded retry is performed. PATH/HOME/LANG are the only inherited runner env
keys, stdin is always None. Read-only argv families:

- `docker image inspect --format '{{json .}}' <immutable-reference>`
- `docker container ls --all --format '{"Name":{{json .Names}},"Project":{{json (.Label "com.docker.compose.project")}}}'`
- `docker volume ls --format '{"Name":{{json .Name}},"Project":{{json (.Label "com.docker.compose.project")}}}'`
- `docker network ls --format '{"Name":{{json .Name}},"Project":{{json (.Label "com.docker.compose.project")}}}'`

Catalog SHA-256 is computed from the explicit file bytes, not descriptor claims.
Images require exact full `.Id` or exact member of `RepoDigests`; no tags,
substring matching, pulls, Compose execution, or database queries. Resource list
commands project only JSON `Name` and exact `com.docker.compose.project` label
values via Docker's Go-template `.Label` helper; Python requires exactly those
keys and typed values. Other labels and metadata are never parsed or emitted.
Malformed projected entries fail the entire observation. Project labels are
compared exactly. Conventional container names match an anchored exact-project/
service/positive-replica pattern (both Compose hyphen/underscore naming), not
project substrings. A project-owned label on any listed volume/network is
conservatively a collision even if renamed.
Ports use temporary IPv4 loopback bind without SO_REUSEADDR; EADDRINUSE means
held (including non-listening bind), other errors are unavailable. No connect.

## Narrow normalized Compose contract

This is intentionally **not** a general Compose validator. JSON only, duplicate
keys refused; exact top-level `name`, `services`, `volumes`, `networks`. `name`
must equal descriptor project. Services are exactly `db`, `odoo`, `web`, `edge`.

| Service | Image | Published ports | Environment | Mounts |
| --- | --- | --- | --- | --- |
| db | local immutable image ID or repo digest | `127.0.0.1:<ports.db>:5432` | exact POSTGRES_DB target db_name; POSTGRES_USER `odoo`; POSTGRES_PASSWORD `${POSTGRES_PASSWORD}` | `db_data:/var/lib/postgresql/data` |
| odoo | exact release_ref.odoo_image | `127.0.0.1:<ports.odoo>:8069` | exact NASQ_COMMERCIAL_CONFIG `/etc/odoo/commercial.json` | `odoo_data:/var/lib/odoo`; private config to `/etc/odoo/odoo.conf:ro`; classification to `/etc/odoo/commercial.json:ro` |
| web | exact release_ref.web_image | none | exact NUXT_ODOO_URL `http://odoo:8069`; NUXT_ODOO_DB target db_name | none |
| edge | exact release_ref.proxy_image | `127.0.0.1:<ports.web>:80` | empty/omitted | private Caddyfile to `/etc/caddy/Caddyfile:ro` |

Every service has `networks: ["tenant_net"]`. Top-level network definition is
`{"tenant_net":{"name":"<project>-private"}}`, optionally `driver:"bridge"`.
No custom IPAM, external network or driver options. Volumes are exactly
`{"db_data":{"name":"<project>-db"},"odoo_data":{"name":"<project>-odoo"}}`.
No external volumes, device binds, drivers or implicit Docker-assigned names.

Alternatively Odoo data may use one absolute explicit directory **strictly below**
descriptor `data_dir`; then omit `odoo_data` top-level definition. Root/broad
system directories and symlinks are refused. Existing data directory must be empty
to establish fresh-target absence. Database data **must** remain a new named
project-owned volume, never a host bind.

Bindings accept short-string syntax only and exact destinations; no extra binds,
docker socket, RW config, directory config mounts or symlinks in any source path
component. Config files must be under Compose parent, regular, owned by current
operator and not group/world writable (0444 allowed for container UID reads).
Use canonical resolved paths on macOS: `/tmp` is a symlink to `/private/tmp`.
The parent must keep the enrollment directory private.

Allowed optional service fields: `restart` no/unless-stopped, unique list-form
`depends_on` naming only other approved services, and `expose` exactly service
ports (db 5432, Odoo 8069/8072, web 3000, edge 80). All other fields are rejected,
including build, entrypoint, command, healthcheck, privileged, capabilities,
network_mode, devices, extends/include, env_file, custom container names and
security options. Unknown fields are not silently ignored. The only Compose
interpolation accepted is the exact DB password expression in the table.

### Odoo config and classification

INI config has only `[options]`, no DEFAULT section or duplicate keys. Required
exact options: `db_host=db`, `db_port=5432`, `db_user=odoo`, `db_name=<target>`,
`dbfilter=^<target>$`, `list_db=False`, `proxy_mode=True`. `db_password` and
`admin_passwd` must be nonempty; the parent compares them to resolved handles
before mutation. No unsupported HOST/USER/PASSWORD or NASQ_PG_PASSWORD shortcut.
Required `workers=2` and `max_cron_threads=0` keep the approved acceptance
process model fixed; optional
`http_port=8069`, `gevent_port=8072`, `data_dir=/var/lib/odoo`, and
`addons_path=/opt/odoo/addons,/opt/nasq/addons` have fixed values. Unknown hooks
and alternate database endpoints are refused.

Classification is required and exactly:

```json
{"schema_version":1,"database":"<target db_name>","commercial_mode":"saas","entitlement_source":"control_plane","expected_valid_until":null,"valid_until_action":"preserve"}
```

Schema version is a strict integer. Caddyfile bytes must **exactly** equal the
parent-owned `managed_bundle.CADDYFILE` constant: auto_https/admin off; Odoo
API/content paths to odoo:8069, websocket to odoo:8072, fallback web:3000.
Arbitrary private proxy configs are refused. Parent acceptance still owns actual
route validation. This introduces a one-way import from probe to managed_bundle;
the pure renderer must not import probe.
Existing generator output is not presumed compatible: it lacks this descriptor's
port/resource/config contract. Parent supplies a separately reviewed safe fixture.

## Database absence and evidence limits

`database_exists` returns False only after revalidating isolated Compose/config,
locally inspecting its pinned DB image, observing **all** containers (including
stopped) without target project/name, and observing no target DB/Odoo volume or
private network, including project-labeled renamed resources. Existing target
resources raise `database_absence_unverified`, not False or an invented DB
existence observation. Unreadable Docker never becomes absence. Existing DBs are
never connected to, enumerated or modified.

Observations are fresh per call, not atomic reservations. Concurrent external
Docker/file changes after preflight remain a time-of-check/time-of-use risk:
parent must enforce its operation lock, private immutable inputs and isolated
resource ownership. Host bind checks do not reserve the port. This probe is not
post-provisioning health evidence. Descriptor currently lacks a DB image field:
Compose pins and locally verifies DB image, but it is not bound to a descriptor
release DB digest. Pinned image contents, Caddy route behavior and real service
health are not proven by these fixture tests.

## RED → GREEN evidence

Command (worktree root):

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools python3 -B -m unittest tools/test_managed_probe.py
python3 -B -m ruff check --no-cache tools/nasq_cli/managed_probe.py tools/test_managed_probe.py
```

- RED before implementation: 18 tests, 18 failures explicitly reporting missing
  `managed_probe`; exit 1. No implementation existed at that point.
- Additional parent-requested RED: two missing runtime-snapshot method errors;
  one arbitrary Caddyfile acceptance failure, each exit 1 before guard changes.
- GREEN final: 28 tests, OK, exit 0. Table-driven subtests cover malicious Compose,
  image mismatch, unavailable/malformed Docker, exact collision identities,
  unknown query, protected/wrong database query, fresh-volume absence, private
  bind freshness, symlink/writable configs, unsafe Odoo config and classification,
  missing catalog, and bind-not-connect port behavior.
- Focused Ruff: initial 9 style findings corrected; final `All checks passed!`.
- `coverage` package absent; no install. Python stdlib `trace.Trace(count=True)`
  around test discovery + run, compared against `trace._find_executable_linenos`,
  measured **324/324 executable lines (100.0%)**. This is line coverage only,
  not branch coverage, independent review or real runtime evidence. Trace data
  stayed in memory; no coverage files were created.

## Bounded projection regression follow-up

- Regression RED: `PYTHONPATH=tools python3 -m unittest tools.test_managed_probe.DockerProbeCase.test_projected_resource_rows_ignore_commas_and_irrelevant_metadata_size` failed for all three resource kinds before implementation because the old parser demanded full-row `Labels`.
- GREEN: `PYTHONPATH=tools python3 -m unittest tools.test_managed_probe` passed 29 tests after implementing narrow rows; existing tests were adjusted to the new `Name`/`Project` shape.
- Fixture coverage includes a comma-rich full `Labels` field containing mounted-config paths plus over 70 KiB of irrelevant label text; the projected test runner drops it before the mock subprocess output. The test asserts the exact template string and preserves fail-closed behavior for missing/wrong projected fields.
- Read-only live format check of those exact resource projections: container exit 0 / 37 rows / schema valid; volume exit 0 / 198 rows / schema valid; network exit 0 / 16 rows / schema valid. No row contents were recorded. This demonstrates compatibility with the current local daemon only, not all Docker versions.
- No coverage threshold rerun. No mutations, DB access, commit or merge.

## Self-evaluation

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | 28 tests and lint pass; actual Docker JSON behavior is fixture-modeled, not live-verified. |
| Completeness | 4/5 | All requested probes and narrow safety checks exist; general Compose intentionally refused and atomic resource reservation is not implemented. |
| Clarity | 4/5 | Exact contract documented; a future canonical fixture schema could reduce contract prose. |
| Actionability | 4/5 | Parent received API and truncation warning; runtime integration remains parent-owned. |
| Conciseness | 4/5 | Three scoped outputs only; validator remains sizable because every accepted config field is explicit. |

Overall **4.0/5**. Highest-impact follow-ups: parent runner truncation safety and
ProbeError mapping; independent adversarial review; separately authorized actual
acceptance. These are not claims of deployed or production readiness.
