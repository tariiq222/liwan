# Odoo and API rules

Layer-specific rules for `odoo-addons/`, the `/api/v1` routes and Odoo test runs. The
architecture rules R1-R10, authorization and Git workflow are in `AGENTS.md`.

## Odoo addon and API rules

- Every Python file starts with `# Part of Odoo. See LICENSE file for full
  copyright and licensing details.` Addon manifests use `'license': 'LGPL-3'`,
  author `Tariq Alwalidi`, and a new addon starts at version `19.0.1.0.0` (later bumps follow
  `docs/migrations.md`). Do not add OCA or
  Enterprise dependencies. Keep `ruff check odoo-addons` clean.
- Routes use `@http.route('/api/v1/...', type='json2', auth='user',
  methods=[...], readonly=<bool>)` and `@api_handler`. Errors use
  `{"code": "<snake_case>", "message": "<human>", "field"?: "<name>"}`
  with a real HTTP status: 403 `forbidden` or `transition_forbidden`, 404
  `not_found`, and 422 `invalid`. Never use `type='http'` for JSON or
  `auth='bearer'` for browser traffic. Never use `sudo()` to dodge an access
  error; fix the group or record rule.
- An application registers its capabilities by extending `nasq.access.service`
  through `super()`: `_nasq_capability_definitions` (with `owner` set to the
  addon), `_nasq_permission_dependencies`, `_nasq_builtin_role_grants`, and when
  needed `_nasq_legacy_capability_keys`, `_nasq_record_company`,
  `_nasq_contextual_capability`, `_nasq_identity_extra`,
  `_nasq_customer_actor_keys` and `_nasq_legacy_admin_roles`. Its data declares
  its groups, permission records and role, then calls
  `_nasq_configure_permission_dependencies` and `_nasq_repair_builtin_role_grants`.
  Moving an xml id between addons needs a `pre-` migration that renames the
  `ir_model_data` row.
- Serializers whitelist fields explicitly: shared shapes belong in
  `nasq_api/serializers`, PMO shapes in `nasq_pmo/serializers`, and HR shapes
  in `nasq_hr/serializers`. Never send a raw ORM `read()` result. Every write
  returns the full detail shape.
- Task state names on the wire are
  `in_progress | changes_requested | approved | waiting | done | cancelled`,
  mapped to Odoo `01_in_progress | 02_changes_requested | 03_approved |
  04_waiting_normal | 1_done | 1_canceled`. Write and approve capabilities
  and record-specific allowed actions decide transitions; do not infer them
  from a legacy role label.
- Plans («باقة») are what customers buy; bundles («حزمة», vendor console only) are
  the app groups inside them; Track A packages are read-only history. Every
  application of the release is installed in every shared-SaaS tenant, and a
  policy or compiled entitlement carries every key of every release application
  (closed: `false` / `0`; catalog `deploy/catalog/solutions/platform_v4.json`, `commercial-compiler/2`).
  `_nasq_validate_features` stays strict; operator scripts complete a target with
  `_nasq_close_unlisted_features`, and `nasq.tenant.profile._register_hook`
  registers a newly installed application's keys closed. Usage is collected per
  limit key; removing an application is not a downgrade below usage.
- Branding source of truth is `res.company`; `deploy/branding.json` seeds it.
  The public branding response is cached. The customer UI edits and sends only
  `primary_color`, and ignores stored secondary colour for rendering. The API
  retains optional `secondary_color` compatibility; it rejects identity fields
  and mixed identity/color requests before any write.
- PMO project management uses record-scoped `_nasq_can_manage` and checked
  private mutation helpers. Task writes, approvals, archive, dependency edits
  and attachment mutations preserve their dedicated capability/visibility gates.
- Documented PMO elevated operations are policy/config access, policy-based
  project creation, checked manager mutations, serializer display lookups,
  integer counts, automatic completion status after an authorized task
  mutation, the notification cron scans, and the recipient-owned candidate
  lookups that build PMO's notification visibility branches. `nasq_notify`'s
  documented elevated operations are bell delivery and recipient-owned bell
  reads: every elevated read first restricts to the current partner's inbox
  rows, and the owning application's branch decides, in the caller's ordinary
  ACL and record-rule environment, which tasks or meetings are still readable.
  Meeting-only access must not reveal task/digest notifications. Do not add an
  undocumented bypass.
- The project charter is written as a stepper: basics, then the optional
  steps the project type configures (`charter_steps` on `nasq.project.type`,
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
  The validator is `nasq_api/serializers/attachment.py`, shared by task,
  meeting and chat uploads; HR documents keep their own parser.
  Dependency edits require project management, same active project, positive
  unique IDs and no cycles. Restores require a readable active parent project.
- A new application starts from `python3 -B tools/new_app.py <app> --name-ar <ar>
  --name-en <en>` and the `nasq-new-app` skill. Outside its own folders it edits
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
- Declare real dependencies: core uses `base` only; HR uses `nasq_api`, `hr`,
  `mail`; the shared services `nasq_notify` (`nasq_api`, `mail`) and
  `nasq_directory` (`nasq_api`) know no application; PMO also uses
  `nasq_platform`, `nasq_notify`, `nasq_directory`, `project`, `bus`; meetings
  use `nasq_platform`, `nasq_notify`, `nasq_directory`, `cyan_meeting_minutes`,
  `calendar`, `mail`; the bridge `nasq_meetings_pmo` (`auto_install`) uses
  `nasq_meetings` and `nasq_pmo` (see manifests). Preserve pillar direction:
  shared `nasq_api` and the shared services never import a pillar, and one
  application never imports another; only a bridge imports both.
- Keep `models/`, `security/`, `data/`, `tests/`; API pillars additionally use
  `controllers/` and whitelist-based `serializers/`; PMO has `i18n/` and
  `migrations/`; `nasq_meetings` has `report/` (the meeting report moved there). Import Python modules through their `__init__.py` files;
  list every XML/CSV file in manifest `data` in the required dependency order.
- New models use dotted `nasq.*` names and `Nasq*` classes; extend stock models
  with `_inherit`, not copies. Model files and local XML ids use snake_case
  (`permission_access_users_read`, `nasq_hr_document_company_rule`); qualify
  cross-addon ids. ACLs live in `security/ir.model.access.csv` (PMO also has
  suffixed ACL CSVs), with `access_*` ids and `model_<dots_as_underscores>` refs.
- Tests live in `tests/test_*.py` and must be imported in `tests/__init__.py`.
  Model tests use `TransactionCase`; HTTP tests use `NasqApiCase(HttpCase)` via
  `NasqHrCase` / `NasqPmoCase`. Mirror existing `nasq` / `nasq_access` tags and
  `post_install`, `-at_install` selection where appropriate.
- Arabic: PMO ships `i18n/ar.po`; core/HR currently have no `i18n/` directory.
  Core capability data has explicit `name_ar` / `name_en` fields. Keep shipped
  PO filenames; make new UI strings extractable and update Arabic translations.
- Lint: `ruff check odoo-addons` uses root `ruff.toml` (upstream Odoo rules;
  imports: stdlib, third-party, `odoo`, `odoo.addons`). No pylint-odoo
  configuration exists; the optional local git hooks come from `npm run hooks:install`
  (`tools/hooks.py`). Do not introduce another convention.
- Authorized module tests: use the **Check commands** block below
  and `.woodpecker.yml` **odoo** step (including its classification fixture; the
  **odoo-tasks-standalone** and **odoo-tasks-bridge** steps run the same shape for
  `nasq_tasks` alone and with the PMO bridge),
  with the selected checkout's explicit addons path, `-i` modules,
  `--test-tags /<addon>` and `--stop-after-init`. Require a nonzero test count;
  preserve isolation/cleanup. These are documented commands, not run by setup.

## Check commands (Odoo scratch database)

Run Odoo checks from `/Users/tariq/code/odoo` using a fresh scratch database
and the selected Nasq worktree's explicit addons path. Use a scratch-only
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
WORKTREE=/absolute/path/to/nasq-worktree
SCRATCH_ROOT=$(mktemp -d)
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
export NASQ_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
(cd "$WORKTREE" && python3 deploy/classification.py fixture --database nasq_scratch --mode saas --output "$NASQ_COMMERCIAL_CONFIG")
# Set PGHOST, PGPORT, PGUSER, and PGPASSWORD in the environment as needed;
# never put a password on the command line.
PGHOST=${PGHOST:-127.0.0.1}; PGPORT=${PGPORT:-5432}; PGUSER=${PGUSER:-tariq}
# The release module list is derived from the catalog, as in .woodpecker.yml.
MODULES="$(cd "$WORKTREE" && python3 -B tools/catalog_check.py --release-modules)"
TAGS="/${MODULES//,/,/}"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$ODOO_CONF" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$WORKTREE/odoo-addons" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d nasq_scratch --db-filter='^nasq_scratch$' \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -i "$MODULES" --test-tags "$TAGS" \
  --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init
```
