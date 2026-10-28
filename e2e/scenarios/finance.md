# Finance

Pages: `/finance`, `/finance/sales/invoices`, `/finance/sales/credit-notes`, `/finance/purchases/bills`,
`/finance/purchases/refunds`, `/finance/payments`, `/finance/partners`, `/finance/accounting/entries`,
`/finance/accounting/accounts`, `/finance/bank/statements`, `/finance/budgets`, `/finance/assets`,
`/finance/reports/[report]` (13 reports), settings `/settings/apps/finance` and its sub-pages
(`accounts`, `journals`, `taxes`, `payment-terms`, `asset-profiles`, `audit`). Owners: `webvue_finance`
(136 routes, 39 capabilities), `webvue_integrations_sa` (1 route, 2 capabilities).
Personas and status values: [README](README.md).

Role matrix (from `odoo-addons/webvue_finance/models/access_service.py`):

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
| FIN-01 | Initial setup: chart of accounts, fiscal settings, journals, taxes, payment terms | cfo | Saved; accountant and auditor cannot change setup | `page /settings/apps/finance` `POST /api/v1/finance/setup/chart` `PATCH /api/v1/finance/setup/fiscal` `cap finance.setup.manage` | planned | |
| FIN-02 | Create, edit and delete a customer and a vendor | accountant | Saved / removed | `page /finance/partners/new` `POST /api/v1/finance/partners` `PATCH /api/v1/finance/partners/<id>` `POST /api/v1/finance/partners/<id>/archive` | planned | The product has archive, not delete: see the partner section |
| FIN-03 | Sales invoice draft, edit, delete | accountant | Draft lifecycle works | `page /finance/sales/invoices/new` `POST /api/v1/finance/invoices` `PATCH /api/v1/finance/invoices/<id>` `DELETE /api/v1/finance/invoices/<id>` | planned | |
| FIN-04 | Post, cancel and reset an invoice | cfo | States change; PDF downloads | `POST /api/v1/finance/invoices/<id>/post` `POST /api/v1/finance/invoices/<id>/cancel` `POST /api/v1/finance/invoices/<id>/reset-to-draft` `GET /api/v1/finance/invoices/<id>/pdf` | planned | |
| FIN-05 | Accountant posts an invoice | accountant | Refused (no `finance.invoices.post`) | `cap finance.invoices.post` | planned | |
| FIN-06 | Credit note and debit note | cfo | Linked to the original invoice | `page /finance/sales/credit-notes/new` `POST /api/v1/finance/invoices/<id>/debit-note` | planned | Debit note is linked (`debit_origin`); there is no route that creates a credit note from an invoice: see the credit note section |
| FIN-07 | Vendor bill and refund, draft to posted | accountant → cfo | Posted by cfo only | `page /finance/purchases/bills/new` `page /finance/purchases/refunds/new` | planned | |
| FIN-08 | Customer payment: create, post, allocate, unallocate, cancel, reset | accountant | Invoice residual follows the allocation | `POST /api/v1/finance/payments` `POST /api/v1/finance/payments/<id>/allocate` `POST /api/v1/finance/payments/<id>/unallocate` `POST /api/v1/finance/payments/<id>/cancel` `POST /api/v1/finance/payments/<id>/reset-to-draft` | planned | |
| FIN-09 | Manual journal entry: create, post, reset, unreconcile | cfo | Posted entry in the general ledger | `page /finance/accounting/entries/new` `POST /api/v1/finance/entries` `POST /api/v1/finance/entries/<id>/post` `POST /api/v1/finance/entries/<id>/reset-to-draft` `POST /api/v1/finance/entries/<id>/unreconcile` | planned | |
| FIN-10 | Accountant posts an entry | accountant | Refused | `cap finance.entries.post` | planned | |
| FIN-11 | Bank statement import and line reconciliation | accountant | Lines matched to payments | `page /finance/bank/statements/new` `POST /api/v1/finance/bank-statements/import` `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-12 | Asset: create, validate, compute depreciation, dispose | cfo | Depreciation lines and disposal entry | `page /finance/assets/new` `POST /api/v1/finance/assets/<id>/validate` `POST /api/v1/finance/assets/compute-depreciation` `POST /api/v1/finance/assets/<id>/dispose` | planned | |
| FIN-13 | Budget: draft, confirm, cancel, reset; edit lines only in draft | cfo | Each transition; line edit refused when confirmed | `page /finance/budgets/new` `POST /api/v1/finance/budgets/<id>/confirm` `POST /api/v1/finance/budgets/<id>/cancel` `POST /api/v1/finance/budgets/<id>/reset-to-draft` | planned | |
| FIN-14 | Every report opens and exports: TB, GL, P&L, BS, cash flow, aged, partner statement, VAT, VAT return, withholding, zakat base, analytic, budget vs actual | auditor | Figures consistent with posted data | `page /finance/reports/[id]` | planned | No report has an export or PDF in the product: see the report section |
| FIN-15 | Auditor tries any write | auditor | No write actions; direct calls refused | `cap finance.invoices.manage` `cap finance.payments.manage` | planned | |
| FIN-16 | Fiscal-year close | cfo | Period locked; later posting in it refused | `POST /api/v1/finance/fiscal-years/<id>/close` `cap finance.closing.manage` | planned | |
| FIN-17 | Zakat adjustment and review | cfo | Saved; accountant refused | `POST /api/v1/finance/zakat/adjustments` `POST /api/v1/finance/zakat/reviews` `cap finance.zakat.review` | planned | |
| FIN-18 | ZATCA sandbox: onboard a sales journal with OTP | cfo | Connection `connected` in `/settings/system` | `POST /api/v1/finance/zatca/journals/<id>/onboard` `cap finance.zatca.manage` | planned | |
| FIN-19 | ZATCA submit and retry | accountant | Accepted; draft invoice `zatca_not_applicable`; journal not onboarded `zatca_not_onboarded`; already accepted `invalid_state` | `POST /api/v1/finance/invoices/<id>/zatca/submit` `POST /api/v1/finance/invoices/<id>/zatca/retry` `cap finance.zatca.submit` | planned | |
| FIN-20 | Finance switched off | vendor | Finance pages, menus and project actuals disappear | `page /finance` | planned | See PLT-10 |
| FIN-21 | Employee opens finance | staff1 | 403 page | `page /finance` | automated | `e2e/tests/access-matrix.e2e.ts`; Same evidence as ACC-02 |

## Access, navigation and tenant state

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-22 | Finance rail icon and sidebar: ten top links (Overview, Sales, Purchases, Payments, Customers and vendors, Accounting, Bank, Budgets, Assets, Reports) | cfo | All ten links show; each opens its page | `page /finance` `cap finance.invoices.read` | planned | |
| FIN-23 | Sidebar for the accountant | accountant | Same ten links (it reads every area); "New invoice" and "New payment" create links show; no settings finance parts that need setup, closing, zakat or audit | `page /finance` `cap finance.entries.read` | planned | |
| FIN-24 | Sidebar for the auditor | auditor | Ten links show; no "+" create link in any section; settings parts offered: setup, accounts, journals, taxes, payment terms, asset profiles, analytic, closing, ZATCA, audit | `page /settings/apps/finance` `cap finance.closing.read` | planned | |
| FIN-25 | Landing path of a role with only a part of finance (custom role with `finance.payments.read` only) | custom role (finance.payments.read) | Opening Finance lands on `/finance/payments`, not on a 403 | `page /finance/payments` `cap finance.payments.read` | planned | Order in manifest landing list: overview, payments, partners, entries, bank, budgets, assets, trial balance |
| FIN-26 | Direct link to a finance page without its capability (accountant opens `/finance/budgets/new`) | accountant | Forbidden state; no form rendered | `page /finance/budgets/new` `cap finance.budgets.manage` | planned | |
| FIN-27 | Employee calls a finance list route directly | staff1 | 403 `forbidden` | `GET /api/v1/finance/invoices` `cap finance.invoices.read` | planned | Extends FIN-21 to the API |
| FIN-28 | Finance feature switched off for the tenant: every finance read | vendor | 403 `feature_not_included` on each route; rail icon and menu gone | `GET /api/v1/finance/payments` `GET /api/v1/finance/setup` | planned | See FIN-20, PLT-10 |
| FIN-29 | Tenant read-only (expired): a finance write | cfo | 403 `tenant_read_only`; reads still work; record pages show action buttons disabled with the reason | `POST /api/v1/finance/entries` | planned | blocked reason `tenant_read_only` |
| FIN-30 | Tenant suspended: any finance call | cfo | 403 `tenant_suspended` | `GET /api/v1/finance/invoices` | planned | |
| FIN-31 | Customer-hosted non-SaaS install | cfo | Finance works with no vendor connection | `page /finance` | planned | Rule R8 |
| FIN-32 | A record of another company (second company of the tenant) opened by id | cfo | 404 `not_found` on invoices, payments, entries, assets, budgets, statements, partners; a company-less partner is not offered | `GET /api/v1/finance/invoices/<id>` `GET /api/v1/finance/payments` `GET /api/v1/finance/entries/<id>` | planned | |
| FIN-33 | Body references a record of another company (partner, journal, account, tax) | cfo | 422 `invalid` with `field` naming the key (for example `lines[0].account_id`), not 404 | `POST /api/v1/finance/invoices` | planned | `company_records` in write_support.py |
| FIN-34 | Country and state lookups feed partner and company forms | accountant | Both `finance.partners.read` and `finance.setup.read` may read them; a role with neither gets 403 | `GET /api/v1/finance/countries` `GET /api/v1/finance/countries/<id>/states` | planned | |
| FIN-35 | Country lookup refused without partner or setup read | custom role (finance.payments.read) | 403 `forbidden` | `GET /api/v1/finance/countries` | planned | |

## Overview (`/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-36 | Overview with data: tiles receivable, payable, draft invoices, partners; attention card lists up to five drafts | cfo | Tiles are server totals in company currency; draft rows link to their record | `page /finance` `GET /api/v1/finance/reports/aged-partner-balance` | planned | Title "نظرة عامة على المالية" |
| FIN-37 | Overview on a fresh company | cfo | Setup card shows progress "done of total" with the checklist of blockers; attention card shows its empty text | `page /finance` `GET /api/v1/finance/setup` | planned | |
| FIN-38 | Overview when setup is complete | cfo | Setup card shows the ready text instead of a checklist | `page /finance` | planned | |
| FIN-39 | Overview for the auditor | auditor | Setup card shown (setup.read), no create link; tiles shown | `page /finance` `cap finance.setup.read` | planned | |
| FIN-40 | Overview tile hidden when its capability is missing (custom role with invoices.read only) | custom role (finance.invoices.read) | Receivable, payable and partner tiles are left out, not shown as a dash; setup card hidden | `page /finance` `cap finance.statements.read` | planned | |
| FIN-41 | KPI toggle hides the strip | cfo | Hidden tiles issue no request | `page /finance` | planned | |

## Partners (customers and vendors)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-42 | Partner list with data, search `q`, filter kind customer / vendor, archived tab, pagination | accountant | Matches name search; `kind` and `archived` in the URL; refresh and back keep them | `page /finance/partners` `GET /api/v1/finance/partners` | planned | Title "العملاء والموردون" |
| FIN-43 | Partner list empty states | accountant | "لا عملاء أو موردين بعد"; archived tab "لا أطراف مؤرشفة" | `page /finance/partners` | planned | |
| FIN-44 | Invalid `kind` or `archived` value on the list API | accountant | 422 `invalid` with `field` kind / archived | `GET /api/v1/finance/partners` | planned | |
| FIN-45 | System partners never listed: users, company partners, employee work contacts | accountant | None of them appear in the list or in pickers | `GET /api/v1/finance/partners` | planned | `company_partners_domain` |
| FIN-46 | Create customer | accountant | Saved with `customer_rank` 1; country defaults to the company country | `page /finance/partners/new` `POST /api/v1/finance/partners` | planned | |
| FIN-47 | Create vendor and a partner that is both | accountant | Both flags kept; existing rank is never lowered by an edit that keeps the flag | `POST /api/v1/finance/partners` | planned | |
| FIN-48 | Create partner without a name | accountant | 422 `invalid`, `field` name, "name is required" | `POST /api/v1/finance/partners` | planned | |
| FIN-49 | Create partner with an unknown field | accountant | 422 `invalid` "unknown field" | `POST /api/v1/finance/partners` | planned | |
| FIN-50 | State that does not belong to the partner country | accountant | 422 `invalid` on `state_id` | `POST /api/v1/finance/partners` | planned | |
| FIN-51 | Unknown country id or state id | accountant | 422 `invalid` "does not reference an existing record" | `PATCH /api/v1/finance/partners/<id>` | planned | |
| FIN-52 | Saudi VAT number checked against the country | accountant | An invalid VAT is refused by the country check; a valid one is saved | `POST /api/v1/finance/partners` | planned | |
| FIN-53 | Partner record page shows details and its documents | accountant | Properties, flags and the edit link | `page /finance/partners/[id]` `GET /api/v1/finance/partners/<id>` | planned | |
| FIN-54 | Partner edit | accountant | Saved; back returns to the record | `page /finance/partners/[id]/edit` `PATCH /api/v1/finance/partners/<id>` | planned | |
| FIN-55 | Partner edit with an empty body | accountant | 422 `invalid` "no fields to update" | `PATCH /api/v1/finance/partners/<id>` | planned | |
| FIN-56 | Archive a partner (inline confirmation "هل تريد أرشفة {name}؟") | accountant | Moves to the archived tab; open documents stay | `POST /api/v1/finance/partners/<id>/archive` | planned | There is no delete route; FIN-02 asks for delete |
| FIN-57 | Restore an archived partner | accountant | Back in the active list | `POST /api/v1/finance/partners/<id>/unarchive` | planned | |
| FIN-58 | Auditor opens partners | auditor | List and record open; no create, edit or archive action; `/finance/partners/new` and `/edit` forbidden | `cap finance.partners.read` `page /finance/partners/new` | planned | |
| FIN-59 | Auditor writes a partner through the API | auditor | 403 `forbidden` | `cap finance.partners.manage` | planned | |
| FIN-60 | Partner id of another company or a system partner | accountant | 404 `not_found` | `GET /api/v1/finance/partners/<id>` | planned | |

## Sales invoices (`/finance/sales/invoices`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-61 | Invoice list with data: columns number, date, due date, total, residual, state, payment state | accountant | 25 per page; residual shown only for posted invoices; row opens the record; title "فواتير المبيعات" | `page /finance/sales/invoices` `GET /api/v1/finance/invoices` | planned | Order is the server default; no column sort control |
| FIN-62 | Invoice list empty | accountant | "لا توجد فواتير مبيعات بعد." | `page /finance/sales/invoices` | planned | |
| FIN-63 | Filters: search `q` (number, reference, partner name), state, customer, date from, date to | accountant | Each narrows the list and the KPI tiles; the counter on the filter button counts active filters | `GET /api/v1/finance/invoices` | planned | |
| FIN-64 | Filters with no result | accountant | "no results" text, not the empty-state text | `page /finance/sales/invoices` | planned | |
| FIN-65 | URL keeps filters: direct link with `?state=posted&partner_id=..&page=2`, refresh, record and back | accountant | Same filters and page after each step; invalid values in the URL are dropped | `page /finance/sales/invoices` | planned | |
| FIN-66 | `date_to` before `date_from` in the URL | accountant | UI drops `date_to`; API answers 422 `invalid` "date_to must be on or after date_from" | `GET /api/v1/finance/invoices` | planned | |
| FIN-67 | API filter values outside the allowed set (`state=foo`, `move_type=foo`, bad date, `partner_id=0`) | accountant | 422 `invalid` with the field | `GET /api/v1/finance/invoices` | planned | |
| FIN-68 | KPI strip: total, draft, posted, cancelled counts follow the list filters | accountant | Server totals; hidden when the KPI toggle is off | `page /finance/sales/invoices` | planned | |
| FIN-69 | Customer-only partner picker in the list filter | accountant | Offers customers, not vendors | `GET /api/v1/finance/partners` | planned | |
| FIN-70 | Auditor opens the invoice list | auditor | List opens; no "New invoice" link | `cap finance.invoices.read` | planned | |
| FIN-71 | Create invoice panel | accountant | Route-backed create panel over the list; on save opens the new draft record and keeps `returnTo` | `page /finance/sales/invoices/new` `POST /api/v1/finance/invoices` | planned | Status 201 |
| FIN-72 | Create with several lines: quantity, unit price, discount, sale taxes, analytic distribution | accountant | Totals computed by Odoo; taxes of purchase type refused for a customer invoice (422 `invalid` on `lines[i].tax_ids`) | `POST /api/v1/finance/invoices` | planned | |
| FIN-73 | Create without lines, without partner or without `move_type` | accountant | 422 `invalid` "lines must be a non-empty list" / "partner_id is required" | `POST /api/v1/finance/invoices` | planned | |
| FIN-74 | Line without name or price, negative quantity or discount above 100 | accountant | 422 `invalid` naming `lines[i].<field>` | `POST /api/v1/finance/invoices` | planned | |
| FIN-75 | `move_type` outside invoice, credit note, bill, vendor refund (for example a receipt) | accountant | 422 `invalid` "move_type must be one of ..." | `POST /api/v1/finance/invoices` | planned | Receipts are readable (list, record, PDF) but never written |
| FIN-76 | Journal not of the sale type or of another company | accountant | 422 `invalid` on `journal_id` | `POST /api/v1/finance/invoices` | planned | |
| FIN-77 | Foreign currency invoice with no exchange rate | accountant | 422 `missing_exchange_rate` on `currency`; UI text explains | `POST /api/v1/finance/invoices` | planned | A zero-amount invoice in a foreign currency is allowed |
| FIN-78 | Unknown currency code | accountant | 422 `invalid` "currency is not an active currency code" | `POST /api/v1/finance/invoices` | planned | |
| FIN-79 | Invoice date inside a locked period | accountant | 422 `period_locked`; UI text "الفترة المحاسبية مقفلة لهذا التاريخ." | `POST /api/v1/finance/invoices` | planned | |
| FIN-80 | Analytic distribution adds up to more than 100 percent in one plan | accountant | 422 `invalid` on `lines[i].analytic_distribution` | `POST /api/v1/finance/invoices` | planned | |
| FIN-81 | Retry the create with the same `Idempotency-Key` | accountant | The first answer comes back; one invoice only | `POST /api/v1/finance/invoices` | planned | See the idempotency section |
| FIN-82 | Draft invoice record: lines panel, aside, actions Post, Edit, Delete | cfo | Buttons enabled from `allowed_actions`; header shows draft state | `page /finance/sales/invoices/[id]` `GET /api/v1/finance/invoices/<id>` | planned | |
| FIN-83 | Edit a draft inline | accountant | Lines replace the old lines; audit event `invoice_changed` | `PATCH /api/v1/finance/invoices/<id>` | planned | |
| FIN-84 | Edit with an empty body | accountant | 422 `invalid` "no fields to update" | `PATCH /api/v1/finance/invoices/<id>` | planned | |
| FIN-85 | Edit a posted or cancelled invoice | accountant | 422 `not_draft`; UI text "المستند ليس مسودة، فلا يمكن تنفيذ هذا الإجراء." | `PATCH /api/v1/finance/invoices/<id>` | planned | |
| FIN-86 | Edit lines that carry an analytic key over several plans created in Odoo | accountant | 422 `invalid` "analytic distribution over several plans" | `PATCH /api/v1/finance/invoices/<id>` | planned | |
| FIN-87 | Delete a draft (inline confirm "حذف المسودة «{name}»؟") | accountant | 204; back to the list | `DELETE /api/v1/finance/invoices/<id>` | planned | |
| FIN-88 | Delete a posted invoice | accountant | 422 `not_draft` | `DELETE /api/v1/finance/invoices/<id>` | planned | |
| FIN-89 | Post a draft | cfo | State posted, number assigned, audit `invoice_posted` | `POST /api/v1/finance/invoices/<id>/post` | planned | |
| FIN-90 | Post an invoice that is not a draft | cfo | 422 `not_draft` | `POST /api/v1/finance/invoices/<id>/post` | planned | |
| FIN-91 | Post with the date in a locked period | cfo | 422 `period_locked`; the Post button shows disabled with the reason | `POST /api/v1/finance/invoices/<id>/post` | planned | blocked reason `period_locked` |
| FIN-92 | Post a Saudi sale invoice on a journal that sends ZATCA but is not onboarded | cfo | 422 `zatca_not_onboarded`, Odoo's other configuration errors in `details.detail`; button disabled | `POST /api/v1/finance/invoices/<id>/post` | planned | blocked reason `zatca_not_onboarded` |
| FIN-93 | Post an invoice that fails Odoo validation (for example missing account on a line) | cfo | 422 `invalid` with Odoo's text | `POST /api/v1/finance/invoices/<id>/post` | planned | |
| FIN-94 | Cancel a posted invoice (inline confirm "إلغاء «{name}»؟") | cfo | State cancel; can be reset to draft later | `POST /api/v1/finance/invoices/<id>/cancel` | planned | |
| FIN-95 | Cancel an already cancelled invoice | cfo | 422 `invalid_state` "already cancelled" | `POST /api/v1/finance/invoices/<id>/cancel` | planned | |
| FIN-96 | Cancel or reset an invoice that has live payments | cfo | 422 `has_payments` with `details.payment_ids`; banner "عليه دفعات مسجّلة"; buttons disabled | `POST /api/v1/finance/invoices/<id>/reset-to-draft` | planned | blocked reason `has_payments`; payments in canceled or rejected state do not count |
| FIN-97 | Reset a posted or cancelled invoice to draft (inline confirm) | cfo | State draft, lines editable again | `POST /api/v1/finance/invoices/<id>/reset-to-draft` | planned | |
| FIN-98 | Reset a draft to draft | cfo | 422 `invalid_state` "already a draft" | `POST /api/v1/finance/invoices/<id>/reset-to-draft` | planned | |
| FIN-99 | Cancel or reset in a locked period | cfo | 422 `period_locked` | `POST /api/v1/finance/invoices/<id>/cancel` | planned | |
| FIN-100 | Accountant sees Post / Cancel / Reset buttons | accountant | Not offered (no `finance.invoices.post`); Edit and Delete offered on drafts | `cap finance.invoices.post` | planned | |
| FIN-101 | Accountant calls post, cancel, reset by API | accountant | 403 `forbidden` on all three | `POST /api/v1/finance/invoices/<id>/post` | planned | |
| FIN-102 | Auditor opens a record | auditor | No action buttons except PDF on a posted invoice | `cap finance.invoices.read` | planned | |
| FIN-103 | Receipt (`out_receipt`) opened by id | cfo | Record opens read-only with PDF only; write routes answer 404 | `GET /api/v1/finance/invoices/<id>` | planned | |
| FIN-104 | Record shows the "Register payment" action only when residual is above zero and not paid | cfo | Opens `/finance/payments/new?invoice_ids=..&returnTo=..` with the invoice preselected | `page /finance/payments/new` | planned | |
| FIN-105 | Back from a record keeps the list filters through `returnTo` | accountant | Safe return path only inside the list path; foreign paths fall back to the list | `page /finance/sales/invoices/[id]` | planned | |
| FIN-106 | Tenant cannot write | cfo | Post, Edit, Delete show disabled with `tenant_read_only` | `page /finance/sales/invoices/[id]` | planned | |

## Credit notes (`/finance/sales/credit-notes`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-107 | Credit note list with filters like invoices | accountant | Title "إشعارات دائنة"; empty "لا توجد إشعارات دائنة بعد." | `page /finance/sales/credit-notes` | planned | |
| FIN-108 | Create a draft credit note for a customer | accountant | Saved as `out_refund` draft; customer picker | `page /finance/sales/credit-notes/new` | planned | |
| FIN-109 | Credit note record: post, cancel, reset, delete like an invoice | cfo | Same state machine and refusals | `page /finance/sales/credit-notes/[id]` | planned | |
| FIN-110 | Create a credit note from a posted invoice so it is linked to it | cfo | A draft credit note with `reversed_entry` pointing to the invoice and copied lines | `POST /api/v1/finance/invoices` | gap | No route reverses an invoice and the serializer has no origin field; FIN-06 expects the link (only debit notes are linked) |
| FIN-111 | ZATCA state of a posted Saudi credit note | cfo | Submit / retry offered as for an invoice | `GET /api/v1/finance/invoices/<id>/zatca` | planned | `out_refund` is in the ZATCA sale move types |

## Vendor bills (`/finance/purchases/bills`) and vendor refunds (`/finance/purchases/refunds`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-112 | Bill list with filters, KPI tiles, empty "لا توجد فواتير موردين بعد." | accountant | Vendor picker offers vendors only; title "فواتير الموردين" | `page /finance/purchases/bills` | planned | |
| FIN-113 | Create a bill with purchase taxes and an expense account on each line | accountant | Draft `in_invoice`; a sale tax on a bill is refused with 422 `invalid` on `lines[i].tax_ids` | `page /finance/purchases/bills/new` | planned | |
| FIN-114 | Bill: vendor reference `ref` and due date | accountant | Saved on the draft; search by `ref` finds it | `PATCH /api/v1/finance/invoices/<id>` | planned | |
| FIN-115 | Bill record: post (cfo), cancel, reset, delete | cfo | Same rules as invoices; accountant cannot post | `page /finance/purchases/bills/[id]` | planned | |
| FIN-116 | Bill: the Post button never raises ZATCA errors | cfo | A purchase document is not a sale document, so `zatca_not_onboarded` never applies | `POST /api/v1/finance/invoices/<id>/post` | planned | |
| FIN-117 | Bill takes its due date from a payment term | accountant | Due date follows the term | `GET /api/v1/finance/payment-terms` | gap | The invoice body has no payment-term key (see the payment terms section) |
| FIN-118 | Vendor refund list, create, record | accountant | Title "مرتجعات الموردين"; empty "لا توجد مرتجعات موردين بعد." | `page /finance/purchases/refunds` `page /finance/purchases/refunds/new` `page /finance/purchases/refunds/[id]` | planned | |
| FIN-119 | Vendor refund received money: register payment direction is inbound | cfo | Payment form defaults to receipt | `page /finance/purchases/refunds/[id]` | planned | `in_refund` direction inbound |
| FIN-120 | Debit note on a bill | cfo | Draft debit note linked to the bill | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |

## Debit notes and invoice PDF

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-121 | Debit note on a posted invoice (inline confirm "إنشاء إشعار مدين على «{name}»؟", optional reason, copy lines switch) | accountant | 201, opens the new draft with `debit_origin` link; the record shows a link back to the origin | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | Needs only `finance.invoices.manage`; audit `invoice_debit_note_created` |
| FIN-122 | Debit note without copying lines | accountant | Draft with no lines | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |
| FIN-123 | Debit note on a draft invoice | accountant | 422 `not_posted` | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |
| FIN-124 | Debit note on a credit note or vendor refund | accountant | 422 `invalid_state` "only a customer invoice or a vendor bill can be debited" | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |
| FIN-125 | Debit note on a debit note | accountant | 422 `invalid_state` "cannot be debited again" | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |
| FIN-126 | Debit note with an unknown field, bad date, non-boolean `copy_lines` | accountant | 422 `invalid` | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |
| FIN-127 | Debit note dated in a locked period | accountant | 422 `period_locked` | `POST /api/v1/finance/invoices/<id>/debit-note` | planned | |
| FIN-128 | Auditor tries a debit note | auditor | 403 `forbidden` | `cap finance.invoices.manage` | planned | |
| FIN-129 | Download the PDF of a posted invoice | cfo | `application/pdf`, file name from the stock report, Arabic kept | `GET /api/v1/finance/invoices/<id>/pdf` | planned | |
| FIN-130 | PDF of a draft or cancelled invoice | cfo | 422 `not_posted` | `GET /api/v1/finance/invoices/<id>/pdf` | planned | |
| FIN-131 | PDF for a caller without `finance.payments.read` | custom role (finance.invoices.read) | PDF renders without the payments section | `GET /api/v1/finance/invoices/<id>/pdf` | planned | Report `account_invoices_without_payment` |
| FIN-132 | PDF engine missing or broken | cfo | 503 `pdf_unavailable`; UI "تعذّر إنشاء ملف PDF الآن. حاول لاحقًا." | `GET /api/v1/finance/invoices/<id>/pdf` | planned | |
| FIN-133 | PDF of an invoice of another company | cfo | 404 as JSON error | `GET /api/v1/finance/invoices/<id>/pdf` | planned | |

## Payments (`/finance/payments`)

There is no payment record page: every payment action runs from the list row menu or the create panel.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-134 | Payment list: number, partner, type, journal, date, amount, state; filters type, state, partner, date range, search `q` (number, memo, partner) | accountant | 25 per page; filters in the URL survive refresh and back | `page /finance/payments` `GET /api/v1/finance/payments` | planned | Title "المدفوعات"; empty "لا توجد دفعات بعد." |
| FIN-135 | List filters with invalid `payment_type` or `state` | accountant | 422 `invalid` on the field | `GET /api/v1/finance/payments` | planned | |
| FIN-136 | Auditor opens payments | auditor | List shows; no "new" links and no row menu actions | `cap finance.payments.read` | planned | |
| FIN-137 | Register a payment for one posted invoice from the invoice record | accountant | Panel `/finance/payments/new?invoice_ids=<id>`; amount defaults to the residual; saving returns to the invoice, residual drops, payment state changes | `page /finance/payments/new` `POST /api/v1/finance/payments` | planned | Status 201 |
| FIN-138 | Partial payment | accountant | Invoice stays posted with a partial payment state and a smaller residual | `POST /api/v1/finance/payments` | planned | |
| FIN-139 | Pay several invoices of one partner together | accountant | One payment covers all; residuals fall | `POST /api/v1/finance/payments` | planned | |
| FIN-140 | Pay invoices of different partners or currencies | accountant | 422 `invalid` "must share one partner and one currency" on `invoice_ids` | `POST /api/v1/finance/payments` | planned | |
| FIN-141 | Pay an invoice together with a credit note | accountant | 422 `invalid` "must all have the same document type" | `POST /api/v1/finance/payments` | planned | |
| FIN-142 | Pay a draft or cancelled invoice | accountant | 422 `not_posted` on `invoice_ids` | `POST /api/v1/finance/payments` | planned | |
| FIN-143 | Amount above the open balance | accountant | 422 `amount_exceeds_residual` on `amount`; UI "المبلغ أكبر من الرصيد المتبقي." | `POST /api/v1/finance/payments` | planned | |
| FIN-144 | Journal currency differs from the invoices currency | accountant | 422 `journal_currency_mismatch` on `journal_id` | `POST /api/v1/finance/payments` | planned | |
| FIN-145 | Payment date in a locked period | accountant | 422 `period_locked` on `payment_date` (Odoo would silently move the date) | `POST /api/v1/finance/payments` | planned | |
| FIN-146 | Journal not bank or cash, or of another company; method line of another journal | accountant | 422 `invalid` on `journal_id` / `payment_method_line_id` | `POST /api/v1/finance/payments` | planned | |
| FIN-147 | Register with no `invoice_ids`, empty list, repeated id, missing amount or date | accountant | 422 `invalid` "invoice_ids must not be empty" and similar | `POST /api/v1/finance/payments` | planned | |
| FIN-148 | Same `Idempotency-Key` retried | accountant | One payment; second call returns the stored answer | `POST /api/v1/finance/payments` | planned | |
| FIN-149 | Standalone receipt (advance, "سند قبض أو سلفة") | accountant | Payment posted at creation, partner type customer for inbound, supplier for outbound; opens from the list link | `POST /api/v1/finance/payments/standalone` | planned | Panel `?kind=standalone`; status 201 |
| FIN-150 | Standalone payment voucher to a vendor | accountant | Outbound, supplier | `POST /api/v1/finance/payments/standalone` | planned | |
| FIN-151 | Standalone refund of a customer advance (outbound to a customer) with explicit `partner_type` | accountant | Kept as sent | `POST /api/v1/finance/payments/standalone` | planned | |
| FIN-152 | Standalone with missing partner, journal, amount, date or `payment_type` | accountant | 422 `invalid` "<field> is required" | `POST /api/v1/finance/payments/standalone` | planned | |
| FIN-153 | Standalone in a locked period | accountant | 422 `period_locked` | `POST /api/v1/finance/payments/standalone` | planned | |
| FIN-154 | Edit a draft payment (row menu "edit", panel "تعديل الدفعة المسودة «{name}»") | accountant | Amount, date, memo, journal, method saved | `PATCH /api/v1/finance/payments/<id>` | planned | Audit `payment_changed` |
| FIN-155 | Edit a payment that is not a draft | accountant | 422 `not_draft` | `PATCH /api/v1/finance/payments/<id>` | planned | |
| FIN-156 | Edit with an empty body or a date in a locked period | accountant | 422 `invalid` "no fields to update" / `period_locked` | `PATCH /api/v1/finance/payments/<id>` | planned | |
| FIN-157 | Post a draft payment | accountant | State in process or paid | `POST /api/v1/finance/payments/<id>/post` | planned | |
| FIN-158 | Post a payment that is not a draft | accountant | 422 `not_draft` | `POST /api/v1/finance/payments/<id>/post` | planned | |
| FIN-159 | Post a draft payment dated in a locked period | accountant | 422 `period_locked` on `date`; menu entry disabled | `POST /api/v1/finance/payments/<id>/post` | planned | |
| FIN-160 | Cancel a posted payment (inline confirm "إلغاء الدفعة «{name}»؟") | accountant | State canceled; the invoice residual returns | `POST /api/v1/finance/payments/<id>/cancel` | planned | |
| FIN-161 | Cancel an already cancelled or rejected payment | accountant | 422 `invalid_state` "the payment is already canceled" | `POST /api/v1/finance/payments/<id>/cancel` | planned | |
| FIN-162 | Cancel a payment in a locked period | accountant | 422 `period_locked`; menu entry disabled | `POST /api/v1/finance/payments/<id>/cancel` | planned | |
| FIN-163 | Reset a cancelled or rejected payment to draft | accountant | State draft; offered instead of cancel | `POST /api/v1/finance/payments/<id>/reset-to-draft` | planned | |
| FIN-164 | Reset a payment that is not cancelled or rejected | accountant | 422 `invalid_state` | `POST /api/v1/finance/payments/<id>/reset-to-draft` | planned | |
| FIN-165 | Allocate an advance to posted invoices | accountant | Residual of the invoice falls by the allocated amount | `POST /api/v1/finance/payments/<id>/allocate` | planned | Row menu "allocate", title "تخصيص {amount} {currency} من {name}" |
| FIN-166 | Allocate a payment to other payments (refund of an advance) | accountant | Both settle each other | `POST /api/v1/finance/payments/<id>/allocate` | planned | |
| FIN-167 | Allocate with both `invoice_ids` and `payment_ids`, or neither | accountant | 422 `invalid` "give either invoice_ids or payment_ids" | `POST /api/v1/finance/payments/<id>/allocate` | planned | |
| FIN-168 | Allocate a payment to itself | accountant | 422 `invalid` on `payment_ids` | `POST /api/v1/finance/payments/<id>/allocate` | planned | |
| FIN-169 | Allocate an unposted payment | accountant | 422 `invalid_state` "only a posted payment can be allocated" | `POST /api/v1/finance/payments/<id>/allocate` | planned | |
| FIN-170 | Allocate a fully allocated payment | accountant | 422 `nothing_to_allocate` | `POST /api/v1/finance/payments/<id>/allocate` | planned | Menu entry hidden when no balance remains |
| FIN-171 | Allocate to another partner's invoice or another currency | accountant | 422 `invalid` "must belong to the same partner" / "share one currency" | `POST /api/v1/finance/payments/<id>/allocate` | planned | |
| FIN-172 | Allocate to a document with nothing open on the payment account | accountant | 422 `invalid` "nothing open on the payment account" | `POST /api/v1/finance/payments/<id>/allocate` | planned | |
| FIN-173 | Unallocate (inline confirm "إلغاء تخصيص «{name}»؟") | accountant | Invoices reopen | `POST /api/v1/finance/payments/<id>/unallocate` | planned | |
| FIN-174 | Unallocate a payment that is not posted or not allocated | accountant | 422 `invalid_state` | `POST /api/v1/finance/payments/<id>/unallocate` | planned | |
| FIN-175 | Auditor calls any payment write | auditor | 403 `forbidden` | `cap finance.payments.manage` | planned | |
| FIN-176 | A custom role with `finance.payments.manage` but no `finance.invoices.read` | custom role (finance.payments.manage) | Cannot be assigned: manage needs `payments.read` and `invoices.read` | `cap finance.payments.read` | planned | Dependency matrix |
| FIN-177 | Payment of another company by id | cfo | 404 `not_found` on cancel, post, allocate | `POST /api/v1/finance/payments/<id>/post` | planned | |
| FIN-178 | Payment create panel without `finance.payments.manage` | auditor | Forbidden state "لا تملك صلاحية عرض هذه الصفحة." | `page /finance/payments/new` | planned | |

## Journal entries and chart of accounts (`/finance/accounting`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-179 | Entry list: filters state, journal, date range, search; pagination | accountant | Manual entries only; entries made by payments, bank lines, cash-basis tax and exchange differences never listed | `page /finance/accounting/entries` `GET /api/v1/finance/entries` | planned | |
| FIN-180 | Entry list invalid `state` or `journal_id` | accountant | 422 `invalid` | `GET /api/v1/finance/entries` | planned | |
| FIN-181 | A system-generated entry opened by id | cfo | 404 `not_found` | `GET /api/v1/finance/entries/<id>` | planned | |
| FIN-182 | Create entry with two balanced lines | accountant | Draft entry in a miscellaneous journal; status 201 | `page /finance/accounting/entries/new` `POST /api/v1/finance/entries` | planned | |
| FIN-183 | Lines that do not balance | accountant | 422 `unbalanced` with `details.debit` and `details.credit` | `POST /api/v1/finance/entries` | planned | |
| FIN-184 | A line with both debit and credit, or neither | accountant | 422 `invalid` "needs exactly one of debit or credit above zero" | `POST /api/v1/finance/entries` | planned | |
| FIN-185 | Missing journal, date or lines; non-general journal; account of another company | accountant | 422 `invalid` naming the field | `POST /api/v1/finance/entries` | planned | |
| FIN-186 | Entry record: lines panel with account, partner, name, debit, credit, analytic | cfo | Totals visible; actions by state | `page /finance/accounting/entries/[id]` `GET /api/v1/finance/entries/<id>` | planned | |
| FIN-187 | Edit a draft entry | accountant | Lines replaced; balanced check again | `PATCH /api/v1/finance/entries/<id>` | planned | |
| FIN-188 | Edit a posted entry | accountant | 422 `not_draft` | `PATCH /api/v1/finance/entries/<id>` | planned | |
| FIN-189 | Delete a draft entry | accountant | 204 | `DELETE /api/v1/finance/entries/<id>` | planned | |
| FIN-190 | Delete a posted entry | accountant | 422 `not_draft` | `DELETE /api/v1/finance/entries/<id>` | planned | |
| FIN-191 | Post a draft entry | cfo | State posted, appears in the general ledger | `POST /api/v1/finance/entries/<id>/post` | planned | |
| FIN-192 | Post an entry dated in a locked period | cfo | 422 `period_locked` on `date`; button disabled | `POST /api/v1/finance/entries/<id>/post` | planned | |
| FIN-193 | Post an entry that is not a draft | cfo | 422 `not_draft` | `POST /api/v1/finance/entries/<id>/post` | planned | |
| FIN-194 | Reset a posted entry to draft | cfo | State draft | `POST /api/v1/finance/entries/<id>/reset-to-draft` | planned | |
| FIN-195 | Reset an entry that is already a draft | cfo | 422 `invalid_state` | `POST /api/v1/finance/entries/<id>/reset-to-draft` | planned | |
| FIN-196 | Reset an entry with reconciled lines | cfo | 422 `has_reconciliations` with `details.line_ids`; button disabled with reason | `POST /api/v1/finance/entries/<id>/reset-to-draft` | planned | |
| FIN-197 | Unreconcile an entry's reconciled lines | cfo | Lines reopen | `POST /api/v1/finance/entries/<id>/unreconcile` | planned | Audit `entry_unreconciled` |
| FIN-198 | Unreconcile an entry with no reconciled lines | cfo | 422 `invalid_state` | `POST /api/v1/finance/entries/<id>/unreconcile` | planned | |
| FIN-199 | Unreconcile when the entry or a counterpart lies in a locked period | cfo | 422 `period_locked`; button disabled | `POST /api/v1/finance/entries/<id>/unreconcile` | planned | |
| FIN-200 | Accountant posts, resets or unreconciles an entry | accountant | Buttons hidden; API 403 `forbidden` | `cap finance.entries.post` | planned | See FIN-10 |
| FIN-201 | Auditor opens an entry | auditor | Read only; no create link | `cap finance.entries.read` | planned | |
| FIN-202 | Direct link `/finance/accounting/entries/new` as auditor | auditor | Forbidden state | `cap finance.entries.manage` | planned | |
| FIN-203 | Chart of accounts page: list, search, type filter, archived tab, pagination | accountant | Read only for the accountant; title in the nav "الحسابات" | `page /finance/accounting/accounts` `GET /api/v1/finance/accounts` | planned | |
| FIN-204 | Account detail by id | accountant | Serializer whitelist; archived accounts readable | `GET /api/v1/finance/accounts/<id>` | planned | |
| FIN-205 | Account list with invalid `account_type` or `archived` | accountant | 422 `invalid` | `GET /api/v1/finance/accounts` | planned | |

## Bank statements and reconciliation (`/finance/bank`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-206 | Statement list: filters journal and date range, KPI strip, pagination | accountant | Matches statements of the company only | `page /finance/bank/statements` `GET /api/v1/finance/bank-statements` | planned | |
| FIN-207 | Statement list empty | accountant | Empty state with link to create or import | `page /finance/bank/statements` | planned | |
| FIN-208 | Create a statement by hand with lines | accountant | Journal, date, opening and closing balance, lines (date, reference, partner, amount); status 201 | `page /finance/bank/statements/new` `POST /api/v1/finance/bank-statements` | planned | |
| FIN-209 | Create with no lines, missing journal or date, a zero amount line | accountant | 422 `invalid` "lines must be a non-empty list" / "amount must not be zero" | `POST /api/v1/finance/bank-statements` | planned | |
| FIN-210 | Create with more lines than the maximum | accountant | 422 `invalid` "lines must have at most N items" | `POST /api/v1/finance/bank-statements` | planned | |
| FIN-211 | Statement journal not of bank or cash type, or of another company | accountant | 422 `invalid` on `journal_id` | `POST /api/v1/finance/bank-statements` | planned | |
| FIN-212 | Statement record: lines, balances, reconciled count | accountant | Aside and actions by capability | `page /finance/bank/statements/[id]` `GET /api/v1/finance/bank-statements/<id>` | planned | |
| FIN-213 | Correct name and balances of a statement | accountant | Saved; audit `bank_statement_changed`; empty body is 422 "no fields to update" | `PATCH /api/v1/finance/bank-statements/<id>` | planned | |
| FIN-214 | Delete a statement with no reconciled line | accountant | 204; audit `bank_statement_deleted` | `DELETE /api/v1/finance/bank-statements/<id>` | planned | |
| FIN-215 | Delete a statement with reconciled lines | accountant | 422 `has_reconciliations` with `details.line_ids` | `DELETE /api/v1/finance/bank-statements/<id>` | planned | |
| FIN-216 | Import preview step 1: CSV content only | accountant | Delimiter, columns (or numbered columns without header), sample rows, `suggested_mapping`, `row_count`; nothing written | `POST /api/v1/finance/bank-statements/import/preview` | planned | Panel `BankImportForm` |
| FIN-217 | Import preview step 2: with a column mapping | accountant | Every line (duplicates flagged), row errors, summary (lines, duplicates, total, date range) | `POST /api/v1/finance/bank-statements/import/preview` | planned | |
| FIN-218 | Preview with different delimiters, date formats, decimal comma, header on or off | accountant | Parsed correctly | `POST /api/v1/finance/bank-statements/import/preview` | planned | |
| FIN-219 | Preview or import with missing `journal_id` or `content`, or unreadable file | accountant | 422 `invalid` | `POST /api/v1/finance/bank-statements/import/preview` | planned | |
| FIN-220 | Import a statement from CSV | accountant | One statement created whole; audit `bank_statement_imported`; status 201 | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-221 | Import with unreadable rows | accountant | 422 `invalid_rows` with `details.errors`; nothing created | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-222 | Import lines the journal already holds | accountant | 422 `duplicate_lines` with `details.rows` unless `skip_duplicates: true`, which keeps only new lines | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-223 | Import where every line is a duplicate and duplicates are skipped | accountant | 422 `invalid` "no new lines to import" on `content` | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-224 | Opening balance plus lines differs from the closing balance | accountant | 422 `balance_mismatch` with `details.expected` and `details.given` | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-225 | Import with non-boolean `skip_duplicates` or missing balances | accountant | 422 `invalid` | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-226 | Same import retried with one `Idempotency-Key` | accountant | One statement | `POST /api/v1/finance/bank-statements/import` | planned | |
| FIN-227 | Reconcile page for a line: proposals sorted exact amount first, then newest; the partner narrows them | accountant | Opens from a statement line | `page /finance/bank/statements/[id]/lines/[id]` `GET /api/v1/finance/bank-statement-lines/<id>/reconcile-proposals` | planned | |
| FIN-228 | Reconcile a line with items that clear it exactly | accountant | Line reconciled; payment or invoice settled | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-229 | Reconcile with leftover booked on an account (bank fee) and a label | accountant | Leftover on `account_id`; line reconciled | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-230 | Reconcile where the items do not clear and no account is given | accountant | 422 `not_balanced` on `move_line_ids` | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-231 | Leftover account that is receivable, payable or liquidity | accountant | 422 `invalid` on `account_id` | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-232 | Reconcile with neither `move_line_ids` nor `account_id`, or `label` without `account_id` | accountant | 422 `invalid` | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-233 | Reconcile an already reconciled line | accountant | 422 `invalid_state` "already reconciled" | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-234 | Items of another direction, unposted or already reconciled | accountant | 422 `invalid` on `move_line_ids` | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-235 | Reconcile in a locked period | accountant | 422 `period_locked` | `POST /api/v1/finance/bank-statement-lines/<id>/reconcile` | planned | |
| FIN-236 | Unreconcile a line (journal reconcile mode edit or keep) | accountant | Line open again; audit `bank_line_unreconciled` | `POST /api/v1/finance/bank-statement-lines/<id>/unreconcile` | planned | |
| FIN-237 | Unreconcile a line that is not reconciled | accountant | 422 `invalid_state` | `POST /api/v1/finance/bank-statement-lines/<id>/unreconcile` | planned | |
| FIN-238 | Auto-match preview (`apply` false) | accountant | `applied` false; `matched` lists lines with exactly one certain item; `review` lists `ambiguous` and `no_match` | `POST /api/v1/finance/bank-statements/<id>/auto-reconcile` | planned | |
| FIN-239 | Auto-match with `apply: true` | accountant | Certain lines reconciled; a line Odoo refuses lands in `review` with reason `failed` and message; audit `bank_statement_auto_reconciled` | `POST /api/v1/finance/bank-statements/<id>/auto-reconcile` | planned | |
| FIN-240 | Auto-match with a non-boolean `apply` or unknown field | accountant | 422 `invalid` | `POST /api/v1/finance/bank-statements/<id>/auto-reconcile` | planned | |
| FIN-241 | Auditor opens statements and a line | auditor | Statement pages read only; reconcile page `/lines/[id]` forbidden; import and create panels forbidden | `cap finance.bank.read` `cap finance.bank.manage` | planned | Route needs `finance.bank.manage` for lines |
| FIN-242 | Auditor reads reconcile proposals by API | auditor | 200 (read capability only) | `GET /api/v1/finance/bank-statement-lines/<id>/reconcile-proposals` | planned | The page itself is forbidden; check this asymmetry is intended |

## Fixed assets (`/finance/assets`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-243 | Asset list: filters state (draft, open, close, removed), search, pagination, KPI strip | cfo | Board of assets plus the depreciation compute section | `page /finance/assets` `GET /api/v1/finance/assets` | planned | |
| FIN-244 | Asset list invalid `state` | cfo | 422 `invalid` | `GET /api/v1/finance/assets` | planned | |
| FIN-245 | Create asset from a profile | cfo | Draft asset; status 201 | `page /finance/assets/new` `POST /api/v1/finance/assets` | planned | |
| FIN-246 | Create with missing profile, name, purchase value or start date; salvage above purchase value; code longer than the limit | cfo | 422 `invalid` naming the field | `POST /api/v1/finance/assets` | planned | |
| FIN-247 | Archived profile or profile of another company | cfo | 422 `invalid` on `profile_id` | `POST /api/v1/finance/assets` | planned | |
| FIN-248 | Asset record: figures, depreciation lines, actions by state | cfo | Draft offers validate, edit, delete; open or close offers dispose; removed offers none | `page /finance/assets/[id]` `GET /api/v1/finance/assets/<id>` | planned | |
| FIN-249 | Edit a draft asset | cfo | Saved; start date in a locked period is refused with `period_locked` on `date_start` | `PATCH /api/v1/finance/assets/<id>` | planned | |
| FIN-250 | Edit a non-draft asset | cfo | 422 `not_draft` | `PATCH /api/v1/finance/assets/<id>` | planned | |
| FIN-251 | Delete a draft asset | cfo | 204; audit `asset_deleted` | `DELETE /api/v1/finance/assets/<id>` | planned | |
| FIN-252 | Delete a validated asset | cfo | 422 `not_draft` | `DELETE /api/v1/finance/assets/<id>` | planned | |
| FIN-253 | Validate a draft asset | cfo | State open, depreciation board computed | `POST /api/v1/finance/assets/<id>/validate` | planned | |
| FIN-254 | Validate an asset that is not a draft | cfo | 422 `not_draft` "it is open" | `POST /api/v1/finance/assets/<id>/validate` | planned | |
| FIN-255 | Compute depreciation up to a date | cfo | Depreciation moves posted for running assets; result lists moves | `POST /api/v1/finance/assets/compute-depreciation` | planned | |
| FIN-256 | Compute depreciation with a future date or missing date | cfo | 422 `invalid` "date must not be in the future" / "date is required" | `POST /api/v1/finance/assets/compute-depreciation` | planned | |
| FIN-257 | Compute depreciation when Odoo reports errors | cfo | 422 `invalid` with the error log | `POST /api/v1/finance/assets/compute-depreciation` | planned | |
| FIN-258 | Dispose of a running asset by sale with sale value and accounts | cfo | Removal entry posted; state removed; audit `asset_disposed` | `POST /api/v1/finance/assets/<id>/dispose` | planned | Profile accounts fill gain and loss |
| FIN-259 | Dispose with a sale value but no sale account | cfo | 422 `invalid` "sale_account_id is required when the asset is sold" | `POST /api/v1/finance/assets/<id>/dispose` | planned | |
| FIN-260 | Dispose when the profile names no gain or loss account and none is sent | cfo | 422 `invalid` "<field> is required: the profile names no account for it" | `POST /api/v1/finance/assets/<id>/dispose` | planned | |
| FIN-261 | Dispose of a draft or removed asset | cfo | 422 `invalid_state` | `POST /api/v1/finance/assets/<id>/dispose` | planned | |
| FIN-262 | Dispose with a date in a locked period | cfo | 422 `period_locked` on `date_remove` | `POST /api/v1/finance/assets/<id>/dispose` | planned | |
| FIN-263 | Accountant and auditor open assets | accountant | Read only: no create link, no validate, dispose or compute button | `cap finance.assets.read` | planned | |
| FIN-264 | Accountant writes an asset by API | accountant | 403 `forbidden` | `cap finance.assets.manage` | planned | |

## Budgets (`/finance/budgets`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-265 | Budget list: filters state (draft, confirmed, cancelled), search, pagination | cfo | KPI strip and rows | `page /finance/budgets` `GET /api/v1/finance/budgets` | planned | |
| FIN-266 | Budget list invalid state | cfo | 422 `invalid` | `GET /api/v1/finance/budgets` | planned | |
| FIN-267 | Create a budget with name and period | cfo | Draft; status 201 | `page /finance/budgets/new` `POST /api/v1/finance/budgets` | planned | |
| FIN-268 | Create with end before start, missing name or dates | cfo | 422 `invalid` "date_to must be on or after date_from" | `POST /api/v1/finance/budgets` | planned | |
| FIN-269 | Budget record: lines panel, variance panel, actions | cfo | Draft offers confirm, cancel, edit lines | `page /finance/budgets/[id]` `GET /api/v1/finance/budgets/<id>` | planned | |
| FIN-270 | Edit name or period of a draft budget | cfo | Saved | `PATCH /api/v1/finance/budgets/<id>` | planned | |
| FIN-271 | Shrink the period so a line falls outside | cfo | 422 `invalid` "a budget line lies outside the new period" | `PATCH /api/v1/finance/budgets/<id>` | planned | |
| FIN-272 | Edit a confirmed or cancelled budget | cfo | 422 `not_draft` | `PATCH /api/v1/finance/budgets/<id>` | planned | |
| FIN-273 | Body carries `budget_id` or other path keys | cfo | 422 `invalid` "is set by the path, not the body" | `PATCH /api/v1/finance/budgets/<id>` | planned | |
| FIN-274 | Confirm a draft budget | cfo | State confirmed; lines frozen | `POST /api/v1/finance/budgets/<id>/confirm` | planned | |
| FIN-275 | Confirm a budget that is not a draft | cfo | 422 `not_draft` | `POST /api/v1/finance/budgets/<id>/confirm` | planned | |
| FIN-276 | Cancel a draft or confirmed budget | cfo | State cancelled | `POST /api/v1/finance/budgets/<id>/cancel` | planned | |
| FIN-277 | Cancel an already cancelled budget | cfo | 422 `invalid_state` | `POST /api/v1/finance/budgets/<id>/cancel` | planned | |
| FIN-278 | Reset a confirmed or cancelled budget to draft | cfo | State draft; lines editable | `POST /api/v1/finance/budgets/<id>/reset-to-draft` | planned | |
| FIN-279 | Reset a draft budget | cfo | 422 `invalid_state` | `POST /api/v1/finance/budgets/<id>/reset-to-draft` | planned | |
| FIN-280 | Add a line (account, amount, optional period, label, cost center) | cfo | Line on the draft; status 201 | `POST /api/v1/finance/budgets/<id>/lines` | planned | |
| FIN-281 | Add a line to a confirmed budget | cfo | 422 `not_draft` | `POST /api/v1/finance/budgets/<id>/lines` | planned | |
| FIN-282 | Add a line with period outside the budget, unknown account, account of another company | cfo | 422 `invalid` naming the field | `POST /api/v1/finance/budgets/<id>/lines` | planned | |
| FIN-283 | Two lines of one account and period without cost centers (split on) | cfo | 422 `cost_center_overlap` on `analytic_account_id` | `POST /api/v1/finance/budgets/<id>/lines` | planned | |
| FIN-284 | Edit a line | cfo | Saved while draft | `PATCH /api/v1/finance/budgets/<id>/lines/<id>` | planned | |
| FIN-285 | Delete a line | cfo | 204 while draft; 422 `not_draft` otherwise | `DELETE /api/v1/finance/budgets/<id>/lines/<id>` | planned | |
| FIN-286 | Line id that belongs to another budget | cfo | 404 `not_found` | `PATCH /api/v1/finance/budgets/<id>/lines/<id>` | planned | |
| FIN-287 | Distribute an amount between cost centers | cfo | One line per cost center, rounding difference on the largest share, lines add up to the amount; status 201 | `POST /api/v1/finance/budgets/<id>/lines/distribute` | planned | |
| FIN-288 | Distribute with fewer than 2 shares, a repeated cost center, shares not adding to 100 | cfo | 422 `invalid` ("2 to N", "can appear once", "must add up to 100") | `POST /api/v1/finance/budgets/<id>/lines/distribute` | planned | |
| FIN-289 | Accountant and auditor open a budget | accountant | Read only; no create, confirm or line actions | `cap finance.budgets.read` | planned | |
| FIN-290 | Accountant writes a budget by API | accountant | 403 `forbidden` | `cap finance.budgets.manage` | planned | |

## Reports (`/finance/reports/[report]`)

Capability per report (from `reportConfig.ts` and the route): `finance.statements.read` for trial balance, general
ledger, aged balance, partner statement, profit and loss, balance sheet, cash flow; `finance.reports.read` for VAT,
VAT return, withholding; `finance.analytic.read` for the cost center report; `finance.budgets.read` for budget vs
actual; `finance.zakat.read` for the zakat base. Filters live in the URL; without dates the period is the current
month up to today; a report that ends on a day (`period: end`) sends only `date_to`.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-291 | Trial balance ("ميزان المراجعة") for a period | auditor | Debit, credit, balances per account, totals; filter posted only or all moves | `page /finance/reports/[id]` `GET /api/v1/finance/reports/trial-balance` | planned | |
| FIN-292 | Trial balance without `date_from` / `date_to` or with an inverted period | auditor | 422 `invalid` "date_from is required" / "date_to must be on or after date_from" | `GET /api/v1/finance/reports/trial-balance` | planned | |
| FIN-293 | Trial balance with a bad date format or `target_move` value | auditor | 422 `invalid` "must be an ISO date (YYYY-MM-DD)" | `GET /api/v1/finance/reports/trial-balance` | planned | |
| FIN-294 | General ledger ("دفتر الأستاذ العام") totals per account | auditor | Totals per account; picking an account opens its lines, 50 per page | `GET /api/v1/finance/reports/general-ledger` | planned | |
| FIN-295 | General ledger lines page with `limit`/`offset` but no `account_id` | auditor | 422 `invalid` "account_id is required to page the lines" | `GET /api/v1/finance/reports/general-ledger` | planned | |
| FIN-296 | General ledger with an account or partner filter outside the company | auditor | 422 `invalid` on `account_id` / `partner_id` | `GET /api/v1/finance/reports/general-ledger` | planned | |
| FIN-297 | Aged partner balance ("أعمار الذمم") receivable and payable | auditor | Buckets by due date as of `date_to`; `kind` switches receivable / payable | `GET /api/v1/finance/reports/aged-partner-balance` | planned | |
| FIN-298 | Aged balance without `date_to` or with a bad `kind` | auditor | 422 `invalid` | `GET /api/v1/finance/reports/aged-partner-balance` | planned | |
| FIN-299 | Partner statement ("كشف حساب طرف") activity type with period | accountant | Opening balance, lines, closing per currency block | `GET /api/v1/finance/reports/partner-statement` | planned | |
| FIN-300 | Partner statement outstanding type | accountant | Open items up to `date_to`; period needs only `date_to` | `GET /api/v1/finance/reports/partner-statement` | planned | |
| FIN-301 | Partner statement before a partner is chosen | accountant | Page shows "اختر العميل أو المورد" and sends no request | `page /finance/reports/[id]` | planned | |
| FIN-302 | Partner statement for a contact of a company (not the commercial partner) | accountant | 422 `invalid` "a statement is for a company or a person" | `GET /api/v1/finance/reports/partner-statement` | planned | |
| FIN-303 | Partner statement without or with an unknown `partner_id`, or bad `type` | accountant | 422 `invalid` | `GET /api/v1/finance/reports/partner-statement` | planned | |
| FIN-304 | Profit and loss ("قائمة الدخل") for a period | auditor | Revenue, costs, expenses, profit; page shows the management information note | `GET /api/v1/finance/reports/profit-loss` | planned | Not a statutory report |
| FIN-305 | Balance sheet ("الميزانية العمومية") as of a day | auditor | Position at `date_to`, current year earnings from the start of its fiscal year | `GET /api/v1/finance/reports/balance-sheet` | planned | |
| FIN-306 | Balance sheet balances (assets equal liabilities plus equity) after posting and after year close | cfo | Totals agree | `GET /api/v1/finance/reports/balance-sheet` | planned | |
| FIN-307 | Cash flow ("التدفق النقدي") for a period | auditor | Indirect method; `difference` against the change of cash accounts is zero when it closes; `statutory` false | `GET /api/v1/finance/reports/cash-flow` | planned | |
| FIN-308 | VAT summary ("ضريبة القيمة المضافة") for a period | accountant | Per tax base and tax; group taxes appear as children; cash-basis taxes at invoice date | `GET /api/v1/finance/reports/vat` | planned | |
| FIN-309 | VAT return ("إقرار ضريبة القيمة المضافة") boxes 1 to 16 | cfo | Boxes from the Saudi tax tags of posted items | `GET /api/v1/finance/reports/vat-return` | planned | |
| FIN-310 | VAT return drill-down: items behind a box column | cfo | Journal items of box `sa_N`, column `base` or `tax`, paged, links to documents | `GET /api/v1/finance/reports/vat-return/items` | planned | |
| FIN-311 | Drill-down without `code` or `column`, or an unknown box | cfo | 422 `invalid` "code and column are required" on the missing one | `GET /api/v1/finance/reports/vat-return/items` | planned | |
| FIN-312 | Withholding tax ("ضريبة الاستقطاع") per withholding tax | accountant | Tax withheld from vendor payments | `GET /api/v1/finance/reports/withholding` | planned | |
| FIN-313 | Cost center report ("تقرير مراكز التكلفة") with and without a plan filter | accountant | Income, expense, net per cost center; `plan_id` limits to a plan and sub-plans | `GET /api/v1/finance/reports/analytic` | planned | |
| FIN-314 | Cost center items behind a row | accountant | Newest first, paged (second request when a row is picked) | `GET /api/v1/finance/reports/analytic/lines` | planned | |
| FIN-315 | Cost center lines without `account_id` or period, or an account of another company | accountant | 422 `invalid` "account_id is required" / 404 for a foreign account | `GET /api/v1/finance/reports/analytic/lines` | planned | |
| FIN-316 | Cost center report with an unknown or non-numeric `plan_id` | accountant | 422 `invalid` on `plan_id` | `GET /api/v1/finance/reports/analytic` | planned | |
| FIN-317 | Budget vs actual ("الميزانية مقابل الفعلي") | cfo | Needs a budget; `date_to` defaults to the budget end; variance per line | `GET /api/v1/finance/reports/budget-vs-actual` | planned | |
| FIN-318 | Budget vs actual before a budget is chosen | cfo | Page shows "اختر الميزانية" and sends no request | `page /finance/reports/[id]` | planned | |
| FIN-319 | Budget vs actual without `budget_id` or with a budget of another company | cfo | 422 `invalid` "budget_id is required" / 404 | `GET /api/v1/finance/reports/budget-vs-actual` | planned | |
| FIN-320 | Zakat base ("وعاء الزكاة") as of a day | cfo | Simplified base plus the adjustments and review panels | `GET /api/v1/finance/reports/zakat-base` | planned | Formula must be reviewed by a Saudi CPA |
| FIN-321 | Unknown report slug | cfo | Not-found state, no request | `page /finance/reports/[id]` | planned | |
| FIN-322 | Report page without its capability (accountant opens zakat base) | accountant | Forbidden state "لا تملك صلاحية عرض هذا التقرير."; API 403 | `cap finance.zakat.read` | planned | |
| FIN-323 | Report filters in the URL: change period, refresh, back | auditor | Same figures and filter chips; "clear filters" removes them all | `page /finance/reports/[id]` | planned | |
| FIN-324 | Report with no data in the period | auditor | "لا توجد بيانات في هذه الفترة." | `page /finance/reports/[id]` | planned | |
| FIN-325 | KPI tiles on a report follow the server totals and hide with the KPI toggle | auditor | Tiles match table totals | `page /finance/reports/[id]` | planned | |
| FIN-326 | Report sidebar group: 13 links, each shown only with its capability | accountant | Accountant sees 12 (no zakat base); auditor sees all 13 (it holds analytic.read and budgets.read) | `cap finance.reports.read` `cap finance.statements.read` `cap finance.analytic.read` `cap finance.budgets.read` | planned | |
| FIN-327 | Export or print any report (CSV, XLSX, PDF) | auditor | A downloadable copy of the figures on screen | `GET /api/v1/finance/reports/trial-balance` | gap | No report route or page action exports; FIN-14 says "exports" |
| FIN-328 | Reports use only the current company and company currency | cfo | Other company's figures never included; partner statement groups by document currency | `GET /api/v1/finance/reports/vat` | planned | |

## Zakat

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-329 | Add a zakat adjustment ("add" or "deduct") for the year ending `date_to` | cfo | Row listed in the adjustments panel; audit `zakat_adjustment_added`; status 201 | `POST /api/v1/finance/zakat/adjustments` | planned | |
| FIN-330 | Adjustment with unknown kind, zero or negative amount, empty label, bad date, unknown field | cfo | 422 `invalid` naming the field | `POST /api/v1/finance/zakat/adjustments` | planned | |
| FIN-331 | List adjustments for a year | auditor | Needs `date_to`; read only | `GET /api/v1/finance/zakat/adjustments` | planned | |
| FIN-332 | List adjustments without `date_to` | auditor | 422 `invalid` | `GET /api/v1/finance/zakat/adjustments` | planned | |
| FIN-333 | Remove an adjustment (inline confirm "حذف التعديل «{label}»؟") | cfo | 204; audit `zakat_adjustment_removed`; base recomputed | `DELETE /api/v1/finance/zakat/adjustments/<id>` | planned | |
| FIN-334 | Record a review with the reviewer credential ("تسجيل المراجعة") | cfo | Review row with base, zakat due, fingerprint; status 201; audit `zakat_reviewed` | `POST /api/v1/finance/zakat/reviews` | planned | Not a ZATCA filing |
| FIN-335 | Review without `credential` or `date_to`, unknown field | cfo | 422 `invalid` "credential is required" | `POST /api/v1/finance/zakat/reviews` | planned | |
| FIN-336 | A review becomes stale after the books or the adjustments change | cfo | The listing flags the earlier review as not current | `GET /api/v1/finance/zakat/reviews` | planned | Fingerprint comparison |
| FIN-337 | A review is never edited or removed | cfo | There is no route to change or delete a review | `GET /api/v1/finance/zakat/reviews` | planned | |
| FIN-338 | Accountant opens zakat | accountant | Zakat report forbidden; adjustments and reviews API 403 | `cap finance.zakat.read` | planned | |
| FIN-339 | Auditor adds an adjustment or a review | auditor | 403 `forbidden` | `cap finance.zakat.manage` | planned | Auditor has read only |
| FIN-340 | A role with `finance.zakat.review` but not `finance.zakat.manage` | custom role (finance.zakat.read, finance.zakat.review) | May record a review, cannot add or remove adjustments | `cap finance.zakat.review` | planned | |

## Setup, chart of accounts and fiscal settings (`/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-341 | Settings page: header tag ready / not ready, setup steps, company tax identity, fiscal year, chart, ZATCA summary | cfo | Cards in order; page anchors setup, analytic, closing, zatca, audit | `page /settings/apps/finance` `GET /api/v1/finance/setup` | planned | |
| FIN-342 | Blockers in order: chart not loaded, VAT 15 tax missing, company VAT missing, registry missing, address incomplete, ZATCA not onboarded | cfo | Checklist lists each stable code in that order; `ready` only when none remain | `GET /api/v1/finance/setup` | planned | |
| FIN-343 | Company identity card is read only here | cfo | Name, VAT, registry, address, currency shown; no edit control | `page /settings/apps/finance` | planned | Identity is edited in the company profile settings |
| FIN-344 | Load the Saudi chart (inline confirm "تحميل دليل الحسابات السعودي؟") | cfo | Accounts, taxes, journals created; Saudi tax rounding set to global; audit `chart_loaded` | `POST /api/v1/finance/setup/chart` | planned | |
| FIN-345 | Load the chart twice | cfo | 422 `chart_already_loaded` | `POST /api/v1/finance/setup/chart` | planned | |
| FIN-346 | Load the chart into a company with branches | cfo | 422 `company_has_branches` | `POST /api/v1/finance/setup/chart` | planned | |
| FIN-347 | Load the chart into a company that already has entries | cfo | 422 `invalid` "already has journal entries" | `POST /api/v1/finance/setup/chart` | planned | |
| FIN-348 | Chart or fiscal write without the expected user and company headers | cfo | 422 `invalid_request_context` (field `X-WebVue-Expected-User-Id` or `X-WebVue-Expected-Company-Id`) before any write | `POST /api/v1/finance/setup/chart` | planned | Malformed, zero or oversized id also 422 |
| FIN-349 | Company switched in another tab before saving | cfo | 409 `request_context_changed`; UI asks to reload; nothing written | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-350 | Edit the fiscal year end (day 1-31, month 1-12) before any posting | cfo | Saved; inline form with revert | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-351 | Fiscal year end that is not a calendar date or out of range | cfo | 422 `invalid` "must be an integer from 1 to 31/12"; UI "أدخل يومًا صحيحًا من 1 إلى 31." | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-352 | Change the fiscal year end after entries were posted | cfo | 422 `fiscal_year_has_posted_entries` | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-353 | Move a lock date later (fiscal-year, tax, sales, purchases lock) | cfo | Saved; posting in the locked period then answers `period_locked` | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-354 | Clear a lock date or move it earlier | cfo | 422 `lock_date_loosening`; UI "لا يمكن إزالة هذا القفل أو إرجاعه إلى تاريخ أسبق." | `PATCH /api/v1/finance/setup/fiscal` | planned | Loosening is an Odoo administrator task |
| FIN-355 | Hard lock date is shown (cfo only) but never writable | cfo | Field not in the whitelist; unknown field 422 | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-356 | Fiscal write with an empty body or unknown field | cfo | 422 `invalid` "no fields to update" / "unknown field" | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-357 | Tax rounding is forced to global rounding for a Saudi company | cfo | Whatever is sent, a Saudi company ends with round globally | `PATCH /api/v1/finance/setup/fiscal` | planned | |
| FIN-358 | Auditor opens setup | auditor | Cards read only: no load-chart button, no fiscal form, no hard lock row | `cap finance.setup.read` | planned | |
| FIN-359 | Accountant opens `/settings/apps/finance` | accountant | Setup card hidden (no setup.read); the page offers only the parts it can read | `page /settings/apps/finance` | planned | |
| FIN-360 | A user with no finance capability opens the settings page | staff1 | Forbidden state, no parts | `page /settings/apps/finance` | planned | |
| FIN-361 | Auditor or accountant writes setup by API | auditor | 403 `forbidden` | `cap finance.setup.read` | planned | |

## Settings records: accounts, journals, taxes, payment terms, asset profiles

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-362 | Accounts page: list, search, account-type filter, archived toggle, pagination 25 | cfo | Inline editor to create and edit; filters in the URL | `page /settings/apps/finance/accounts` `GET /api/v1/finance/accounts` | planned | |
| FIN-363 | Create an account (code, name, type, reconcile, currency) | cfo | Saved; audit `account_created` | `POST /api/v1/finance/accounts` | planned | |
| FIN-364 | Create with missing code, name or type, or an unknown type | cfo | 422 `invalid` "account_type must be one of ..." | `POST /api/v1/finance/accounts` | planned | |
| FIN-365 | Edit an account name or code | cfo | Saved | `PATCH /api/v1/finance/accounts/<id>` | planned | |
| FIN-366 | Change the type of an account that has journal items | cfo | 422 `account_in_use` on `account_type` | `PATCH /api/v1/finance/accounts/<id>` | planned | |
| FIN-367 | Archive an unused account (inline confirm) | cfo | Moves to archived; audit `account_archived` | `POST /api/v1/finance/accounts/<id>/archive` | planned | |
| FIN-368 | Archive an account with a balance, used as a journal default, or used by a tax | cfo | 422 `account_in_use` with the reason text | `POST /api/v1/finance/accounts/<id>/archive` | planned | |
| FIN-369 | Restore an archived account | cfo | Back in the active list | `POST /api/v1/finance/accounts/<id>/unarchive` | planned | |
| FIN-370 | Accountant opens the accounts settings | accountant | List readable, no create or edit control | `cap finance.accounts.read` | planned | |
| FIN-371 | Accountant writes an account by API | accountant | 403 `forbidden` | `cap finance.accounts.manage` | planned | |
| FIN-372 | Journals page: list, type filter, archived toggle | cfo | Inline editor | `page /settings/apps/finance/journals` `GET /api/v1/finance/journals` | planned | |
| FIN-373 | Journal detail by id including archived | cfo | Serialized whitelist | `GET /api/v1/finance/journals/<id>` | planned | |
| FIN-374 | Create a journal (name, code, type, optional currency, default account) | cfo | Saved; audit `journal_created` | `POST /api/v1/finance/journals` | planned | |
| FIN-375 | Bank or cash journal without a default account | cfo | 422 `invalid` "default_account_id is required for a bank or cash journal" | `POST /api/v1/finance/journals` | planned | |
| FIN-376 | Journal code already used | cfo | 422 `invalid` "code is already used by another journal" | `POST /api/v1/finance/journals` | planned | |
| FIN-377 | Unknown journal type or missing name or code | cfo | 422 `invalid` | `POST /api/v1/finance/journals` | planned | |
| FIN-378 | Edit a journal; the type cannot be changed | cfo | Saved; sending `type` is 422 "unknown field" | `PATCH /api/v1/finance/journals/<id>` | planned | |
| FIN-379 | Archive and restore a journal | cfo | Hidden from pickers when archived | `POST /api/v1/finance/journals/<id>/archive` | planned | |
| FIN-380 | Restore an archived journal | cfo | Active again | `POST /api/v1/finance/journals/<id>/unarchive` | planned | |
| FIN-381 | Archive a journal Odoo refuses to archive (has draft items) | cfo | 422 `invalid` with Odoo's text | `POST /api/v1/finance/journals/<id>/archive` | planned | |
| FIN-382 | Accountant writes a journal by API | accountant | 403 `forbidden` | `cap finance.journals.manage` | planned | |
| FIN-383 | Auditor reads journals | auditor | List and detail readable | `cap finance.journals.read` | planned | |
| FIN-384 | Taxes page: list, use filter (sale, purchase, none), archived toggle, search | cfo | Inline editor | `page /settings/apps/finance/taxes` `GET /api/v1/finance/taxes` | planned | |
| FIN-385 | Tax detail by id | cfo | Serialized with tax account | `GET /api/v1/finance/taxes/<id>` | planned | |
| FIN-386 | Create a tax (name, use, amount type, amount, included in price, tax account) | cfo | Both invoice and refund tax lines use the account; audit `tax_created`; status 201 | `POST /api/v1/finance/taxes` | planned | |
| FIN-387 | Create without name, use, amount or tax account | cfo | 422 `invalid` "<field> is required" | `POST /api/v1/finance/taxes` | planned | |
| FIN-388 | Tax account of another company | cfo | 422 `invalid` on `tax_account_id` | `POST /api/v1/finance/taxes` | planned | |
| FIN-389 | Change the rate, kind or account of a tax used by journal items | cfo | 422 `tax_in_use` on the changed field; rename is allowed | `PATCH /api/v1/finance/taxes/<id>` | planned | |
| FIN-390 | Edit an unused tax fully | cfo | Saved | `PATCH /api/v1/finance/taxes/<id>` | planned | |
| FIN-391 | Archive and restore a tax | cfo | Archived tax no longer offered on lines | `POST /api/v1/finance/taxes/<id>/archive` | planned | |
| FIN-392 | Restore an archived tax | cfo | Active again | `POST /api/v1/finance/taxes/<id>/unarchive` | planned | |
| FIN-393 | Accountant and auditor see taxes read only; API writes 403 | accountant | No create or edit; 403 `forbidden` | `cap finance.taxes.read` `cap finance.taxes.manage` | planned | |
| FIN-394 | Payment terms page: list, search, archived toggle | cfo | Inline editor with lines | `page /settings/apps/finance/payment-terms` `GET /api/v1/finance/payment-terms` | planned | |
| FIN-395 | Payment term detail by id | cfo | Lines with value, amount, days, delay type | `GET /api/v1/finance/payment-terms/<id>` | planned | |
| FIN-396 | Create a term (percent lines add to 100, days after invoice date or month end) | cfo | Saved; audit `payment_term_created`; status 201 | `POST /api/v1/finance/payment-terms` | planned | |
| FIN-397 | Term whose percent lines do not add to 100, no lines, too many lines, bad `value`, `delay_type` or `nb_days` | cfo | 422 `invalid` on the field | `POST /api/v1/finance/payment-terms` | planned | |
| FIN-398 | Edit a company term | cfo | Lines replaced | `PATCH /api/v1/finance/payment-terms/<id>` | planned | |
| FIN-399 | Edit, archive or restore a term shared by every company (from the chart) | cfo | 422 `shared_record` "cannot be changed here" | `POST /api/v1/finance/payment-terms/<id>/archive` | planned | Same refusal for edit and unarchive |
| FIN-400 | Archive and restore an own term | cfo | Toggles the archived list | `POST /api/v1/finance/payment-terms/<id>/unarchive` | planned | |
| FIN-401 | Apply a payment term to an invoice or bill | accountant | Due date follows the term | `GET /api/v1/finance/payment-terms` | gap | The invoice body has no payment-term key (`EDITABLE_FIELDS` in serializers/invoice.py), so the terms configured here have no consumer in Finance |
| FIN-402 | Payment terms read by accountant and auditor, write refused | accountant | List readable; API writes 403 | `cap finance.payment_terms.read` `cap finance.payment_terms.manage` | planned | |
| FIN-403 | Asset profiles page: list, archived toggle | cfo | Inline editor | `page /settings/apps/finance/asset-profiles` `GET /api/v1/finance/asset-profiles` | planned | |
| FIN-404 | Asset profile detail | cfo | Accounts, journal, method, periods | `GET /api/v1/finance/asset-profiles/<id>` | planned | |
| FIN-405 | Create a profile (asset, depreciation, expense accounts, general journal, method) | cfo | Saved; audit `asset_profile_created`; status 201 | `POST /api/v1/finance/asset-profiles` | planned | |
| FIN-406 | Create with missing accounts or journal, a method outside the choices, a non-integer period, a non-boolean flag | cfo | 422 `invalid` naming the field | `POST /api/v1/finance/asset-profiles` | planned | |
| FIN-407 | Change accounts, journal or method of a profile used by assets | cfo | 422 `profile_in_use` | `PATCH /api/v1/finance/asset-profiles/<id>` | planned | Name stays editable |
| FIN-408 | Archive a profile: no new asset can use it, running assets continue | cfo | Audit `asset_profile_archived` | `POST /api/v1/finance/asset-profiles/<id>/archive` | planned | |
| FIN-409 | Restore a profile | cfo | Offered again on asset creation | `POST /api/v1/finance/asset-profiles/<id>/unarchive` | planned | |
| FIN-410 | Asset profiles written by accountant or auditor | accountant | Read allowed (`finance.assets.read`), writes 403 `forbidden` | `cap finance.assets.read` | planned | Profiles use the assets capabilities |

## Cost centers (analytic plans and accounts, section on `/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-411 | Plans list with search `q`; plan detail | accountant | Plans are shared by every company of the database | `GET /api/v1/finance/analytic-plans` `GET /api/v1/finance/analytic-plans/<id>` | planned | |
| FIN-412 | Create a sub-plan | cfo | Saved; needs `finance.analytic.manage` only; status 201 | `POST /api/v1/finance/analytic-plans` | planned | |
| FIN-413 | Create a root plan | cfo | Needs `finance.setup.manage` too (adds a column and index) | `POST /api/v1/finance/analytic-plans` | planned | A custom role with analytic.manage but no setup.manage gets 403 |
| FIN-414 | Rename a plan; renaming a root plan needs setup.manage | cfo | Only the name changes | `PATCH /api/v1/finance/analytic-plans/<id>` | planned | |
| FIN-415 | Cost center accounts list: search, plan filter, archived toggle; detail | accountant | Company accounts only | `GET /api/v1/finance/analytic-accounts` `GET /api/v1/finance/analytic-accounts/<id>` | planned | |
| FIN-416 | Create a cost center (name, code, plan) | cfo | Saved; missing name or plan is 422 `invalid` | `POST /api/v1/finance/analytic-accounts` | planned | |
| FIN-417 | Move a cost center with analytic items to another root plan | cfo | 422 `analytic_account_in_use` | `PATCH /api/v1/finance/analytic-accounts/<id>` | planned | |
| FIN-418 | Archive a cost center with `active: false` | cfo | Hidden from pickers; inline archive confirm | `PATCH /api/v1/finance/analytic-accounts/<id>` | planned | |
| FIN-419 | Accountant and auditor see cost centers read only | accountant | Writes 403 `forbidden` | `cap finance.analytic.read` `cap finance.analytic.manage` | planned | |

## Fiscal-year closing (section `closing` on `/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-420 | Fiscal years list: every year from the first posted line to the current one, oldest first, with state open / locked / closed and result | auditor | Read only; empty text "لا توجد سنوات مالية بعد. تظهر السنوات بعد ترحيل أول قيد." on a new company | `GET /api/v1/finance/fiscal-years` `cap finance.closing.read` | planned | |
| FIN-421 | Closing preview of an ended year ("معاينة إقفال سنة {year}") | auditor | Closing lines (each P&L balance reversed, net result on retained earnings), no blockers | `GET /api/v1/finance/fiscal-years/<id>/closing-preview` | planned | |
| FIN-422 | Preview of the current year | cfo | Blocker `year_not_ended` listed under "لا يمكن إقفال هذه السنة الآن"; close button disabled | `GET /api/v1/finance/fiscal-years/<id>/closing-preview` | planned | |
| FIN-423 | Preview or close with draft entries inside the year | cfo | Blocker `has_drafts` with `drafts` count | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | Close answers 422 with the same code |
| FIN-424 | Close a year while an earlier year still has unallocated results | cfo | Blocker `previous_year_open`; earlier years under a lock date are exempt | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | |
| FIN-425 | Archived or foreign-currency account holds a balance | cfo | Blocker `account_not_closable` with `account_ids` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | |
| FIN-426 | Company with no retained-earnings account or no miscellaneous journal | cfo | Blockers `no_retained_earnings_account` / `no_general_journal` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | |
| FIN-427 | Close an ended year (inline confirm "إقفال سنة {year}؟", cannot be undone) | cfo | Closing entry posted, fiscal-year lock date set to the year end, state closed, audit `fiscal_year_closed` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | See FIN-16 |
| FIN-428 | Close a year with no income or expense lines | cfo | No entry; lock date still set; state `locked` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | |
| FIN-429 | Close a year twice (or two closes racing) | cfo | 422 `already_closed`; UI "هذه السنة مقفلة بالفعل." | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | Preview of a closed year is also `already_closed` |
| FIN-430 | Closing entry dated inside an existing lock | cfo | 422 `period_locked`; UI "الفترة مقفلة بتاريخ قفل..." | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | |
| FIN-431 | Year outside 1900 to 2999 | cfo | 422 `invalid` "year must be from 1900 to 2999" | `GET /api/v1/finance/fiscal-years/<id>/closing-preview` | planned | |
| FIN-432 | After closing, post or edit a document dated inside the year | accountant | 422 `period_locked` on invoice, entry, payment, bank reconciliation | `POST /api/v1/finance/entries/<id>/post` | planned | |
| FIN-433 | Close needs both closing.manage and setup.manage | custom role (finance.closing.manage, finance.setup.manage) | Closes; a role with closing.manage alone cannot be saved (dependency) | `cap finance.closing.manage` | planned | |
| FIN-434 | Accountant and auditor try to close | accountant | Section hidden for the accountant (no closing.read); auditor sees it without the close button; API 403 `forbidden` | `POST /api/v1/finance/fiscal-years/<id>/close` | planned | |

## ZATCA e-invoicing (section `zatca` on `/settings/apps/finance`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-435 | ZATCA section: readiness, mode, sales journals with state not started / compliance checked / onboarded, backlog counts | accountant | Backlog of waiting invoices; rejected and blocked counts shown in red | `GET /api/v1/finance/zatca/status` `cap finance.zatca.read` | planned | "الفواتير المنتظرة", "يوميات المبيعات" |
| FIN-436 | Setup card ZATCA summary on the settings page | cfo | API mode, key present, onboarded flag | `page /settings/apps/finance` | planned | |
| FIN-437 | Waiting documents work list ("مستندات بانتظار هيئة الزكاة"), oldest first, filter by state | accountant | Rows with ZATCA errors; empty "لا مستندات بانتظار الهيئة."; at most the oldest 500 are examined | `GET /api/v1/finance/zatca/documents` | planned | |
| FIN-438 | Work list invalid `state` | accountant | 422 `invalid` | `GET /api/v1/finance/zatca/documents` | planned | With a state filter, `total` counts only inside those 500 |
| FIN-439 | Onboard a sales journal with a 6-digit OTP (inline confirm "ربط يومية {journal} بزاتكا؟") | cfo | Journal onboarded; `/settings/system` connection `connected` when all sales journals are done, `pending` otherwise; audit `zatca_onboarded` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | See FIN-18 |
| FIN-440 | OTP not six digits, missing, or an unknown field | cfo | 422 `invalid` on `otp` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | UI strips non-digits and limits to six |
| FIN-441 | Onboard when the company API mode is not sandbox | cfo | 422 `zatca_mode_not_allowed` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | Production is out of scope until the policy exists |
| FIN-442 | ZATCA refuses the OTP or the CSR | cfo | 422 `zatca_rejected`; the earlier working onboarding stays intact | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | |
| FIN-443 | ZATCA unreachable or answers an uninterpreted error | cfo | 502 `zatca_unavailable` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | |
| FIN-444 | Journal that is not a sales journal or belongs to another company | cfo | 404 `not_found` | `POST /api/v1/finance/zatca/journals/<id>/onboard` | planned | |
| FIN-445 | Accountant and auditor try to onboard | accountant | Form hidden; API 403 `forbidden` | `cap finance.zatca.manage` | planned | |
| FIN-446 | ZATCA state of one invoice (record panel) | accountant | State pending / sent / rejected / etc., UUID, confirmed time, errors from ZATCA | `GET /api/v1/finance/invoices/<id>/zatca` | planned | |
| FIN-447 | Submit a posted Saudi invoice now | accountant | State accepted; audit `zatca_submitted` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | See FIN-19 |
| FIN-448 | Submit a draft, cancelled, purchase or non-Saudi document | accountant | 422 `zatca_not_applicable` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-449 | Submit on a journal not onboarded | accountant | 422 `zatca_not_onboarded` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | Button disabled with the reason |
| FIN-450 | Submit when the company mode is not sandbox | accountant | 422 `zatca_mode_not_allowed` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-451 | Submit an invoice already accepted | accountant | 422 `invalid_state` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-452 | Submit an invoice ZATCA already rejected | accountant | 422 `invalid_state` "correct it and retry" | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-453 | ZATCA rejects the invoice on submit | accountant | 422 `zatca_rejected` with `details.submission` carrying ZATCA's codes and messages; the state is saved | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-454 | ZATCA gives no verdict (timeout) | accountant | 502 `zatca_unavailable`; state `retry`; retry is safe | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-455 | Local processing error before ZATCA | accountant | 422 `zatca_local_error` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-456 | ZATCA refuses the journal certificate | accountant | 422 `zatca_unauthorized`; onboard again | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-457 | Retry after correcting a rejected invoice | accountant | Error cleared, sent again, accepted | `POST /api/v1/finance/invoices/<id>/zatca/retry` | planned | |
| FIN-458 | Document already being sent by another process | accountant | 422 `invalid_state` "try again shortly" | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |
| FIN-459 | Auditor sees ZATCA state but no submit / retry action; API 403 | auditor | `finance.zatca.read` only | `cap finance.zatca.submit` | planned | |
| FIN-460 | Submit on an invoice of another company | accountant | 404 `not_found` | `POST /api/v1/finance/invoices/<id>/zatca/submit` | planned | |

## Audit log (`/settings/apps/finance/audit`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-461 | Audit preview card on the settings page links to the full list | auditor | Latest events and a link | `page /settings/apps/finance` | planned | |
| FIN-462 | Audit list: who, when, action, record, fields written (names only), outcome; count tag | auditor | 25 per page, newest first; title "سجل تدقيق المالية" | `page /settings/apps/finance/audit` `GET /api/v1/finance/audit-events` | planned | |
| FIN-463 | Audit filters action, date from, date to in the URL | auditor | Narrow the rows; refresh and back keep them; dates use the user's timezone day | `GET /api/v1/finance/audit-events` | planned | |
| FIN-464 | Audit with unknown `action` or inverted dates | auditor | 422 `invalid` | `GET /api/v1/finance/audit-events` | planned | |
| FIN-465 | Audit empty | auditor | "لا توجد أحداث في السجل بعد." | `page /settings/apps/finance/audit` | planned | |
| FIN-466 | Each action writes one event: invoice posted, entry posted, payment posted, chart loaded, year closed, ZATCA onboarded and submitted | cfo | One row per action with record and company | `GET /api/v1/finance/audit-events` | planned | |
| FIN-467 | Audit rows are immutable | cfo | No route or page can edit or delete a row | `GET /api/v1/finance/audit-events` | planned | `audit_is_immutable` |
| FIN-468 | Audit coverage of payment cancel / reset, asset create / validate / compute, budget changes, analytic and partner changes | cfo | Each logs an event, or the owner decides they do not | `GET /api/v1/finance/audit-events` | decision | No audit action exists for them (audit_event.py selection) |
| FIN-469 | Accountant opens the audit page | accountant | Forbidden; API 403 | `cap finance.audit.read` | planned | |

## Capability matrix

One allow row and one refusal row per capability, following `access_service.py`. `GET` of a list is the usual probe
for a read capability, a write route the probe for a manage capability.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-470 | Role grants: cfo holds all 39 finance capabilities; vendor support holds all 39 | cfo | `/api/v1/me` lists them; roles page shows the built-in grants | `cap finance.invoices.read` `cap finance.zakat.review` | planned | |
| FIN-471 | accountant allowed: invoices.read/manage, payments.read/manage, partners.read/manage, entries.read/manage, bank.read/manage | accountant | Corresponding lists load and writes succeed | `cap finance.invoices.manage` `cap finance.payments.manage` `cap finance.partners.manage` `cap finance.entries.manage` `cap finance.bank.manage` | planned | |
| FIN-472 | accountant allowed reads: accounts, journals, reports, statements, zatca, budgets, assets, analytic, taxes, payment terms | accountant | Lists and reports load | `cap finance.accounts.read` `cap finance.journals.read` `cap finance.reports.read` `cap finance.statements.read` `cap finance.zatca.read` `cap finance.budgets.read` `cap finance.assets.read` `cap finance.analytic.read` `cap finance.taxes.read` `cap finance.payment_terms.read` | planned | |
| FIN-473 | accountant refused: post invoices and entries, setup, closing, zakat, audit, ZATCA manage and every setup record manage | accountant | 403 `forbidden` on each write; read routes of closing, zakat, audit, setup 403 | `cap finance.invoices.post` `cap finance.entries.post` `cap finance.setup.read` `cap finance.closing.read` `cap finance.zakat.read` `cap finance.audit.read` | planned | |
| FIN-474 | accountant refused manage of accounts, journals, taxes, payment terms, budgets, assets, analytic | accountant | 403 `forbidden` | `cap finance.accounts.manage` `cap finance.journals.manage` `cap finance.taxes.manage` `cap finance.payment_terms.manage` `cap finance.budgets.manage` `cap finance.assets.manage` `cap finance.analytic.manage` | planned | |
| FIN-475 | auditor allowed reads: invoices, payments, partners, accounts, journals, entries, bank, statements, zakat, reports, audit, budgets, assets, analytic, closing, setup, ZATCA, taxes, payment terms | auditor | Every list and report loads; no write button anywhere | `cap finance.zakat.read` `cap finance.audit.read` `cap finance.closing.read` `cap finance.setup.read` | planned | |
| FIN-476 | auditor refused every manage and post capability | auditor | 403 `forbidden` on the probes of FIN-15 plus entries, bank, assets, budgets, zakat, ZATCA | `cap finance.entries.manage` `cap finance.bank.manage` `cap finance.zatca.submit` `cap finance.zakat.manage` | planned | |
| FIN-477 | Manage capability without its read capability cannot be granted | custom role (finance.invoices.post only) | Role save refused or the dependency added automatically (`invoices.post` needs `invoices.manage`) | `cap finance.invoices.post` | planned | See `FINANCE_PERMISSION_DEPENDENCIES` |
| FIN-478 | Custom role with `finance.statements.read` only | custom role (finance.statements.read) | Statement reports open; VAT reports 403; sidebar shows only the reports link | `cap finance.statements.read` | planned | |
| FIN-479 | Custom role with `finance.reports.read` only | custom role (finance.reports.read) | VAT, VAT return and withholding open; the Reports sidebar link (`statements.read`) is missing, reach is by direct link | `cap finance.reports.read` | planned | Check the link/landing mismatch |
| FIN-480 | Custom role that adds `finance.zakat.manage` | custom role (finance.zakat.read, finance.zakat.manage) | Adds and removes adjustments, cannot record a review | `cap finance.zakat.manage` | planned | |
| FIN-481 | Role assignment is per company | custom role (finance.invoices.read) | A role assigned in company A does not grant finance in company B | `cap finance.invoices.read` | planned | |
| FIN-482 | `it_admin` holds no finance capability | it_admin | Finance menu hidden, `/finance` forbidden, even though the user manages access | `cap finance.invoices.read` | planned | system_admin does not imply finance |

## Integrations connections (`webvue_integrations_sa`)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-483 | List the company's connections (kind, provider, state, last checked, status message) | it_admin | `{items, total}`; the ZATCA row reads `connected` after FIN-18 | `GET /api/v1/integrations/connections` `cap integrations.read` | planned | Shown on `/settings/system` |
| FIN-484 | Connections list for an employee | staff1 | 403 `forbidden`; `/settings/system` forbidden | `cap integrations.read` | planned | |
| FIN-485 | Connections with the feature `integrations.enabled` off | it_admin | 403 `feature_not_included` | `GET /api/v1/integrations/connections` | planned | |
| FIN-486 | A role with `integrations.manage` must also hold `integrations.read` | custom role (integrations.manage) | Dependency added or role refused | `cap integrations.manage` | planned | The only route needs read; no route needs manage yet |
| FIN-487 | Another company's connections never listed | it_admin | Only the current company's rows | `GET /api/v1/integrations/connections` | planned | |

## Idempotency, concurrency and cross-cutting rules

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-488 | `Idempotency-Key` accepted on create invoice, register payment, standalone payment, create entry, import statement | accountant | A repeat returns the first answer with the first status | `POST /api/v1/finance/entries` `POST /api/v1/finance/payments/standalone` | planned | |
| FIN-489 | Key with the wrong shape (shorter than 8, longer than 128, bad characters) | accountant | 422 `invalid` on `Idempotency-Key` | `POST /api/v1/finance/payments` | planned | |
| FIN-490 | Same key with another body, route or user | accountant | 422 `idempotency_key_reused` | `POST /api/v1/finance/invoices` | planned | |
| FIN-491 | Two requests racing on one key | accountant | The loser answers 409 `duplicate_request` | `POST /api/v1/finance/invoices` | planned | |
| FIN-492 | A refused request leaves no key | accountant | Send again corrected with the same key and it runs | `POST /api/v1/finance/entries` | planned | |
| FIN-493 | Create routes without the header | accountant | Work as normal; two sends create two records | `POST /api/v1/finance/invoices` | planned | Zakat review, partner, asset, budget and statement creates are not idempotent |
| FIN-494 | Browser traffic uses the session cookie only | accountant | No bearer token sent by the Nuxt app | `GET /api/v1/finance/invoices` | planned | |
| FIN-495 | Unknown field in any write body | cfo | 422 `invalid` "unknown field: <name>" with `field` | `PATCH /api/v1/finance/taxes/<id>` | planned | |
| FIN-496 | Direct link, refresh and back on every list keep filters | accountant | Filters are in the URL for invoices, payments, partners, entries, accounts, bank, budgets, assets, reports, audit | `page /finance/budgets` `page /finance/assets` `page /finance/bank/statements` | planned | |
| FIN-497 | Create panels open over their list and Escape or back returns with the filters | accountant | Draft protection prompts when the form is dirty | `page /finance/accounting/entries/new` `page /finance/partners/new` | planned | |
| FIN-498 | Arabic RTL: figures stay Latin, money right-aligned, status badges as pills | accountant | No overflow at phone width on lists and records | `page /finance/accounting/entries/[id]` | planned | |
