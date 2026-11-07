# Finance

Pages: `/finance`, `/finance/sales/invoices`, `/finance/sales/credit-notes`, `/finance/purchases/bills`,
`/finance/purchases/refunds`, `/finance/payments`, `/finance/partners`, `/finance/accounting/entries`,
`/finance/accounting/accounts`, `/finance/bank/statements`, `/finance/budgets`, `/finance/assets`,
`/finance/reports/[report]` (13 reports), settings `/settings/apps/finance` and its sub-pages
(`accounts`, `journals`, `taxes`, `payment-terms`, `asset-profiles`, `audit`). Owners: `liwan_finance`
(136 routes, 39 capabilities), `liwan_integrations_sa` (1 route, 2 capabilities).
Personas and status values: [README](README.md).

Role matrix (from `odoo-addons/liwan_finance/models/access_service.py`):

- `cfo` (finance_manager): all 39 finance capabilities.
- `accountant` (finance_accountant): read and manage invoices, payments, partners, entries and bank;
  read accounts, journals, reports, statements, ZATCA, budgets, assets, analytic, taxes, payment terms; submit to
  ZATCA. No `finance.invoices.post`, `finance.entries.post`, setup, closing, zakat, audit, ZATCA manage or any
  other `*.manage` of setup records.
- `auditor` (finance_auditor): read-only on everything it reads, plus `finance.audit.read`,
  `finance.closing.read`, `finance.setup.read`, `finance.zakat.read`; it also holds `finance.reports.read` and
  `finance.statements.read`.
- `it_admin` (system_admin) holds no finance capability; `staff1` (employee) holds none.
- `vendor` support role holds all finance capabilities (vendor_support).
- A manage capability needs its read capability (`FINANCE_PERMISSION_DEPENDENCIES`): a custom role that grants
  `finance.invoices.post` must also carry `finance.invoices.manage`, and so on.

Conventions for every row below: a refusal means the UI hides or disables the action and a direct API call is
answered with the stated HTTP status and error `code`. A record of another company or a hidden record is 404.
Every finance route is gated by the `finance.enabled` feature (403 `feature_not_included`; write routes also
403 `tenant_read_only` / `tenant_suspended`). Lists are paged 25 per page and use `{items, total}`.

## Core scenarios (original register)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-06 | Credit note and debit note | cfo | Linked to the original invoice | `page /finance/sales/credit-notes/new` `POST /api/v1/finance/invoices/<id>/debit-note` | planned | Debit note is linked (`debit_origin`); there is no route that creates a credit note from an invoice: see the credit note section |
| FIN-07 | Vendor bill and refund, draft to posted | accountant → cfo | Posted by cfo only | `page /finance/purchases/bills/new` `page /finance/purchases/refunds/new` | planned | r3 not run: bill and refund create forms are blocked by #169 (number input crash); post/refund paths are covered by the FIN-1xx rows |
| FIN-08 | Customer payment: create, post, allocate, unallocate, cancel, reset | accountant | Invoice residual follows the allocation | `POST /api/v1/finance/payments` `POST /api/v1/finance/payments/<id>/allocate` `POST /api/v1/finance/payments/<id>/unallocate` `POST /api/v1/finance/payments/<id>/cancel` `POST /api/v1/finance/payments/<id>/reset-to-draft` | planned | r3 partial: UI payment form from refund 25 (type received, amount typed 10, number input does not crash) -> residual 30 to 20; allocate, unallocate, cancel, reset not re-run in r3 |
| FIN-14 | Every report opens and exports: TB, GL, P&L, BS, cash flow, aged, partner statement, VAT, VAT return, withholding, zakat base, analytic, budget vs actual | auditor | Figures consistent with posted data | `page /finance/reports/[id]` | gap | #150; r3 UI: all 13 report pages open for cfo/auditor (TB, GL, P&L, BS, cash flow, aged, partner statement, VAT, VAT return, withholding, zakat base, analytic, budget vs actual) with consistent tiles; no export or print on any report; /finance/reports has no index (404); No report has an export or PDF in the product: see the report section |
| FIN-16 | Fiscal-year close | cfo | Period locked; later posting in it refused | `POST /api/v1/finance/fiscal-years/<id>/close` `cap finance.closing.manage` | fail | #170; closing works (FIN-427, FIN-429) but posting in the closed period is not refused for invoices and bank lines (FIN-432, FIN-235) |
| FIN-18 | ZATCA sandbox: onboard a sales journal with OTP | cfo | Connection `connected` in `/settings/system` | `POST /api/v1/finance/zatca/journals/<id>/onboard` `cap finance.zatca.manage` | planned | r3 not run: company is not Saudi and needs a real OTP (exclusive/ZATCA stays planned) |
| FIN-19 | ZATCA submit and retry | accountant | Accepted; draft invoice `zatca_not_applicable`; journal not onboarded `zatca_not_onboarded`; already accepted `invalid_state` | `POST /api/v1/finance/invoices/<id>/zatca/submit` `POST /api/v1/finance/invoices/<id>/zatca/retry` `cap finance.zatca.submit` | planned | r3 not run: needs a Saudi company with an onboarded journal; see FIN-447..458 |
| FIN-21 | Employee opens finance | staff1 | 403 page | `page /finance` | automated | `e2e/tests/access-matrix.e2e.ts`; Same evidence as ACC-02 |

## Access, navigation and tenant state

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Overview (`/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-36 | Overview with data: tiles receivable, payable, draft invoices, partners; attention card lists up to five drafts | cfo | Tiles are server totals in company currency; draft rows link to their record | `page /finance` `GET /api/v1/finance/reports/aged-partner-balance` | fail | #201; r2 UI cfo overview: tiles receivable 1,159.00 USD, payable shown as -30,198.33 USD (the payable total includes payroll account 252000 Tax Payable with a negative sign while vendor bills show positive), draft tile 12, partners 18, attention card lists five drafts linking to their records; see findings2; Title "نظرة عامة على المالية" |
| FIN-38 | Overview when setup is complete | cfo | Setup card shows the ready text instead of a checklist | `page /finance` | planned | r3 not run: a complete setup needs a Saudi company (VAT number, registry, address and ZATCA onboarding); the shared root company must not be edited |

## Partners (customers and vendors)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Sales invoices (`/finance/sales/invoices`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-92 | Post a Saudi sale invoice on a journal that sends ZATCA but is not onboarded | cfo | 422 `zatca_not_onboarded`, Odoo's other configuration errors in `details.detail`; button disabled | `POST /api/v1/finance/invoices/<id>/post` | planned | blocked reason `zatca_not_onboarded` |

## Credit notes (`/finance/sales/credit-notes`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-110 | Create a credit note from a posted invoice so it is linked to it | cfo | A draft credit note with `reversed_entry` pointing to the invoice and copied lines | `POST /api/v1/finance/invoices` | gap | #148; No route reverses an invoice and the serializer has no origin field; FIN-06 expects the link (only debit notes are linked) |
| FIN-111 | ZATCA state of a posted Saudi credit note | cfo | Submit / retry offered as for an invoice | `GET /api/v1/finance/invoices/<id>/zatca` | planned | `out_refund` is in the ZATCA sale move types |

## Vendor bills (`/finance/purchases/bills`) and vendor refunds (`/finance/purchases/refunds`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-117 | Bill takes its due date from a payment term | accountant | Due date follows the term | `GET /api/v1/finance/payment-terms` | gap | #149; The invoice body has no payment-term key (see the payment terms section) |

## Debit notes and invoice PDF

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-127 | Debit note dated in a locked period | accountant | 422 `period_locked` | `POST /api/v1/finance/invoices/<id>/debit-note` | fail | #170; debit note with date 2025-03-01 in the lock -> 201 draft, no period_locked |
| FIN-129 | Download the PDF of a posted invoice | cfo | `application/pdf`, file name from the stock report, Arabic kept | `GET /api/v1/finance/invoices/<id>/pdf` | planned | r2 not run: PDF engine absent (503 pdf_unavailable); PDF engine missing on the scratch stack (503 pdf_unavailable); download not verifiable here |
| FIN-131 | PDF for a caller without `finance.payments.read` | custom role (finance.invoices.read) | PDF renders without the payments section | `GET /api/v1/finance/invoices/<id>/pdf` | planned | r2 not run: PDF engine absent; Report `account_invoices_without_payment` |

## Payments (`/finance/payments`)

There is no payment record page: every payment action runs from the list row menu or the create panel.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-144 | Journal currency differs from the invoices currency | accountant | 422 `journal_currency_mismatch` on `journal_id` | `POST /api/v1/finance/payments` | planned | r2 not run: only USD is active, a EUR journal cannot be created (422 on currency) |

## Journal entries and chart of accounts (`/finance/accounting`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-196 | Reset an entry with reconciled lines | cfo | 422 `has_reconciliations` with `details.line_ids`; button disabled with reason | `POST /api/v1/finance/entries/<id>/reset-to-draft` | planned | |
| FIN-197 | Unreconcile an entry's reconciled lines | cfo | Lines reopen | `POST /api/v1/finance/entries/<id>/unreconcile` | planned | Audit `entry_unreconciled` |

## Bank statements and reconciliation (`/finance/bank`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-219 | Preview or import with missing `journal_id` or `content`, or unreadable file | accountant | 422 `invalid` | `POST /api/v1/finance/bank-statements/import/preview` | fail | #172; missing journal/content -> 422 ok, but binary garbage content -> 200 preview with one junk column, row_count 0 (should be 422 unreadable) |
| FIN-239 | Auto-match with `apply: true` | accountant | Certain lines reconciled; a line Odoo refuses lands in `review` with reason `failed` and message; audit `bank_statement_auto_reconciled` | `POST /api/v1/finance/bank-statements/<id>/auto-reconcile` | planned | r3 not run: creating a statement already auto-reconciles payment-number lines, no certain item is left and the failed reason cannot be provoked; #166; r2 partly: creating a statement already auto-reconciles lines whose payment_ref equals a payment number (no audit event), so apply:true found nothing certain; `failed` reason not reproduced |

## Fixed assets (`/finance/assets`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-257 | Compute depreciation when Odoo reports errors | cfo | 422 `invalid` with the error log | `POST /api/v1/finance/assets/compute-depreciation` | planned | r3 not run: no way to make Odoo return depreciation errors on this data |

## Budgets (`/finance/budgets`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Reports (`/finance/reports/[report]`)

Capability per report (from `reportConfig.ts` and the route): `finance.statements.read` for trial balance, general
ledger, aged balance, partner statement, profit and loss, balance sheet, cash flow; `finance.reports.read` for VAT,
VAT return, withholding; `finance.analytic.read` for the cost center report; `finance.budgets.read` for budget vs
actual; `finance.zakat.read` for the zakat base. Filters live in the URL; without dates the period is the current
month up to today; a report that ends on a day (`period: end`) sends only `date_to`.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-327 | Export or print any report (CSV, XLSX, PDF) | auditor | A downloadable copy of the figures on screen | `GET /api/v1/finance/reports/trial-balance` | gap | #150; No report route or page action exports; FIN-14 says "exports" |

## Zakat

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Setup, chart of accounts and fiscal settings (`/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-342 | Blockers in order: VAT 15 tax missing, company VAT missing, registry missing, address incomplete, ZATCA not onboarded | cfo | Checklist lists each stable code in that order; `ready` only when none remain | `GET /api/v1/finance/setup` | planned | r3 partial: root company blockers company_vat_missing, company_registry_missing, company_address_incomplete, zatca_not_onboarded come in that order and the UI checklist matches; branch adds vat_15_tax_missing first; chart_not_loaded cannot be reproduced |
| FIN-344 | Load the Saudi chart (inline confirm "تحميل دليل الحسابات السعودي؟") | cfo | Accounts, taxes, journals created; Saudi tax rounding set to global; audit `chart_loaded` | — | dropped | dropped 2026-10-29: the Saudi chart is loaded when the tenant is installed and its load route (POST setup/chart) is gone, #265; r3 not run: chart already loaded on the shared root company (chart_already_loaded); #200; #200 |
| FIN-345 | Load the chart twice | cfo | 422 `chart_already_loaded` | — | dropped | dropped 2026-10-29: the Saudi chart is loaded when the tenant is installed and its load route (POST setup/chart) is gone, #265; API as persona: load chart again (already loaded) -> 422 chart_already_loaded {"code":"chart_already_loaded","message":"the chart of accounts is already loaded"} |
| FIN-346 | Load the chart into a company with branches | cfo | 422 `company_has_branches` | — | dropped | dropped 2026-10-29: the Saudi chart is loaded when the tenant is installed and its load route (POST setup/chart) is gone, #265; r2 not run: POST setup/chart answers 422 chart_already_loaded before any branch check (root has branches) |
| FIN-347 | Load the chart into a company that already has entries | cfo | 422 `invalid` "already has journal entries" | — | dropped | dropped 2026-10-29: the Saudi chart is loaded when the tenant is installed and its load route (POST setup/chart) is gone, #265; r2 not run: chart_already_loaded masks it |
| FIN-357 | Tax rounding is forced to global rounding for a Saudi company | cfo | Whatever is sent, a Saudi company ends with round globally | `PATCH /api/v1/finance/setup/fiscal` | planned | r3 not run: needs a Saudi company |

## Settings records: accounts, journals, taxes, payment terms, asset profiles

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Cost centers (analytic plans and accounts, section on `/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-417 | Move a cost center with analytic items to another root plan | cfo | 422 `analytic_account_in_use` | `PATCH /api/v1/finance/analytic-accounts/<id>` | planned | r3 not run: no analytic item can be posted on a cost center without altering shared data; r2 not run: no analytic items on a cost center of this area |

## Fiscal-year closing (section `closing` on `/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-425 | Archived or foreign-currency account holds a balance | cfo | Blocker `account_not_closable` with `account_ids` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | r3 not run: needs a year that can close (2025 is closed, 2026 not ended) |
| FIN-426 | Company with no retained-earnings account or no miscellaneous journal | cfo | Blockers `no_retained_earnings_account` / `no_general_journal` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | r3 not run: would need removing the retained-earnings account or journal of the shared company |
| FIN-428 | Close a year with no income or expense lines | cfo | No entry; lock date still set; state `locked` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | r3 not run: no closable year without lines (2025 closed, 2026+ not ended) |
| FIN-430 | Closing entry dated inside an existing lock | cfo | 422 `period_locked`; UI "الفترة مقفلة بتاريخ قفل..." | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | r3 not run: no closable year inside the existing lock |
| FIN-432 | After closing, post or edit a document dated inside the year | accountant | 422 `period_locked` on invoice, entry, payment, bank reconciliation | `POST /api/v1/finance/entries/<id>/post` | fail | #170; r2 API accountant: after closing 2025, entry dated 2025-12-01 -> 422 period_locked on date; payment -> 422 period_locked on payment_date; but invoice dated 2025-12-01 is created 201 and posted 200 (named INV/2026/00013, date silently moved) - same defect as FIN-79 |

## ZATCA e-invoicing (section `zatca` on `/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-439 | Onboard a sales journal with a 6-digit OTP (inline confirm "ربط يومية {journal} بزاتكا؟") | cfo | Journal onboarded; `/settings/system` connection `connected` when all sales journals are done, `pending` otherwise; audit `zatca_onboarded` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | See FIN-18 |
| FIN-441 | Onboard when the company API mode is not sandbox | cfo | 422 `zatca_mode_not_allowed` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | #197; Production is out of scope until the policy exists |
| FIN-442 | ZATCA refuses the OTP or the CSR | cfo | 422 `zatca_rejected`; the earlier working onboarding stays intact | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | |
| FIN-443 | ZATCA unreachable or answers an uninterpreted error | cfo | 502 `zatca_unavailable` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | |
| FIN-447 | Submit a posted Saudi invoice now | accountant | State accepted; audit `zatca_submitted` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | See FIN-19 |
| FIN-448 | Submit a draft, cancelled, purchase or non-Saudi document | accountant | 422 `zatca_not_applicable` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | fail | #203; r2 API accountant: submit a draft -> 422 zatca_not_applicable and a posted non-Saudi invoice -> 422 zatca_not_applicable, but a vendor bill -> 404 not_found (while GET /zatca on the same bill answers 200 not_applicable) |
| FIN-449 | Submit on a journal not onboarded | accountant | 422 `zatca_not_onboarded` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | r2 not run: needs a Saudi company (ZATCA applicable) and onboarding; Button disabled with the reason |
| FIN-450 | Submit when the company mode is not sandbox | accountant | 422 `zatca_mode_not_allowed` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-451 | Submit an invoice already accepted | accountant | 422 `invalid_state` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-452 | Submit an invoice ZATCA already rejected | accountant | 422 `invalid_state` "correct it and retry" | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-453 | ZATCA rejects the invoice on submit | accountant | 422 `zatca_rejected` with `details.submission` carrying ZATCA's codes and messages; the state is saved | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-454 | ZATCA gives no verdict (timeout) | accountant | 502 `zatca_unavailable`; state `retry`; retry is safe | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-455 | Local processing error before ZATCA | accountant | 422 `zatca_local_error` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-456 | ZATCA refuses the journal certificate | accountant | 422 `zatca_unauthorized`; onboard again | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-457 | Retry after correcting a rejected invoice | accountant | Error cleared, sent again, accepted | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-458 | Document already being sent by another process | accountant | 422 `invalid_state` "try again shortly" | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |

## Audit log (`/settings/apps/finance/audit`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-465 | Audit empty | auditor | "لا توجد أحداث في السجل بعد." | `page /settings/apps/finance/audit` | manual 2026-11-06 | r4 UI auditor on a fresh scratch DB (audit-events total 0): /settings/apps/finance/audit shows the «لا أحداث» tag, the action/date filters and «لا توجد أحداث في السجل بعد.» with no rows; r3 not run: a truly empty log is unreachable (events exist); a filtered empty list shows «لا نتائج.» |
| FIN-466 | Each action writes one event: invoice posted, entry posted, payment posted, chart loaded, year closed, ZATCA onboarded and submitted | cfo | One row per action with record and company | `GET /api/v1/finance/audit-events` | planned | r3 partial: API list holds invoice_posted, entry_posted, payment_posted, fiscal_year_closed, zatca none; item has no company field; #166 |
| FIN-468 | Audit coverage of payment cancel / reset, asset create / validate / compute, budget changes, analytic and partner changes | cfo | Each logs an event, or the owner decides they do not | `GET /api/v1/finance/audit-events` | decision | #166; No audit action exists for them (audit_event.py selection) |

## Capability matrix

One allow row and one refusal row per capability, following `access_service.py`. `GET` of a list is the usual probe
for a read capability, a write route the probe for a manage capability.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Integrations connections (`liwan_integrations_sa`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-486 | A role with `integrations.manage` must also hold `integrations.read` | custom role (integrations.manage) | Dependency added or role refused | `cap integrations.manage` | planned | r2 not run: role save needs an Arabic name in a shape not found; skipped; The only route needs read; no route needs manage yet |
| FIN-487 | Another company's connections never listed | it_admin | Only the current company's rows | `GET /api/v1/integrations/connections` | planned | r3 not run: needs a connection owned by another company |

## Idempotency, concurrency and cross-cutting rules

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
