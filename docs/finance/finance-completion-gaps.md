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
| 3c | Bank statements limited to bank journals | **C**, fixed | statements and imports now accept cash journals; reconciling a cash-journal line is not yet tested |
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
| G1 | Setup | Account create/update/archive with used-account guards (API done; web screens not yet) | `controllers/finance_accounts.py`, `serializers/account.py`, `models/setup_service.py` or a new service, contracts, web | Create/PATCH/archive through `/api/v1/finance/accounts`; type change refused when the account has posted items; archive refused with a non-zero balance or open items; audit event per write; tests for 403, other company, locked period | **in progress**: routes, capability, ACL, audit, contracts and 11 tests done; web UI open |
| G2 | Setup | (journals, taxes, payment terms and asset profiles API done with tests) Payment methods, bank accounts (`res.partner.bank` + journal link), asset profiles: manage routes | per resource controller + serializer + capability | A new company can be configured end to end from WebVue | in progress |
| G3 | Setup | New-company end-to-end configuration test from WebVue only | `tests/test_finance_new_company.py` | Scratch-database test: empty company to first posted invoice with no Odoo UI step | **partial**: chart, accounts, tax, term, journals, vendor, bill, payment and trial balance pass through the routes; a Saudi sales invoice is not covered because posting needs a ZATCA-onboarded journal (G12), and company identity (VAT, registry) is still written outside this flow |
| G4 | Payments (done in the API: standalone receipt/payment, advances, allocate/unallocate to invoices and payments, 13 tests; web screens open) | Standalone receipt/payment, customer/vendor advances, allocation to invoices later | `finance_payments.py`, `serializers/payment.py` | `account.payment` without invoices; allocate/unallocate through reconciliation; overpayment becomes unallocated balance | open |
| G5 | Payments | Internal transfers (bank/cash/bank) — open, Odoo 19 Community has no transfer payment, needs an accountant's decision on the transfer account; refund of unallocated balance, draft correction and re-post — done | `finance_payments.py` | transfer posts balanced pair; period-locked and permission denials tested | open |
| G6 | Bank (CSV import done: preview, column mapping, balance check, duplicate prevention, 13 tests; OFX/CAMT blocked on pinning OCA/bank-statement-import, needs the owner; web screens open) | CSV statement import with preview, column mapping, balance check, duplicate prevention; assess OFX/CAMT addons in the pinned OCA set (`deploy/oca-addons.json`) | `finance_bank.py` or new `finance_bank_import.py`, serializers | duplicate file/line rejected; ending balance verified; nothing written before confirm | open |
| G7 | Bank (unreconcile, statement correction/deletion and certain-match auto-reconcile done, 9 tests; FX differences, partial/multiple auto-matching and OCA reconcile models open) | Unreconcile, statement correction, FX differences, cash journals, reconcile-model rules with review of uncertain matches | `finance_bank.py` | partial, multiple, fee and difference matches tested | open |
| G8 | Assets (disposal with gain or loss done, 6 tests; correction of a validated asset, creation from a purchase bill and profile management still open) | Sale/disposal with gain/loss entry, correction of validated asset, bill linkage, profile management, recompute on change without touching posted lines | `finance_assets.py` | disposal entry balances; posted depreciation untouched | open |
| G9 | Reports (indirect cash-flow statement done with its closing check, 6 tests; web screen, print/export and the accountant's classification review open) | Cash-flow statement from an accounting source, traceable to lines | `data/finance_mis_reports.xml`, `finance_mis_reports.py`, contracts, web | Opening cash plus net movement equals closing cash for a tested month; marked non-statutory | open |
| G10 | Reports (VAT return boxes 1-16 with drill-down to the items done, 6 tests; accountant review, print/export and web screen open) | VAT return mapped to return boxes; print/export/drill to source document | `models/vat_report.py`, web | box totals equal the posted lines by tag | open |
| G11 | Tax (company adjustments and a separate review capability with a stated credential and a stale check done, 10 tests; the template's formula itself still needs a Saudi CPA, so it stays management information) | Zakat inputs/exclusions configurable per company; accountant review state required before "approved" | `models/`, `finance_mis_reports.py` | cannot reach an approved state without the review capability; labelled management information until then | open |
| G12 | ZATCA (stuck-document work list added, 4 tests; the move to preprod/prod is prepared in zatca-production-readiness.md, not made) | Preprod/production switch per company, per-company secrets, retry, stuck-document view, standard/simplified/notes | `models/zatca_service.py`, `finance_zatca.py` | **no production activation**; needs the owner's approval of the policy first | blocked (B3) |
| G13 | Budgets (cost-center split and distribution done with OCA's overlap switch, 6 tests; copying, KPI/group lines, commitments and over-budget control remain optional) | Distribute one account's budget across cost centers (several lines of the same account in one period), without breaking OCA's overlap rule | `models/budget.py`, `finance_budgets.py` | needs a design decision: relax OCA's overlap constraint per analytic account, or one line with distribution | open (design) |
| G14 | Cross-cutting (Idempotency-Key on the six creating routes done, 7 tests; audit events now cover accounts, journals, taxes, terms, payments, imports and disposals; create/approve/post segregation not reviewed) | Idempotency of payment/entry creation, audit coverage for payment/entry/reversal, segregation of create/approve/post | `models/audit_event.py`, controllers | duplicate request creates one record; audit event for each sensitive write | open |

## Blockers needing the owner

- **B1 (resolved for accounts, 2026-10-20): no `sudo()`.** Stock grants account writes to `account.group_account_manager`,
  which WebVue never implies. The accounts route follows the cost-center and budget precedent instead: a dedicated
  capability group (`finance.accounts.manage`) with create/write ACL rows on `account.account` in
  `security/ir.model.access.csv`, so no new R7 case and no `Architecture-approved-by:` trailer. Journals, taxes,
  payment terms and bank accounts are to follow the same pattern; if one needs real elevation (for example a journal's
  sequences), that single case still needs the owner's trailer.
- **B2 (resolved 2026-10-20): runtime.** Odoo 19 at `deploy/odoo/ODOO_COMMIT`, the pinned OCA repos and PostgreSQL 16 were
  provisioned in the session (outside the repository) and tests run on `webvue_scratch_*` databases only. Baseline of
  `webvue_finance` at `main`: 417 tests, 0 failed.
- **B3: ZATCA production.** The production policy is a draft and the owner deferred D2-D6 until before the first
  production deployment. The sandbox confinement stays; only preparation work is allowed until then.
- **B4: a qualified Saudi accountant** must review the VAT-return mapping, the Zakat inputs and the expected figures of
  the month cycle before any of them is called approved.

## Findings from the first runs (2026-10-20)

- F1 (fixed): the invoice route could not choose a journal, so a journal made through the new routes was unusable. `journal_id` is now accepted at creation.
- F2 (fixed by design): a tax created without a tax account books its amount on the expense or income account of the line (seen in a run: 1150 booked on the expense account for a 1000 + 15% bill). `tax_account_id` is therefore required.
- F3 (open): posting a Saudi sales invoice needs a ZATCA-onboarded journal, so a new company cannot invoice customers until sandbox onboarding succeeds (G12).
- F4 (fixed): a payment reset to draft and posted again is no longer linked to its invoice in Odoo (its invoice stays unpaid). The new `post` and `allocate` routes let the user finish it; `invoices` is read from reconciliations because Odoo's stored `reconciled_invoice_ids` still names the old invoice.

## Month cycle (2026-10-20)

`odoo-addons/webvue_finance/tests/test_finance_month_cycle.py` runs a fresh company through the routes only: chart, an
account for capital, partners, opening balances as one posted entry, a sale, a credit note, a bill, a customer advance
allocated to the sale, a partial bill payment, a CSV bank statement with a fee reconciled to an expense account, then the
profit and loss (revenue 9000, net profit 4975), the VAT return (box 1: 9000 / 1350, box 7: 4000 / 600, net VAT 750), the cash
flow (opening 50000, closing check 0), the trial balance, the balance sheet difference (0) and the aged receivable (27350).
The expected figures are worked out in the test's docstring for an accountant to check. Shortcuts that are not product
behavior: the ZATCA e-invoicing format is taken off the fresh company's journals (F3), and the month holds no fixed asset
depreciation (asset profiles cannot yet be made through the routes) and no foreign currency.
Not yet in the cycle: depreciation, returns of a purchase, a second company, the year-end close, a period lock.
