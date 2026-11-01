# Pinned OCA addons

LiwanOS's Odoo runs with a few OCA 19.0 repositories on its addons path (finance reporting,
reconciliation, bank statement files, assets, MIS reports, document management, payroll, shifts, appointments and paid bookings). They are separate, pinned dependencies fetched at run or build
time. The fetched repositories stay outside this checkout. The separately maintained
`odoo-addons/base_tier_validation` is the documented vendored OCA exception.

## Source of truth

`deploy/oca-addons.json` lists each fetched repository with its branch and a full 40-character commit, and
`python_requirements` (the Python packages the manifests of the used modules declare). `tools/oca_addons.py`
(stdlib only) reads it:

| Command | Effect |
|---|---|
| `python3 -B tools/oca_addons.py check` | Validates the file: unique `OCA/<name>` repos, 40-character shas. |
| `python3 -B tools/oca_addons.py fetch [--dest DIR]` | Clones each repository (https only) to exactly its commit under `DIR/<name>`; idempotent (a checkout at the pin is kept and cleaned with `git clean -fdx`, anything else is replaced; a failed fetch leaves nothing behind), verifies `HEAD`. A network failure (unreachable host, timeout, reset, 5xx) is retried twice, after 10 and 30 seconds; a refused or unknown commit fails at once. |
| `python3 -B tools/oca_addons.py path [--dest DIR] [--check]` | Prints the comma-joined addons paths, in pin order. `--check` fails (exit 2) unless every repository is fetched at its pin with no local changes; every script that starts Odoo uses it. |

The destination is `--dest`, else `$LIWAN_OCA_DIR`, else `oca-19.0` next to the main checkout
(`/Users/tariq/code/oca-19.0` locally), so every worktree shares one fetch. CI uses
`$RUNNER_TEMP/oca-19.0`, cached by the hash of the pin file.

## Where the path is appended

The OCA path always comes last, after the existing entries, so nothing existing changes behaviour:

- local and scratch commands: `docs/agents/odoo-rules.md` block, `npm run test:odoo`
  (`tools/odoo_test.py`, whose template database name also covers the pin file) and
  `npm run e2e:odoo` (`tools/e2e_isolated.mjs`). **Every Odoo test run now requires
  `python3 -B tools/oca_addons.py fetch` first**; without it `npm run test:odoo` and `npm run e2e:odoo`
  stop with a "run fetch" message;
- CI: the `setup` action (`odoo: 'true'`) fetches and exports `LIWAN_OCA_DIR`; `deploy/ci/odoo.sh`,
  `upgrade.sh` (the upgraded tree only) and `restore-drill.sh` append it. The standalone and bridge
  tasks stages install fixed non-finance modules and do not use it;
- other launchers: `deploy/check_isolated.py` (`--with-oca` on `odoo`, `upgrade` and `runtime`; the `odoo-isolated`
  check of `deploy/verification-checks.json` and the `deploy/OPERATIONS.md` examples pass it),
  `deploy/rpo_rto_drill.py`, `tools/shared_isolation_acceptance/real-odoo-isolation-matrix.mjs`,
  `tools/shared_saas_lifecycle/admin_password_effect.py` (image path `/opt/oca`), the acceptance image
  overlay of `tools/continuous_updates_acceptance/docker_odoo.py`, and the local release migration
  (`deploy/releases/migrate.py`, config key `ocaDir`, verified at the pins);
- deployments: `deploy/odoo/Dockerfile` fetches the repositories into `/opt/oca` (without `.git`) and
  `deploy/odoo/entrypoint.sh` appends them (the image has no git, so it does not run `--check`; the pins
  were verified when the image was built). `deploy/provision.sh` and the compose files only build and
  run that image.

## What uses them

`liwan_finance` depends on OCA finance modules (`odoo-addons/liwan_finance/README.md`, "OCA-backed
reports, assets and bank"). Only modules a route uses are declared:

| OCA module (repository) | Used for |
|---|---|
| `account_financial_report` (account-financial-reporting) | trial balance, general ledger, aged partner balance |
| `partner_statement` (account-financial-reporting) | partner activity and outstanding statements |
| `account_asset_management` (account-financial-tools) | fixed assets and their depreciation board |
| `account_reconcile_oca` (account-reconcile), with `account_statement_base` | bank statement line reconciliation |
| `account_statement_import_camt` (bank-statement-import), with `account_statement_import_file` and `account_statement_import_base` | the CAMT parser (`account.statement.import.camt.parser`) and the `unique_import_id` line field behind the bank statement import; the OCA wizard and its menus are never used (OFX is read by `liwan_finance` itself, no OCA 19.0 module reads it) |
| `mis_builder` (mis-builder) | profit and loss, balance sheet, Zakat base (templates shipped as data) |

`date_range` and `report_xlsx` (server-ux, reporting-engine) come in as their dependencies. `account_tax_balance` and
`account_fiscal_year` are in the pinned repositories but unused.

`dms` (OCA/dms) is the engine used by the implemented `liwan_documents` library; the
`liwan_documents_hr` bridge adds HR department and own-employee contexts. Attachment, migration and access
acceptance remain separate release checks. Source implementation and a pin do not prove deployment
or tenant acceptance. Provenance and license headers are recorded in
[the DMS provenance record](verification/oca-dms/PROVENANCE.md).

`hr_employee_calendar_planning` (OCA/hr) is the shifts engine of `liwan_hr`: date-ranged
`resource.calendar` rows per employee (`hr.employee.calendar`) over the stock working
schedules. It is an internal engine (AGPL-3, owner-accepted, like the finance modules); it
is the only module of OCA/hr that is installed.

| OCA module (repository) | Used for |
|---|---|
| `payroll` (payroll) | payslip engine behind the payroll section of `liwan_hr`; its groups, menus and views are never used |

`resource_booking` (OCA/calendar) is the booking engine of `liwan_appointments` (owner decision
2026-10-28): booking types, availability calendars, resource combinations, computed states and the
`calendar.event` of each booking. Its portal pages (`/my/bookings/...`) stay closed by the
`liwan_platform` guard. `liwan_appointments` currently lists booking types
(`GET /api/v1/appointments/types`); the booking routes are not implemented yet. The engine's
scheduling check is a Python constraint without a lock, and a measured two-transaction probe
double-booked one slot, so the booking routes must serialize scheduling per resource combination
before they ship.

| OCA module (repository) | Used for |
|---|---|
| `resource_booking` (calendar) | booking types of `liwan_appointments` today; slots, combinations and booking states once the booking routes exist |
| `web_calendar_slot_duration` (web) | backend calendar-view dependency of `resource_booking`; no LiwanOS use |
| `sale_resource_booking` (sale-workflow) | paid bookings in the bridge `liwan_appointments_payments`: links a product to a booking type and a booking to its sale order line, keeps a booking with an unpaid order out of `confirmed`, confirms it once the order is confirmed and cancels it with the order |
| `web_ir_actions_act_multi` (web) | backend action dependency of `sale_resource_booking`; no LiwanOS use |

`calendar_public_holiday` (calendar) and the other OCA/web modules are in the pinned repositories but unused;
neither repository has an `auto_install` module. OCA/sale-workflow (added 2026-10-28 under the standing
owner rule of 2026-10-27 for engine updates) is used only for `sale_resource_booking`; its `auto_install`
modules each need a module LiwanOS does not install (`product_secondary_unit`, `sales_team_security`,
`sale_stock`, `portal_account_personal_data_only`, `sale_automatic_workflow`), so none installs itself.

## Bump a pin

1. `git ls-remote https://github.com/OCA/<repo>.git refs/heads/19.0`, take the sha.
2. Edit `commit` in `deploy/oca-addons.json` (and `python_requirements` if a manifest's
   `external_dependencies` changed); run `python3 -B tools/oca_addons.py check`.
3. `python3 -B tools/oca_addons.py fetch`, then run the Odoo tests of the addons that depend on the
   OCA modules.

Add a repository only when a module LiwanOS depends on needs it (check `depends` transitively).

## Python requirements

The runtime already provides them through `deploy/odoo/requirements-python312-linux.txt`:
`python-dateutil` (`account_asset_management`), `xlsxwriter` and `xlrd` (`report_xlsx`), `cssselect`
(`resource_booking`). Changing the
pins must keep that file satisfying `python_requirements`.

## Licensing (owner decision 2026-10-18)

Most OCA modules are AGPL-3 (some, such as `date_range`, `account_statement_base`, `account_statement_import_base` and `account_statement_import_file`, LGPL-3; `account_statement_import_camt` is AGPL-3). They are
used unmodified, as separate dependencies, and fetched from OCA rather than copied here. LiwanOS's own
addons are LGPL-3. The owner accepted AGPL-3 OCA dependencies for LiwanOS on 2026-10-18. Keep the OCA
modules unmodified; if one ever has to be changed, the change is published with its source as AGPL-3
requires.

## Launchers that do not use the OCA path yet

- `deploy/control-plane-outage/` (`outage-fixture`, `restart-odoo`, `rotate.py`): bound to one fixed
  worktree, and `restart-odoo` compares the exact argv of a running process, so it changes together
  with a relaunch of that fixture. Its module list includes `liwan_finance`, so **the fixture fails to install
  `liwan_finance` until its addons path gets the OCA directories**.
- The `addons_path` written into a managed bundle's `odoo.conf` (`tools/liwan_cli/managed_bundle.py`,
  checked by `managed_probe.py`): the image entrypoint passes `--addons-path`, which overrides it.
