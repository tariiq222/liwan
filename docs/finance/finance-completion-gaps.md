# Finance completion: gap register

Branch `codex/finance-completion`, started 2026-10-20 from `main` (`d2e11e8`). This file is the working register
for closing the Finance application's gaps. Update the status column in the same commit that changes a gap.

## Evidence rules

- **Confirmed (C)**: read in the code at the cited path; the gap exists in this checkout.
- **Partial (P)**: some of the behaviour exists; the missing part is stated.
- **To verify (V)**: not established by reading; needs a run on a scratch database.
- Nothing here is a runtime result. The session that wrote this register had **no Odoo runtime** (no Odoo core
  checkout, no `odoo-bin`, no installed OCA addons, PostgreSQL cluster down), so no Odoo test was run and no
  percentage of completion is claimed.

## Stage 0 verification of the stated gaps (code reading only)

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1a | Accounts are read-only besides the Saudi chart load | **C** | `controllers/finance_accounts.py` has only `GET /accounts`; `controllers/finance_setup.py` has `POST /setup/chart` |
| 1b | Journals, taxes, payment methods/terms, bank accounts, asset profiles have no management routes | **C** | `controllers/finance_journals.py` is `GET` only; no tax, payment-term or bank-account controller; `GET /asset-profiles` only (`finance_assets.py:47`) |
| 2a | Payment registration needs posted invoices and refuses more than the open balance | **C** | `finance_payments.py:34-46` (`not_posted`), `:85` (`amount_exceeds_residual`); `POST /payments` takes `invoice_ids` |
| 2b | No standalone receipt/payment, advance, allocation, refund of unallocated balance, internal transfer | **C** | `finance_payments.py` routes: list, register, cancel, reset-to-draft only |
| 3a | No bank-statement file import | **C** | docstring of `FinanceBankController` (`finance_bank.py:94-98`) lists OFX, CAMT, CSV as not covered; no import route |
| 3b | No undo of a reconciliation, reconcile models/rules, multi-partner match, FX differences | **C** | same docstring; only `reconcile` and `reconcile-proposals` routes exist |
| 3c | Bank statements limited to bank journals | **V** | `finance_bank.py` journal domain not yet checked against cash journals |
| 4a | Asset sale/disposal and gain/loss | **C** | `finance_assets.py` routes: profiles, list, get, create, validate, compute-depreciation |
| 4b | Asset correction, creation from a purchase bill, profile management | **C** / **V** | no route; bill linkage depends on OCA `account_asset_management` profile on the product/account (not run) |
| 5a | No cash-flow statement | **C** | no `cash` match in `odoo-addons/webvue_finance`, `apps/web/app`, `packages/contracts/src`; `data/finance_mis_reports.xml` defines profit-loss, balance-sheet, zakat only |
| 5b | VAT report is per-tax totals, not return boxes | **C** | `models/vat_report.py` groups by tax; the Saudi return is data-only in Community (docstring) |
| 5c | Opening balances, prior periods, late-dated adjustments in reports | **V** | `tests/test_finance_statements_parity.py` exists; scope not yet read |
| 6a | Zakat is an administrative base, not a return | **C** | `GET /reports/zakat-base` over a MIS report; no accountant-review state |
| 6b | Withholding report limits | **P** | `models/withholding_report.py` identifies taxes by the tags of the stock Saudi withholding return and counts posted lines; customer-withheld-from-company case not handled |
| 7 | ZATCA refuses any api mode but sandbox | **C** | `models/zatca_service.py` `_webvue_require_sandbox`; the production policy `docs/superpowers/specs/2026-10-20-zatca-production-policy.md` is a **draft**; D2-D6 are deferred by the owner, so the sandbox confinement stays in force |
| 8 | One account cannot be budgeted for two cost centers in the same period | **C** | `README.md` "Cost centers" budget section: OCA's overlap rule per account; one analytic account per line; no commitments, copy, or budget control |

Section 3 items of the brief (opening balances, payroll/expenses/purchases/inventory/projects links, currencies and
revaluation, create/approve/post/pay segregation, audit completeness, idempotency and concurrency) are all **V**.
Audit exists for chart load, fiscal writes, ZATCA (`models/audit_event.py`, `GET /audit-events`); its coverage of
payment and entry operations is not yet read.

## Gap register

Status: `open` / `blocked` / `in progress` / `done`. Priority follows the brief's order.

| ID | Area | Gap | Files expected to change | Acceptance criteria | Status |
|---|---|---|---|---|---|
| G1 | Setup | Account create/update/archive with lock-date and used-account guards | `controllers/finance_accounts.py`, `serializers/account.py`, `models/setup_service.py` or a new service, contracts, web | Create/PATCH/archive through `/api/v1/finance/accounts`; type change refused when the account has posted items; archive refused with a non-zero balance or open items; audit event per write; tests for 403, other company, locked period | **blocked** (B1) |
| G2 | Setup | Journals, taxes, payment terms, payment methods, bank accounts (`res.partner.bank` + journal link), asset profiles: manage routes | per resource controller + serializer + capability | A new company can be configured end to end from WebVue | blocked (B1) |
| G3 | Setup | New-company end-to-end configuration test from WebVue only | `tests/` | Scratch-database test: empty company to first posted invoice with no Odoo UI step | blocked (B2) |
| G4 | Payments | Standalone receipt/payment, customer/vendor advances, allocation to invoices later | `finance_payments.py`, `serializers/payment.py` | `account.payment` without invoices; allocate/unallocate through reconciliation; overpayment becomes unallocated balance | open |
| G5 | Payments | Internal transfers (bank/cash/bank), refund of unallocated balance, reverse/correct | `finance_payments.py` | transfer posts balanced pair; period-locked and permission denials tested | open |
| G6 | Bank | CSV statement import with preview, column mapping, balance check, duplicate prevention; assess OFX/CAMT addons in the pinned OCA set (`deploy/oca-addons.json`) | `finance_bank.py` or new `finance_bank_import.py`, serializers | duplicate file/line rejected; ending balance verified; nothing written before confirm | open |
| G7 | Bank | Unreconcile, statement correction, FX differences, cash journals, reconcile-model rules with review of uncertain matches | `finance_bank.py` | partial, multiple, fee and difference matches tested | open |
| G8 | Assets | Sale/disposal with gain/loss entry, correction of validated asset, bill linkage, profile management, recompute on change without touching posted lines | `finance_assets.py` | disposal entry balances; posted depreciation untouched | open |
| G9 | Reports | Cash-flow statement from an accounting source, traceable to lines | `data/finance_mis_reports.xml`, `finance_mis_reports.py`, contracts, web | Opening cash plus net movement equals closing cash for a tested month; marked non-statutory | open |
| G10 | Reports | VAT return mapped to return boxes; print/export/drill to source document | `models/vat_report.py`, web | box totals equal the posted lines by tag | open |
| G11 | Tax | Zakat inputs/exclusions configurable per company; accountant review state required before "approved" | `models/`, `finance_mis_reports.py` | cannot reach an approved state without the review capability; labelled management information until then | open |
| G12 | ZATCA | Preprod/production switch per company, per-company secrets, retry, stuck-document view, standard/simplified/notes | `models/zatca_service.py`, `finance_zatca.py` | **no production activation**; needs the owner's approval of the policy first | blocked (B3) |
| G13 | Budgets | Distribute one account's budget across cost centers (several lines of the same account in one period), without breaking OCA's overlap rule | `models/budget.py`, `finance_budgets.py` | needs a design decision: relax OCA's overlap constraint per analytic account, or one line with distribution | open (design) |
| G14 | Cross-cutting | Idempotency of payment/entry creation, audit coverage for payment/entry/reversal, segregation of create/approve/post | `models/audit_event.py`, controllers | duplicate request creates one record; audit event for each sensitive write | open |

## Blockers needing the owner

- **B1: `sudo()` for account/journal/tax writes.** Stock grants these writes to `account.group_account_manager`
  only, which WebVue never implies (`README.md` "Deliberate ORM grant"). The routes therefore need new documented
  `sudo()` cases in `webvue_finance` (R7), recorded in `tools/arch_documented_sudo.json`. AGENTS.md says that needs
  the owner's `Architecture-approved-by:` trailer; agents never add it. Decision needed: approve a new
  `models/setup_service.py` elevation (capability-checked, field-whitelisted, current company only) for accounts,
  journals, taxes, payment terms and bank accounts, or grant a narrower stock group instead.
- **B2: no runtime in this session.** Odoo 19 core, the pinned OCA checkouts and a running PostgreSQL are absent.
  Without them no Odoo test can run (and `odoo19` must never be used). Code written here would be unverified; I did not
  write payment, bank or asset code on that basis. Provide a session with the environment of `docs/testing.md`
  (`npm run test:odoo` against a scratch database), then the stages proceed with tests.
- **B3: ZATCA production.** The production policy is a draft and the owner deferred D2-D6 until before the first
  production deployment. The sandbox confinement stays; only preparation work is allowed until then.
- **B4: a qualified Saudi accountant** must review the VAT-return mapping, the Zakat inputs and the expected figures of
  the month cycle before any of them is called approved.
