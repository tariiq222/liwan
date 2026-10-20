# Odoo and API rules

Layer-specific rules for `odoo-addons/`, the `/api/v1` routes and Odoo test runs. The
architecture rules R1-R10, authorization and Git workflow are in `AGENTS.md`.

## Odoo addon and API rules

- Every Python file starts with `# Part of Odoo. See LICENSE file for full
  copyright and licensing details.` Addon manifests use `'license': 'LGPL-3'`,
  author `Tariq Alwalidi`, and a new addon starts at version `19.0.1.0.0` (later bumps follow
  `docs/migrations.md`). Do not add Enterprise dependencies; OCA dependencies only from the
  pinned repositories of `deploy/oca-addons.json` (owner decision 2026-10-18). Keep `ruff check odoo-addons` clean.
- Routes use `@http.route('/api/v1/...', type='json2', auth='user',
  methods=[...], readonly=<bool>)` and `@api_handler`. Errors use
  `{"code": "<snake_case>", "message": "<human>", "field"?: "<name>"}`
  with a real HTTP status: 403 `forbidden` or `transition_forbidden`, 404
  `not_found`, and 422 `invalid`. Never use `type='http'` for JSON or
  `auth='bearer'` for browser traffic. Never use `sudo()` to dodge an access
  error; fix the group or record rule.
- An application registers its capabilities by extending `webvue.access.service`
  through `super()`: `_webvue_capability_definitions` (with `owner` set to the
  addon), `_webvue_permission_dependencies`, `_webvue_builtin_role_grants`, and when
  needed `_webvue_legacy_capability_keys`, `_webvue_record_company`,
  `_webvue_customer_actor_keys` and `_webvue_legacy_admin_roles`. An application that
  scopes permissions to its own records (PMO: `project`) registers that context kind in
  `_webvue_scope_kinds` (its contextual permissions and contextual roles) and decides them in
  `_webvue_contextual_capability` and `_webvue_contextual_role_held`; the foundation knows no
  kind by name, and a context kind is never assignable. Its data declares
  its groups, permission records and role, then calls
  `_webvue_configure_permission_dependencies` and `_webvue_repair_builtin_role_grants`.
  Moving an xml id between addons needs a `pre-` migration that renames the
  `ir_model_data` row.
- Serializers whitelist fields explicitly: shared shapes belong in
  `webvue_api/serializers`, PMO shapes in `webvue_pmo/serializers`, and HR shapes
  in `webvue_hr/serializers`. Never send a raw ORM `read()` result. Every write
  returns the full detail shape.
- Task state names on the wire are
  `in_progress | changes_requested | approved | waiting | done | cancelled`,
  mapped to Odoo `01_in_progress | 02_changes_requested | 03_approved |
  04_waiting_normal | 1_done | 1_canceled`. Write and approve capabilities
  and record-specific allowed actions decide transitions; do not infer them
  from a legacy role label.
- Plans («باقة») are what customers buy; bundles («حزمة», managed only in the WebVue vendor administration, `apps/vendor-admin`) are
  the app groups inside them; Track A packages are read-only history. Every
  application of the release is installed in every shared-SaaS tenant, and a
  policy or compiled entitlement carries every key of every release application
  (closed: `false` / `0`; catalog `deploy/catalog/solutions/platform_v4.json`, `commercial-compiler/2`).
  `_webvue_validate_features` stays strict; operator scripts complete a target with
  `_webvue_close_unlisted_features`, and `webvue.tenant.profile._register_hook`
  registers a newly installed application's keys closed. Usage is collected per
  limit key; removing an application is not a downgrade below usage.
- Branding source of truth is `res.company`; `deploy/branding.json` seeds it.
  The public branding response is cached. The customer UI edits and sends only
  `primary_color`, and ignores stored secondary colour for rendering. The API
  retains optional `secondary_color` compatibility; it rejects identity fields
  and mixed identity/color requests before any write.
- PMO project management uses record-scoped `_webvue_can_manage` and checked
  private mutation helpers. Task writes, approvals, archive, dependency edits
  and attachment mutations preserve their dedicated capability/visibility gates.
- Documented PMO elevated operations are policy/config access, policy-based
  project creation, checked manager mutations, serializer display lookups,
  integer counts, automatic completion status after an authorized task
  mutation, the notification cron scans, and the recipient-owned candidate
  lookups that build PMO's notification visibility branches. `webvue_notify`'s
  documented elevated operations are bell delivery and recipient-owned bell
  reads: every elevated read first restricts to the current partner's inbox
  rows, and the owning application's branch decides, in the caller's ordinary
  ACL and record-rule environment, which tasks or meetings are still readable.
  Meeting-only access must not reveal task/digest notifications. Do not add an
  undocumented bypass.
- The project charter is written as a stepper: basics, then the optional
  steps the project type configures (`charter_steps` on `webvue.project.type`,
  exposed on the types catalog and on `charter.type`), then review. The
  charter carries `state` (`draft | final`); a new charter is a draft and the
  review step finalizes it. `/projects/new` uses the route-backed create panel
  (`SharedCreatePanel`), like other `/new` routes.
- Task comments are one conversation per task family: `/tasks/{id}/timeline`
  returns the comments of the topmost readable ancestor and every readable
  descendant (each carries `task`), while tracking entries stay per task. A
  comment is stored on the task it was posted from. `POST .../comments` takes
  plain-text `body` plus optional `mentions` (user ids, the `/people`
  population) and `task_refs` (family task ids from `.../thread-tasks`); the
  server marks up only declared `@name` / `/task name` tokens present in the
  text. A mention sends one `mention` notification, only to a person who can
  read the task, and replaces that person's `comment` row.
- Task attachment uploads accept PDF, PNG, JPEG, text, DOCX and XLSX up to
  10 MiB decoded, with exact binary task linkage and ordinary attachment ACLs.
  The validator is `webvue_api/serializers/attachment.py`, shared by task,
  meeting and chat uploads; HR documents keep their own parser.
  Dependency edits require project management, same active project, positive
  unique IDs and no cycles. Restores require a readable active parent project.
- A new application starts from `python3 -B tools/new_app.py <app> --name-ar <ar>
  --name-en <en>` and the `webvue-new-app` skill. Outside its own folders it edits
  only three registration files: `tools/arch_layers.json`,
  `deploy/catalog/solutions/platform_v4.json` and `packages/contracts/src/index.ts`
  (plus copies written by `python3 -B tools/catalog_check.py --sync-release-copies`).
  It edits `deploy/catalog/solutions/platform_v4.json` in place only while that catalog is unpublished; after the
  first publish a new application needs a new `platform_vN.json`, decided before the first
  server deploy.


## Odoo development

- Use the `odoo-workflow` skill before any Odoo change; trace real source into a
  Context Brief with `file:line`, then consult the `odoo-19` reference pack.
- Runtime: Odoo **19.0**, read-only core `/Users/tariq/code/odoo`, custom addons
  in this checkout's `odoo-addons/`. `.claude/odoo.json` is machine-local and
  already gitignored; it pins `odoo_version`, `odoo_root`, `addons` (a JSON
  array), and `python`, deliberately without a live config or `dev_db`.
  Read-only trace command from the repo root (use Python 3.12 for core syntax):
  `/Users/tariq/code/odoo/.venv/bin/python /Users/tariq/.agents/skills/odoo-workflow/scripts/odoo_trace.py env`.
- Never run against named/live databases (including `odoo19`); use an explicitly
  isolated throwaway database and scratch-only config, data directory and logs.
  Odoo tests run only through the Check commands below or `npm run test:odoo`, never against a named or live database.
- Manifests: Odoo copyright header, `LGPL-3`, author `Tariq Alwalidi`,
  `category: Hidden`, `installable: True`, `application: False`; versions use
  `19.0.X.Y.Z` (the current numbers are in each manifest). Follow
  `docs/migrations.md` for schema/data version bumps and migrations.
- Declare real dependencies: core uses `base` only; HR uses `webvue_api`, `hr`,
  `mail`; the shared services `webvue_notify` (`webvue_api`, `mail`) and
  `webvue_directory` (`webvue_api`) know no application; PMO also uses
  `webvue_platform`, `webvue_notify`, `webvue_directory`, `project`, `bus`; meetings
  use `webvue_platform`, `webvue_notify`, `webvue_directory`, `calendar`, `mail`; the bridge `webvue_meetings_pmo` (`auto_install`) uses
  `webvue_meetings` and `webvue_pmo` (see manifests). Preserve pillar direction:
  shared `webvue_api` and the shared services never import a pillar, and one
  application never imports another; only a bridge imports both.
- Keep `models/`, `security/`, `data/`, `tests/`; API pillars additionally use
  `controllers/` and whitelist-based `serializers/`; PMO has `i18n/` and
  `migrations/`; `webvue_meetings` has `report/` (the meeting report moved there). Import Python modules through their `__init__.py` files;
  list every XML/CSV file in manifest `data` in the required dependency order.
- Every `/api/v1` route has `api_handler`, a feature gate and a capability gate:
  `@requires_capability('<key>', ..., match='all')` from `webvue_api/controllers/common.py`
  (403 `forbidden`; `match='any'` accepts one of the keys; decorator order is `route`,
  `api_handler`, `requires_feature`, `requires_capability`; it cannot grant a record-contextual
  capability), or a top-level `require_capability` call (or a refusing `if not has_capability`) in
  the handler or a helper it calls before it returns data. A route intentionally without a capability (own-account,
  recipient-owned rows, model-level checks) is listed with its reason in
  `tools/route_gate_allowlist.json`; `tools/route_gate_policy.py` (also run by
  `tools/test_route_gate_policy.py` in `npm test`) fails on any other route and on a
  `request.env[<non-constant>]`. The route to gate matrix (route-capabilities.json beside openapi.json in docs/api), generated by
  `tools/api_surface.py` at integration only, lists every operation's gate.
- New models use dotted `webvue.*` names and `WebVue*` classes; extend stock models
  with `_inherit`, not copies. Model files and local XML ids use snake_case
  (`permission_access_users_read`, `webvue_hr_document_company_rule`); qualify
  cross-addon ids. ACLs live in `security/ir.model.access.csv` (PMO also has
  suffixed ACL CSVs), with `access_*` ids and `model_<dots_as_underscores>` refs.
- Tests live in `tests/test_*.py`. `tests/__init__.py` is
  `from odoo.addons.webvue_core.testing import import_all_tests` followed by
  `import_all_tests(__name__)`, so no test file can be left out of the run (`webvue_finance` and `webvue_hr` are converted to it at the next integration; from then
  on only the helper style is accepted, with the vendored OCA addon `base_tier_validation` as the
  single documented exception. `tools/test_addon_test_imports.py` enforces this and its
  `EXPLICIT_IMPORTS_ALLOWED` set shrinks with each conversion).
  Model tests use `TransactionCase`; HTTP tests use `WebVueApiCase(HttpCase)` via
  `WebVueHrCase` / `WebVuePmoCase`. Mirror existing `webvue` / `webvue_access` tags and
  `post_install`, `-at_install` selection where appropriate.
- Arabic: PMO ships `i18n/ar.po`; core/HR currently have no `i18n/` directory.
  Core capability data has explicit `name_ar` / `name_en` fields. Keep shipped
  PO filenames; make new UI strings extractable and update Arabic translations.
- Lint: `ruff check odoo-addons` uses root `ruff.toml` (upstream Odoo rules;
  imports: stdlib, third-party, `odoo`, `odoo.addons`). No pylint-odoo
  configuration exists; the optional local git hooks come from `npm run hooks:install`
  (`tools/hooks.py`). Do not introduce another convention.
- Authorized module tests: use the **Check commands** block below
  and `deploy/ci/odoo.sh` (the **odoo** stage, including its classification fixture; the
  **odoo-app-standalone** and **odoo-bridge** matrix stages run the same shape for every
  application alone and every bridge with its two sides, see `docs/testing.md`),
  with the selected checkout's explicit addons path, `-i` modules,
  `--test-tags /<addon>` and `--stop-after-init`. Require a nonzero test count;
  preserve isolation/cleanup. These are documented commands, not run by setup.

## Check commands (Odoo scratch database)

Run Odoo checks from `/Users/tariq/code/odoo` using a fresh scratch database
and the selected WebVue worktree's explicit addons path. Use a scratch-only
config at `/absolute/path/to/scratch-only.conf`; do not use a live config whose
`data_dir` or `logfile` points inside the read-only Odoo checkout. Keep the
temporary data and logs outside that checkout, and remove the scratch database,
temporary data, logs, and scratch-only config after the check:

```sh
export PYTHONDONTWRITEBYTECODE=1
cd /Users/tariq/code/odoo
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
ODOO_CONF=/absolute/path/to/scratch-only.conf
WORKTREE=/absolute/path/to/webvue-worktree
# Pinned OCA addons (deploy/oca-addons.json): fetch once, shared by every worktree (docs/oca-addons.md).
(cd "$WORKTREE" && python3 -B tools/oca_addons.py fetch)
OCA_PATH="$(cd "$WORKTREE" && python3 -B tools/oca_addons.py path)"
SCRATCH_ROOT=$(mktemp -d)
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
export WEBVUE_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
(cd "$WORKTREE" && python3 deploy/classification.py fixture --database webvue_scratch --mode saas --output "$WEBVUE_COMMERCIAL_CONFIG")
# Set PGHOST, PGPORT, PGUSER, and PGPASSWORD in the environment as needed;
# never put a password on the command line.
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-tariq}
# The release module list is derived from the catalog, as in deploy/ci/odoo.sh.
MODULES="$(cd "$WORKTREE" && python3 -B tools/catalog_check.py --release-modules)"
TAGS="/${MODULES//,/,/}"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons,$OCA_PATH" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d webvue_scratch --db-filter='^webvue_scratch$' \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -i "$MODULES" --test-tags "$TAGS" \
  --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init
```


## Account contact create (R9 exception)

The access-grant capability (`group_cap_access_users_grant`) holds no `res.partner` create ACL.
`webvue.access.service._webvue_create_account` creates the one contact of a new account inside
`protected_write.marked` with `PARTNER_CREATE_MARKER` set to the caller's uid, after its own
`access.users.grant` check, and the `odoo-addons/webvue_core/models/res_partner.py` override of the public
`check_access` passes only the `create` operation while that marker holds the current uid; every other
operation and every other caller keeps Odoo's ACLs and record rules. No Odoo method body is copied.
Regression evidence: `test_grant_capability_creates_a_contact_only_inside_the_account_create` in
`odoo-addons/webvue_api/tests/test_access_admin.py`. Do not widen the marker to other fields or callers.

## Managed document engine boundaries

`webvue_documents` uses pinned, unmodified OCA DMS in attachment mode. Its business
policy lives on `webvue.document`; native groups do not grant a second document ACL.
Only the actual Odoo operator identity passes bootstrap/migration guards. An elevated
environment retaining a customer uid and `base.group_system` are insufficient.

The scoped `odoo-addons/webvue_documents/models/ir_binary.py` override of `ir.binary._record_to_stream` is the
required R9 exception: Odoo's `_find_record` accepts a limited-field token and elevates
before ordinary ACL checks ([Odoo 19 binary source](/Users/tariq/code/odoo/odoo/addons/base/models/ir_binary.py:23)). The source calls
this an extensible hook. The adapter checks the original actor, canonical attachment,
company, feature and archive policy before delegating streaming; it wraps response
headers with private/no-store and nosniff. No Odoo method body is copied.
Regression evidence: `odoo-addons/webvue_documents/tests/test_document_downloads.py` exercises real limited-field tokens,
legacy tokens, unmanaged aliases, native portal routes, HEAD/Range, authorized reads
and archive revocation. `odoo-addons/webvue_documents/tests/test_dms_boundaries.py` covers raw ORM and warm caches.

OCA's public `filtered_domain` returns all elevated records. The managed file/directory
extensions filter its result by the owned document policy so core warm-cache ACL
checks and exports cannot bypass it; non-managed resources keep their base policy.
Public read/copy guards retain original actor checks. Do not add private native
`_search`, `check_access` or `_check_access` overrides or customer `sudo` here.

The attachment-mode create adapter fills existing DMS size/checksum metadata from the
same attachment because upstream removes content before its inverse runs. It neither
copies bytes nor claims quota. `webvue_platform` remains the sole quota writer through
`ir.attachment`. A company policy fence handles stale role snapshots; lock order is
company policy, document policy fence, document, tenant profile, then file/grant writes.
Metadata operations share the company/fence/profile policy locks while each
aggregate retains an exclusive document lock. Upload takes an exclusive profile
lock upfront, reused by quota claims; existing non-document callers remain
exclusive. Public routes perform one protected operation per transaction; future
multi-operation transactions need an explicit lock-upgrade design and tests.
Independent cursor tests cover parallel different-document edits, stale writers,
role/grant/feature revocation and competing upload capacity.

Document/native rules embed the owned permission SQL subquery. The existing owned
`_filtered_access` and read guard batch candidate checks; serializers batch page
permissions and registered provider labels. Never introduce a long-lived permission
result cache. Pinned OCA still discovers inherited candidates with `array_agg` and
materializes IDs on cold native rule construction; this upstream O(n) boundary is
not removed by the adapter optimization.

Document detail contains summary plus body. Files use the bounded collection
`GET /api/v1/documents/<id>/files` (default 50, maximum 200), returning
`items`, `total`, `revision`. UI requests pin the observed positive `revision`;
a mismatched revision returns 409 and restarts traversal after refreshing detail.
Mutation responses retain the complete current detail shape and invalidate file
pages. Metadata context/tag lookups search and page in the provider's normal
company/ACL environment, retaining selected values outside the current page.
