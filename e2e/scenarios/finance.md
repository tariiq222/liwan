# Finance

Pages: `/finance/sales/invoices`, `/finance/sales/credit-notes`, `/finance/purchases/bills`,
`/finance/purchases/refunds`, `/finance/payments`, `/finance/accounting/entries`,
`/finance/accounting/accounts`, `/finance/bank/statements`, `/finance/assets`,
`/finance/budgets`, `/finance/partners`, `/finance/reports/[report]`, settings
`/settings/apps/finance`. Owners: `webvue_finance`, `webvue_integrations_sa`.
Personas and status values: [README](README.md).

Role matrix: `cfo` (finance_manager) everything; `accountant` (finance_accountant) manages
documents but cannot post invoices or entries, no setup, zakat or closing, can submit to
ZATCA; `auditor` (finance_auditor) read-only plus audit, closing, setup and zakat reads.

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| FIN-01 | Initial setup: chart of accounts, fiscal settings, journals, taxes, payment terms | cfo | Saved; accountant and auditor cannot change setup | planned | |
| FIN-02 | Create, edit and delete a customer and a vendor | accountant | Saved / removed | planned | |
| FIN-03 | Sales invoice draft, edit, delete | accountant | Draft lifecycle works | planned | |
| FIN-04 | Post, cancel and reset an invoice | cfo | States change; PDF downloads | planned | |
| FIN-05 | Accountant posts an invoice | accountant | Refused (no `finance.invoices.post`) | planned | |
| FIN-06 | Credit note and debit note | cfo | Linked to the original invoice | planned | |
| FIN-07 | Vendor bill and refund, draft to posted | accountant → cfo | Posted by cfo only | planned | |
| FIN-08 | Customer payment: create, post, allocate, unallocate, cancel, reset | accountant | Invoice residual follows the allocation | planned | |
| FIN-09 | Manual journal entry: create, post, reset, unreconcile | cfo | Posted entry in the general ledger | planned | |
| FIN-10 | Accountant posts an entry | accountant | Refused | planned | |
| FIN-11 | Bank statement import and line reconciliation | accountant | Lines matched to payments | planned | |
| FIN-12 | Asset: create, validate, compute depreciation, dispose | cfo | Depreciation lines and disposal entry | planned | |
| FIN-13 | Budget: draft, confirm, cancel, reset; edit lines only in draft | cfo | Each transition; line edit refused when confirmed | planned | |
| FIN-14 | Every report opens and exports: TB, GL, P&L, BS, cash flow, aged, partner statement, VAT, VAT return, withholding, zakat base, analytic, budget vs actual | auditor | Figures consistent with posted data | planned | |
| FIN-15 | Auditor tries any write | auditor | No write actions; direct calls refused | planned | |
| FIN-16 | Fiscal-year close | cfo | Period locked; later posting in it refused | planned | |
| FIN-17 | Zakat adjustment and review | cfo | Saved; accountant refused | planned | |
| FIN-18 | ZATCA sandbox: onboard a sales journal with OTP | cfo | Connection `connected` in `/settings/system` | planned | |
| FIN-19 | ZATCA submit and retry | accountant | Accepted; draft invoice `zatca_not_applicable`; journal not onboarded `zatca_not_onboarded`; already accepted `invalid_state` | planned | |
| FIN-20 | Finance switched off | vendor | Finance pages, menus and project actuals disappear | planned | See PLT-10 |
| FIN-21 | Employee opens finance | staff1 | 403 page | manual 2026-10-28 | Same evidence as ACC-02 |
