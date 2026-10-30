# HR and Finance applications for the Saudi market — design

Status: draft for owner approval (2026-10-18). Nothing in this document is built yet.

## Intent

LiwanOS is a unified Arabic company-operations platform. Projects, tasks and a thin HR
directory exist. This design adds two full applications: **Human Resources** and
**Finance (accounting)**, both compliant with the Saudi market, for companies of any
size, with a mid-size company (SAR 5M+ monthly sales, hundreds of employees) as the
reference load.

Principle from the owner: **reuse ready-made, open-licensed modules; build nothing from
scratch** unless no ready option exists.

## Evidence (verified 2026-10-18)

Installed and smoke-tested on a throwaway database with Odoo 19 Community:

- `l10n_sa`, `l10n_sa_edi` (ZATCA), `l10n_sa_withholding_tax`, `l10n_sa_pos` install with
  no Enterprise dependency (LGPL-3). Saudi chart of 178 accounts, 17 taxes (VAT 15%,
  reverse charge, withholding 5/15/20%), VAT Return and Withholding Return reports,
  a ZAKAT journal. A 1000 SAR invoice posts with 150 VAT correctly.
- With `l10n_sa_edi` installed, customer invoices cannot be posted until the company is
  ZATCA-onboarded (private key, OTP, journal onboarding, company city/state). Onboarding
  itself was **not** tested (needs a live ZATCA connection).
- OCA 19.0 modules install: `account_financial_report`, `account_tax_balance`,
  `partner_statement`, `account_asset_management`, `account_fiscal_year`,
  `account_lock_date_update`, `account_reconcile_oca`, `mis_builder`. They need six OCA
  repos: account-financial-reporting, account-financial-tools, account-reconcile,
  mis-builder, reporting-engine, server-ux.
- Not in Community 19 and not in OCA 19.0: `hr_payroll`, `hr_contract`, appraisals.
  OCA `payroll` (19.0, engine only) exists. No open-source Saudi payroll module exists
  (GOSI, WPS, end of service). Paid options (Pokutsoft `l10n_sa_wps_payroll`, OPL-1;
  ECOSIRE, build-to-order, depends on `hr_payroll`) are rejected: closed or unclear
  license and source delivery conflicts with the clean, owned-code rule.

## HR fit test (verified 2026-10-18, scratch DB, Odoo 19 Community + liwan_hr)

Install-only test (liwan_hr's own suite was not run with them loaded) plus a payroll smoke test.

- Accepted as internal engines (no UI of their own is exposed): OCA `payroll` (LGPL-3; computes
  a payslip from `hr.version.wage`, no contract model needed), `hr_attendance_reason`,
  `hr_holidays_natural_period`, `hr_employee_relative`.
- Rejected: OpenHRMS `hr_payroll_community` (hard-coded Indian allowance fields),
  `hr_employee_updation` and `hr_resignation` (duplicate core hr fields),
  `oh_employee_documents_expiry` and OCA `hr_employee_document` (duplicate
  `liwan.hr.document`; the latter overrides `ir.rule._compute_domain`, breaking R9).
- Blocked: OCA `hr_holidays_public` needs the python package `openupgradelib`. Saudi public
  holidays ship as data in `liwan_hr` instead.
- Risk: OCA `payroll` Officer group implies `hr.group_hr_manager`. Payroll access must be
  granted only through `liwan_hr` capabilities, never by assigning that group.
- Built directly in `liwan_hr` (not as third-party modules): warnings/disciplinary actions,
  custody/assets, advances and loans, insurance, shifts, resignation and clearance, Saudi leave
  types and public holidays (data), iqama/ID expiry, Saudization report.

## One module, one architecture (owner requirement, 2026-10-18)

HR is one application with one web area, one API namespace (`/api/v1/hr/*`), one capability
catalog (`hr.*`) and one data model per fact. Third-party modules are internal engines only:
their menus, views and groups are never exposed, and no module is installed that duplicates a
field or model already in core `hr`, `hr.version` or `liwan_hr`. The acceptance bar for any
ready-made module: installs on Community 19 with no Enterprise dependency, open license, no
duplicated fields, no core-security override.

## Goals

1. Finance application: invoicing, payments, journals, chart of accounts, VAT, ZATCA
   e-invoicing, financial reports, fixed assets, bank reconciliation, period locking,
   Zakat base report.
2. HR application: employees, departments, documents with expiry alerts, leave with Saudi
   public holidays, attendance, recruitment, contracts, Saudization (Nitaqat) report,
   then payroll with GOSI, end of service and WPS file.
3. Live links to ZATCA and banks live on **one dedicated settings page**, separate from
   the finance and HR pages (owner decision).
4. Rename the HR rail entry from «المؤسسة» to «الموارد البشرية».

## Non-goals and anti-goals

- No purchased module; no copy of a vendor's closed code in the tree.
- No live ZATCA or bank connection is built or exercised without separate owner
  approval. No payment execution.
- No automated Zakat or income-tax filing; the accountant files on the ZATCA portal.
- No timesheets, bank salary data in the customer UI beyond what payroll needs
  (see AGENTS.md delivery scope: payroll is a **separately scoped** request and this
  design is that request for the payroll phase; it needs the owner's explicit go-ahead
  before phase 4).
- Anti-goal: a parallel or duplicated accounting engine next to Odoo's `account`.

## Architecture (rules R1–R10)

- `liwan_finance` (rank 4, application): depends on `liwan_api`, `account`, `l10n_sa`.
  Owns its capabilities, groups, roles, record rules (R2), registers `finance.enabled`
  and sub-features in `liwan.feature.registry` (R10). `/api/v1/finance/*` routes use
  `json2`, `auth='user'`, shared `api_handler`, serializer whitelists, 403/404/422.
- `liwan_hr` (existing, rank 4) is extended: contracts model, expiry alerts, Saudization
  report. Stock `hr` source untouched (R9).
- Payroll is a section of `liwan_hr`, not a separate addon (owner decision 2026-10-19: one
  addon per application). OCA `payroll` is its internal engine. Access through dedicated
  `hr.payroll.*` capabilities that no other HR capability implies, plus the `hr.payroll`
  sub-feature. Saudi rules (GOSI, end of service, WPS) are deferred to the last phase.
- Bridge `liwan_hr_finance` (rank 5, `auto_install`): posts payroll and end-of-service
  accruals to accounting. HR and Finance never import each other (R3). Same rule in
  `apps/web`: finance pages do not use HR components.
- `liwan_integrations_sa` (rank 3, shared service): holds ZATCA and bank connection
  settings and credentials, exposes status to applications. The settings page
  `/settings/integrations` (new, under the existing settings area) is its only UI. Finance
  consumes it through the feature registry, not by import (R4, R8: hidden or inert in
  `non_saas` is not required — works in both).
- OCA modules are consumed from a **pinned addons path outside the source tree**
  (repo + commit list in a deploy manifest), not copied into `odoo-addons/` (clean
  codebase rule). My call; see Open questions.
- Every new addon is registered in `tools/arch_layers.json` before merge.
- No new `sudo()` outside documented cases; any needed (e.g. posting payroll entries) is
  documented and tested.

## UI (follows DESIGN.md)

- Finance: invoices, payments, journals, chart of accounts, reports as pages; creation via
  `SharedCreatePanel` `/new` routes; destructive actions confirmed inline; Storybook
  components only; Arabic default, RTL-first, all strings in the owning locale namespace.
- HR: existing `/hr` pages plus contracts, leave, attendance, recruitment, then payroll.
- Settings: `/settings/integrations` with ZATCA onboarding steps (key, OTP, journal,
  company address) and bank links, each with visible status; no secrets echoed back.

## Phases

0. **Groundwork**: rename rail label key `nav.organization` (manifest, project breadcrumb,
   tests, locale); register addons in `arch_layers.json`; deploy manifest for OCA repos.
1. **Finance core**: `liwan_finance`, API, pages (invoices, payments, journals, chart),
   VAT; install OCA reports.
2. **Finance extended**: financial statements, assets, reconciliation, period lock,
   monthly VAT return, Zakat base via `mis_builder` (formula reviewed by a Saudi CPA).
3. **HR core** (all inside `liwan_hr`, one API/UI): contract fields on `hr.version`, expiry
   alerts and Saudization report (already built in worktree `hr-contracts`, uncommitted, pending
   review of the `hr.group_hr_manager` implication), leave with Saudi types and public holidays
   as data, attendance (`hr_attendance_reason`), relatives, recruitment (core `hr_recruitment`).
3b. **HR extended** (built in `liwan_hr`): warnings, custody, advances/loans, insurance,
   shifts, resignation and clearance, onboarding checklist, appraisals.
4. **Payroll** (last phase): OCA `payroll` as the engine behind the payroll section of `liwan_hr`
   (GOSI, end of service, WPS deferred), payroll access only via `hr.payroll.*` capabilities,
   bridge to finance.
5. **Integrations page**: `liwan_integrations_sa` and `/settings/integrations`; live
   ZATCA/bank work only with separate approval.

Phase 5's page shell (status display, no live calls) may ship with phase 1 so ZATCA
onboarding state is visible while onboarding is still manual.

## Verification

Per phase: focused Odoo tests against a scratch database (never `odoo19`), every `test_*.py`
imported by its `tests/__init__.py`; web `npm test` and `npm -w apps/web run lint`; arch
and git policy checks; `odoo-reviewer` before merge. The VAT 150-on-1000 smoke case and
ZATCA-blocks-posting behaviour are encoded as tests.

## Open questions (owner)

1. Approve the payroll scope (AGENTS.md says payroll is a stage constraint needing a
   separate request) — decided at the start of phase 4.
2. Confirm OCA repos live in a pinned external addons path rather than inside the repo.
3. Who is the Saudi CPA reviewing Zakat and end-of-service formulas?
4. Which banks matter first for the integrations page.

## Left to the builder

File-level layout, model field names, serializer shapes, test fixtures, and the exact
OCA commit pins, within the rules above.
