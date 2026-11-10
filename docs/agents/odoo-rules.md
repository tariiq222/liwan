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
  The one exception is the public namespace `/api/v1/public/` (owner decision D3, 2026-10-28):
  routes for anonymous visitors, `auth='public'` and `save_session=False`, authorized by a
  per-document access token or a gateway signature, never by a session (the Nuxt proxy
  forwards them without cookies); gateway callbacks there may be `type='http'`. Each is
  listed with its reason in `tools/route_gate_allowlist.json`.
- An application registers its capabilities by extending `liwan.access.service`
  through `super()`: `_liwan_capability_definitions` (with `owner` set to the
  addon), `_liwan_permission_dependencies`, `_liwan_builtin_role_grants`, and when
  needed `_liwan_legacy_capability_keys`, `_liwan_record_company`,
  `_liwan_customer_actor_keys` and `_liwan_legacy_admin_roles`. An application that
  scopes permissions to its own records (PMO: `project`) registers that context kind in
  `_liwan_scope_kinds` (its contextual permissions and contextual roles) and decides them in
  `_liwan_contextual_capability` and `_liwan_contextual_role_held`; the foundation knows no
  kind by name, and a context kind is never assignable. Its data declares
  its groups, permission records and role, then calls
  `_liwan_configure_permission_dependencies` and `_liwan_repair_builtin_role_grants`.
  Moving an xml id between addons needs a `pre-` migration that renames the
  `ir_model_data` row.
- Serializers whitelist fields explicitly: shared shapes belong in
  `liwan_api/serializers`, PMO shapes in `liwan_pmo/serializers`, and HR shapes
  in `liwan_hr/serializers`. Never send a raw ORM `read()` result. Every write
  returns the full detail shape.
- Task state names on the wire are
  `in_progress | changes_requested | approved | waiting | done | cancelled`,
  mapped to Odoo `01_in_progress | 02_changes_requested | 03_approved |
  04_waiting_normal | 1_done | 1_canceled`. Write and approve capabilities
  and record-specific allowed actions decide transitions; do not infer them
  from a legacy role label.
- Plans («باقة») are what customers buy; bundles («حزمة», managed only in the LiwanOS vendor administration, `apps/vendor-admin`) are
  the app groups inside them; Track A packages are read-only history. Every
  application of the release is installed in every shared-SaaS tenant, and a
  policy or compiled entitlement carries every key of every release application
  (closed: `false` / `0`; catalog `deploy/catalog/solutions/platform_v4.json`, `commercial-compiler/4`).
  `_liwan_validate_features` stays strict; operator scripts complete a target with
  `_liwan_close_unlisted_features`, and `liwan.tenant.profile._register_hook`
  registers a newly installed application's keys closed. Usage is collected per
  limit key; removing an application is not a downgrade below usage.
  Meetings, documents, operations and the AI assistant belong to the always-included
  platform base (catalog tier `core`, owner decision 2026-11-05), not to a bundle; their
  limits (`ai.messages.monthly`, `ai.tool_calls.per_run`) are platform limits every plan sets
  explicitly (`null` is unlimited). The `projects` tier is PMO only.
- Branding source of truth is `res.company`; `deploy/branding.json` seeds it.
  The public branding response is cached. The customer UI edits and sends only
  `primary_color`, and ignores stored secondary colour for rendering. The API
  retains optional `secondary_color` compatibility; it rejects identity fields
  and mixed identity/color requests before any write.
- PMO project management uses record-scoped `_liwan_can_manage` and checked
  private mutation helpers. Task writes, approvals, archive, dependency edits
  and attachment mutations preserve their dedicated capability/visibility gates.
- Elevated operations (`sudo()`, `with_user`, `env.su`): the single registry is
  `tools/arch_documented_sudo.json`, listed per file. Do not copy its cases into prose; read
  the registry. Rule R7 in `AGENTS.md` is enforced by `tools/sudo_gate.py` (inside `npm test`):
  a site beyond its file's documented cases or the `tools/arch_baseline.json` count fails,
  and every reason must name the elevating call and the blocking ACL or record rule. An
  elevated read keeps the caller's authorization in front of it (for notifications, rows are
  first restricted to the current partner's inbox, and the owning application decides in the
  caller's ordinary environment what is still readable; meeting-only access must not reveal
  task/digest notifications). Never add a case to dodge an access error; fix the group or rule first.
- Project creation uses the existing route-backed `SharedCreatePanel` and one
  create request; core objectives and success criteria are independent of the
  charter. The charter editor remains a governance-only stepper, with the
  project type's optional steps and `draft | submitted | approved` states.
  Live company tool policies (`enabled | optional | disabled`) govern all
  current/new projects; only optional preferences are project-writable.
  DESIGN.md owns presentation. Enabling a tool does not implicitly require
  approval, and tool policies never bypass capabilities or entitlements.
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
  The validator is `liwan_api/serializers/attachment.py`, shared by task,
  meeting and chat uploads; HR documents keep their own parser.
  Dependency edits require project management, same active project, positive
  unique IDs and no cycles. Restores require a readable active parent project.
- A new application starts from `python3 -B tools/new_app.py <app> --name-ar <ar>
  --name-en <en> [--route SLUG] [--dry-run]` and the `liwan-new-app` skill. It creates the
  application's own folders (addon, web pages/components, contracts namespace) and its AI bridge
  `liwan_<app>_ai` (rank 5, one agent, one read tool and the access test, from
  `tools/new_app_templates`). Outside those folders it edits exactly three registration files:
  `tools/arch_layers.json` (the application at rank 4, the bridge at rank 5, and its `web_apps` entry),
  `deploy/catalog/solutions/platform_v4.json` (a sellable tier with module `liwan_<app>` and feature
  `boolean:<app>.enabled`) and `packages/contracts/src/index.ts` (one export line). It then runs
  `python3 -B tools/catalog_check.py --sync-release-copies`, which rewrites the release module
  lists in `deploy/provision.sh`, `deploy/check_isolated.py`, `deploy/OPERATIONS.md`,
  `deploy/verification-checks.json`, `tools/liwan_cli/operator.py` and the other copies named in
  `RELEASE_COPIES` of `tools/catalog_check.py`. Nothing is written when any target exists or a check fails.
  It edits `deploy/catalog/solutions/platform_v4.json` in place only while that catalog is unpublished; after the
  first publish a new application needs a new `platform_vN.json`, decided before the first
  server deploy.


## Odoo development

- Before any Odoo change, trace the real source in `/Users/tariq/code/odoo` and cite
  `file:line` for the behavior you rely on, instead of relying on memory of Odoo 18 or older.
- Runtime: Odoo **19.0**, read-only core `/Users/tariq/code/odoo`, custom addons
  in this checkout's `odoo-addons/`. `.claude/odoo.json` is machine-local and
  already gitignored; it pins `odoo_version`, `odoo_root`, `addons` (a JSON
  array), and `python`, deliberately without a live config or `dev_db`.
- Never run against named/live databases (including `odoo19`); use an explicitly
  isolated throwaway database and scratch-only config, data directory and logs.
  Odoo tests run only through the Check commands below or `npm run test:odoo`, never against a named or live database.
- Manifests: Odoo copyright header, `LGPL-3`, author `Tariq Alwalidi`,
  `category: Hidden`, `installable: True`, `application: False`; versions use
  `19.0.X.Y.Z` (the current numbers are in each manifest). Follow
  `docs/migrations.md` for schema/data version bumps and migrations.
- Declare real dependencies, read from each addon manifest (core uses `base` only;
  shared services such as `liwan_notify` and `liwan_directory` depend on `liwan_api` and stock
  modules and know no application; a bridge such as `liwan_meetings_pmo` is `auto_install` and
  depends on exactly its two sides). Do not copy a dependency list into prose. Ranks are in
  `tools/arch_layers.json`. Preserve pillar direction:
  shared `liwan_api` and the shared services never import a pillar, and one
  application never imports another; only a bridge imports both.
- Keep `models/`, `security/`, `data/`, `tests/`; API pillars additionally use
  `controllers/` and whitelist-based `serializers/`; addons with user-facing strings have `i18n/`, and
  `migrations/` follow `docs/migrations.md`; `liwan_meetings` has `report/` (the meeting report moved there). Import Python modules through their `__init__.py` files;
  list every XML/CSV file in manifest `data` in the required dependency order.
- Every `/api/v1` route has `api_handler`, a feature gate and a capability gate:
  `@requires_capability('<key>', ..., match='all')` from `liwan_api/controllers/common.py`
  (403 `forbidden`; `match='any'` accepts one of the keys; decorator order is `route`,
  `api_handler`, `requires_feature`, `requires_capability`; it cannot grant a record-contextual
  capability), or a top-level `require_capability` call (or a refusing `if not has_capability`) in
  the handler or a helper it calls before it returns data. A route intentionally without a capability (own-account,
  recipient-owned rows, model-level checks) is listed with its reason in
  `tools/route_gate_allowlist.json`; `tools/route_gate_policy.py` (also run by
  `tools/test_route_gate_policy.py` in `npm test`) fails on any other route and on a
  `request.env[<non-constant>]`. The route to gate matrix (route-capabilities.json beside openapi.json in docs/api), generated by
  `tools/api_surface.py` at integration only, lists every operation's gate.
- New models use dotted `liwan.*` names and `LiwanOS*` classes; extend stock models
  with `_inherit`, not copies. Model files and local XML ids use snake_case
  (`permission_access_users_read`, `liwan_hr_document_company_rule`); qualify
  cross-addon ids. ACLs live in `security/ir.model.access.csv` (PMO also has
  suffixed ACL CSVs), with `access_*` ids and `model_<dots_as_underscores>` refs.
- Tests live in `tests/test_*.py`. First-party `tests/__init__.py` files call
  `import_all_tests(__name__)` from `liwan_core.testing`, so new test files are
  discovered automatically. The vendored OCA addon `base_tier_validation` is the
  sole exception allowed to import tests explicitly; `tools/test_addon_test_imports.py`
  enforces this boundary.
  Model tests use `TransactionCase`; HTTP tests use `LiwanApiCase(HttpCase)` via
  `LiwanHrCase` / `LiwanPmoCase`. Mirror existing `liwan` / `liwan_access` tags and
  `post_install`, `-at_install` selection where appropriate.
- Arabic: every addon with user-facing server strings ships `i18n/ar.po` (for example `liwan_hr`);
  an addon without such strings (for example `liwan_core`, most bridges) has no `i18n/` directory.
  Core capability data has explicit `name_ar` / `name_en` fields. Keep shipped
  PO filenames; make new UI strings extractable and update Arabic translations.
- Lint: `ruff check odoo-addons` uses root `ruff.toml` (upstream Odoo rules;
  imports: stdlib, third-party, `odoo`, `odoo.addons`). No pylint-odoo
  configuration exists; the optional local git hooks come from `npm run hooks:install`
  (`tools/hooks.py`). Do not introduce another convention.
- Authorized module tests. The normal local path is `npm run test:odoo` (`tools/odoo_test.py`): it
  clones a cached template database that has every release module installed, runs `-u` of the
  changed addons and their dependents, takes a free HTTP port from 8170-8199 and a unique
  `liwan_scratch_*` database per run, drops it afterwards, and queues through `tools/test_slot.py`.
  Options: `--addons a,b`, `--all`, `--base`, `--dry-run`, `--keep-db`. Its `-u` run sees a partial
  registry for low-rank `at_install` tests, so tests touching later modules are tagged
  `post_install` (see `docs/testing.md` section 1). The full fresh `-i` block under **Check commands**
  below is the release/CI-equivalent check; use it with `deploy/ci/odoo.sh` (the **odoo** stage, including its classification fixture; the
  **odoo-app-standalone** and **odoo-bridge** matrix stages run the same shape for every
  application alone and every bridge with its two sides, see `docs/testing.md`),
  with the selected checkout's explicit addons path, `-i` modules,
  `--test-tags /<addon>` and `--stop-after-init`. Require a nonzero test count;
  preserve isolation/cleanup. These are documented commands, not run by setup.

## Check commands (Odoo scratch database)

This is the full fresh-install (`-i`) check, equivalent to the CI **odoo** stage; for ordinary
local work prefer `npm run test:odoo`. Run Odoo checks from `/Users/tariq/code/odoo` using a fresh
scratch database and the selected LiwanOS worktree's explicit addons path. For concurrent runs take the
database name and HTTP port from the worktree's git-ignored `.env.worktree`
(`NUXT_ODOO_DB`, `ODOO_HTTP_PORT`) instead of a shared fixed name and port; the block below shows
`liwan_scratch` and 8169 only as the single-run default. Use a scratch-only
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
WORKTREE=/absolute/path/to/liwan-worktree
# Pinned OCA addons (deploy/oca-addons.json): fetch once, shared by every worktree (docs/oca-addons.md).
(cd "$WORKTREE" && python3 -B tools/oca_addons.py fetch)
OCA_PATH="$(cd "$WORKTREE" && python3 -B tools/oca_addons.py path)"
SCRATCH_ROOT=$(mktemp -d)
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
export LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
(cd "$WORKTREE" && python3 deploy/classification.py fixture --database liwan_scratch --mode saas --output "$LIWAN_COMMERCIAL_CONFIG")
# Set PGHOST, PGPORT, PGUSER, and PGPASSWORD in the environment as needed;
# never put a password on the command line.
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-tariq}
# The release module list is derived from the catalog, as in deploy/ci/odoo.sh.
MODULES="$(cd "$WORKTREE" && python3 -B tools/catalog_check.py --release-modules)"
TAGS="/${MODULES//,/,/}"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons,$OCA_PATH" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d liwan_scratch --db-filter='^liwan_scratch$' \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -i "$MODULES" --test-tags "$TAGS" \
  --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init
```


## Account contact create (R9 exception)

The access-grant capability (`group_cap_access_users_grant`) holds no `res.partner` create ACL.
`liwan.access.service._liwan_create_invitee` (called by `_liwan_invite_account`, which holds the
`access.users.grant` check; the account has no password until its holder accepts the emailed invitation) creates the one
contact of a new account inside `protected_write.marked` with `PARTNER_CREATE_MARKER` set to the caller's uid, and the `odoo-addons/liwan_core/models/res_partner.py` override of the public
`check_access` passes only the `create` operation while that marker holds the current uid; every other
operation and every other caller keeps Odoo's ACLs and record rules. No Odoo method body is copied.
Regression evidence: `test_grant_capability_creates_a_contact_only_inside_the_account_create` in
`odoo-addons/liwan_api/tests/test_access_admin.py`. Do not widen the marker to other fields or callers.

## Managed document engine boundaries

`liwan_documents` uses pinned, unmodified OCA DMS in attachment mode. Its business
policy lives on `liwan.document`; native groups do not grant a second document ACL.
Only the actual Odoo operator identity passes bootstrap/migration guards. An elevated
environment retaining a customer uid and `base.group_system` are insufficient.

The scoped `odoo-addons/liwan_documents/models/ir_binary.py` override of `ir.binary._record_to_stream` is the
required R9 exception: Odoo's `_find_record` accepts a limited-field token and elevates
before ordinary ACL checks ([Odoo 19 binary source](/Users/tariq/code/odoo/odoo/addons/base/models/ir_binary.py:23)). The source calls
this an extensible hook. The adapter checks the original actor, canonical attachment,
company, feature and archive policy before delegating streaming; it wraps response
headers with private/no-store and nosniff. No Odoo method body is copied.
Regression evidence: `odoo-addons/liwan_documents/tests/test_document_downloads.py` exercises real limited-field tokens,
legacy tokens, unmanaged aliases, native portal routes, HEAD/Range, authorized reads
and archive revocation. `odoo-addons/liwan_documents/tests/test_dms_boundaries.py` covers raw ORM and warm caches.

OCA's public `filtered_domain` returns all elevated records. The managed file/directory
extensions filter its result by the owned document policy so core warm-cache ACL
checks and exports cannot bypass it; non-managed resources keep their base policy.
Public read/copy guards retain original actor checks. Do not add private native
`_search`, `check_access` or `_check_access` overrides or customer `sudo` here.

The attachment-mode create adapter fills existing DMS size/checksum metadata from the
same attachment because upstream removes content before its inverse runs. It neither
copies bytes nor claims quota. `liwan_platform` remains the sole quota writer through
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

## Company-scoped native ACL fence (branch policy)

`liwan_core.models.ir_rule.IrRule._compute_domain` extends Odoo 19's native
`ir.rule._compute_domain` (upstream `/Users/tariq/code/odoo/odoo/addons/base/models/ir_rule.py:141`) with
an uncached company/operation fence. Stock ACL groups are global; LiwanOS grants
are company-scoped. The fence uses the native ACL group expression from
`ir.model.access._get_access_groups` and the groups of the actor's effective
company grants; it never promotes global group membership into a branch grant.
It is ANDed after the native cached domain so a revoked delegation or inherited
role is rechecked for searches, direct reads/writes and exports. Identity/access
metadata retain their protected service checks to avoid recursive authorization;
trusted transaction markers are never accepted from client context.
Regression evidence: `liwan_core/tests/test_branch_access.py`,
`liwan_api/tests/test_branch_access.py` and
`liwan_finance/tests/test_finance_branch_access.py` cover membership-only denial,
read-only delegation, operation gates, inheritance/revocation, ordinary ORM,
exports/attachment targets and real finance HTTP requests. No stock source or
ACL is weakened and no new elevated access is introduced.

### Native identity reference reads (branch fence exception)

The branch `ir.rule._compute_domain` extension preserves Odoo 19's native
`res.partner` **read** exception for `partner_share=False` (internal-user identities).
Source: `/Users/tariq/code/odoo/odoo/addons/base/security/base_security.xml:12-19`
explains why these references remain visible across companies; `/Users/tariq/code/odoo/odoo/addons/base/models/res_partner.py:443-448`
computes the flag from internal users. The exception remains ANDed with the original native
domain and native ACLs. It does not cover ordinary business contacts, writes, creates or
unlinks. The supported `ir.attachment._inaccessible_comodel_records` target-check hook
(upstream `/Users/tariq/code/odoo/odoo/addons/base/models/ir_attachment.py:591-617`) explicitly suppresses this read exception
while checking files, so visible identity references do not authorize foreign files.
Focused regressions cover foreign internal authors, ordinary foreign contacts, native
private identity rules, writes/unlinks and linked attachment denial.

Native `_compute_domain` recursively embeds `_inherits` parent rules inside its ormcache
(upstream `/Users/tariq/code/odoo/odoo/addons/base/models/ir_rule.py:141-152`). A trusted cursor marker keeps every recursive
native computation native-only. Fresh company/operation fences for the outer model and its
stored delegated parents are applied **after** that cache, including parent ACL projections.
Identity metadata such as `res.users` intentionally keeps only native inherited rules
for ordinary identity references; attachment target checks retain the fresh user/partner
fences instead. Protected account creation may reuse a validated current-company employee contact without
granting general business-contact create rights. Tests retain foreign-contact and ordinary
contact-create denial. This prevents native child caches from retaining revoked branch grants.

The optimized native attachment search also invokes `comodel._search` directly when the
`res_model` domain names at most five models (upstream
`/Users/tariq/code/odoo/odoo/addons/base/models/ir_attachment.py:650-677`). The narrow
`ir.attachment._search` wrapper forwards the original domain, pagination and native access
flags under the same target-check context, preserving native search while suppressing the
identity-reference exception. Regression checks include direct reads, exact-target searches
and counts for private files linked to both partner and user identities.


The HR extension of `_liwan_fresh_company_domain` adds a read-only staff/own-employee
fence for `hr.leave` and `hr.leave.allocation` after the native rule cache. Approve/manage
capabilities are checked in each already scoped owning company. The existing read-only
payroll engine grant (`hr_payroll_rules.xml:162-178`) is preserved only where the actual
`hr.payroll.read` capability is held. A parent's globally unioned native staff group
cannot reveal another branch employee's leave; own requests and actual branch staff
remain readable. The allocation owner is stored `employee_company_id`, related to the
employee company (upstream `/Users/tariq/code/odoo/addons/hr_holidays/models/hr_leave_allocation.py:74-77`);
its fresh read fence also intersects the model ACL/company scope so own employee identity
cannot authorize a foreign allocation. Warm inherited grants are rechecked after opt-out. Employee/version
readers likewise filter exact capability companies, and API contract/access fields use
the employee's owning-company capability rather than the parent capability.

Capability-group synchronization reads stored memberships through
`res.users.with_context(active_test=False).company_ids`, replacing its former stock
membership-table SELECT. This preserves archived memberships without using the active-only
`_get_company_ids()` result. Inverse `res.company.user_ids` changes invalidate the native
registry company cache (matching upstream
`/Users/tariq/code/odoo/odoo/addons/base/models/res_users.py:638-643`) and the transaction
branch memo. Focused tests retain archived memberships/reactivation and revoke warmed
branch/home scopes after inverse removal.

Branch authorization itself uses stored active memberships in the rollback-cleared
transaction memo, rather than native process-cached `_get_company_ids` (upstream
`/Users/tariq/code/odoo/odoo/addons/base/models/res_users.py:725-729`). A grant computed
inside a savepoint must disappear after rollback. The helper intersects actor/target
memberships for ordinary callers and reads native identity/company metadata in a separate
empty-company context with only the attachment target marker suppressed; the service's
policy root and operation scope stay unchanged. Cold users-target file denial is tested.
Inverse membership changes also reset cached environment properties, matching native
`res.users.write(company_ids)` at `/Users/tariq/code/odoo/odoo/addons/base/models/res_users.py:625-632`.
