# Pinned OCA addons

WebVue's Odoo runs with a few OCA 19.0 repositories on its addons path (finance reporting,
reconciliation, assets, MIS reports and document management). They are separate, pinned dependencies fetched at run or build
time. OCA code is never copied into this repository, and never into `odoo-addons/`.

## Source of truth

`deploy/oca-addons.json` lists each repository with its branch and a full 40-character commit, and
`python_requirements` (the Python packages the manifests of the used modules declare). Nothing else
names an OCA repository or commit. `tools/oca_addons.py` (stdlib only) reads it:

| Command | Effect |
|---|---|
| `python3 -B tools/oca_addons.py check` | Validates the file: unique `OCA/<name>` repos, 40-character shas. |
| `python3 -B tools/oca_addons.py fetch [--dest DIR]` | Clones each repository (https only) to exactly its commit under `DIR/<name>`; idempotent (a checkout at the pin is kept and cleaned with `git clean -fdx`, anything else is replaced; a failed fetch leaves nothing behind), verifies `HEAD`. |
| `python3 -B tools/oca_addons.py path [--dest DIR] [--check]` | Prints the comma-joined addons paths, in pin order. `--check` fails (exit 2) unless every repository is fetched at its pin with no local changes; every script that starts Odoo uses it. |

The destination is `--dest`, else `$WEBVUE_OCA_DIR`, else `oca-19.0` next to the main checkout
(`/Users/tariq/code/oca-19.0` locally), so every worktree shares one fetch. CI uses
`$RUNNER_TEMP/oca-19.0`, cached by the hash of the pin file.

## Where the path is appended

The OCA path always comes last, after the existing entries, so nothing existing changes behaviour:

- local and scratch commands: `docs/agents/odoo-rules.md` block, `npm run test:odoo`
  (`tools/odoo_test.py`, whose template database name also covers the pin file) and
  `npm run e2e:odoo` (`tools/e2e_isolated.mjs`). **Every Odoo test run now requires
  `python3 -B tools/oca_addons.py fetch` first**; without it `npm run test:odoo` and `npm run e2e:odoo`
  stop with a "run fetch" message;
- CI: the `setup` action (`odoo: 'true'`) fetches and exports `WEBVUE_OCA_DIR`; `deploy/ci/odoo.sh`,
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

`webvue_finance` depends on OCA finance modules (`odoo-addons/webvue_finance/README.md`, "OCA-backed
reports, assets and bank"). Only modules a route uses are declared:

| OCA module (repository) | Used for |
|---|---|
| `account_financial_report` (account-financial-reporting) | trial balance, general ledger, aged partner balance |
| `partner_statement` (account-financial-reporting) | partner activity and outstanding statements |
| `account_asset_management` (account-financial-tools) | fixed assets and their depreciation board |
| `account_reconcile_oca` (account-reconcile), with `account_statement_base` | bank statement line reconciliation |
| `mis_builder` (mis-builder) | profit and loss, balance sheet, Zakat base (templates shipped as data) |

`date_range` and `report_xlsx` (server-ux, reporting-engine) come in as their dependencies. `account_tax_balance` and
`account_fiscal_year` are in the pinned repositories but unused.

`dms` (OCA/dms) is pinned for the independent documents replacement. Its adoption remains
subject to the attachment, migration and access acceptance gates; the pin alone does not
replace HR documents. Provenance and license headers are recorded in
[the DMS provenance record](verification/oca-dms/PROVENANCE.md).

`hr_employee_calendar_planning` (OCA/hr) is the shifts engine of `webvue_hr`: date-ranged
`resource.calendar` rows per employee (`hr.employee.calendar`) over the stock working
schedules. It is an internal engine (AGPL-3, owner-accepted, like the finance modules); it
is the only module of OCA/hr that is installed.

## Bump a pin

1. `git ls-remote https://github.com/OCA/<repo>.git refs/heads/19.0`, take the sha.
2. Edit `commit` in `deploy/oca-addons.json` (and `python_requirements` if a manifest's
   `external_dependencies` changed); run `python3 -B tools/oca_addons.py check`.
3. `python3 -B tools/oca_addons.py fetch`, then run the Odoo tests of the addons that depend on the
   OCA modules.

Add a repository only when a module WebVue depends on needs it (check `depends` transitively).

## Python requirements

The runtime already provides them through `deploy/odoo/requirements-python312-linux.txt`:
`python-dateutil` (`account_asset_management`), `xlsxwriter` and `xlrd` (`report_xlsx`). Changing the
pins must keep that file satisfying `python_requirements`.

## Licensing (owner decision 2026-10-18)

Most OCA modules are AGPL-3 (some, such as `date_range` and `account_statement_base`, LGPL-3). They are
used unmodified, as separate dependencies, and fetched from OCA rather than copied here. WebVue's own
addons are LGPL-3. The owner accepted AGPL-3 OCA dependencies for WebVue on 2026-10-18. Keep the OCA
modules unmodified; if one ever has to be changed, the change is published with its source as AGPL-3
requires.

## Launchers that do not use the OCA path yet

- `deploy/control-plane-outage/` (`outage-fixture`, `restart-odoo`, `rotate.py`): bound to one fixed
  worktree, and `restart-odoo` compares the exact argv of a running process, so it changes together
  with a relaunch of that fixture. Its module list includes `webvue_finance`, so **the fixture fails to install
  `webvue_finance` until its addons path gets the OCA directories**.
- The `addons_path` written into a managed bundle's `odoo.conf` (`tools/webvue_cli/managed_bundle.py`,
  checked by `managed_probe.py`): the image entrypoint passes `--addons-path`, which overrides it.
- `deploy/verification-checks.json` does not pass `--with-oca`; add it when `webvue_finance` depends on
  OCA modules.
