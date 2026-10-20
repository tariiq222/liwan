# HR Saudi Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A payroll officer runs the Saudi payroll month in WebVue (inputs, compute, review, approve), the accountant posts it to accounting, exports the bank salary file, records the payment and exports the WPS file, with GOSI, end of service and self-service payslips, and no spreadsheet in between.

**Architecture:** Payroll is a section of `webvue_hr` (rank 4) over the pinned OCA `payroll` 19.0 engine (structure, rules, payslips, inputs, runs; never its groups, menus or views). WebVue computes the money (proration, unpaid leave, GOSI, end of service) in a pure-math module plus one calculator service and feeds the engine through its public `get_current_contract_dict` hook and engine input lines. A new bridge `webvue_hr_finance` (rank 5, `auto_install`) owns account mapping, posting, payment and the end-of-service provision. Compensation lives in a payroll-only model; access is four `hr.payroll.*` capabilities plus the `hr.payroll` sub-feature. The web UI lives in the HR area (`pages/hr/payroll/**`, `components/hr/payroll/**`).

**Tech Stack:** Odoo 19 Community, OCA `payroll` 19.0, stock `hr`, `hr_holidays`, `account`, `analytic`; WebVue `webvue_api` (`api_handler`, `requires_feature`, `requires_capability`); Nuxt 4 + Nuxt UI v4 + `@tanstack/vue-query`; zod in `packages/contracts`; vitest; Storybook; Playwright mock stack.

**Spec:** [docs/superpowers/specs/2026-10-20-hr-saudi-payroll-design.md](../specs/2026-10-20-hr-saudi-payroll-design.md) (parent: [2026-10-18-hr-and-finance-saudi-design.md](../specs/2026-10-18-hr-and-finance-saudi-design.md)).

## Global Constraints

- Work in one worktree: `npm run wt -- new hr-payroll --owner <orchestrator> --task "Saudi payroll phase" --scope odoo-addons/webvue_hr --scope odoo-addons/webvue_hr_finance --scope packages/contracts/src/hr --scope apps/web/app --scope apps/web/stories --scope apps/web/i18n/locales --scope apps/web/e2e`; branch `codex/hr-payroll`; never `git worktree add`.
- Shared files are edited only in the step that names them, by the orchestrator or with its agreement: `deploy/oca-addons.json`, `tools/arch_layers.json`, `deploy/catalog/solutions/platform_v4.json` (+ `python3 -B tools/catalog_check.py --sync-release-copies`), `deploy/provision.sh`, `deploy/verification-checks.json`, `deploy/check_isolated.py`, `deploy/OPERATIONS.md`, `deploy/control-plane-outage/*`, `tools/webvue_cli/operator.py`, `tools/shared_acceptance_live/up.sh`, `apps/web/i18n/locales/{ar,en}/common.json`, `packages/contracts/src/access/access.ts`, `odoo-addons/webvue_api/tests/test_access_composition.py`, `odoo-addons/webvue_finance/controllers/{write_support,finance_entries}.py`.
- No `sudo()` anywhere in `webvue_hr` or `webvue_hr_finance` (AGENTS.md: HR and its bridges have no `sudo()` path); `tools/arch_documented_sudo.json` is not touched.
- Capabilities `hr.payroll.read`, `hr.payroll.manage`, `hr.payroll.approve`, `hr.payroll.config` are owned by `webvue_hr`, are not in `HR_PERMISSIONS`, are implied by no other HR capability, by neither `webvue_hr.group_hr_manager` nor `role_hr_manager` nor `role_vendor_support`, and imply no `hr.*.manage` capability.
- Payroll capability groups imply no stock group: never `hr.group_hr_user`, `hr.group_hr_manager`, `payroll.group_payroll_user`, `payroll.group_payroll_manager`; engine ACLs are granted to WebVue groups in `security/ir.model.access.csv`; OCA payroll groups are never assigned to anyone.
- Sub-feature `hr.payroll` (boolean, owner and module `webvue_hr`) in `webvue.feature.registry`; every payroll route has `@requires_feature('hr.enabled', 'hr.payroll', operation=...)`; bridge routes add `'finance.enabled'`; works in `saas` and `non_saas` (R8).
- Bridge actions need both sides: posting and the EOS provision `hr.payroll.read` + `finance.entries.post`; payment `hr.payroll.read` + `finance.payments.manage`; finance mapping edits `finance.setup.manage`; department cost centers `finance.analytic.manage`.
- Routes: `@http.route('/api/v1/hr/payroll/...', type='json2', auth='user', methods=[...], readonly=<bool>)`, then `@api_handler`, `@requires_feature`, `@requires_capability` in that order; file downloads are `type='http'` GET with `api_handler` (pattern `webvue_finance/controllers/finance_documents.py:48`).
- Errors `{code, message, field?, details?}` with real status: 403 `forbidden` / `transition_forbidden`, 404 `not_found` (another company's record is a 404), 422 `invalid` and the named 422 codes of this plan; HR model refusals raise `WebVueHrRule` translated by `hr_rule_handler` (`webvue_hr/controllers/common.py`).
- Lists are `{items, total}`; every write returns the full detail shape; serializers whitelist keys and Odoo tests assert the exact key set (zod parity: the same keys in `packages/contracts/src/hr/payroll.ts`, `.strict()`).
- Compensation, IBAN, GOSI data, payslips and runs appear only in `hr.payroll.*`-gated routes and in the caller's own approved payslips; never in `/api/v1/hr/employees*`, `/api/v1/people`, directory, reports or search.
- No hard-coded GOSI rates or bank/WPS layouts in Python: they are data records (`noupdate`, comment `VERIFY before release`) editable with `hr.payroll.config`.
- Money is computed with `Decimal` and rounded half-up to the company currency (2 places) before it reaches the engine; wire amounts are JSON numbers.
- Odoo tests only on scratch databases through `npm run test:odoo -- --addons <addon>` after `python3 -B tools/oca_addons.py fetch`; never on `odoo19` or a named database.
- `webvue_hr` moves `19.0.1.6.0` -> `19.0.1.7.0` once, in Task 1, with `migrations/19.0.1.7.0/` (README + post script); later tasks of this branch extend that README, they do not bump again. The bridge starts at `19.0.1.0.0`.
- Commit subjects `type(scope): imperative subject`, at most 72 characters, scope from `core platform api pmo meetings hr chat tasks operations web cp deploy tools docs ci`; one logical change per commit; end every commit message with the attribution trailer from the session reminder; no `Architecture-approved-by:` trailer is ever added by an agent.
- `tools/arch_baseline.json` only shrinks; suppressions (`# noqa`, `eslint-disable`, test skips) only shrink.
- Web: Storybook components only (`docs/design-system/catalog.json`: `SharedListPage`, `SharedListCard`, `SharedDataTable`, `SharedRecordPage`, `SharedRecordSection`, `SharedPropertiesPanel`, `SharedPropertyRow`, `SharedFormSection`, `SharedFormActions`, `SharedInlineConfirm`, `SharedCreatePanel`, `SharedStatusBadge`, `SharedKpiStrip`, `SharedMetricTile`, `SharedSettingsPage`, `SharedPageState`, `SharedEmptyState`, `SharedFilterBar`, `SharedDateField`, `SharedUnsavedChanges`, `SharedRowActions`); every new `components/hr/payroll/*.vue` ships a story in `apps/web/stories/hr/payroll/`; regenerate `node tools/ui_catalog.mjs`; Arabic first, RTL logical classes only, strings in `apps/web/i18n/locales/{ar,en}/hr-payroll.json` (root key `hrPayroll`), `nav.*` labels in `common.json`; interactive controls use `useHydrated()`; transitions stay pending until the server confirms.

## Review Focus

These five input classes are not covered by happy-path tests and each gets an explicit test in its owning task:

1. **Employee without an IBAN at bank-file export** -> Task 16 `test_bank_file_refuses_employee_without_iban` (422 `missing_iban`, `details.employee_ids` lists exactly the employees with positive net and no IBAN; no file bytes) and `test_bank_file_skips_zero_net_line`.
2. **Contract starting mid-month plus unpaid leave in the same month** -> Task 7 `test_joiner_mid_month_with_unpaid_leave` (basic 9000, housing 2250, transport 750, contract start 2026-11-16, unpaid 2026-11-20..22: BASIC 4500.00, HOUSING 1125.00, TRANSPORT 375.00, UNPAID -1200.00, GOSI base 5625.00, GOSI_EE_ANN -506.25, GOSI_EE_SANED -42.19, NET 4251.56) and `test_unpaid_leave_before_contract_start_is_not_counted`.
3. **Zero or negative net** -> Task 8 `test_approve_refuses_negative_net` (422 `negative_net`, `field='employee_id'`, run stays `computed`) and `test_zero_net_payslip_is_approvable`; Task 16 `test_wps_keeps_zero_net_line`.
4. **Run for a month whose finance period is locked** -> Task 13 `test_post_refuses_locked_period` (fiscal lock date 2026-11-30, run month 2026-11: 422 `period_locked`, no `account.move` created, run stays `approved`) and Task 14 `test_payment_refuses_locked_date`.
5. **Employee changing department mid-month (analytic split)** -> Task 7 `test_payslip_snapshots_department_of_period_end_version` (two `hr.version` rows in the month, department A then B from 2026-11-16: one BASIC line, `webvue_department_id` = B) and Task 13 `test_posting_uses_payslip_department_snapshot` (department changed again after compute: entry still uses B's cost center).

## Tasks

### Task 1: Pin OCA payroll and make it the engine of webvue_hr

Risk: mechanical (worker), but touches shared `deploy/oca-addons.json`.

**Files:**
- Modify: `deploy/oca-addons.json` (append `{"repo": "OCA/payroll", "branch": "19.0", "commit": "58f8a39799383ef98d50097f81f4abcc6dd03782"}`; HEAD of 19.0 on 2026-10-05, module `payroll` 19.0.1.0.2, depends `hr_holidays`, `mail`, no Python requirements)
- Modify: `docs/oca-addons.md` (table row: `payroll` (payroll) - payslip engine behind the payroll section of `webvue_hr`; its groups, menus and views are never used)
- Modify: `odoo-addons/webvue_hr/__manifest__.py` (version `19.0.1.7.0`; `depends` += `'payroll'`; comment: engine only, never its groups)
- Create: `odoo-addons/webvue_hr/migrations/19.0.1.7.0/README.md`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_engine.py`

**Interfaces:**
- Consumes: `tools/oca_addons.py fetch|path --check`.
- Produces: engine models `hr.payroll.structure`, `hr.salary.rule`, `hr.salary.rule.category`, `hr.rule.input`, `hr.payslip`, `hr.payslip.line`, `hr.payslip.input`, `hr.payslip.run`, `hr.payslip.worked_days`; engine hooks used later: `hr.payslip.get_current_contract_dict(contract, contracts) -> dict`, `hr.payslip.compute_sheet()`, `hr.payslip.action_payslip_done()` (context `without_compute_sheet=True`), `hr.payslip.run.close_payslip_run()`.

- [ ] Write `test_payroll_engine.py` (`TransactionCase`, tags `webvue`, `webvue_access`):
  - `test_payroll_engine_is_installed`: `ir.module.module` `payroll` state `installed`; `env['hr.payslip']` exists.
  - `test_no_webvue_group_implies_a_payroll_group`: for every `res.groups` whose xml id module is `webvue_*`, `all_implied_ids` contains neither `payroll.group_payroll_user` nor `payroll.group_payroll_manager`.
  - `test_payroll_groups_hold_only_system_users`: every user of `payroll.group_payroll_user` has `base.group_system` (OCA seeds root and admin only).
- [ ] Run `python3 -B tools/oca_addons.py check && python3 -B tools/oca_addons.py fetch && npm run test:odoo -- --addons webvue_hr`. Expected FAIL: `test_payroll_engine_is_installed` (module not installed).
- [ ] Add the pin, the manifest dependency and the version; write the README ("19.0.1.7.0 adds the payroll section over OCA payroll; schema additions listed per task below; `post-payroll.py` carries `hr.enabled` onto `hr.payroll`" - the script itself arrives in Task 2).
- [ ] Run `python3 -B tools/oca_addons.py path --check && npm run test:odoo -- --addons webvue_hr && python3 -B tools/migration_guard.py --base main`. Expected PASS (whole `webvue_hr` suite green, guard silent).
- [ ] Commit: `git add deploy/oca-addons.json docs/oca-addons.md odoo-addons/webvue_hr && git commit -m "feat(hr): add the OCA payroll engine behind webvue_hr"`.

### Task 2: Payroll capabilities, groups, role and the hr.payroll sub-feature

Risk: risky (authorization foundation; touches shared catalog and composition test).

**Files:**
- Modify: `odoo-addons/webvue_hr/models/access_service.py`
- Modify: `odoo-addons/webvue_hr/models/feature_registry.py`
- Modify: `odoo-addons/webvue_hr/security/hr_capability_groups.xml`
- Modify: `odoo-addons/webvue_hr/data/hr_access_permissions.xml`
- Create: `odoo-addons/webvue_hr/migrations/19.0.1.7.0/post-payroll.py`; Modify its `README.md`
- Modify (shared): `deploy/catalog/solutions/platform_v4.json` (`"boolean:hr.payroll"` in tier `people`), then `python3 -B tools/catalog_check.py --sync-release-copies`
- Modify (shared): `odoo-addons/webvue_api/tests/test_access_composition.py` (HR set += 4 keys, dependencies += 4 entries, test renamed `..._46_keys_...`, count 46)
- Modify (shared): `packages/contracts/src/access/access.ts` (`KNOWN_CAPABILITIES` += 4 keys) and `packages/contracts/src/access/__tests__/schemas.test.ts`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_access.py`

**Interfaces:**
- Produces (Python, `access_service.py`):
  - `PAYROLL_PERMISSIONS = frozenset({'hr.payroll.read', 'hr.payroll.manage', 'hr.payroll.approve', 'hr.payroll.config'})`
  - `PAYROLL_PERMISSION_DEPENDENCIES = {'hr.payroll.read': {'hr.employees.read'}, 'hr.payroll.manage': {'hr.payroll.read'}, 'hr.payroll.approve': {'hr.payroll.read'}, 'hr.payroll.config': {'hr.payroll.read'}}`
  - `_webvue_capability_definitions` adds the four keys (`owner='webvue_hr'`); `_webvue_permission_dependencies` merges the map; `_webvue_builtin_role_grants` adds `'webvue_hr.role_payroll_manager': PAYROLL_PERMISSIONS` only; `_webvue_legacy_capability_keys` unchanged (no legacy group grants payroll).
- Produces (XML): groups `webvue_hr.group_cap_hr_payroll_read|manage|approve|config` (privilege `webvue_core.res_groups_privilege_webvue`, `implied_ids` = `[Command.clear()]`); permission records `permission_hr_payroll_read|manage|approve|config` (domain `hr`, resource `payroll`, `sensitive=True`, `custom_role_allowed=True`, Arabic names: قراءة الرواتب، إدارة الرواتب، اعتماد مسيّرات الرواتب، إعدادات الرواتب); built-in role `role_payroll_manager` (key `payroll_manager`, مسؤول الرواتب / Payroll manager, `noupdate`, assignable, protected); `group_hr_manager.implied_ids` unchanged.
- Produces (feature): `{'key': 'hr.payroll', 'type': 'boolean', 'owner': 'webvue_hr', 'module': 'webvue_hr'}`.
- Produces (migration): `post-payroll.py` `migrate(cr, version)` copies the stored `hr.enabled` onto `hr.payroll` for every `webvue.tenant.profile`, the same shape as `migrations/19.0.1.6.0/post-hr_complete.py::_carry_hr_enabled`; idempotent; returns on a fresh install.

- [ ] Write `test_payroll_access.py` (`TransactionCase`, tags `webvue`, `webvue_access`):
  - `test_payroll_keys_are_owned_by_webvue_hr_and_sensitive`: the four keys in `_webvue_capability_map()` with owner `webvue_hr`; each permission record `sensitive` is True.
  - `test_no_hr_capability_implies_payroll`: for every key in `HR_PERMISSIONS`, the transitive closure of `_webvue_permission_dependencies()` contains no payroll key; `role_hr_manager`, `role_vendor_support` and `webvue_core.role_employee` grants contain no payroll key; `webvue_hr.group_hr_manager.all_implied_ids` contains no `group_cap_hr_payroll_*`.
  - `test_payroll_implies_no_broader_hr_write`: closure of each payroll key is a subset of `PAYROLL_PERMISSIONS | {'hr.employees.read'}`; each payroll group's `all_implied_ids` contains none of `hr.group_hr_user`, `hr.group_hr_manager`, `payroll.group_payroll_user`, `payroll.group_payroll_manager`, `webvue_hr.group_cap_hr_employees_manage`.
  - `test_payroll_role_grants_exactly_the_four_keys`.
  - `test_hr_payroll_feature_is_registered`: key in `_webvue_feature_definitions()` with owner `webvue_hr`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr,webvue_api`. Expected FAIL: the five new tests (keys missing).
- [ ] Implement the constants, XML, migration, catalog entry, composition-test update and `KNOWN_CAPABILITIES`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr,webvue_api && python3 -B tools/catalog_check.py && npm -w packages/contracts run test`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): add payroll capabilities and the hr.payroll sub-feature"`.

### Task 3: Open the payroll engine to the payroll capability groups

Risk: risky (record rules, field groups on `hr.version`; one wrong line leaks salaries).

**Files:**
- Modify: `odoo-addons/webvue_hr/security/ir.model.access.csv`
- Create: `odoo-addons/webvue_hr/security/hr_payroll_rules.xml` (listed in manifest `data` after `hr_engine_rules.xml`)
- Modify: `odoo-addons/webvue_hr/models/hr_version.py`, `odoo-addons/webvue_hr/models/hr_employee.py`
- Modify: `odoo-addons/webvue_hr/__manifest__.py`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_engine_access.py`

**Interfaces:**
- ACL rows (all `access_webvue_hr_payroll_*`): `group_cap_hr_payroll_read` read on `payroll.model_hr_payslip`, `_hr_payslip_line`, `_hr_payslip_input`, `_hr_payslip_run`, `_hr_payslip_worked_days`, `_hr_payroll_structure`, `_hr_salary_rule`, `_hr_salary_rule_category`, `_hr_rule_input`, `_hr_contribution_register`; `group_cap_hr_payroll_manage` read/write/create/unlink on payslip, line, input, worked_days and read/write/create on run; `group_cap_hr_payroll_approve` read/write on payslip and run; `group_cap_hr_employees_read` read on payslip, payslip line and salary rule category only.
- Record rules (`hr_payroll_rules.xml`): `rule_hr_payslip_own_approved` (group `group_cap_hr_employees_read`, read only, `[('employee_id.user_id', '=', user.id), ('state', '=', 'done')]`); `rule_hr_payslip_line_own_approved` (same group, `[('slip_id.employee_id.user_id', '=', user.id), ('slip_id.state', '=', 'done')]`); `rule_hr_payslip_payroll_read` and `rule_hr_payslip_line_payroll_read` (group `group_cap_hr_payroll_read`, `[(1, '=', 1)]`; the OCA global company rule still applies); `rule_hr_leave_payroll_read` and `rule_hr_leave_allocation_payroll_read` (group `group_cap_hr_payroll_read`, perm_read only, `[('employee_id.company_id', 'in', company_ids)]`).
- `hr_version.py`: `PAYROLL_READ_GROUP = 'webvue_hr.group_cap_hr_payroll_read'`; `PAYROLL_READ_CAPABILITIES = ('hr.employees.read', 'hr.payroll.read')`; `_webvue_version_read_allowed()` also returns True when the caller holds both payroll read capabilities (read only; writes keep `hr.employees.manage`). Stock fields redeclared with `PAYROLL_READ_GROUP` appended to their groups, only those the engine and calculator read: `date_version`, `contract_date_start`, `contract_date_end`, `date_start`, `date_end`, `country_id`, `identification_id`, `departure_date`, `departure_reason_id` (start from this list; add a field only when a failing test names it; never add `hr.group_hr_user` to a payroll group instead). `wage` is not opened: WebVue never writes or reads `hr.version.wage`.
- `hr_employee.py`: the matching `related=..., inherited=True` redeclarations for the fields above that the employee exposes (pattern of `contract_date_start` at `hr_employee.py:21`).

- [ ] Write `test_payroll_engine_access.py` (`TransactionCase`; users built like `TestHrEngineGroups._user_with`): fixtures: employee A (user `own`), employee B, a draft `hr.payslip` per employee and one `done` payslip of A (structure from the OCA demo-free base `hr.payroll.structure` created in the test).
  - `test_employee_reads_only_own_approved_payslips`: `own` (role employee) `search([])` on `hr.payslip` returns exactly A's done payslip; on `hr.payslip.line` only its lines.
  - `test_payroll_reader_reads_all_company_payslips_without_hr_manage`: reader (`hr.payroll.read`) sees all four payslips; `env['hr.employee'].with_user(reader).browse(B).write({'name': 'x'})` raises `AccessError`; `env['hr.version'].with_user(reader).search([...]).write({'job_title': 'x'})` raises `AccessError`.
  - `test_payroll_reader_reads_version_dates_and_nationality`: reader reads `contract_date_start`, `date_start`, `date_end`, `country_id`, `identification_id`, `departure_date` of B's version without `AccessError`.
  - `test_hr_manager_without_payroll_reads_no_payslip`: `role_hr_manager` user `search([])` on `hr.payslip` raises `AccessError`.
  - `test_payroll_reader_reads_company_leaves_and_allocations`: reader `search_count` on `hr.leave` and `hr.leave.allocation` of B is 1 each; a role-employee user sees 0 of B's.
  - `test_payroll_manager_computes_a_payslip`: manager calls `compute_sheet()` on B's draft payslip without `AccessError` (structure with one fixed rule).
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL: six new tests (`AccessError` on model access).
- [ ] Add ACLs, rules, field-group redeclarations and the read path; rerun until green.
- [ ] Run `npm run test:odoo -- --addons webvue_hr && ruff check odoo-addons`. Expected PASS; the whole HR suite (leave, offboarding, contracts) stays green.
- [ ] Commit: `git commit -m "feat(hr): open the payroll engine to payroll capability groups"`.

### Task 4: Payroll-only compensation record and its API

Risk: risky (privacy boundary).

**Files:**
- Create: `odoo-addons/webvue_hr/models/hr_compensation.py` (import in `models/__init__.py`)
- Modify: `odoo-addons/webvue_hr/security/ir.model.access.csv`, `security/hr_payroll_rules.xml` (company rule)
- Create: `odoo-addons/webvue_hr/serializers/payroll/__init__.py`, `serializers/payroll/compensation.py`
- Create: `odoo-addons/webvue_hr/controllers/payroll/__init__.py`, `controllers/payroll/common.py`, `controllers/payroll/compensation.py` (import in `controllers/__init__.py`)
- Test: `odoo-addons/webvue_hr/tests/payroll_common.py`, `tests/test_payroll_compensation.py`

**Interfaces:**
- Model `webvue.hr.compensation` (`WebVueHrCompensation`): `employee_id` Many2one `hr.employee` required, `ondelete='cascade'`, index; `company_id` related `employee_id.company_id` stored; `currency_id` related `company_id.currency_id`; Monetary `basic_wage`, `housing_allowance`, `transport_allowance`, `other_allowance`; `iban` Char; `bank_id` Many2one `res.bank`; `gosi_number` Char; `gosi_registration_date` Date. Constraints: `UNIQUE(employee_id)`; `CHECK(basic_wage > 0 AND housing_allowance >= 0 AND transport_allowance >= 0 AND other_allowance >= 0)`; `@api.constrains('iban')`: empty or `stdnum.iban.is_valid(iban)` and `iban.startswith('SA')` and length 24 (store compact upper-case). Methods: `_webvue_fixed_wage() -> Decimal` (basic + housing + transport + other, the EOS and day-rate wage), `_webvue_gosi_base() -> Decimal` (basic + housing). Nationality and national ID are NOT stored here: they are stock `hr.version.country_id` / `identification_id` (one source; Saudization already uses `country_id`).
- ACL: read `group_cap_hr_payroll_read`; read/write/create `group_cap_hr_payroll_manage`; no unlink. Rule `rule_webvue_hr_compensation_company` (global, `[('company_id', 'in', company_ids)]`).
- `controllers/payroll/common.py`: `PAYROLL_READ = ('hr.enabled', 'hr.payroll')` helpers `payroll_employee(employee_id) -> hr.employee` (current company, archived included, else 404 `not_found`), `own_employee()` reuse from `controllers/assets/common.py` (import, do not copy).
- Routes:
  - `GET /api/v1/hr/payroll/compensation/<int:employee_id>` (readonly, `hr.payroll.read`) -> `HrCompensation` or 404 `not_found` when the employee has none.
  - `PUT /api/v1/hr/payroll/compensation/<int:employee_id>` (`hr.payroll.manage`) body `{basic_wage, housing_allowance, transport_allowance, other_allowance, iban, bank_id, gosi_number, gosi_registration_date}` (all keys required, `iban`/`bank_id`/`gosi_*` nullable) -> upsert, returns `HrCompensation`; 422 `invalid` with `field` for each refusal.
- Serializer `dump_compensation(record) -> {employee: {id, name}, basic_wage, housing_allowance, transport_allowance, other_allowance, fixed_wage, iban, bank: {id, name}|null, gosi_number, gosi_registration_date, nationality: {id, name, code}|null}` (`nationality` read from the employee's version); `parse_compensation(payload) -> vals` rejecting unknown keys (422).
- `tests/payroll_common.py`: `class PayrollCase(WebVueHrCase)` with `payroll_user(login, keys) -> res.users` (custom role in the current company, like `TestHrAssets._user_with_capabilities`), `make_employee(name, *, country='SA', start=date(2024, 1, 1), department=None, user=None) -> hr.employee` (writes `contract_date_start` on the version as superuser), `set_compensation(employee, basic, housing=0, transport=0, other=0, iban=None, gosi_registration_date=None)`.

- [ ] Write `test_payroll_compensation.py` (`PayrollCase`, tags `post_install`, `-at_install`, `webvue`):
  - `test_compensation_visibility_matrix`: GET as payroll reader 200, payroll manager 200, `role_hr_manager` 403, role employee 403 (also for own employee), finance accountant (`webvue_finance.role_finance_accountant` if installed, else skip that row by `self.env.ref(..., raise_if_not_found=False)`) 403; PUT as reader 403, as HR manager 403, as payroll manager 200.
  - `test_compensation_keys_are_exact`: body keys equal `COMPENSATION_KEYS`; `fixed_wage` = 13500.0 for basic 10000, housing 2500, transport 1000.
  - `test_employee_routes_never_carry_salary`: as payroll manager with `hr.employees.read`, `GET /api/v1/hr/employees/<id>` and `GET /api/v1/hr/employees` items have no key in `{'basic_wage', 'housing_allowance', 'iban', 'gosi_number', 'compensation', 'wage'}`; same for `GET /api/v1/people?q=`.
  - `test_put_validates_iban_and_amounts`: `SA0380000000608010167519` accepted; `SA0380000000608010167518` -> 422 `field='iban'`; `basic_wage: 0` -> 422 `field='basic_wage'`; unknown key -> 422.
  - `test_other_company_employee_is_404`.
  - `test_payroll_feature_off_closes_compensation`: `set_hr_feature(self, 'hr.payroll', False)` -> GET 403 `feature_not_included`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL: 404 route not found on all six.
- [ ] Implement model, ACL, rule, serializer, routes.
- [ ] Run `npm run test:odoo -- --addons webvue_hr && npm test`. Expected PASS (route gate policy included in `npm test`).
- [ ] Update `migrations/19.0.1.7.0/README.md` (new table `webvue_hr_compensation`, no data to carry).
- [ ] Commit: `git commit -m "feat(hr): add the payroll-only employee compensation record"`.

### Task 5: Web compensation section «التعويضات»

Risk: mechanical (worker).

**Files:**
- Create: `packages/contracts/src/hr/payroll.ts`; Modify: `packages/contracts/src/hr/index.ts` (`export * from './payroll'`)
- Test: `packages/contracts/src/hr/__tests__/payroll.test.ts`
- Create: `apps/web/app/composables/useHrPayrollCompensation.ts`; Test: `apps/web/app/composables/__tests__/useHrPayrollCompensation.test.ts`
- Create: `apps/web/app/components/hr/payroll/CompensationSection.vue`, `CompensationForm.vue`; stories `apps/web/stories/hr/payroll/CompensationSection.stories.ts`, `CompensationForm.stories.ts`
- Modify: `apps/web/app/pages/hr/employees/[employeeId].vue` (section only when `can('hr.payroll.read')` and feature `hr.payroll` readable)
- Create: `apps/web/app/pages/hr/employees/[employeeId]/compensation.vue` (edit page, `SharedUnsavedChanges`)
- Modify: `apps/web/app/modules/hr/manifest.ts` (`routeCapabilities` `{ pattern: /^\/hr\/employees\/[^/]+\/compensation$/, capability: 'hr.payroll.manage', feature: 'hr.payroll' }` before the generic employee entry; `subFeatures['hr.payroll.'] = 'hr.payroll'`); Test: `apps/web/app/modules/__tests__/manifests.test.ts`
- Create: `apps/web/i18n/locales/ar/hr-payroll.json`, `apps/web/i18n/locales/en/hr-payroll.json` (root `hrPayroll`, section `compensation.*`)

**Interfaces:**
- Zod: `HrCompensationSchema` (exact keys of Task 4), `HrCompensationWriteSchema` (all keys, `iban` regex `/^SA\d{22}$/` nullable, amounts `z.number().min(0)`, `basic_wage` `.positive()`), types `HrCompensation`, `HrCompensationWrite`.
- Composable: `hrPayrollKeys` (`all: ['hr', 'payroll']`, `compensation: (employeeId) => ['hr', 'payroll', 'compensation', employeeId]`), `useHrCompensation(employeeId: MaybeRefOrGetter<number>)` (a 404 maps to `null`, not an error), `useSaveHrCompensation(employeeId)` (PUT, replaces cache with the server response).

- [ ] Write the contract test (`accepts the compensation detail`, `rejects an unknown key`, `rejects a non-Saudi IBAN`) and the composable test (`maps 404 to null`, `PUT replaces the cached record`); add manifest test rows `['/hr/employees/3/compensation', 'hr.payroll.manage']`.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test -- app/composables/__tests__/useHrPayrollCompensation.test.ts app/modules/__tests__/manifests.test.ts`. Expected FAIL (exports missing).
- [ ] Implement schemas, composable, components (section: `SharedRecordSection` + `SharedPropertiesPanel`/`SharedPropertyRow`, nationality read-only from the server, «تعديل التعويضات» button only with `can('hr.payroll.manage')`; form: `SharedFormSection`, `SharedFormActions`), page, stories, ar/en locales.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test && npm -w apps/web run lint && node tools/ui_catalog.mjs && node tools/ui_catalog.mjs --check && python3 -B tools/ui_policy.py`. Expected PASS.
- [ ] Commit: `git commit -m "feat(web): add the compensation section to the employee page"`.

### Task 6: Payroll settings, dated GOSI rate table and GOSI math

Risk: risky (GOSI class selection and caps).

**Files:**
- Create: `odoo-addons/webvue_hr/models/payroll_math.py` (pure functions, no ORM import)
- Create: `odoo-addons/webvue_hr/models/payroll_settings.py`, `models/gosi_rate.py` (import both in `models/__init__.py`)
- Create: `odoo-addons/webvue_hr/data/hr_gosi_rate_data.xml` (manifest `data` after the permission file)
- Modify: `security/ir.model.access.csv`, `security/hr_payroll_rules.xml`
- Create: `odoo-addons/webvue_hr/serializers/payroll/settings.py`, `controllers/payroll/settings.py`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_gosi.py`, `tests/test_payroll_settings.py`

**Interfaces:**
- `payroll_math.py`:
  - `GCC_CODES = frozenset({'AE', 'BH', 'KW', 'OM', 'QA'})`, `SAUDI_REFORM_DATE = date(2024, 7, 3)` (a law date, not a rate).
  - `nationality_class(country_code: str | None, registration_date: date | None) -> str`:
    ```python
    if not country_code: raise PayrollMathError('nationality_missing')
    if country_code == 'SA':
        if not registration_date: raise PayrollMathError('gosi_registration_missing')
        return 'saudi_before_2024' if registration_date < SAUDI_REFORM_DATE else 'saudi_from_2024'
    return 'gcc' if country_code in GCC_CODES else 'non_saudi'
    ```
  - `contributory_wage(base: Decimal, wage_min: Decimal, wage_max: Decimal) -> Decimal` = `min(max(base, wage_min), wage_max)`.
  - `money(value) -> Decimal` (quantize `0.01`, `ROUND_HALF_UP`).
  - `gosi_amounts(base: Decimal, rates: dict[str, GosiRate], ratio: Decimal) -> dict[str, tuple[Decimal, Decimal]]`: per branch `(employee, employer)` = `money(contributory_wage(base, row.min, row.max) * ratio * pct / 100)`; the cap applies to the full monthly base, the proration ratio after it.
  - `class PayrollMathError(Exception)` with `code`.
- Model `webvue.hr.gosi.rate`: `company_id` (optional; seed rows company-less), `branch` Selection `annuities|saned|hazards`, `nationality_class` Selection `saudi_before_2024|saudi_from_2024|non_saudi|gcc`, `date_from` Date required, `employee_rate` / `employer_rate` Float digits (6, 4) percent, `wage_min` / `wage_max` Monetary; `UNIQUE(company_id, branch, nationality_class, date_from)`; `CHECK(employee_rate >= 0 AND employer_rate >= 0 AND wage_max >= wage_min)`. `_webvue_rates_for(nationality_class, day) -> dict[branch, record]`: per branch the row with greatest `date_from <= day`, the current company's row winning over a shared row of the same date.
- Seed `hr_gosi_rate_data.xml` (`noupdate="1"`, header comment `VERIFY against gosi.gov.sa before release (spec 6.2)`), all rows `wage_min` 1500, `wage_max` 45000: `saudi_before_2024` from 2000-01-01: annuities 9/9, saned 0.75/0.75, hazards 0/2; `saudi_from_2024`: annuities 2024-07-03 9/9, 2025-07-01 9.5/9.5, 2026-07-01 10/10, 2027-07-01 10.5/10.5, 2028-07-01 11/11; saned 2024-07-03 0.75/0.75; hazards 2024-07-03 0/2; `non_saudi` from 2000-01-01: hazards 0/2. No `gcc` rows.
- Model `webvue.hr.payroll.settings`: `company_id` required unique; `day_divisor` Integer default 30, `CHECK(day_divisor BETWEEN 28 AND 31)`; `structure_id` Many2one `hr.payroll.structure` (default `webvue_hr.structure_saudi`, set in Task 7); `unpaid_leave_type_ids` Many2many `hr.leave.type` (default `hr_holidays.leave_type_unpaid`); `annual_leave_type_id` Many2one `hr.leave.type` (default `hr_holidays.holiday_status_cl`, the stock "Paid Time Off" that `hr_leave_type_data.xml` names as annual leave). `@api.model _webvue_for_company(company)` -> stored record or an unsaved `new()` with defaults (no create on read, no elevation); PATCH creates it.
- ACL: rates and settings read `group_cap_hr_payroll_read`, write/create/unlink `group_cap_hr_payroll_config` (settings: no unlink). Rule on rates `['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]`.
- Routes (`controllers/payroll/settings.py`): `GET|PATCH /api/v1/hr/payroll/settings` (read / `hr.payroll.config`) -> `HrPayrollSettings {day_divisor, structure: ref, unpaid_leave_types: ref[], annual_leave_type: ref}`; `GET /api/v1/hr/payroll/gosi-rates` -> `{items, total}` of `HrGosiRate {id, branch, nationality_class, date_from, employee_rate, employer_rate, wage_min, wage_max, shared}`; `POST` (201), `PATCH /<id>`, `DELETE /<id>` (204) with `hr.payroll.config`.
- Calculator entry used by Task 7: `webvue.hr.payroll.calculator._webvue_gosi(employee, compensation, day, ratio) -> dict` raising `WebVueHrRule('gosi_rate_missing', ..., field='employee_id', details={'employee_id': id, 'nationality_class': cls})` when a needed class has no row, and `WebVueHrRule(code)` for the two `PayrollMathError` codes.

- [ ] Write `test_payroll_gosi.py` (`TransactionCase`):
  - `test_nationality_class_boundaries`: `('SA', 2024-07-02)` -> `saudi_before_2024`; `('SA', 2024-07-03)` -> `saudi_from_2024`; `('AE', None)` -> `gcc`; `('EG', None)` -> `non_saudi`; `('SA', None)` raises `gosi_registration_missing`; `(None, None)` raises `nationality_missing`.
  - `test_contributory_wage_caps`: 1200 -> 1500; 60000 -> 45000; 12500 -> 12500.
  - `test_rate_lookup_by_date`: `saudi_from_2024` annuities at 2026-11-30 -> 10.0/10.0; at 2026-06-30 -> 9.5/9.5.
  - `test_gosi_amounts_per_class`: base 12500, ratio 1: `saudi_before_2024` employee total 1218.75, employer total 1468.75; `saudi_from_2024` at 2026-11-30 employee 1343.75, employer 1593.75; `non_saudi` base 7500 employee 0.00, employer 150.00; base 60000 old Saudi employee 4387.50.
  - `test_gcc_without_rows_refuses_with_employee`: raises `WebVueHrRule` code `gosi_rate_missing`, `details['nationality_class'] == 'gcc'`.
  - `test_company_row_overrides_shared_row_of_same_date`.
- [ ] Write `test_payroll_settings.py` (`PayrollCase`): `test_settings_defaults_without_record` (GET as reader: `day_divisor` 30, unpaid types contain `hr_holidays.leave_type_unpaid`), `test_only_config_edits_settings_and_rates` (manager PATCH 403, config PATCH 200 creates the record; divisor 27 -> 422 `field='day_divisor'`), `test_gosi_rates_list_envelope_and_crud`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL (module/route missing).
- [ ] Implement; extend migration README (tables `webvue_hr_gosi_rate`, `webvue_hr_payroll_settings`; seed loads on upgrade because the records are new).
- [ ] Run `npm run test:odoo -- --addons webvue_hr && ruff check odoo-addons`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): add payroll settings and the dated GOSI rate table"`.

### Task 7: Saudi salary structure, day math and the engine hook

Risk: risky (proration algorithm; engine extension point).

**Files:**
- Modify: `odoo-addons/webvue_hr/models/payroll_math.py`
- Create: `odoo-addons/webvue_hr/models/payroll_calculator.py`, `models/hr_payslip.py` (imports)
- Create: `odoo-addons/webvue_hr/data/hr_payroll_structure_data.xml` (manifest `data`)
- Test: `odoo-addons/webvue_hr/tests/test_payroll_day_math.py`, `tests/test_payroll_compute.py`

**Interfaces:**
- `payroll_math.py` additions:
  - `paid_days(month_start, month_end, contract_start, contract_end, departure_date, divisor) -> int`:
    ```python
    start = max(month_start, contract_start)
    end = min(d for d in (month_end, contract_end, departure_date) if d)
    if end < start:
        return 0
    if start == month_start and end == month_end:
        return divisor          # a full month is always the divisor, 28 or 31 days alike
    return min((end - start).days + 1, divisor)
    ```
  - `overlap_days(leave_from, leave_to, window_start, window_end, half_day=False) -> Decimal` (inclusive calendar days of the overlap; `Decimal('0.5')` for a half-day leave inside the window; 0 when disjoint).
  - `day_amount(monthly: Decimal, days: Decimal, divisor: int) -> Decimal` = `money(monthly / divisor * days)`.
- Model `webvue.hr.payroll.calculator` (AbstractModel): `_webvue_payslip_values(payslip) -> dict[str, float]` with keys `basic, housing, transport, other, absence, unpaid, gosi_base, gosi_ee_annuities, gosi_ee_saned, gosi_er_annuities, gosi_er_saned, gosi_er_hazards, eos, leave_encashment, settlement_deduction, paid_days, unpaid_days` (EOS keys return 0 until Task 18). Rules: earnings = `money(component * paid_days / divisor)`; `unpaid` = `-day_amount(fixed_wage, unpaid_days, divisor)`, `absence` = `-day_amount(fixed_wage, absence_days_input, divisor)`, with `unpaid_days + absence_days` capped at `paid_days`; unpaid days = sum of `overlap_days` of validated (`state='validate'`) `hr.leave` of the employee whose `holiday_status_id` is in `settings.unpaid_leave_type_ids`, inside the contract window of the month; GOSI from Task 6 with `ratio = paid_days / divisor` at the run's `date_to`.
- `hr_payslip.py` (`_inherit = 'hr.payslip'`): `webvue_department_id` Many2one `hr.department` (snapshot written at compute from `contract_id.department_id`); `get_current_contract_dict(self, contract, contracts)` returns `{**super().get_current_contract_dict(contract, contracts), **self.env['webvue.hr.payroll.calculator']._webvue_payslip_values(self)}`; `_webvue_period_version()` -> the employee's `hr.version` effective on `min(date_to, departure_date)` (the payslip's single `contract_id`, so two versions in one month never double the basic).
- Structure data (`webvue_hr.structure_saudi`, code `SA_MONTHLY`, company-less): categories `BASIC`, `ALW`, `VAR`, `DED`, `GOSI` (employee share, child of `DED`), `COMP` (employer share, not in net), `NET`, `BASE` (statistical, not on payslip); rules (python code, `result = current_contract.<key>` or `result = inputs.<CODE>.amount` / negated for deductions; sequence order) `BASIC`, `HOUSING`, `TRANSPORT`, `OTHER`, `OVERTIME` (input `WV_OVERTIME`), `BONUS` (`WV_BONUS`), `EOS`, `LEAVE_ENC`, `ABSENCE`, `UNPAID`, `DEDUCTION` (`WV_DEDUCTION`), `ADVANCE` (`WV_ADVANCE`), `SETTLEMENT_DED`, `GOSI_EE_ANN`, `GOSI_EE_SANED`, `GOSI_ER_ANN`, `GOSI_ER_SANED`, `GOSI_ER_OH`, `GOSI_BASE` (`appears_on_payslip` False), `NET` (`categories.BASIC + categories.ALW + categories.VAR + categories.DED`); `hr.rule.input` codes `WV_OVERTIME`, `WV_ABSENCE_DAYS`, `WV_BONUS`, `WV_DEDUCTION`, `WV_ADVANCE`.

- [ ] Write `test_payroll_day_math.py` (`TransactionCase`, pure):
  - `test_paid_days`: Nov 2026 joiner 2026-11-16 -> 15; full December 2026 -> 30; February 2027 full -> 30; February 2027 joiner 2027-02-15 -> 14; leaver departure 2026-12-10 -> 10; contract ended 2026-10-31 -> 0.
  - `test_overlap_days`: leave 2026-11-20..22 in November -> 3; leave 2026-11-28..2026-12-03 in November -> 3; half-day inside -> 0.5; leave entirely before the window -> 0.
  - `test_day_amount`: `(12000, 3, 30)` -> 1200.00; `(10000, 1, 30)` -> 333.33.
- [ ] Write `test_payroll_compute.py` (`PayrollCase`): helper `_payslip(employee, month)` builds a payslip with `struct_id = structure_saudi`, `contract_id = _webvue_period_version()`, inputs from the structure, then `compute_sheet()` as a payroll manager.
  - `test_full_month_saudi_payslip`: basic 10000, housing 2500, transport 1000, Saudi registered 2020-01-01, November 2026: lines `BASIC` 10000, `HOUSING` 2500, `TRANSPORT` 1000, `GOSI_EE_ANN` -1125.00, `GOSI_EE_SANED` -93.75, `GOSI_ER_*` sum 1468.75, `NET` 12281.25.
  - `test_joiner_mid_month_with_unpaid_leave` (Review Focus 2, values in that section).
  - `test_unpaid_leave_before_contract_start_is_not_counted`: unpaid leave 2026-11-10..12, contract start 2026-11-16 -> `UNPAID` 0.
  - `test_absence_input_and_cap`: `WV_ABSENCE_DAYS` 40 on a 15-paid-day joiner -> `ABSENCE` capped to the earned amount, `NET` >= `-GOSI`.
  - `test_payslip_snapshots_department_of_period_end_version` (Review Focus 5).
  - `test_engine_does_not_read_hr_version_wage`: `hr.version.wage` 0 and the payslip still computes the compensation values.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL (functions and structure missing).
- [ ] Implement math, calculator, payslip extension, structure data; set `payroll_settings.structure_id` default to `structure_saudi`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): add the Saudi salary structure and payslip day math"`.

### Task 8: Monthly run lifecycle, inputs, compute and approve

Risk: risky (state machine, segregation of duties).

**Files:**
- Create: `odoo-addons/webvue_hr/models/hr_payslip_run.py`, `models/payroll_finance_link.py` (imports)
- Create: `odoo-addons/webvue_hr/serializers/payroll/run.py`, `controllers/payroll/runs.py`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_runs.py`

**Interfaces:**
- `hr_payslip_run.py` (`_inherit = 'hr.payslip.run'`): `webvue_state` Selection `draft|computed|approved` required default `draft` (the bridge adds `posted|paid`); `webvue_approved_by_id` Many2one `res.users`; `webvue_approved_at` Datetime; `_webvue_one_run_per_month = models.Constraint('UNIQUE(company_id, date_start)', ...)`; `@api.constrains` `date_start` is day 1 and `date_end` its month end. OCA `state` stays the engine's own field: `close_payslip_run()` on approve, nothing else writes it.
  - `@api.model _webvue_create_month(month_start: date) -> run` (name `YYYY-MM`, company `env.company`, then `_webvue_sync_payslips()`); duplicate -> `WebVueHrRule('duplicate', 'a run already exists for this month', field='month')`.
  - `_webvue_sync_payslips()`: in draft/computed, one payslip per employee of the company with a compensation record and a version overlapping the month; adds missing, unlinks payslips of employees no longer eligible; each payslip carries the five input lines.
  - `_webvue_compute()`: requires `draft|computed`; sync, `compute_sheet()` per payslip, write `webvue_department_id`, state `computed`.
  - `_webvue_approve()`: requires `computed` (`WebVueHrRule('transition_forbidden', status=403)` otherwise); refuses when any payslip employee's `user_id == env.user` (403 `transition_forbidden`, `field='employee_id'`); refuses `NET < 0` (422 `negative_net`, `details={'employee_ids': [...]}`); refuses a leaver of the month without a confirmed settlement (422 `settlement_missing`, Task 18 adds the check through `_webvue_approval_blockers()`); then `action_payslip_done()` with `without_compute_sheet=True`, `close_payslip_run()`, state `approved`, stamps approver.
  - `_webvue_cancel()`: only `draft|computed`; cancels then unlinks payslips and the run.
  - `_webvue_set_inputs(payslip, vals)`: only `draft|computed`; writes `hr.payslip.input.amount` by code; a computed run returns to `draft` and its payslips to engine `draft`.
  - `_webvue_totals() -> dict` (`gross`, `deductions`, `gosi_employee`, `gosi_employer`, `net`, from `hr.payslip.line` `_read_group` by code), `_webvue_warnings() -> list[dict]` (`compensation_missing` for company employees with a version and no compensation; `missing_iban`), `_webvue_allowed_actions() -> list[str]` (`compute`, `approve`, `cancel`, `edit_inputs` by state and capability, plus `self.env['webvue.hr.payroll.finance.link']._webvue_finance_actions(self)`).
- `payroll_finance_link.py`: AbstractModel `webvue.hr.payroll.finance.link` with `_webvue_finance_actions(run) -> list[str]` (default `[]`) and `_webvue_finance_refs(run) -> dict | None` (default `None`); the bridge overrides both (pattern `webvue_pmo` `webvue.project.actual.source`).
- Routes (`controllers/payroll/runs.py`, decorators `hr_rule_handler` inside `api_handler`):
  - `GET /api/v1/hr/payroll/runs?year=&state=&limit=&offset=` (`hr.payroll.read`) -> `{items: HrPayrollRunSummary[], total}`.
  - `POST /api/v1/hr/payroll/runs` `{month: 'YYYY-MM'}` (`hr.payroll.manage`) -> 201 `HrPayrollRun`.
  - `GET /api/v1/hr/payroll/runs/<int:run_id>` -> `HrPayrollRun {id, month, state, employee_count, totals, warnings: [{code, employee: ref}], allowed_actions, approved_by: ref|null, approved_at, finance: {entry_id, entry_name, payment_id, payment_name}|null}`.
  - `DELETE /api/v1/hr/payroll/runs/<int:run_id>` (`hr.payroll.manage`) -> 204.
  - `POST /runs/<id>/compute` (`hr.payroll.manage`), `POST /runs/<id>/approve` (`hr.payroll.approve`) -> `HrPayrollRun`.
  - `GET /runs/<id>/payslips?q=&limit=&offset=` (`hr.payroll.read`) -> `{items: HrPayslipRow[], total}`; row `{id, employee: ref, department: ref|null, state, paid_days, inputs: {overtime_amount, absence_days, bonus_amount, deduction_amount, advance_recovery_amount}, gross, deductions, net, iban_missing}`.
  - `PATCH /runs/<id>/payslips/<int:payslip_id>/inputs` (`hr.payroll.manage`) body: any non-empty subset of the five input keys, numbers >= 0 -> `HrPayslipRow`.

- [ ] Write `test_payroll_runs.py` (`PayrollCase`; users officer `hr.payroll.manage`, approver `hr.payroll.approve`, reader, HR manager):
  - `test_run_state_machine`: create 201 `draft` -> PATCH inputs ok -> compute `computed` -> PATCH inputs returns run to `draft` -> compute -> approve `approved`; after approve PATCH inputs 422 `invalid`/`not_editable`, compute 403 `transition_forbidden`, DELETE 403.
  - `test_one_run_per_company_month`: second POST same month -> 422 `duplicate` `field='month'`.
  - `test_approver_cannot_approve_run_with_own_payslip`: approver has an employee with compensation -> 403 `transition_forbidden`.
  - `test_approve_refuses_negative_net` and `test_zero_net_payslip_is_approvable` (Review Focus 3: `WV_DEDUCTION` 20000 on a 12281.25 net -> 422; deduction equal to net -> approve 200 with `NET` 0).
  - `test_manager_cannot_approve_and_hr_manager_cannot_read`: officer approve 403 `forbidden`; HR manager GET list 403.
  - `test_cancel_frees_the_month`: DELETE a computed run 204, POST same month 201.
  - `test_run_list_envelope_and_detail_keys`: exact key sets `RUN_KEYS`, `ROW_KEYS`; `totals.net` equals the sum of row nets.
  - `test_compensation_missing_warning`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL (routes missing).
- [ ] Implement; extend migration README (columns on `hr_payslip_run`, `hr_payslip`).
- [ ] Run `npm run test:odoo -- --addons webvue_hr && npm test`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): add the monthly payroll run lifecycle and inputs"`.

### Task 9: Payslip detail and own payslips self-service

Risk: risky (self-service privacy).

**Files:**
- Create: `odoo-addons/webvue_hr/serializers/payroll/payslip.py`, `controllers/payroll/payslips.py`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_payslips.py`

**Interfaces:**
- `GET /api/v1/hr/payroll/runs/<int:run_id>/payslips/<int:payslip_id>` (`hr.payroll.read`) -> `HrPayslip {id, number, month, state, employee: ref, department: ref|null, paid_days, lines: [{code, name, category, amount}], gross, deductions, net, gosi_employer, company: {name, vat}}` (lines with `appears_on_payslip` only; `GOSI_ER_*` grouped under `gosi_employer`, not in `lines`).
- `GET /api/v1/hr/payroll/payslips/mine` (`hr.employees.read`, feature `hr.enabled` + `hr.payroll`) -> `{items: HrMyPayslipSummary[], total}`: the caller's own employee's payslips in state `done` only, newest month first; the record rules of Task 3 do the filtering, the route adds the own-employee domain (no elevation).
- `GET /api/v1/hr/payroll/payslips/mine/<int:payslip_id>` -> `HrPayslip`; a colleague's or a non-approved payslip -> 404.

- [ ] Write `test_payroll_payslips.py`:
  - `test_employee_sees_only_own_approved_payslips`: approved run with A (user `own`) and B; `own` GET mine -> 1 item (A); GET mine/<B's id> 404; payslip of a draft run of the next month is not listed.
  - `test_employee_without_payroll_cannot_open_run_payslip`: `own` GET `/runs/<id>/payslips/<A>` 403.
  - `test_payslip_detail_keys_and_lines`: exact `PAYSLIP_KEYS`; `lines` codes for the full-month case `['BASIC', 'HOUSING', 'TRANSPORT', 'GOSI_EE_ANN', 'GOSI_EE_SANED']`; `net` 12281.25; `gosi_employer` 1468.75.
  - `test_mine_closed_with_payroll_feature_off`: 403 `feature_not_included`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm run test:odoo -- --addons webvue_hr && npm test`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): add payslip detail and own payslips self-service"`.

### Task 10: Web run pages, payslip page and payroll settings page

Risk: mechanical (worker), large; split the commit if a reviewer asks.

**Files:**
- Modify: `packages/contracts/src/hr/payroll.ts`, `packages/contracts/src/hr/__tests__/payroll.test.ts`
- Create: `apps/web/app/composables/useHrPayrollRuns.ts`, `useHrPayrollSettings.ts`; tests in `apps/web/app/composables/__tests__/`
- Create: `apps/web/app/components/hr/payroll/PayrollRunTable.vue`, `PayrollRunCreateForm.vue`, `PayrollInputsTable.vue`, `PayrollRunTotals.vue`, `PayrollRunActions.vue`, `PayslipDocument.vue`, `GosiRateTable.vue`, `PayrollGeneralSettingsForm.vue` + one story each in `apps/web/stories/hr/payroll/`
- Create: `apps/web/app/pages/hr/payroll.vue` (list + `<NuxtPage />`, pattern `pages/hr/assets.vue`), `pages/hr/payroll/new.vue` (`SharedCreatePanel`), `pages/hr/payroll/[runId]/index.vue`, `pages/hr/payroll/[runId]/payslips/[payslipId].vue` (printable, `@media print` via existing tokens), `pages/hr/payroll/settings.vue` (`SharedSettingsPage`)
- Modify: `apps/web/i18n/locales/{ar,en}/hr-payroll.json`
- Create: `apps/web/e2e/hr-payroll-ui-preview-data.mjs`; Modify: `apps/web/e2e/module-ui-preview-data.mjs` (wire it), `apps/web/e2e/ci-mock-specs.txt`; Create: `apps/web/e2e/hr-payroll-mocked.spec.ts`

**Interfaces:**
- Zod: `HrPayrollRunStateSchema = z.enum(['draft', 'computed', 'approved', 'posted', 'paid'])`, `HrPayrollRunSummarySchema`, `HrPayrollRunListSchema`, `HrPayrollRunSchema`, `HrPayrollRunCreateSchema ({month: /^\d{4}-(0[1-9]|1[0-2])$/})`, `HrPayslipInputsSchema`, `HrPayslipInputsPatchSchema` (non-empty), `HrPayslipRowSchema`, `HrPayslipRowListSchema`, `HrPayslipSchema`, `HrMyPayslipSummarySchema`, `HrMyPayslipListSchema`, `HrPayrollSettingsSchema`, `HrPayrollSettingsPatchSchema`, `HrGosiRateSchema`, `HrGosiRateListSchema`, `HrGosiRateWriteSchema`, `HrPayrollWarningSchema`.
- Composables: `useHrPayrollRuns(query)`, `useHrPayrollRun(runId)`, `useCreateHrPayrollRun()`, `useHrPayrollRunTransition(runId)` returning `{compute, approve, cancel}` mutations (pending until the server answers; replace `hrPayrollKeys.run(id)` with the response, invalidate lists), `useHrPayrollRunPayslips(runId, query)`, `usePatchHrPayslipInputs(runId)` (optimistic row edit allowed, replaced by the server row), `useHrPayslip(runId, payslipId)`, `useHrPayrollSettings()`, `usePatchHrPayrollSettings()`, `useHrGosiRates()`, `useSaveHrGosiRate()`, `useDeleteHrGosiRate()`.
- Manifest (`apps/web/app/modules/hr/manifest.ts`): `AREA_CREATE` += `['/hr/payroll', { id: 'new-payroll-run', labelKey: 'hrPayroll.runs.new', icon: plus, to: '/hr/payroll/new', capability: 'hr.payroll.manage', pinned: true }]`; `routeCapabilities` += `/^\/hr\/payroll\/new$/` manage, `/^\/hr\/payroll\/settings$/` config, `/^\/hr\/payroll(?:\/|$)/` read (all `feature: 'hr.payroll'`, placed after Task 11's `mine` entry); `landing` += `{ path: '/hr/payroll', capability: 'hr.payroll.read' }`; `commands` += `hr.new-payroll-run`.

- [ ] Write contract tests (one `accepts`/`rejects` pair per schema family), composable tests (`approve stays pending until the server answers`, `inputs patch replaces the row with the server row`), manifest tests (`['/hr/payroll', 'hr.payroll.read']`, `['/hr/payroll/new', 'hr.payroll.manage']`, `['/hr/payroll/settings', 'hr.payroll.config']`) and the mocked spec (`run page shows totals and inline-confirmed approve`, `payslip page prints net`).
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test`. Expected FAIL.
- [ ] Implement: the run page is also the monthly payroll register (spec 3.4): its payslip table with totals prints as the register (print styles hide actions). Run page = `SharedRecordPage` + `SharedKpiStrip` totals + `PayrollInputsTable` (inline number cells editable only when `allowed_actions` has `edit_inputs`) + warnings + `PayrollRunActions` (compute, approve, cancel; `approve` and `cancel` use `SharedInlineConfirm`); the list keeps its query filters on back navigation (`returnToQuery`).
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test && npm -w apps/web run lint && node tools/ui_catalog.mjs && node tools/ui_catalog.mjs --check && python3 -B tools/ui_policy.py`. Expected PASS.
- [ ] Mock-stack proof (memory note "Isolated UI mock stack"): start `apps/web/e2e/internal-ui-audit-mock.mjs` with `MODULE_UI_PREVIEW=1 MOCK_PORT=<free>` and the worktree Nuxt on a free port; `E2E_BASE_URL=http://localhost:<nuxt> npx -w apps/web playwright test e2e/hr-payroll-mocked.spec.ts`; capture run page and payslip page in light/dark, desktop/mobile, RTL. Never use :3000 / :8069.
- [ ] Commit: `git commit -m "feat(web): add payroll run pages, payslip page and settings"`.

### Task 11: HR sidebar section «الرواتب» and «قسائمي»

Risk: mechanical (worker); touches shared `common.json`.

**Files:**
- Modify: `apps/web/app/modules/hr/manifest.ts`; Test: `apps/web/app/modules/__tests__/manifests.test.ts`
- Create: `apps/web/app/pages/hr/payroll/mine/index.vue`, `pages/hr/payroll/mine/[payslipId].vue` (reuses `PayslipDocument`)
- Create: `apps/web/app/composables/useHrPayslips.ts` (`useMyHrPayslips()`, `useMyHrPayslip(id)`); test
- Modify (shared): `apps/web/i18n/locales/{ar,en}/common.json` (`nav.payroll` «المسيّرات» / Payroll runs, `nav.payrollSettings` «إعدادات الرواتب», `nav.myPayslips` «قسائمي» / My payslips); `apps/web/i18n/locales/{ar,en}/hr.json` (`hr.nav.payroll` «الرواتب» / Payroll)

**Interfaces:**
- `contextLinks` += `{ id: 'payroll', labelKey: 'nav.payroll', icon: 'i-lucide-banknote', to: '/hr/payroll', capability: 'hr.payroll.read', feature: 'hr.payroll', section: 'hr.nav.payroll' }`, `{ id: 'payroll-settings', labelKey: 'nav.payrollSettings', icon: 'i-lucide-settings-2', to: '/hr/payroll/settings', capability: 'hr.payroll.config', feature: 'hr.payroll', section: 'hr.nav.payroll' }` (section placed after `hr.nav.daily`, before `hr.nav.mine`), and in `hr.nav.mine` `{ id: 'my-payslips', labelKey: 'nav.myPayslips', icon: 'i-lucide-receipt', to: '/hr/payroll/mine', capability: 'hr.employees.read', feature: 'hr.payroll', section: 'hr.nav.mine' }`.
- `nav` += `{ to: '/hr/payroll', labelKey: 'nav.payroll', icon: 'i-lucide-banknote', shortcut: '', capability: 'hr.payroll.read' }`.
- `routeCapabilities` += `{ pattern: /^\/hr\/payroll\/mine(?:\/[^/]+)?$/, capability: 'hr.employees.read', feature: 'hr.payroll' }` placed before the generic payroll entry.
- `isNavActive`: `/hr/payroll/mine` is its own entry; `/hr/payroll` claims `/hr/payroll/<runId>/...` and `/hr/payroll/new` but not `mine` or `settings`; `/hr/payroll/settings` exact.

- [ ] Write manifest tests: `['/hr/payroll/mine', 'hr.employees.read']`, `['/hr/payroll/mine/7', 'hr.employees.read']`; a user with only `hr.employees.read` and `hr.payroll` readable sees `my-payslips` and not `payroll`; a user with `hr.payroll.read` but feature `hr.payroll` closed sees neither; `isNavActive('/hr/payroll/mine', '/hr/payroll')` is false.
- [ ] Run `npm -w apps/web run test -- app/modules/__tests__/manifests.test.ts`. Expected FAIL.
- [ ] Implement manifest, pages, composable, locale keys (ar and en; `tests/localeFiles.test.ts` keeps both in sync).
- [ ] Run `npm -w apps/web run test && npm -w apps/web run lint`. Expected PASS.
- [ ] Commit: `git commit -m "feat(web): add the payroll sidebar section and my payslips"`.

### Task 12: Bridge webvue_hr_finance: scaffold, finance settings and cost centers

Risk: risky (new addon, shared registration files, cross-addon helper move).

**Files:**
- Create: `odoo-addons/webvue_hr_finance/__init__.py`, `__manifest__.py` (`19.0.1.0.0`, `depends: ['webvue_hr', 'webvue_finance']`, `auto_install: True`, data `security/ir.model.access.csv`, `security/payroll_finance_rules.xml`), `models/__init__.py`, `models/payroll_finance_settings.py`, `models/payroll_cost_center.py`, `serializers/__init__.py`, `serializers/settings.py`, `controllers/__init__.py`, `controllers/settings.py`, `i18n/ar.po`, `tests/__init__.py` (`import_all_tests`), `tests/common.py`, `tests/test_payroll_finance_settings.py`
- Modify (shared, orchestrator): `tools/arch_layers.json` (`"webvue_hr_finance": 5`), `deploy/provision.sh`, `deploy/verification-checks.json`, `deploy/check_isolated.py`, `deploy/OPERATIONS.md`, `deploy/control-plane-outage/README.md`, `deploy/control-plane-outage/outage-fixture`, `tools/webvue_cli/operator.py`, `tools/shared_acceptance_live/up.sh` (insert `webvue_hr_finance` after `webvue_pmo_finance` in each module list, the same files commit `d3bfb8e4` touched), `docs/agents/repository-layout.md` (bridge entry)
- Modify (shared): `odoo-addons/webvue_finance/controllers/write_support.py` (move `_require_balanced` from `finance_entries.py:58` here as public `require_balanced(lines)`), `odoo-addons/webvue_finance/controllers/finance_entries.py` (import it; no behaviour change)

**Interfaces:**
- `webvue.hr.payroll.finance.settings`: `company_id` required unique; `journal_id` (general journal of the company); accounts `basic_expense_account_id`, `allowance_expense_account_id`, `variable_expense_account_id` (overtime, bonus, leave encashment), `gosi_expense_account_id`, `gosi_payable_account_id`, `salaries_payable_account_id` (must be `reconcile=True`), `deduction_account_id`, `advance_account_id` (employee receivable, `reconcile=True`), `eos_expense_account_id`, `eos_provision_account_id`; `default_analytic_account_id`; `entry_detail` Selection `aggregated|per_employee` required default `aggregated`. `@api.constrains`: every account and the journal belong to the company. `_webvue_for_company(company)` like Task 6.
- `webvue.hr.payroll.cost.center`: `company_id`, `department_id` (company department), `analytic_account_id` (company analytic account, `analytic_support.company_analytic_domain()`); `UNIQUE(company_id, department_id)`.
- ACL: settings read `webvue_hr.group_cap_hr_payroll_read` and `webvue_finance.group_cap_finance_setup_read`, write/create `webvue_finance.group_cap_finance_setup_manage`; cost centers read the same readers plus `group_cap_finance_analytic_read`, write/create/unlink `webvue_finance.group_cap_finance_analytic_manage`; company rules.
- Routes (`controllers/settings.py`): `GET /api/v1/hr/payroll/finance-settings` (`match='any'` of `hr.payroll.read`, `finance.setup.read`) -> `HrPayrollFinanceSettings {journal: ref|null, accounts: {basic_expense: ref|null, ...10 keys}, default_analytic_account: ref|null, entry_detail}`; `PATCH` (`finance.setup.manage`) partial; `GET /api/v1/hr/payroll/cost-centers` -> `{items: [{department: ref, analytic_account: ref|null}], total}` over all company departments; `PUT /api/v1/hr/payroll/cost-centers/<int:department_id>` `{analytic_account_id: int|null}` (`finance.analytic.manage`). Feature gate `('hr.enabled', 'hr.payroll', 'finance.enabled')`.
- `tests/common.py`: `class PayrollFinanceCase(AnalyticCase)` (from `webvue_finance/tests/analytic_common.py`) adding payroll users through `user_with(login, keys)`, an approved run builder `_approved_run(employees, month)` (computes as officer, approves as approver), and the account fixtures of the company chart.

- [ ] Write `test_payroll_finance_settings.py`: `test_bridge_auto_installs` (module state installed with both sides), `test_default_entry_detail_is_aggregated`, `test_only_finance_setup_manage_edits_accounts` (payroll config 403, finance accountant 403, finance manager 200), `test_accounts_must_belong_to_company` (422 `field='accounts.salaries_payable'`), `test_cost_center_mapping_needs_analytic_manage`, `test_cost_center_list_covers_every_department`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance`. Expected FAIL (module unknown).
- [ ] Implement scaffold, models, routes, registration lists; move `require_balanced`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance,webvue_finance && python3 -B tools/arch_policy.py --base main && npm test`. Expected PASS; `webvue_finance` entries tests unchanged and green; arch policy reports no new violation.
- [ ] Commit: `git commit -m "feat(hr): add the webvue_hr_finance bridge and its settings"`.

### Task 13: Post an approved run to accounting

Risk: risky (balanced entry, analytic split, period lock, move guard).

**Files:**
- Create: `odoo-addons/webvue_hr_finance/models/hr_payslip_run.py`, `models/account_move.py`, `models/payroll_posting.py`, `models/payroll_finance_link.py`; `serializers/posting.py`; `controllers/posting.py`
- Test: `odoo-addons/webvue_hr_finance/tests/test_payroll_posting.py`

**Interfaces:**
- `hr_payslip_run.py`: `webvue_state = fields.Selection(selection_add=[('posted', 'Posted'), ('paid', 'Paid')], ondelete={'posted': lambda runs: runs.write({'webvue_state': 'approved'}), 'paid': lambda runs: runs.write({'webvue_state': 'approved'})})`; `webvue_move_id` Many2one `account.move` readonly, `ondelete='restrict'`.
- `account_move.py`: `webvue_payroll_origin` Selection `run|payment|eos_provision` readonly (what generated the move, like stock `origin_payment_id`); overrides of public `button_draft()`, `button_cancel()` and `unlink()` raise `UserError` for a move with a payroll origin (the Finance routes' `attempt()` then answers 422).
- `payroll_posting.py` (AbstractModel `webvue.hr.payroll.posting`):
  - `RULE_ACCOUNT_ROLES = {'BASIC': 'basic_expense', 'ABSENCE': 'basic_expense', 'UNPAID': 'basic_expense', 'HOUSING': 'allowance_expense', 'TRANSPORT': 'allowance_expense', 'OTHER': 'allowance_expense', 'OVERTIME': 'variable_expense', 'BONUS': 'variable_expense', 'LEAVE_ENC': 'variable_expense', 'EOS': 'eos_provision', 'DEDUCTION': 'deduction', 'SETTLEMENT_DED': 'deduction', 'ADVANCE': 'advance', 'GOSI_EE_ANN': 'gosi_payable', 'GOSI_EE_SANED': 'gosi_payable', 'NET': 'salaries_payable'}`; employer GOSI codes post twice: debit `gosi_expense`, credit `gosi_payable`. Codes of the shipped structure, not a bank layout.
  - `_webvue_posting_lines(run, settings) -> (list[dict], list[dict])` returns `(lines, warnings)`; each line `{account_id, name, debit, credit, partner_id?, analytic_distribution?}`. Key per line: aggregated `(account, analytic)` for expense lines, `(account,)` for liability lines; per_employee adds `employee` and sets `partner_id = employee.work_contact_id` and `name = employee.name`. `ADVANCE` lines always carry the employee partner (the receivable is per employee) in both modes. Expense lines carry `{str(analytic_id): 100}` from the payslip's `webvue_department_id` mapping, else `default_analytic_account_id` plus warning `{code: 'unmapped_department', employee}`; no default and an unmapped department -> 422 `missing_cost_center`.
  - `_webvue_post(run) -> account.move`: requires `approved`; reads `entry_detail` at post time; `require_balanced(lines)`; refuses `is_period_locked(run.date_end, journal)` with `period_locked(field='date')` before creating anything; creates the move (date `run.date_end`, journal, `ref` run name, `webvue_payroll_origin='run'`) in the caller's environment and posts it through `attempt(move.action_post, day=..., journal=...)`; writes `webvue_move_id`, state `posted`.
- `payroll_finance_link.py` overrides `_webvue_finance_actions(run)` (`post` when approved and caller has `finance.entries.post`; `record_payment` when posted and caller has `finance.payments.manage`; `eos_provision` from Task 19) and `_webvue_finance_refs(run)` (`entry_id` always, `entry_name` only with `finance.entries.read`).
- Routes: `GET /api/v1/hr/payroll/runs/<int:run_id>/posting-preview` (`hr.payroll.read` + `finance.entries.post`, `match='all'`) -> `HrPayrollPostingPreview {entry_detail, date, journal: ref, lines: [{account: {id, code, name}, analytic_account: ref|null, employee: ref|null, debit, credit}], debit, credit, warnings}`; `POST /api/v1/hr/payroll/runs/<int:run_id>/post` (same gates) -> `HrPayrollRun` (HR detail shape, `finance` filled).

- [ ] Write `test_payroll_posting.py` (fixture: E1 Saudi registered 2020, basic 10000, housing 2500, transport 1000, department A mapped to analytic AA; E2 Egyptian, basic 6000, housing 1500, transport 500, department B unmapped; default analytic DEF; month 2026-11):
  - `test_aggregated_entry_is_balanced_with_analytic_split`: 8 lines: basic expense AA 10000.00 / DEF 6000.00, allowance AA 3500.00 / DEF 2000.00, GOSI expense AA 1468.75 / DEF 150.00, credit salaries payable 20281.25, credit GOSI payable 2837.50; debit = credit = 23118.75; no line carries a partner; preview warnings = `[unmapped_department E2]`.
  - `test_per_employee_entry_lines`: `entry_detail='per_employee'`: 10 lines, payable lines 12281.25 (partner E1) and 8000.00 (partner E2).
  - `test_setting_change_does_not_rewrite_posted_runs`: post October aggregated, switch to per_employee, post November: October move line count unchanged.
  - `test_advance_recovery_credits_employee_receivable_with_partner`: `WV_ADVANCE` 500 on E1, aggregated: advance credit 500.00 with partner E1, payable 19781.25.
  - `test_post_refuses_locked_period` (Review Focus 4).
  - `test_posting_uses_payslip_department_snapshot` (Review Focus 5).
  - `test_post_needs_both_capabilities`: payroll reader 403; finance accountant without payroll 403; HR approver 403; user with `hr.payroll.read` + `finance.entries.post` 200.
  - `test_payroll_move_cannot_be_reset_or_deleted`: `POST /api/v1/finance/entries/<move>/reset-to-draft` as finance manager -> 422; `move.unlink()` raises `UserError`.
  - `test_missing_cost_center_without_default` -> 422 `missing_cost_center`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance,webvue_hr,webvue_finance`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): post approved payroll runs to accounting"`.

### Task 14: Record the salary payment of a posted run

Risk: risky (reconciliation).

**Files:**
- Modify: `odoo-addons/webvue_hr_finance/models/hr_payslip_run.py` (`webvue_payment_id` Many2one `account.payment`), `models/payroll_posting.py`, `controllers/posting.py`
- Test: `odoo-addons/webvue_hr_finance/tests/test_payroll_payment.py`

**Interfaces:**
- `_webvue_record_payment(run, journal, day) -> account.payment`: requires `posted`; journal of type `bank` or `cash` of the company (422 `field='journal_id'`); refuses a locked `day` (`period_locked(field='date')`); creates one outbound `account.payment` (amount = sum of the run move's salaries-payable credits, `destination_account_id` = salaries payable, `memo` run name, no partner in aggregated mode) in the caller's environment, posts it through `attempt`, marks its move `webvue_payroll_origin='payment'`, reconciles its payable debit with the run move's payable credit lines (`(lines).reconcile()`), writes `webvue_payment_id`, state `paid`.
- Route `POST /api/v1/hr/payroll/runs/<int:run_id>/payment` `{journal_id: int, date: 'YYYY-MM-DD'}` (`hr.payroll.read` + `finance.payments.manage`) -> `HrPayrollRun`.

- [ ] Write `test_payroll_payment.py`: `test_payment_clears_salaries_payable` (payment amount 20281.25; every salaries-payable line of the run move `reconciled`; run `paid`; the payment appears in `GET /api/v1/finance/payments`), `test_payment_refuses_locked_date` (Review Focus 4), `test_payment_needs_posted_run` (approved -> 403 `transition_forbidden`), `test_payment_needs_both_capabilities`, `test_payment_journal_must_be_bank_or_cash`, `test_per_employee_payable_lines_are_reconciled`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): record the salary payment of a posted payroll run"`.

### Task 15: Web finance side of payroll (run actions, finance settings sections)

Risk: mechanical (worker).

**Files:**
- Modify: `packages/contracts/src/hr/payroll.ts` (+ tests): `HrPayrollFinanceSettingsSchema`, `HrPayrollFinanceSettingsPatchSchema`, `HrPayrollCostCenterSchema`, `HrPayrollCostCenterListSchema`, `HrPayrollCostCenterWriteSchema`, `HrPayrollPostingPreviewSchema`, `HrPayrollPaymentCreateSchema`
- Create: `apps/web/app/composables/useHrPayrollFinance.ts` (`useHrPayrollFinanceSettings()`, `usePatchHrPayrollFinanceSettings()`, `useHrPayrollCostCenters()`, `useSetHrPayrollCostCenter()`, `useHrPayrollPostingPreview(runId)`, `usePostHrPayrollRun(runId)`, `useRecordHrPayrollPayment(runId)`); test
- Create: `apps/web/app/components/hr/payroll/PayrollPostingPreview.vue`, `PayrollPaymentForm.vue`, `PayrollFinanceSettingsForm.vue`, `PayrollCostCenterTable.vue` + stories
- Modify: `apps/web/app/components/hr/payroll/PayrollRunActions.vue`, `apps/web/app/pages/hr/payroll/[runId]/index.vue`, `apps/web/app/pages/hr/payroll/settings.vue`, locales, mock data and mocked spec

**Interfaces:**
- The run page shows `post` and `record_payment` only when `allowed_actions` lists them (the server decides, the bridge may be absent); the preview lists warnings before an inline-confirmed post; the settings page shows the finance section only when `GET /finance-settings` answers 200 (404/403 hides it, no client guess about installed addons); finance fields are read-only unless `can('finance.setup.manage')`, cost centers unless `can('finance.analytic.manage')`. No file under `components/finance/**` or `pages/finance/**` is touched (R3).

- [ ] Write tests: contract pairs; composable `post stays pending until the server answers`; mocked spec `post shows unmapped-department warning then confirms inline`, `settings hides finance section on 404`.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test && npm -w apps/web run lint && node tools/ui_catalog.mjs && node tools/ui_catalog.mjs --check && python3 -B tools/arch_policy.py --base main`. Expected PASS (R3 web check: HR folders import no finance component).
- [ ] Commit: `git commit -m "feat(web): add payroll posting and payment to the run page"`.

### Task 16: Bank salary file profiles, WPS file and GOSI statement

Risk: risky (file correctness, totals rule).

**Files:**
- Create: `odoo-addons/webvue_hr/models/bank_profile.py`, `models/payroll_export.py` (imports)
- Create: `odoo-addons/webvue_hr/data/hr_payroll_file_profile_data.xml` (manifest `data`; header comment `VERIFY the WPS columns against the current Mudad template before release`)
- Modify: `security/ir.model.access.csv`, `security/hr_payroll_rules.xml`
- Create: `odoo-addons/webvue_hr/serializers/payroll/files.py`, `controllers/payroll/files.py`; Modify: `controllers/payroll/settings.py` (profile CRUD)
- Test: `odoo-addons/webvue_hr/tests/test_payroll_files.py`

**Interfaces:**
- `webvue.hr.payroll.bank.profile`: `company_id` (optional; seed rows shared), `name`, `kind` Selection `bank|wps`, `delimiter` Selection `,|;|\t|\|` default `,`, `encoding` Selection `utf-8|utf-8-sig` default `utf-8`, `include_header` Boolean default True, `footer` Selection `none|totals` default `none`, `column_ids` One2many `webvue.hr.payroll.bank.profile.column` (`sequence`, `source` Selection `employee_ref|identification|name|iban|bank_code|basic|housing|other_allowances|deductions|net|value_date|constant`, `label`, `constant_value`).
- Seed: `profile_generic_csv` (kind `bank`; columns identification, name, iban, basic, housing, other_allowances, deductions, net, value_date); `profile_mudad_wps` (kind `wps`; columns name, identification, iban, basic, housing, other_allowances, deductions, net).
- `payroll_export.py`: `@dataclass(frozen=True) SalaryLine(employee_id, employee_ref, identification, name, iban, bank_code, basic, housing, other_allowances, deductions, net)` built on demand from approved payslip lines (`basic` = BASIC; `housing` = HOUSING; `other_allowances` = TRANSPORT + OTHER + OVERTIME + BONUS + EOS + LEAVE_ENC; `deductions` = -(ABSENCE + UNPAID + DEDUCTION + ADVANCE + SETTLEMENT_DED + GOSI_EE_*)); not stored. AbstractModel `webvue.hr.payroll.export`: `_webvue_salary_lines(run) -> list[SalaryLine]`, `_webvue_render(profile, lines, value_date) -> bytes` (stdlib `csv`, `QUOTE_MINIMAL`, `\r\n`; amounts `format(money(x), 'f')`: ASCII digits, `.` decimal, no grouping; dates ISO; text UTF-8), `_webvue_check_totals(lines)` (per line `basic + housing + other_allowances - deductions == net`, else 422 `wps_totals_mismatch` with the employee), `_webvue_gosi_statement(run) -> dict`.
- Routes (all require run state in `approved|posted|paid`, else 403 `transition_forbidden`):
  - `GET /api/v1/hr/payroll/runs/<int:run_id>/bank-file?profile_id=&value_date=` (`type='http'`, `hr.payroll.read`): lines with `net > 0` only; any of them without IBAN -> 422 `missing_iban` `details={'employee_ids': [...]}`; `Content-Type: text/csv; charset=utf-8`, `Content-Disposition` via `content_disposition('salaries-YYYY-MM.csv')`.
  - `GET /api/v1/hr/payroll/runs/<int:run_id>/wps-file?profile_id=` (`type='http'`): every payslip line including zero net; totals rule enforced first; missing IBAN on a positive net -> 422 `missing_iban`.
  - `GET /api/v1/hr/payroll/runs/<int:run_id>/gosi-statement` (`json2`) -> `HrGosiStatement {month, lines: [{employee: ref, gosi_number, nationality_class, contributory_wage, branches: {annuities: {employee, employer}, saned: {...}, hazards: {...}}, employee_amount, employer_amount}], totals: {contributory_wage, employee_amount, employer_amount}}` (a document, not a list route), built from `GOSI_*` payslip lines.
  - `GET|POST /api/v1/hr/payroll/bank-profiles`, `PATCH|DELETE /api/v1/hr/payroll/bank-profiles/<int:profile_id>` (read / `hr.payroll.config`); shared seed profiles are read-only (403 on write).

- [ ] Write `test_payroll_files.py`:
  - `test_bank_file_generic_csv`: two employees, header row equals the profile labels, E1 row contains `12281.25` and `SA0380000000608010167519`, Arabic name round-trips as UTF-8, no `٫` or Arabic-Indic digit anywhere, delimiter `,`.
  - `test_bank_file_refuses_employee_without_iban` and `test_bank_file_skips_zero_net_line` (Review Focus 1).
  - `test_wps_totals_rule_holds_for_every_line` and `test_wps_keeps_zero_net_line` (Review Focus 3).
  - `test_profile_delimiter_and_bom`: `;` + `utf-8-sig` -> file starts with `﻿`, fields split by `;`.
  - `test_files_need_an_approved_run`: computed run -> 403 `transition_forbidden`.
  - `test_gosi_statement_totals`: E1 old Saudi + E2 non-Saudi: totals employee 1218.75, employer 1618.75, contributory wage 20000.00.
  - `test_shared_profile_is_read_only`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL.
- [ ] Implement; extend migration README.
- [ ] Run `npm run test:odoo -- --addons webvue_hr && npm test`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): export bank salary and WPS files and GOSI statement"`.

### Task 17: Web salary files, GOSI statement and bank profiles

Risk: mechanical (worker).

**Files:**
- Modify: `packages/contracts/src/hr/payroll.ts` (+ tests): `HrBankProfileSchema`, `HrBankProfileListSchema`, `HrBankProfileWriteSchema`, `HrGosiStatementSchema`
- Create: `apps/web/app/composables/useHrPayrollFiles.ts` (`hrPayrollFileUrl(runId: number, kind: 'bank' | 'wps', params: { profileId: number; valueDate?: string }): string`, `useHrGosiStatement(runId)`, `useHrBankProfiles()`, `useSaveHrBankProfile()`, `useDeleteHrBankProfile()`); test
- Create: `apps/web/app/components/hr/payroll/PayrollFileActions.vue`, `GosiStatementTable.vue`, `BankProfileForm.vue` + stories; `apps/web/app/pages/hr/payroll/[runId]/gosi.vue`
- Modify: `PayrollRunActions.vue`, `pages/hr/payroll/[runId]/index.vue`, `pages/hr/payroll/settings.vue`, locales, mock data, mocked spec

**Interfaces:**
- On click the file route is fetched through `useApi()` (same origin, session cookie, raw response); a structured 422 (`missing_iban`, `wps_totals_mismatch`) is shown inline with the employee names, a 200 body is saved as a blob download with the server's file name. No second request and no client-side IBAN check.

- [ ] Write tests: contract pairs; `hrPayrollFileUrl` builds `/api/v1/hr/payroll/runs/7/bank-file?profile_id=1&value_date=2026-12-01`; mocked spec `missing IBAN shows the employee names`.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test && npm -w apps/web run lint && node tools/ui_catalog.mjs --check`. Expected PASS.
- [ ] Commit: `git commit -m "feat(web): add salary files, GOSI statement and bank profiles"`.

### Task 18: End-of-service award, case mapping and final settlement

Risk: risky (Labor Law math; run integration).

**Files:**
- Modify: `odoo-addons/webvue_hr/models/payroll_math.py`, `models/payroll_calculator.py`, `models/hr_payslip_run.py`
- Create: `odoo-addons/webvue_hr/models/eos_case.py`, `models/eos_settlement.py` (imports); `data/hr_eos_case_data.xml`
- Modify: `security/ir.model.access.csv`, `security/hr_payroll_rules.xml`
- Create: `odoo-addons/webvue_hr/serializers/payroll/eos.py`, `controllers/payroll/eos.py`
- Test: `odoo-addons/webvue_hr/tests/test_payroll_eos.py`

**Interfaces:**
- `payroll_math.py`:
  - `EOS_CASES = ('termination', 'contract_expiry', 'resignation', 'force_majeure', 'marriage_childbirth', 'no_award')`.
  - `service_years(start: date, end: date) -> Decimal` (end inclusive, anniversary based):
    ```python
    after = end + timedelta(days=1)
    full = relativedelta(after, start).years
    anniversary = start + relativedelta(years=full)
    return Decimal(full) + Decimal((after - anniversary).days) / Decimal(365)
    ```
  - `eos_award(wage: Decimal, years: Decimal, case: str) -> Decimal`:
    ```python
    full = wage * (Decimal('0.5') * min(years, 5) + max(years - 5, 0))
    if case == 'no_award':
        return money(0)
    if case != 'resignation':
        return money(full)                      # Articles 84 and 87
    if years < 2:
        return money(0)                         # Article 85
    factor = Decimal(1) / 3 if years < 5 else Decimal(2) / 3 if years < 10 else Decimal(1)
    return money(full * factor)
    ```
- `webvue.hr.payroll.eos.case`: `company_id` (optional), `departure_reason_id` (stock `hr.departure.reason`), `case` Selection `EOS_CASES`; `UNIQUE(company_id, departure_reason_id)`. Seed (shared, `noupdate`): `hr.departure_fired` -> `termination`, `hr.departure_resigned` -> `resignation`; any other reason needs a mapping or an explicit case.
- `webvue.hr.payroll.settlement`: `employee_id` required unique; `company_id` related stored; `departure_date` Date (copied from the employee when the settlement is confirmed, so a later edit of the departure is visible as a mismatch warning); `case` Selection; `service_years` Float; `eos_wage`, `award`, `leave_days` (Float), `leave_amount`, `open_deductions`, `total` Monetary; `state` Selection `draft|confirmed`. `_webvue_estimate(employee, day, case) -> dict` (start = `employee._get_first_contract_date()`, wage = compensation `_webvue_fixed_wage()`, leave days = `virtual_remaining_leaves` of `settings.annual_leave_type_id` from `hr.leave.type.get_allocation_data(employee, target_date=day)`, `leave_amount = day_amount(wage, leave_days, divisor)`, `total = award + leave_amount - open_deductions`). Confirm locks the values; the departure month's payslip then takes `eos = award`, `leave_encashment = leave_amount`, `settlement_deduction = -open_deductions` through the calculator; `hr.payslip.run._webvue_approval_blockers()` adds `settlement_missing` for an employee whose `departure_date` is inside the month without a confirmed settlement.
- ACL: case map read `hr.payroll.read`, write `hr.payroll.config`; settlement read `hr.payroll.read`, write/create `hr.payroll.manage`; confirm needs `hr.payroll.approve` and refuses the caller's own employee (403 `transition_forbidden`).
- Routes: `GET /api/v1/hr/payroll/eos/<int:employee_id>/estimate?date=YYYY-MM-DD&case=` -> `HrEosEstimate {employee: ref, start_date, end_date, service_years, eos_wage, case, award, leave_days, leave_amount}`; `GET|PUT /api/v1/hr/payroll/eos/<int:employee_id>/settlement` (PUT `{case, open_deductions}`, draft only) -> `HrSettlement`; `POST /api/v1/hr/payroll/eos/<int:employee_id>/settlement/confirm` -> `HrSettlement`; `GET|PUT /api/v1/hr/payroll/eos-cases` (`{items: [{departure_reason: ref, case: str|null}], total}` / PUT `{departure_reason_id, case}`). An unmapped reason without `case` -> 422 `eos_case_missing` `field='case'`.

- [ ] Write `test_payroll_eos.py`:
  - `test_eos_award_boundaries` (wage 10000): years 1.99 resignation 0.00; 1.99 termination 9950.00; 2 resignation 3333.33; 4.99 resignation 8316.67; 5 resignation 16666.67; 9.99 resignation 49933.33; 10 resignation 75000.00; 10 termination 75000.00; 3 marriage_childbirth 15000.00; 3 no_award 0.00.
  - `test_service_years_is_anniversary_based`: 2024-11-01..2026-10-31 -> 2; 2024-11-01..2026-10-30 -> 1 + 364/365 (< 2, resignation 0); 2021-11-01..2026-10-31 -> 5.
  - `test_final_settlement_amounts`: hired 2023-12-01, departs 2026-11-30, reason resigned, basic 8000, housing 2000, transport 500, annual balance 12.5 days, open deductions 300: award 5250.00, leave 4375.00, total 9325.00.
  - `test_departure_month_payslip_carries_the_settlement`: November run lines `EOS` 5250.00, `LEAVE_ENC` 4375.00, `SETTLEMENT_DED` -300.00; paid days 30.
  - `test_approve_refuses_leaver_without_confirmed_settlement`: 422 `settlement_missing`.
  - `test_unmapped_reason_needs_explicit_case`.
  - `test_settlement_visibility`: HR manager with `hr.offboarding.manage` and no payroll -> 403 on estimate and settlement.
- [ ] Run `npm run test:odoo -- --addons webvue_hr`. Expected FAIL.
- [ ] Implement; extend migration README.
- [ ] Run `npm run test:odoo -- --addons webvue_hr && npm test`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): add end-of-service award and final settlement"`.

### Task 19: Monthly end-of-service provision entry

Risk: risky (accrual delta).

**Files:**
- Create: `odoo-addons/webvue_hr_finance/models/eos_accrual.py`, `models/eos_provision.py`; `serializers/eos.py`; `controllers/eos.py`
- Modify: `models/payroll_finance_link.py` (`eos_provision` action), `security/ir.model.access.csv`, `security/payroll_finance_rules.xml`
- Test: `odoo-addons/webvue_hr_finance/tests/test_payroll_eos_provision.py`

**Interfaces:**
- `webvue.hr.payroll.eos.accrual`: `employee_id` required unique, `company_id`, `amount` Monetary (the last posted accrual), `month` Date. `webvue.hr.payroll.eos.provision`: `company_id`, `month` Date (day 1), `move_id`, `UNIQUE(company_id, month)`.
- `_webvue_post_provision(month_start) -> account.move`: requires the month's run `posted` or `paid` (403 `transition_forbidden` otherwise) and no provision for that month (422 `duplicate`); per employee with compensation: `target = eos_award(fixed_wage, service_years(first_contract_date, month_end), 'termination')` for active employees, `0` for an employee settled in that month; `paid = EOS line of that month's payslip` (positive); `delta = target - (last_accrual - paid)`; lines Dr `eos_expense` (analytic from the payslip department snapshot or default) / Cr `eos_provision` for a positive delta, reversed for a negative one, aggregated or per employee by `entry_detail`; zero deltas emit no line; period lock refused as in Task 13; move `webvue_payroll_origin='eos_provision'`; after posting each accrual `amount = target`, `month = month_start`.
- Routes: `GET /api/v1/hr/payroll/eos-provisions` -> `{items: [{month, entry_id, entry_name, amount}], total}`; `POST /api/v1/hr/payroll/eos-provisions` `{month: 'YYYY-MM'}` (`hr.payroll.read` + `finance.entries.post`) -> 201 item.

- [ ] Write `test_payroll_eos_provision.py`: employee hired 2021-12-01, fixed wage 13500:
  - `test_first_provision_posts_full_accrual`: month 2026-11 (5.0 years) -> move total 33750.00, accrual 33750.00.
  - `test_next_month_posts_only_the_delta`: month 2026-12 (5 + 31/365 years, award 34896.58) -> move total 1146.58.
  - `test_settlement_month_reverses_the_unpaid_part`: leaver settled in 2027-01 with `EOS` 30000.00 paid in the run and last accrual 34896.58 -> delta `0 - (34896.58 - 30000.00)` = -4896.58 (Dr provision, Cr expense).
  - `test_one_provision_per_month`, `test_provision_needs_a_posted_run`, `test_provision_refuses_locked_period`, `test_provision_move_cannot_be_reset`.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm run test:odoo -- --addons webvue_hr_finance,webvue_hr`. Expected PASS.
- [ ] Commit: `git commit -m "feat(hr): post the monthly end-of-service provision"`.

### Task 20: Web end of service on the offboarding record

Risk: mechanical (worker).

**Files:**
- Modify: `packages/contracts/src/hr/payroll.ts` (+ tests): `HrEosCaseSchema`, `HrEosEstimateSchema`, `HrSettlementSchema`, `HrSettlementWriteSchema`, `HrEosCaseMapListSchema`, `HrEosCaseMapWriteSchema`, `HrEosProvisionSchema`, `HrEosProvisionListSchema`, `HrEosProvisionCreateSchema`
- Create: `apps/web/app/composables/useHrPayrollEos.ts` (`useHrEosEstimate(employeeId, params)`, `useHrSettlement(employeeId)`, `useSaveHrSettlement(employeeId)`, `useConfirmHrSettlement(employeeId)`, `useHrEosCases()`, `useSaveHrEosCase()`, `useHrEosProvisions()`, `usePostHrEosProvision()`); test
- Create: `apps/web/app/components/hr/payroll/EosSettlementSection.vue`, `EosCaseMapTable.vue` + stories
- Modify: `apps/web/app/pages/hr/offboarding/[employeeId].vue` (section only with `can('hr.payroll.read')` and feature `hr.payroll`), `pages/hr/payroll/settings.vue` (EOS mapping section), `components/hr/payroll/PayrollRunActions.vue` (`eos_provision` action with inline confirmation), locales, mock data, mocked spec

- [ ] Write tests: contract pairs; composable `confirm stays pending until the server answers`; mocked spec `offboarding record shows the settlement only with payroll read`.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test`. Expected FAIL.
- [ ] Implement.
- [ ] Run `npm -w packages/contracts run test && npm -w apps/web run test && npm -w apps/web run lint && node tools/ui_catalog.mjs --check`. Expected PASS.
- [ ] Commit: `git commit -m "feat(web): add end of service to the offboarding record"`.

## Final gate (orchestrator, before integration)

- [ ] `npm run check:fast`, `npm test`, `npm -w apps/web run lint`, `ruff check odoo-addons`.
- [ ] `npm run test:odoo -- --addons webvue_hr,webvue_hr_finance,webvue_finance,webvue_api,webvue_access_hr,webvue_documents_hr` (dependents included), then the bridge isolation stage `deploy/ci/odoo-bridge.sh webvue_hr_finance` and `deploy/ci/odoo-app-standalone.sh webvue_hr` locally if the runner allows.
- [ ] `python3 -B tools/git_policy.py --base main`, `python3 -B tools/arch_policy.py --base main`, `python3 -B tools/migration_guard.py --base main`, `python3 -B tools/catalog_check.py`.
- [ ] `odoo-reviewer` on the addon and contract diff; `reviewer` with `tools/jev_review.mjs` on the full diff.
- [ ] Mock-stack screenshots: run page, payslip page, my payslips, settings, offboarding settlement; RTL, light/dark, mobile.
- [ ] Record in `docs/WORKSPACE.md` the release gates of spec section 10 that stay open: GOSI seed rates confirmed on gosi.gov.sa, Mudad WPS template confirmed, EOS formulas, provision method and posting reviewed by a Saudi CPA. Local green tests are not release approval.
