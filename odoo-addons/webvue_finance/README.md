# webvue_finance

The Finance application over stock `account`, `base_vat` and `l10n_sa`: reads of invoices,
payments, accounts and journals, writes for partners, invoices and payments, the company setup
and the VAT summary. The financial statements, partner statements and aging, fixed assets, bank
statements with reconciliation and the Zakat base come from pinned, unmodified OCA modules
(see [OCA-backed reports, assets and bank](#oca-backed-reports-assets-and-bank)).

## Routes (`/api/v1/finance`, lists are `{items, total}` envelopes)

| Route | Capability |
| --- | --- |
| `GET /invoices`, `GET /invoices/<id>` (carries the `zatca` block), `GET /invoices/<id>/pdf` | `finance.invoices.read` |
| `POST /invoices` (201, a draft), `PATCH /invoices/<id>`, `DELETE /invoices/<id>` (204) | `finance.invoices.manage` |
| `POST /invoices/<id>/post`, `/cancel`, `/reset-to-draft` | `finance.invoices.post` |
| `GET /payments` | `finance.payments.read` |
| `POST /payments` (201), `POST /payments/<id>/cancel`, `/reset-to-draft` | `finance.payments.manage` |
| `GET /accounts` | `finance.accounts.read` |
| `GET /journals` | `finance.journals.read` |
| `GET /setup` | `finance.setup.read` |
| `POST /setup/chart`, `PATCH /setup/company`, `PATCH /setup/fiscal` | `finance.setup.manage` |
| `GET /reports/vat?date_from&date_to`, `GET /reports/withholding?date_from&date_to` | `finance.reports.read` |
| `GET /entries` (`state`, `journal_id`, `date_from`, `date_to`, `q`), `GET /entries/<id>` | `finance.entries.read` |
| `POST /entries` (201, a draft), `PATCH /entries/<id>`, `DELETE /entries/<id>` (204) | `finance.entries.manage` |
| `POST /entries/<id>/post`, `/reset-to-draft`, `/unreconcile` | `finance.entries.post` |
| `POST /invoices/<id>/debit-note` (201, a draft) | `finance.invoices.manage` |
| `GET /countries` (`q`), `GET /countries/<id>/states` (`q`) | `finance.partners.read` or `finance.setup.read` |
| `GET /reports/trial-balance`, `/reports/general-ledger`, `/reports/aged-partner-balance`, `/reports/partner-statement`, `/reports/profit-loss`, `/reports/balance-sheet` | `finance.statements.read` |
| `GET /reports/zakat-base` | `finance.zakat.read` |
| `GET /asset-profiles`, `GET /assets`, `GET /assets/<id>` | `finance.assets.read` |
| `POST /assets` (201, a draft), `POST /assets/<id>/validate`, `POST /assets/compute-depreciation` | `finance.assets.manage` |
| `GET /bank-statements`, `GET /bank-statements/<id>`, `GET /bank-statement-lines/<id>/reconcile-proposals` | `finance.bank.read` |
| `POST /bank-statements` (201), `POST /bank-statement-lines/<id>/reconcile` | `finance.bank.manage` |
| `GET /partners` (`q`, `kind=customer\|vendor`, `archived=true\|false`), `GET /partners/<id>` | `finance.partners.read` |
| `POST /partners` (201), `PATCH /partners/<id>`, `POST /partners/<id>/archive`, `/unarchive` | `finance.partners.manage` |

Every route also requires the `finance.enabled` feature (writes check it as a write). There is
no partner delete: archive instead. Capability dependencies: `partners.manage` needs
`partners.read`; `invoices.manage` needs `invoices.read`; `invoices.post` needs `invoices.manage`;
`payments.manage` needs `payments.read` and `invoices.read`; `setup.manage` needs `setup.read`; `entries.manage` needs
`entries.read`; `entries.post` needs `entries.manage`; `assets.manage` needs `assets.read`; `bank.manage` needs
`bank.read`. The built-in `finance_manager` role (and `webvue_core`'s vendor support role) holds all twenty-one
capabilities.

## Write semantics

- Request bodies are strict: an unknown key is a 422 `invalid` naming it. Money is a plain JSON
  number, never a string. Records named by id (partner, tax, account, journal, invoices) must be
  visible in the current company, else 422 `invalid` on that field. A path record outside the
  company is a 404.
- Invoices (`out_invoice | in_invoice | out_refund | in_refund`) are created as drafts with at
  least one line `{name, price_unit, quantity=1, discount=0, tax_ids?, account_id?}`. Omitted
  `tax_ids` means the account's default taxes, `[]` means no tax. `currency` is a code and
  defaults to the company currency; `ref` is the customer/bill reference.
- `PATCH` of a draft: a body with `lines` replaces every line, a body without `lines` keeps
  them. The move type cannot change. A non-draft invoice answers 422 `not_draft` to
  `PATCH`, `DELETE` and `post`; `cancel` on a cancelled and `reset-to-draft` on a draft invoice
  answer 422 `invalid_state`.
- `POST /payments` takes `{invoice_ids, amount, payment_date, journal_id, payment_method_line_id?,
  memo?}` and runs Odoo's `account.payment.register` wizard as one batch: the invoices must be
  posted (`not_posted`), of one partner and one currency. `amount` above the open balance is
  422 `amount_exceeds_residual` (Odoo itself would take the overpayment). A payment can be
  cancelled; only a cancelled or rejected one can be reset to draft. The journal must be
  of the invoices' currency (`journal_currency_mismatch`), and the invoices must be of one
  document type, so an invoice and a credit note are never paid together.
- Cancelling or resetting a posted invoice that has reconciled payments is always 422
  `has_payments` (`details.payment_ids`): cancel or reset the payments through the payments
  route first. Receipts can be read but have no write route (404). Line taxes must be of the
  document's kind (sale taxes on customer documents, purchase taxes on vendor ones). Numbers are
  below 10^12 in absolute value; dates are exactly `YYYY-MM-DD`.
- Partners exclude Odoo system records: users' partners, the companies' own partners and employee
  work contacts (the stored `employee` flag of hr when hr is installed; no dependency on hr).
  They are 404 on every partner route. A model the caller cannot read at all is 403.
- Odoo refusals are 422 `invalid` with its message, except: `invalid_vat` (partner VAT, checked
  by `base_vat`: Saudi numbers are 15 digits starting and ending with 3; a new partner defaults
  to the company country so the check always has a country), `period_locked` (a lock date covers
  the date; the original text is in `details.detail`; a payment date in a closed period is
  refused up front because Odoo would silently move it) and `zatca_not_onboarded` (posting a
  Saudi sale document is refused while `l10n_sa_edi` is installed and its sales journal is not
  ZATCA-onboarded; Odoo lists every configuration error in one refusal, so other errors may be
  named next to the onboarding one in `details.detail`). No ZATCA onboarding or network call is
  made by this addon.

## Deliberate ORM grant

The routes read and write in the caller's own environment (the only `sudo()` is the setup
elevation below), so each capability
group implies the least stock group that lets the ORM do the operation (documented per group in
`security/finance_capability_groups.xml`):

- the read capabilities (`entries.read` included), the setup and report capabilities and `partners.read`:
  `account.group_account_readonly` (partners: nothing, every internal user reads `res.partner`);
- `partners.manage`: `base.group_partner_manager`;
- `invoices.manage`, `invoices.post`, `payments.manage`, `entries.manage`, `entries.post`: `account.group_account_invoice`;

- `statements.read`, `zakat.read`, `bank.read`: `account.group_account_readonly`;
- `assets.read`: `account.group_account_readonly` plus read-only ACLs on `account.asset`, its lines, profiles and groups
  (`security/ir.model.access.csv`): it cannot write assets or create journal entries through the ORM;
- `assets.manage`: `account.group_account_invoice` (the lowest stock group with write access to `account.asset`);
- `bank.manage`: `account.group_account_basic`, the stock group for basic bank reconciliation. **This grant is broader
  than the capability**: Basic implies Invoicing, so the holder can also create, edit and post invoices, bills and
  payments through the ORM (the route is the only per-capability gate, as for the other write capabilities).

`account.group_account_manager` is never implied. Consequence: the stock groups are broader than
the capabilities (any write capability allows ORM writes on every invoice and payment), so only
the route gates per capability (`tests/test_finance_capability_isolation.py`,
`tests/test_finance_write_access.py`). The same approach is used by `webvue_hr`
(`hr.group_hr_user`).

The capability split is route-level and relies on the pending closing of Odoo's generic ORM
endpoints, which would otherwise let the broader stock groups act directly.

## Journal entries

`/entries` is the manual journal entries of the current company: `move_type = entry` without a payment or bank
statement origin and without a cash-basis tax origin. Invoices, payments (and their reversals) and the entries Odoo generates (cash-basis, exchange-difference) are 404
on every entries route, reads included. Entries are in the company currency: a request has no `currency` key, a response reports the company currency code.

- `POST` takes `{journal_id, date, ref?, lines}`; the journal must be a `general` journal of the company, each line is
  `{account_id, partner_id?, name, debit, credit}` with exactly one of `debit` and `credit` above zero (else 422
  `invalid` on `lines[i]`) and at least two lines are needed to balance. The totals must be equal in the company
  currency, else 422 `unbalanced` (`details.debit`, `details.credit`) before Odoo is called. No tax keys exist.
- `PATCH` of a draft follows the invoice semantics: a body with `lines` replaces every line (and is balance-checked
  again), a body without keeps them. A non-draft entry answers 422 `not_draft` to `PATCH`, `DELETE` and `post`;
  `reset-to-draft` on a draft is 422 `invalid_state`.
- `reset-to-draft` of a posted entry with a reconciled line is 422 `has_reconciliations` (`details.line_ids`):
  `POST /entries/<id>/unreconcile` first (it removes the reconciliation of the entry's reconciled lines through
  `remove_move_reconcile`, 422 `invalid_state` when there is none, lock dates mapped like the reset). An entry date in a closed period is 422 `period_locked` (field `date`) on create, `PATCH`
  and `post`, refused up front because Odoo would silently move the date when posting; a refused reset maps to the same code.

## Debit notes

`POST /invoices/<id>/debit-note` takes the optional `{reason, date, copy_lines}` (date defaults to today in Odoo, the
lines are not copied by default) and runs the public `account.debit.note` wizard of `account_debit_note`. Only a posted
customer invoice or vendor bill that is not itself a debit note can be debited: a draft is 422 `not_posted`, a credit
note or a debit note 422 `invalid_state`. It answers 201 with the new draft invoice (`debit_origin_id` links it to the
original), which is then posted through the normal `/invoices/<id>/post` route.

## Lookups

`GET /countries` and `GET /countries/<id>/states` feed the partner and company address fields, so either
`finance.partners.read` or `finance.setup.read` opens them (403 otherwise). `q` matches the name or the code. Names are
Odoo's translated names, in the language of the request user; nothing is hardcoded. Lists are paged
(`limit`, `offset`, the shared API maximum), an unknown country is 404.

## Setup and VAT report routes

- `GET /setup`: `finance.setup.read`. Chart, company tax identity, fiscal settings, journal and tax counts,
  ZATCA readiness, `ready` and stable `blockers` codes (`chart_not_loaded`, `vat_15_tax_missing`,
  `company_vat_missing`, `company_registry_missing`, `company_address_incomplete`, `zatca_not_onboarded`)
- `POST /setup/chart` (loads the Saudi `sa` chart, 422 `chart_already_loaded` when one is loaded),
  `PATCH /setup/company` (`vat`, `company_registry`, `street`, `city`, `state_id`, `country_id`) and
  `PATCH /setup/fiscal` (`fiscalyear_last_day`, `fiscalyear_last_month`, the sale, purchase, tax and
  global lock dates; never the irreversible hard lock date): `finance.setup.manage` (needs
  `finance.setup.read`); each returns the full setup status
- `GET /reports/vat?date_from&date_to`: `finance.reports.read`. Per tax base and tax amount for sales
  and purchases of the posted entries of the current company, and `net_payable` (output minus input VAT)

## Setup elevation (documented `sudo()` cases)

Stock refuses `account.chart.template` loads to non-administrators and `res.company` writes without the
Access Rights group. After the route's `finance.setup.manage` check, `webvue.finance.setup` elevates in
exactly two methods, the R7 case "finance setup (chart load, company tax identity)":

1. `_webvue_load_chart`: loads the Saudi template `sa` only, into the current company (`env.company`).
   It refuses (422) when a chart is loaded (`chart_already_loaded`), the company has branches
   (`company_has_branches`, stock recurses into them) or it already has journal entries.
2. `_webvue_write_company`: writes the current company only, restricted to a field whitelist
   (`vat`, `company_registry`, `street`, `city`, `state_id`, `country_id` and the fiscal year day/month and
   the four non-hard lock dates). Any other field, including `hard_lock_date`, raises `AccessError`.

Through `PATCH /setup/fiscal` a lock date can only be tightened (set, or moved later); removing or
moving one earlier is 422 `lock_date_loosening`, done by an accounting administrator in Odoo. Stock
`RedirectWarning`s (for example unreconciled bank lines before a lock date) become 422 `invalid`
without the action link. Changing only `country_id` re-validates the existing `state_id` (422 on `state_id`).

Both re-check that the record is the current company. Reads, validation and serializers stay in the
caller's environment. A caller without `finance.setup.manage` gets 403 and nothing changes
(`tests/test_finance_setup.py`).

## VAT report scope

`GET /reports/vat` groups posted journal items per individual tax: a group tax appears as its child
taxes, cash-basis taxes count at the invoice date, and only the current company is read (not branches). Withholding taxes (the taxes of the stock Saudi 'Withholding Return', see
'Withholding summary source') are not VAT and are left out of both sections, so they never change `net_payable`.

## ZATCA readiness is read-only

`serializers/zatca.py` reports, from stock `l10n_sa_edi` data when that module is installed
(`{installed: false}` otherwise): the API mode, whether a private key exists, and per sale journal
`onboarded` and `state` (`not_started`, `compliance_checked`, `onboarded`). Key material, CSR, CSIDs
and tokens are never read into the shape (`tests/test_finance_zatca.py` scans every output for
secret-like keys and values). No onboarding action and no network call exist here.

## VAT summary source

The Saudi 'VAT Return' (`l10n_sa.tax_report_vat_filing`) is data only in Community: the `account.report`
engine that evaluates its `tax_tags` expressions ships with Enterprise `account_reports`. The summary
therefore groups posted `account.move.line` rows with `_read_group` (base by `tax_ids` on product lines,
tax by `tax_line_id`), signed as a return reads. A reverse-charge tax shows its base and a net tax of
zero.

## Invoice PDF and ZATCA fields

`GET /invoices/<id>/pdf` returns the stock invoice report of a posted invoice, bill or credit note as
`application/pdf` with a `Content-Disposition: attachment` filename built from the stock report file name
(Arabic is kept, RFC 5987 `filename*`; quotes, slashes and control characters are replaced). The report lists the
invoice's payments, so it is `account.account_invoices` only for a caller who also holds `finance.payments.read`;
anyone else gets `account.account_invoices_without_payment`. For a Saudi company Odoo prints the `l10n_sa` tax
invoice, with the ZATCA QR code once the company has a VAT number. The language is Odoo's own: the partner's
language, or both languages when the company has `l10n_gcc_dual_language_invoice` on. A draft or cancelled invoice
is 422 `not_posted`, an invoice of another company 404, a missing `finance.invoices.read` 403, a missing or
failing `wkhtmltopdf` 503 `pdf_unavailable` (any other render error stays 422 `invalid`).

- The route is the only `type='http'` finance route: a file download is not JSON (the same convention as the
  meeting minutes PDF). After authentication `api_handler` answers every refusal with the JSON error shape; an
  expired session follows Odoo's 303 redirect to `/web/login` like the meeting minutes PDF, so the future Nuxt
  proxy must treat a 3xx or `text/html` answer as 401.
- The report is rendered in the caller's own environment (`_render_qweb_pdf`, no `sudo()`): the stock groups
  the capability implies are enough. The report stores no attachment, so the route writes nothing
  (`readonly=True`).
- Rendering needs `wkhtmltopdf` on the server. Under test Odoo renders HTML instead, so the tests replace the
  renderer for the PDF headers and render the real stock template separately.

The invoice detail carries `zatca`: `null` unless the document is a Saudi sale document, else `{qr_code,
confirmation_datetime}`. `qr_code` is the base64 TLV payload `l10n_sa` prints (seller, VAT number, issue time, total,
VAT; `null` until the document is posted and the company has a VAT number) and `confirmation_datetime` the
ISO-8601 UTC time `l10n_sa` stamps when it is posted.

## Withholding summary source

`GET /reports/withholding` has no withholding model to read in Community: `l10n_account_withholding_tax` lets a
payment withhold a tax (its `account.payment.withholding.line` is readable only by the invoicing group, which the
report capability does not imply), and the Saudi chart ships the withholding taxes of the three groups (5%, 15%,
20%). The summary therefore groups posted journal items, as the VAT summary does, and selects the withholding tax
lines the way the stock 'Withholding Return' (`l10n_sa.tax_report_withholding_tax`) does: by the tax tags of its
'tax' column (whose `tax_tags` engine is Enterprise). One row per withholding tax:

- a deducted (`... D`) tax, archived in the stock chart, is withheld by the payment: its tax line is in the
  payment's journal entry;
- a gross (`... G`) tax is a cash-basis tax of the vendor bill: it counts when the bill is paid, through the
  cash basis entry.

`withheld` is the credit balance of the tagged tax lines (reversals net out), `base` is added in the direction of
the withheld amount, both in the company currency; a cancelled payment or an unpaid bill is not included. Only
the current company is read. A custom withholding tax without the stock tags is not recognised: it stays in the VAT
summary. A customer withholding from a sale is not reported.

## OCA-backed reports, assets and bank

`webvue_finance` depends on `account_financial_report`, `partner_statement`, `account_asset_management`,
`account_reconcile_oca` (which pulls `account_statement_base`) and `mis_builder` from the pinned repositories of
`deploy/oca-addons.json` (see [docs/oca-addons.md](../../docs/oca-addons.md)); they are AGPL-3 and used unmodified
through their models, in the caller's own environment (no `sudo()`). `account_tax_balance` and
`account_fiscal_year` are not used and not declared. All amounts are in the company currency (the partner statement
excepted), the current company only. Dates are `YYYY-MM-DD`; `target_move` is `posted` (default) or `all`.

### Statements (`finance.statements.read`)

- `GET /reports/trial-balance?date_from&date_to`: per account `{account, initial_balance, debit, credit, balance,
  ending_balance}` and `totals` (a complete ledger has `debit == credit` and zero balances; the earnings of
  earlier fiscal years sit on the unaffected-earnings account's opening balance). Runs the OCA trial balance
  (`trial.balance.report.wizard` as a virtual record plus `report.account_financial_report.trial_balance`).
- `GET /reports/general-ledger?date_from&date_to[&account_id][&partner_id][&limit][&offset]`: per account the opening
  balance, the period debit and credit, the closing balance and a `lines` page `{items, total}` (`limit`/`offset`
  apply to the lines and need `account_id`: without it 422 `invalid` on `account_id`; every line carries the running
  `balance`). No centralization or grouping.
- `GET /reports/aged-partner-balance?date_to[&kind=receivable|payable][&partner_id]`: open balances at `date_to`, aged
  from the due date into `current`, `days_1_30`, `days_31_60`, `days_61_90`, `days_91_120`, `days_over_120` and `total`,
  per account and partner (a credit balance is negative).
- `GET /reports/partner-statement?partner_id&date_from&date_to[&kind]` (`partner_id` must be a company or a person, not a
  contact of one: 422 `invalid`): the OCA activity statement (opening balance, the
  period's items with a running balance, aging buckets). `type=outstanding` takes only `date_to` and lists the open
  items. One block per currency of the partner's items, in that currency; the partner is named explicitly, so the OCA
  filters that hide partners without due items are off. Weekly or monthly aging and the detailed statement are not exposed.
- `GET /reports/profit-loss?date_from&date_to` and `GET /reports/balance-sheet?date_to`: `lines` of
  `{code, label, value}` (stable `code`, English `label`). Profit and loss: `revenue`, `cost_of_revenue`, `gross_profit`,
  `operating_expenses`, `depreciation`, `operating_profit`, `other_income`, `other_expenses`, `net_profit`. Balance sheet:
  `cash`, `receivables`, `current_assets`, `prepayments`, `fixed_assets`, `non_current_assets`, `total_assets`,
  `payables`, `credit_cards`, `current_liabilities`, `non_current_liabilities`, `total_liabilities`, `equity`,
  `retained_earnings` (the unallocated result of earlier fiscal years plus the unaffected-earnings account),
  `current_year_earnings` (from the start of the fiscal year of `date_to`), `total_equity`,
  `total_liabilities_and_equity` and `difference` (zero when the books balance).

**Decision: profit and loss, balance sheet and Zakat share one engine, mis_builder.** The three are `mis.report`
templates shipped as data (`data/finance_mis_reports.xml`) and evaluated by `report.evaluate()` (the simplified public
API) by `webvue.finance.mis.report`. A figure is a KPI expression on the Saudi chart's account types
(`balp[('account_type', '=', 'income')]`), so a report is changed by editing data, not code, and the Zakat base needs
the engine anyway. Deriving them from the trial balance by account type would have meant a second set of rules and no
way to adjust a formula without code. The templates are updated with the module (not `noupdate`).

### Zakat base (`finance.zakat.read`)

`GET /reports/zakat-base?date_to` returns `lines` (every step of the formula), `base`, `rate` (2.5% of the lunar year
scaled to the Gregorian fiscal year, 0.025 x 365/354, about 2.5776%, as the data expression of the `zakat_rate` line),
`zakat_due` (the rate on the positive base), and a `disclaimer` that states the scaling. **This is a simplified base for management information, not a
ZATCA filing computation; the formula must be reviewed by a Saudi certified public accountant before it is relied on.**
The formula (`mis_report_zakat_base`): equity + earnings of earlier years + long-term liabilities (`liability_non_current`)
+ provisions (the accounts 201005 and 201006) + the adjusted net profit of the fiscal year to date (net profit plus the
Zakat and income tax expense, accounts 400072 and 400055), less net fixed assets (`asset_fixed`, accumulated depreciation
included) and long-term investments (`asset_non_current`). Account codes are those of the `l10n_sa` chart; the
`disclaimer` is the template's description. Adjust the expressions in the data file.

### Fixed assets (`finance.assets.*`)

`GET /asset-profiles`, `GET /assets` (`state`, `profile_id`, `q`), `GET /assets/<id>` (with the depreciation board),
`POST /assets` (`{profile_id, name, purchase_value, date_start, code?, salvage_value?, partner_id?, note?}`; a draft that
takes the profile's method), `POST /assets/<id>/validate` (draft to running, computes the board; 422 `not_draft`) and
`POST /assets/compute-depreciation {date}` (`date` not in the future, else 422 on `date`; posts the entry of every due
line of the running assets up to `date`, and applies the pending recompute triggers, through OCA's
`account.asset._compute_entries(date, check_triggers=True)` in the caller's rights; the OCA wizard is not used because it
needs the full Accountant group. A line that cannot be posted refuses the whole request with 422, nothing is posted).
`salvage_value` above `purchase_value` is 422. Not covered:
asset disposal or sale (a wizard with accounting regimes), editing a validated asset, groups, asset creation from an
invoice line, and the recompute triggers (a board is not recomputed when the fiscal year changes).

### Bank (`finance.bank.*`)

`POST /bank-statements {journal_id, date, lines[{date, payment_ref, amount, partner_id?}], name?, balance_start?,
balance_end_real?}` creates a statement on a bank journal (at least one line, none with a zero amount).
`GET /bank-statement-lines/<id>/reconcile-proposals` lists the open journal items on reconcilable accounts that could
clear the line (same direction of money, the line's partner when it has one), the exact-amount ones first (`exact`),
at most 1000 examined. `POST /bank-statement-lines/<id>/reconcile {move_line_ids?, account_id?, label?}` matches the line
with those items through account_reconcile_oca's reconciliation data (`reconcile_data_info`, `reconcile_bank_line`);
what the items leave over is booked on `account_id`, a company account that is not receivable, payable or liquidity
(else 422 `invalid` on `account_id`). Without leftover `account_id` is unused; with leftover and no `account_id` the
answer is 422 `not_balanced`; a reconciled line is 422 `invalid_state`.
The reconcile and proposal routes call private methods of account_reconcile_oca (`_default_reconcile_data`,
`_add_account_move_line`, `_recompute_suspense_line`): **a pin bump of `account_reconcile_oca` must re-run
`test_finance_bank`.**
Not covered: statement file import (OFX, CAMT, CSV), reconcile models and automatic rules, foreign-currency exchange
differences, unreconciling, cash journals and editing a statement.
