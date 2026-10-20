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
| `POST /payments` (201), `POST /payments/standalone` (201), `PATCH /payments/<id>`, `POST /payments/<id>/cancel`, `/reset-to-draft`, `/post`, `/allocate`, `/unallocate` | `finance.payments.manage` |
| `GET /accounts` (`archived=true\|false`, `account_type`, `q`), `GET /accounts/<id>` | `finance.accounts.read` |
| `POST /accounts` (201), `PATCH /accounts/<id>`, `POST /accounts/<id>/archive`, `/unarchive` | `finance.accounts.manage` |
| `GET /taxes` (`type_tax_use`, `archived`, `q`), `GET /taxes/<id>` | `finance.taxes.read` |
| `POST /taxes` (201), `PATCH /taxes/<id>`, `POST /taxes/<id>/archive`, `/unarchive` | `finance.taxes.manage` |
| `GET /payment-terms` (`archived`, `q`), `GET /payment-terms/<id>` | `finance.payment_terms.read` |
| `POST /payment-terms` (201), `PATCH /payment-terms/<id>`, `POST /payment-terms/<id>/archive`, `/unarchive` | `finance.payment_terms.manage` |
| `GET /journals` (`type`, `archived=true\|false`), `GET /journals/<id>` | `finance.journals.read` |
| `POST /journals` (201), `PATCH /journals/<id>`, `POST /journals/<id>/archive`, `/unarchive` | `finance.journals.manage` |
| `GET /setup` | `finance.setup.read` |
| `POST /setup/chart`, `PATCH /setup/fiscal` | `finance.setup.manage` |
| `GET /reports/vat?date_from&date_to`, `GET /reports/withholding?date_from&date_to` | `finance.reports.read` |
| `GET /entries` (`state`, `journal_id`, `date_from`, `date_to`, `q`), `GET /entries/<id>` | `finance.entries.read` |
| `POST /entries` (201, a draft), `PATCH /entries/<id>`, `DELETE /entries/<id>` (204) | `finance.entries.manage` |
| `POST /entries/<id>/post`, `/reset-to-draft`, `/unreconcile` | `finance.entries.post` |
| `POST /invoices/<id>/debit-note` (201, a draft) | `finance.invoices.manage` |
| `GET /countries` (`q`), `GET /countries/<id>/states` (`q`) | `finance.partners.read` or `finance.setup.read` |
| `GET /reports/trial-balance`, `/reports/general-ledger`, `/reports/cash-flow`, `/reports/aged-partner-balance`, `/reports/partner-statement`, `/reports/profit-loss`, `/reports/balance-sheet` | `finance.statements.read` |
| `GET /reports/zakat-base` | `finance.zakat.read` |
| `GET /asset-profiles`, `GET /assets`, `GET /assets/<id>` | `finance.assets.read` |
| `POST /assets` (201, a draft), `POST /assets/<id>/validate`, `POST /assets/<id>/dispose`, `POST /assets/compute-depreciation` | `finance.assets.manage` |
| `GET /bank-statements`, `GET /bank-statements/<id>`, `GET /bank-statement-lines/<id>/reconcile-proposals` | `finance.bank.read` |
| `POST /bank-statements` (201), `POST /bank-statements/import/preview`, `POST /bank-statements/import` (201), `PATCH` and `DELETE` (204) `/bank-statements/<id>`, `POST /bank-statements/<id>/auto-reconcile`, `POST /bank-statement-lines/<id>/reconcile`, `/unreconcile` | `finance.bank.manage` |
| `GET /budgets` (`state`, `q`), `GET /budgets/<id>`, `GET /reports/budget-vs-actual?budget_id[&date_to]` | `finance.budgets.read` |
| `POST /budgets` (201), `PATCH /budgets/<id>`, `POST /budgets/<id>/confirm`, `/cancel`, `/reset-to-draft`, `POST /budgets/<id>/lines` (201), `PATCH` and `DELETE` (204) `/budgets/<id>/lines/<line_id>` | `finance.budgets.manage` |
| `GET /zatca/status`, `GET /invoices/<id>/zatca` | `finance.zatca.read` |
| `POST /zatca/journals/<id>/onboard` (`{otp}`) | `finance.zatca.manage` |
| `POST /invoices/<id>/zatca/submit`, `POST /invoices/<id>/zatca/retry` | `finance.zatca.submit` |
| `GET /analytic-plans` (`q`), `GET /analytic-plans/<id>`, `GET /analytic-accounts` (`q`, `plan_id`, `archived=true\|false`), `GET /analytic-accounts/<id>`, `GET /reports/analytic?date_from&date_to&plan_id?`, `GET /reports/analytic/lines?account_id&date_from&date_to` | `finance.analytic.read` |
| `POST /analytic-plans` (201), `PATCH /analytic-plans/<id>`, `POST /analytic-accounts` (201), `PATCH /analytic-accounts/<id>` (`active` archives) | `finance.analytic.manage` |
| `GET /fiscal-years`, `GET /fiscal-years/<year>/closing-preview` | `finance.closing.read` |
| `POST /fiscal-years/<year>/close` | `finance.closing.manage` |
| `GET /audit-events` (`action`, `date_from`, `date_to`) | `finance.audit.read` |
| `GET /partners` (`q`, `kind=customer\|vendor`, `archived=true\|false`), `GET /partners/<id>` | `finance.partners.read` |
| `POST /partners` (201), `PATCH /partners/<id>`, `POST /partners/<id>/archive`, `/unarchive` | `finance.partners.manage` |

Every route also requires the `finance.enabled` feature (writes check it as a write). There is
no partner delete: archive instead. Capability dependencies: `partners.manage` needs
`partners.read`; `invoices.manage` needs `invoices.read`; `invoices.post` needs `invoices.manage`;
`payments.manage` needs `payments.read` and `invoices.read`; `setup.manage` needs `setup.read`; `entries.manage` needs
`entries.read`; `entries.post` needs `entries.manage`; `assets.manage` needs `assets.read`; `bank.manage` needs
`bank.read`; `analytic.manage` needs `analytic.read`; `budgets.manage` needs `budgets.read`; `zatca.read` needs `invoices.read`; `zatca.manage` and `zatca.submit` need `zatca.read`; `closing.manage` needs `closing.read` and `setup.manage`. The built-in
`finance_manager` role (and `webvue_core`'s vendor support role) holds all thirty-seven capabilities.

Two more built-in roles (sets defined once in `models/access_service.py`):

- `finance_accountant` (محاسب): invoices, payments, partners, entries, bank each `read` + `manage`; `zatca.read` + `zatca.submit`;
  `accounts`, `journals`, `reports`, `statements`, `budgets`, `assets`, `analytic` `read`. It registers payments (Odoo posts the
  payment move), cancels payments, enters bank statements and reconciles them (including write-offs to accounts other than
  receivable, payable and liquidity). It does not post invoices or journal entries, close years, change setup or onboard ZATCA,
  and cannot manage budgets, assets or cost centers, or read the audit trail or zakat.
- `finance_auditor` (مدقق): the nineteen `.read` capabilities, listed literally and nothing that changes data.

## Write semantics

- Request bodies are strict: an unknown key is a 422 `invalid` naming it. Money is a plain JSON
  number, never a string. Records named by id (partner, tax, account, journal, invoices) must be
  visible in the current company, else 422 `invalid` on that field. A path record outside the
  company is a 404.
- Invoices (`out_invoice | in_invoice | out_refund | in_refund`) are created as drafts, in the optional `journal_id` (a
  journal of the document's kind in the company, chosen at creation only) or else the first journal of that kind, with at
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
  Saudi sale document is refused while its sales journal, which carries the ZATCA e-invoicing format, is not
  ZATCA-onboarded; Odoo lists every configuration error in one refusal, so other errors may be
  named next to the onboarding one in `details.detail`). Posting makes no network call; onboarding and
  submission are the explicit ZATCA routes below.

## Deliberate ORM grant

The routes read and write in the caller's own environment (the only `sudo()` places are the setup elevation below and the ZATCA service), so each capability
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

## Accounts

`finance.accounts.manage` (needs `accounts.read`) creates, edits and archives the accounts of the current company; there
is no delete. No `sudo()`: `security/ir.model.access.csv` gives the capability group create and write (not unlink) on
`account.account`, as for cost centers and budgets, and every audit write is in the caller's environment. A body is
`{code, name, account_type, reconcile?, currency?}` (`currency` is a code or `null`); `PATCH` takes any of them. Odoo's own
constraints stay in force (unique code, receivable/payable must reconcile, currency and reconcile switches on used
accounts). On top of them: an account that has journal items keeps its type (422 `account_in_use`), and an account cannot
be archived while it has a posted balance, is the default account of a journal or sits on a tax (422 `account_in_use`).
Each write leaves an audit event (`account_created`, `account_changed`, `account_archived`, `account_unarchived`) with
field names only. The list hides archived accounts unless `archived=true`.

## Journals

`finance.journals.manage` (needs `journals.read`) creates, edits and archives the journals of the current company, with
create/write ACL rows on `account.journal` and no `sudo()`. `POST {name, code, type, currency?, default_account_id?}`:
a `bank` or `cash` journal must name its `default_account_id` (an account of the company, made through the accounts
routes), so the journals route never creates an account. The type is chosen at creation and `PATCH` refuses it. The
code is unique per company (422 `invalid` on `code`). Odoo refuses to archive a journal that holds draft entries.

## Taxes and payment terms

`finance.taxes.manage` and `finance.payment_terms.manage` (each needs its `.read`) work through ACL rows, no `sudo()`.
A tax is a single `sale` or `purchase` tax, `percent` or `fixed`, with the default repartition (100% base, 100% tax).
`tax_account_id` is required on creation and is where the tax amount is booked, on both the invoice and the credit-note
distribution (a tax without one would book its amount on the line's expense or income account, and a receivable or payable
account is refused by Odoo); group taxes, cash-basis settings and tax tags are not edited here. Once journal items use
a tax (`used`), its kind, rate, price-include setting and tax account are fixed (422 `tax_in_use`); it can still be renamed or
archived. A payment term is `{name, note?, lines: [{value: percent|fixed, value_amount, nb_days, delay_type?}]}`; the
percent lines must add up to 100 and a `PATCH` with `lines` replaces them. Terms without a company come with the chart
and are shared: listed and readable, but 422 `shared_record` on every write. Both resources are archived, never deleted,
and each write leaves an audit event with field names only.

## Receipts, advances and allocation

`POST /payments` still pays posted invoices and refuses an amount above their open balance. Money that names no invoice
goes through `POST /payments/standalone` `{payment_type, partner_id, amount, payment_date, journal_id, partner_type?,
payment_method_line_id?, memo?}`: `inbound` is a receipt from a customer, `outbound` a payment to a vendor (`partner_type`
overrides that, so a refund of a customer advance is an outbound payment to a customer). It is created and posted in one
step and leaves its whole amount `unallocated`. Every payment carries `unallocated` (what it still holds open on the
partner's receivable or payable account, zero until posted) and `invoices` (the invoices it is set against now, read from
its reconciliations).

- `POST /payments/<id>/allocate` takes exactly one of `invoice_ids` or `payment_ids` and reconciles the payment's open
  balance with the open items of those posted documents (same partner, currency and account); a partial result is allowed.
  A refund of an advance is an outbound payment allocated against it (`payment_ids`). Nothing to allocate is 422
  `nothing_to_allocate`; a document that is not of the payment's partner, currency or side is 422 `invalid`.
- `POST /payments/<id>/unallocate` removes those reconciliations (a locked period refuses it, 422 `period_locked`).
- A cancelled payment reset to draft can be edited (`PATCH`, drafts only, else 422 `not_draft`) and posted again
  (`POST /payments/<id>/post`). Odoo forgets the invoice of a payment reset to draft, so posting it again leaves its amount
  unallocated; allocate it to the invoice again.
- Odoo 19 Community has no internal-transfer payment: a transfer between bank and cash accounts is not covered yet (see
  `docs/finance/finance-completion-gaps.md`).
- Every create, edit, post, allocation and unallocation leaves an audit event.

## Bank statement import (CSV)

Banks export their own layouts, so the import is two steps over the same body `{journal_id, content, delimiter?,
has_header?, date_format?, decimal_separator?, mapping?}` (`content` is the file text, at most 2 MiB and 5000 rows):

1. `POST /bank-statements/import/preview` writes nothing. Without `mapping` it answers the header, a sample and the
   columns the header names suggest (`suggested_mapping`, English and Arabic words). With a `mapping` (`date`,
   `payment_ref`, and `amount` or `debit` with `credit`; columns by header name, or by position when `has_header` is false)
   it answers every line the import would create (flagged `duplicate` when the journal already holds it), every unreadable
   row with its row number, and the totals.
2. `POST /bank-statements/import` adds `balance_start` and `balance_end_real` (both required) and creates one statement, whole
   or not at all: an unreadable row is 422 `invalid_rows`; lines the journal already holds are 422 `duplicate_lines`
   (`details.rows`) unless `skip_duplicates` is true; opening balance plus the new lines that is not the closing balance is
   422 `balance_mismatch` (`details.expected`, `details.given`). The import is audited (`bank_statement_imported`).

Numbers accept thousands separators, parentheses or a sign for negatives, `decimal_separator` `.` or `,`, and Arabic-Indic
digits; dates use one of the listed formats (`DD/MM/YYYY` is not guessed, it is chosen). A line is a duplicate when the
journal already holds at least as many lines with the same day, amount and reference as the file has shown so far, so two
identical coffees in one file are both kept. Statements and imports work on bank and cash journals. OFX and CAMT files are
not read: the pinned OCA set (`deploy/oca-addons.json`) has no statement-import repository, and adding
`OCA/bank-statement-import` needs the owner's decision.

## Asset disposal

`POST /assets/<id>/dispose` `{date_remove, sale_value?, sale_account_id?, plus_account_id?, min_account_id?, note?}` sells
(`sale_value` above zero, proceeds debited to `sale_account_id`: a bank, cash or receivable account) or scraps a running
or fully depreciated asset, through OCA's removal wizard (`account.asset.remove`, with create/write ACL for the capability
and no `sudo()`). The wizard first posts the depreciation up to the day before the date (an early removal), clears the asset
and its accumulated depreciation, and books the gain on `plus_account_id` or the loss on `min_account_id` (profile
defaults; a missing one the result needs is 422 `invalid`). The removal entry is posted, the asset becomes `removed` and
carries `date_remove`. A date in a locked period is 422 `period_locked`; a date before the last posted depreciation is
refused by the wizard (422 `invalid`); a draft or already removed asset is 422 `invalid_state`.

## Undoing, correcting and matching automatically

- `POST /bank-statement-lines/<id>/unreconcile` undoes a reconciliation through OCA's `unreconcile_bank_line`: the journal's
  reconcile mode decides whether the matching and the entries made for it are removed (`edit`) or the matched entries are
  reversed (`keep`). A line that is not reconciled is 422 `invalid_state`.
- `PATCH /bank-statements/<id>` corrects the name and the opening and closing balances; `DELETE` removes a statement none
  of whose lines is reconciled (422 `has_reconciliations`, `details.line_ids`: undo them first). Both are audited.
- `POST /bank-statements/<id>/auto-reconcile` `{apply?}` matches only the lines that have exactly one certain item: one open
  item that clears the line to the cent and is tied to it by the same partner or by its entry number in the line reference.
  Without `apply: true` nothing is written. Every other line is listed in `review` as `ambiguous`, `no_match` or `failed`;
  nothing is guessed, and each line is matched in its own savepoint so one refusal does not stop the rest.
- Not done: foreign-currency exchange differences in a reconciliation, partial matches proposed automatically, and OCA
  reconcile models and rules (the route above is the only automatic rule).

## Cash flow statement

`GET /reports/cash-flow?date_from&date_to` (`finance.statements.read`) is the statement of cash flows by the indirect method,
built from the posted journal items of the current company with the year-end closing entries left out. Cash is the
accounts of type `asset_cash`. Operating is net income, the depreciation added back, and the change of receivables, prepayments,
other current assets, payables, credit cards and other current liabilities; investing is the change of the fixed and
non-current asset accounts less the depreciation (so only purchases and sales remain); financing is the change of equity and
non-current liabilities. Each line is an account with its cash effect (positive when cash comes in), so it can be opened
down to the entries. `difference` is the check against the change of the cash accounts: it is zero when every account kind
is classified, and a kind outside the three sections would show there, not be hidden. `basis` is `indirect` and `statutory`
is always `false`: this is an accounting statement from the books, not a filed one; a Saudi accountant must review its
classification before it is relied on. The direct method is not offered (it needs the payment-to-document chain that Odoo
Community's reports do not keep).

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

## Cost centers (analytic accounting)

Cost centers are stock `analytic` plans (`account.analytic.plan`) and accounts (`account.analytic.account`);
nothing is added to the schema. A plan is shared by every company of the database (stock plans have no
company); an account belongs to the current company. Shared (company-less) and other-company accounts are
404 on the account routes and 422 in a distribution.

- Plans: `POST {name, parent_id?}`, `PATCH {name}`. The parent is chosen at creation only, because moving a plan
  makes Odoo rebuild the plan columns of its analytic items. **Schema side effect:** creating or renaming a
  ROOT plan (no parent) makes Odoo add a column and an index to `account_analytic_line` (and the other analytic
  tables, `project_project` among them) and reload the registry, so those two calls need `finance.setup.manage`
  in addition to `finance.analytic.manage`; a sub-plan only adds a grouping field and needs
  `finance.analytic.manage` alone. Accounts: `POST {name, plan_id, code?, active?}`, `PATCH` any of them;
  `active: false` archives and `true` unarchives, there is no delete anywhere. An account moves to a plan of
  another ROOT plan only while no analytic item and no journal item distribution names it (422
  `analytic_account_in_use`; Odoo's own `RedirectWarning` is answered the same way); a move between sub-plans of
  the same root is always allowed. Lists are `{items, total}`; accounts list `archived=false` by default.
- `analytic_distribution` on an invoice line or a manual entry line is a strict object
  `{"<account id>": percent}`: each percent is above 0 and at most 100 and each account an active account of the
  current company (422 `invalid` on `lines[i].analytic_distribution`). Odoo's own rule: the percentages of one
  root plan add up to at most 100 (the rest is unallocated), and a plan its applicability marks mandatory must
  reach 100 when the document is posted (Odoo's refusal comes back as 422 `invalid`). Keys are canonical account
  ids (`^[1-9]\d*$`). **An absent key is not the same as `{}`:** a line without `analytic_distribution` is left to
  Odoo, so its analytic distribution models (partner, product, account prefix) may fill it in; `{}` is an explicit
  "none" and is stored as such. A `lines` PATCH replaces every line, so a line loses its distribution unless
  it is sent again (an absent key then means the Odoo default again). Every line in a response carries
  `analytic_distribution: [{account, percent}]` where `account` is `{id, name, code}`. A stored key naming several
  accounts at once (`"1,2"`, made by Odoo's own screens and distribution models) is flattened to one entry per
  account, which keeps each plan's percentage but is **lossy** to send back, so a `lines` PATCH that would rewrite
  a line holding such a key is refused (422 `invalid` on `lines`). An account the caller cannot read (legacy data
  of another company) keeps its percentage and shows as `{id, name: '', code: ''}` instead of failing the whole
  document. A writer needs only the invoice or entry capability for this, not
  `finance.analytic.read`, and a reader of invoices sees the cost center names of the lines.
- `GET /reports/analytic` returns income, expense and net per cost center in the company currency, for the
  posted items of the period, optionally for one plan and its sub-plans (every active account of the company is
  listed, zeros included, plus any archived account with activity; shared company-less accounts are left out, so
  every row has a working drill-down). The source is `account.analytic.line`,
  the items Odoo creates when a distributed journal item is posted and removes when it returns to draft, read with
  `_read_group` per root plan column; it holds the share of each account with the percentages already applied.
  Only items on income and expense accounts count (`internal_group`): income is the credit balance, expense the
  debit balance, net is income less expense. `GET /reports/analytic/lines` lists the items behind one row (newest
  first, `limit`/`offset`), with the same scope, so its amounts add up to the row.

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

- `GET /setup`: `finance.setup.read`. Chart, company tax identity (read-only here; written by the company profile, `PATCH /api/v1/admin/company`), fiscal settings, journal and tax counts,
  ZATCA readiness, `ready` and stable `blockers` codes (`chart_not_loaded`, `vat_15_tax_missing`,
  `company_vat_missing`, `company_registry_missing`, `company_address_incomplete`, `zatca_not_onboarded`)
- `POST /setup/chart` (loads the Saudi `sa` chart, 422 `chart_already_loaded` when one is loaded),
  and `PATCH /setup/fiscal` (`fiscalyear_last_day`, `fiscalyear_last_month`, the sale, purchase, tax and
  global lock dates; never the irreversible hard lock date): `finance.setup.manage` (needs
  `finance.setup.read`); each returns the full setup status
- `GET /reports/vat?date_from&date_to`: `finance.reports.read`. Per tax base and tax amount for sales
  and purchases of the posted entries of the current company, and `net_payable` (output minus input VAT)

## Setup elevation (documented `sudo()` cases)

Stock refuses `account.chart.template` loads to non-administrators and `res.company` writes without the
Access Rights group. `webvue.finance.setup` elevates in exactly two methods, each of which checks
`finance.setup.manage` itself before it elevates (a direct call without it raises `AccessError`), the R7 case "finance setup (chart load, company fiscal settings)":

1. `_webvue_load_chart`: loads the Saudi template `sa` only, into the current company (`env.company`).
   It refuses (422) when a chart is loaded (`chart_already_loaded`), the company has branches
   (`company_has_branches`, stock recurses into them) or it already has journal entries.
2. `_webvue_write_company`: writes the current company only, restricted to a field whitelist
   (the fiscal year day/month and the four non-hard lock dates). Any other field, including `hard_lock_date`, raises `AccessError`.

Through `PATCH /setup/fiscal` a lock date can only be tightened (set, or moved later); removing or
moving one earlier is 422 `lock_date_loosening`, done by an accounting administrator in Odoo. Stock
`RedirectWarning`s (for example unreconciled bank lines before a lock date) become 422 `invalid`
without the action link.

Both re-check that the record is the current company. Reads, validation and serializers stay in the
caller's environment. A caller without `finance.setup.manage` gets 403 and nothing changes
(`tests/test_finance_setup.py`).

## Logs and audit trail

The irreversible and elevated actions leave two records, never a secret, a value or an amount (ids and field
names only): an INFO/WARNING log record with a stable event name, and an audit row in the immutable model
`webvue.finance.audit.event` (company-scoped by a record rule; actor = `create_uid`, time = `create_date`;
`write`, `unlink` and a direct `create` raise `AccessError` for everyone, rows are only created by `_webvue_log`
in the caller's own environment, no `sudo()`; the ACL grants create to the setup, closing and ZATCA capability
groups). Read: `GET /audit-events` (`finance.audit.read`, in the finance manager role) with `action`, `date_from`,
`date_to`, `limit`, `offset`, answering `{items, total}` newest first; each item is
`{id, action, actor, created_at, res_model, res_id, fields_written, outcome}`.

| Event (log) | Audit `action` (record) |
|---|---|
| `finance.setup.chart_loaded` | `chart_loaded` (company, outcome = template) |
| `finance.setup.company_written` (also the lock date of a year close) | `company_written` (company, `fields_written`) |
| `finance.fiscal_year.closed` | `fiscal_year_closed` (closing entry or company, outcome = `<year>:<state>`) |
| `finance.zatca.onboarded` | `zatca_onboarded` (journal) |
| `finance.zatca.onboard_failed` (WARNING; the request rolls back, so only the log survives) | none |
| `finance.zatca.submitted` (WARNING unless `accepted`) | `zatca_submitted` (invoice, outcome = state) |

Stock also tracks the lock-date change on the company; the audit row is the uniform record. The closing entry has a
unique index per company and fiscal year (`webvue_closing_year`); a concurrent second close is 422 `already_closed`.
The backlog and the invoice submission state are parsed from the stock error HTML on every request (a per-request cost).

## Fiscal year-end closing (`finance.closing.*`)

Stock Odoo already needs no closing entry for its reports: the balance sheet adds the unallocated earnings of
the open and earlier years to the `equity_unaffected` account itself. Closing is therefore the accounting act of
allocating the year's result and locking the year. OCA `account_fiscal_year_closing` (account-closing, 19.0)
exists but is a wizard over closing templates that the Saudi chart has none of, so it is not pinned; the
smallest correct close is built here from public ORM reads, with no new `sudo()`.

- A fiscal year is named by the calendar year in which it ends; its dates come from the company's fiscal year
  day and month (`compute_fiscalyear_dates`). `result` is net profit (negative: loss) of the posted income and
  expense lines, closing entry excluded.
- `state`: `closed` = the close posted its closing entry; `locked` = `fiscalyear_lock_date` covers the year end
  without a closing entry (locked through `PATCH /setup/fiscal`, or closed while it had no income or expense);
  `open` otherwise. A `closed` or `locked` year answers 422 `already_closed` to a close and a preview.
- `GET /fiscal-years` lists the years from the first posted line to the current one (today in the user's time
  zone). `GET /fiscal-years/<year>/closing-preview` returns the lines the close would create (each non-zero income
  or expense account reversed, the net result on the retained-earnings account), the rounded totals, and
  `blockers`: the refusals a close would hit now (`code`, `message`, `details`). It writes nothing.
- `POST /fiscal-years/<year>/close` creates and posts ONE balanced entry dated the last day of the year in the
  company's first miscellaneous journal, then sets `fiscalyear_lock_date` to the year end. A year with no income
  or expense is only locked. Refusals (422), in this order: `already_closed`, `year_not_ended` (the year end is
  not before today), `has_drafts` (`details.drafts`), `previous_year_open`, `account_not_closable`
  (`details.account_ids`: an archived account or one with a forced foreign currency holds a balance),
  `no_retained_earnings_account`, `no_general_journal`, and `period_locked` (a lock date, for example the hard
  lock, covers the year end). Closing lines carry no analytic distribution.
- `previous_year_open` looks only at earlier years NOT covered by the fiscal-year or hard lock date: a locked
  earlier year may keep unallocated income and expense (the balance sheet shows it as earlier-years earnings).
- The retained-earnings account is the company's `equity_unaffected` account: the Saudi chart (`l10n_sa`) has no
  other equity account than `999999` "Undistributed Profits/Losses".
- The closing entry is marked by the server-set stored field `account.move.webvue_closing_year` (the fiscal year
  number; `ref` `FYC/<year>` is only a human label). Nothing in the API writes it, so a manual entry with that
  ref is an ordinary entry, and a later change of the fiscal year end does not lose the link. Any consumer of
  profit-and-loss actuals (the reports here, the budgets later) must leave out moves with `webvue_closing_year`
  set; `webvue.finance.closing._webvue_closing_moves` returns them.
- The lock date is written through `webvue.finance.setup._webvue_write_company`, the existing documented setup
  elevation, so `POST /close` requires BOTH `finance.closing.manage` and `finance.setup.manage` (the dependency map
  makes a role with the first carry the second). Only ever a later date (the tighten-only rule); nothing else is
  elevated and the documented sudo case is not widened.
- Reopening a year is deliberately not offered: lock dates only tighten here, so a reopen needs an approved
  policy first. Until then an accounting administrator loosens the lock in Odoo.
- `GET /reports/profit-loss`, `GET /reports/zakat-base` and the year `result` leave the closing entries out, so a
  closed year still reports its real result (the Zakat base is the same as before the close). The balance sheet
  keeps them: the result sits in the `equity_unaffected` account and the current-year earnings are zero, never
  counted twice.
- Schema: version 1.1.0 adds the stored field; `migrations/19.0.1.1.0/README.md` records that no data moves.

## VAT report scope

`GET /reports/vat` groups posted journal items per individual tax: a group tax appears as its child
taxes, cash-basis taxes count at the invoice date, and only the current company is read (not branches). Withholding taxes (the taxes of the stock Saudi 'Withholding Return', see
'Withholding summary source') are not VAT and are left out of both sections, so they never change `net_payable`.

## ZATCA e-invoicing (Fatoora phase 2)

`l10n_sa_edi` (stock, LGPL, Community) is a hard dependency; the routes drive its public flow and never copy or
override its access methods. The Saudi company needs a complete identity first (`GET /setup`): VAT, address,
registry; the seller's commercial-registration identification and building number are what ZATCA warns about
otherwise.

**Sandbox only; a release blocker.** Onboarding is sandbox-only in this phase, so **production invoicing for real
tenants is a release blocker until the simulation/production policy is approved.** The company api mode itself is
confined: a `res.company` constraint (`models/res_company.py`) refuses any `l10n_sa_api_mode` but `sandbox`, because
the stock EDI cron sends every pending document in the company's own mode (the shared cron is left active; see below). Onboarding,
submit and retry also refuse a non-sandbox mode with 422 `zatca_mode_not_allowed` before anything is elevated or sent.
There is no route that changes the mode.

- `GET /zatca/status`: `{api_mode, private_key_present, journals: [{journal, onboarded, state}], onboarded, backlog}`.
  `state` is `not_started`, `compliance_checked` or `onboarded`. `backlog` counts the posted ZATCA documents of the
  current company still waiting (read in the caller's environment, no `sudo()`): `to_send` (no attempt blocked yet),
  `retry` (blocked with a warning or info level: no verdict, the cron tries again), `rejected` (error with ZATCA validation codes) and
  `blocked` (error before any verdict: signing, certificate, chain head). The setup `zatca` block has no backlog.
- `POST /zatca/journals/<id>/onboard {otp}`: `otp` is the six-digit one-time password of the Fatoora portal (the
  sandbox accepts `123345`). It runs the stock `l10n_sa_edi.otp.wizard` (key and CSR when missing, compliance CSID,
  the six compliance checks, production CSID) for one sales journal of the current company, then updates the
  integrations connection (`connected` when every sales journal is onboarded, else `pending`). Onboarding again is the
  re-onboarding; there is no reset route. Answer: the journal row. A failure is 502 `zatca_unavailable` (ZATCA could not
  be reached: connection errors, timeouts, or any HTTP status stock did not interpret other than 400, including 401;
  the generic message never carries the raw answer) or 422 `zatca_rejected` (ZATCA's 400 answer, or stock's own short
  message; that text is echoed, length-capped). The stock wizard runs in English whatever the caller's language. A failure rolls the whole request back, so a previously working onboarding survives a wrong OTP.
  Stock folds every failure into one text, so the 502/422 split reads that text (a `[NNN]` status marker other than
  400, or connection-error words); a transport failure during the compliance checks is indistinguishable from a rejection and answers 422.
- `GET /invoices/<id>/zatca` and the `submission` block of the invoice detail `zatca`:
  `{state, mode, errors, warnings, qr_present}`. `state`: `not_applicable` (draft, or no ZATCA document), `pending`
  (posted, waiting; the stock cron also sends it), `accepted` (`warnings` hold ZATCA's warnings), `rejected` (ZATCA's
  validation errors in `errors: [{code, message}]`), `retry` (no verdict yet: ZATCA unreachable, a 5xx, or warnings
  only; ZATCA's codes are shown when it gave any, else a generic message; stock keeps the chain index only when ZATCA
  may have received the document and resets it on a definite answer), `blocked` (a local failure before any verdict:
  signing, certificate, chain-head block, unexpected answer; a short stock message, never a dumped response) and
  `unauthorized` (ZATCA refused the journal certificate: onboard the journal again).
  `mode` is `clearance` for a standard (B2B) invoice and `reporting` for a simplified (B2C) one. Warnings are kept
  by stock only in the chatter, so they are read from the newest alert box of the invoice (best effort).
- `POST /invoices/<id>/zatca/submit` and `/retry`: send that one posted invoice now (no waiting for the cron).
  `submit` refuses a rejected document (`invalid_state`: correct it and retry); `retry` clears the stock error first.
  An accepted document, or one being sent by another process, is 422 `invalid_state`; a draft or non-ZATCA document 422 `zatca_not_applicable`; a journal
  that lost its onboarding 422 `zatca_not_onboarded`. Answer: the submission block. Otherwise the answer is an error
  carrying `details.submission`, committed (stock keeps the rejected XML and the chain index of a document ZATCA may
  have received): 422 `zatca_rejected`, 502 `zatca_unavailable` (state `retry`), 422 `zatca_local_error` (`blocked`),
  422 `zatca_unauthorized` (`unauthorized`).

Error codes: `zatca_unavailable` 502, `zatca_rejected` 422, `zatca_local_error` 422, `zatca_unauthorized` 422,
`zatca_mode_not_allowed` 422, `zatca_not_onboarded` 422,
`zatca_not_applicable` 422, `invalid_state` 422, plus the usual 403 `forbidden`, 404 `not_found` and 422 `invalid`
(`otp`: exactly six digits, no other key).

**The cron.** `account_edi.ir_cron_edi_network` ("EDI: Perform web services operations") ships inactive
(`noupdate`, `active=False`, every 1 day) in stock `account_edi`. Creating an EDI format whose `_needs_web_services()` is
true activates it (`account.edi.format.create`); `l10n_sa_edi` creates `sa_zatca`, which needs web services, so
installing it leaves the cron active (`tests/test_finance_zatca_flow.py` pins `active` and the 1-day interval).
Posting or retrying a document also triggers the cron right away (`_trigger()`), so the day interval is only the
fallback. The cron skips documents blocked with `error` (the `rejected` and `blocked` backlog); `retry` and `to_send`
ones are sent again in the company's own api mode, which the company constraint confines to `sandbox`.

**Elevation.** Stock needs `res.company`, `account.journal` and `ir.sequence` writes and system-only fields, which no
finance group has, so `models/zatca_service.py` (`webvue.finance.zatca`) is the one documented `sudo()` place
(two calls, one per public entry, R7 owner approval 2026-10-19). Each entry checks the capability, finds the journal or
invoice in the current company, and refuses a non-sandbox mode before it elevates. No key, CSR, CSID, token or raw
ZATCA response leaves it (`tests/test_finance_zatca_flow.py` scans every response).

Tests mock the gateway at `requests.request`, where stock calls it (`tests/zatca_common.py`; the fake issues real
certificates for the CSR it receives and fails on any URL outside the sandbox developer portal). One live smoke
test is skipped unless asked for:

    WEBVUE_ZATCA_SANDBOX=1 python3 -B tools/odoo_test.py --addons webvue_finance --no-dependents

It needs outbound HTTPS to the sandbox, onboards a fictitious company and clears one standard and reports one
simplified invoice.

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
invoice (its file name is the ZATCA one, `<seller VAT>_<issue time>_<number>`), with the ZATCA QR code once the company has a VAT number. The language is Odoo's own: the partner's
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
confirmation_datetime, submission}`. `qr_code` is the base64 TLV payload `l10n_sa` prints (seller, VAT number, issue time, total,
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
`account_reconcile_oca` (which pulls `account_statement_base`), `mis_builder` and `mis_builder_budget` from the pinned repositories of
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
  balance (balance sheet accounts: every earlier item; profit and loss accounts: the fiscal year's; the earlier years
  sit on the unaffected-earnings account, listed when no account is named), the period debit and credit, the closing
  balance and `lines` `{items, total}`. `total` counts the period's lines; `items` is one SQL page (`limit`/`offset`,
  date order) of the one `account_id` they require (without it 422 `invalid` on `account_id`, and `items` is empty),
  and every line carries the running `balance` of its account. The sums are grouped reads on the journal items and the
  page is `search(limit, offset)` with one sum for the lines before it, so the cost does not grow with the ledger; the
  OCA general ledger is the reference of the parity tests, not run by the route. The fiscal year is the company's
  (`compute_fiscalyear_dates`, so a year ending in June works). Year-end closing entries (`webvue_closing_year`) are
  ordinary posted entries: they appear as lines of the profit and loss accounts and of the unaffected-earnings account
  `999999`. Deliberately unlike the OCA engine, a ledger of `999999` alone has the same opening balance as its row of the
  full ledger (the earlier years' result is added back); the engine leaves it out when an account is named. No
  centralization or grouping.
- `GET /reports/aged-partner-balance?date_to[&kind=receivable|payable][&partner_id]`: open balances at `date_to`, aged
  from the due date into `current`, `days_1_30`, `days_31_60`, `days_61_90`, `days_91_120`, `days_over_120` and `total`,
  per account and partner (a credit balance is negative; items without a partner form the row with `partner` null).
  One grouped read of `amount_residual` per bucket; a reconciliation dated after `date_to` still counts its amount as
  open at that date (the OCA engine does so only when `date_to` is in the past). The items it touched are found by a
  subquery on their partial reconciles within the report's accounts and partner, and aged one by one; the other items
  are excluded from the bucket sums the same way, so the query count stays constant.
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
Not covered: OFX and CAMT import, reconcile models and automatic rules, foreign-currency exchange
differences, unreconciling, cash journals and editing a statement.

## Budgets (`finance.budgets.*`)

**Decision: budgets are OCA `mis_builder_budget`, budget by account.** Odoo 19 Community ships no budget model
(`account_budget` is Enterprise). `OCA/account-budgeting` 19.0 has only `account_budget_oca`, a port of the old stock
budget (budgetary positions and analytic-account budget lines, which needs a new repository pin and an analytic account
on every line). `mis_builder_budget` is in the already pinned `OCA/mis-builder` repository (AGPL-3, used unmodified; no
new pin), is account-based, and prorates a budget with the engine's own function. Of its two models only
`mis.budget.by.account` (states `draft | confirmed | cancelled`, items with an account, a period, debit/credit and an
analytic distribution) is used; the by-KPI budget needs a hand-made MIS template per customer and is not exposed.

- A budget has a name, a period and the current company; a line is `{account_id, amount, date_from?, date_to?, label?,
  analytic_account_id?}` and defaults to the period of the budget. Lines of one account cannot overlap (the engine
  refuses with 422 `invalid`). An account group is not a line target: the budget is per account.
- `amount` is in the company currency, in the natural direction of the account: a debit for assets and expenses, a
  credit for income, liabilities and equity (stored as the item's `debit` or `credit`). A budget of 10000 on an expense
  account and a posted expense of 7500 are both positive numbers.
- Only a draft budget (and its lines) can be edited (422 `not_draft`). `confirm` freezes it, `cancel` closes it from
  draft or confirmed, `reset-to-draft` reopens a confirmed or cancelled one (422 `invalid_state` otherwise).
  `state` is not writable through `PATCH`. Changing the period cannot leave a line outside it.
- `GET /reports/budget-vs-actual?budget_id[&date_to]`: `date_to` defaults to the end of the budget; a line counts from its own
  start up to `min(line end, date_to)`. Its **budget** is the amount prorated over the days elapsed (mis_builder_budget's own
  `_intersect_days`); its **actual** is read in one `_read_group` per distinct (period, analytic account): the posted journal
  items of the account, or, for a line with an analytic account, the analytic lines of that account (a 50% share of a
  1000 expense counts 500), both in the company currency. Per line `{budget, actual, variance, variance_percent, nature,
  favorable}`: **variance is budget minus actual** (25 on a 10000 budget with 7500 spent), `variance_percent` is that over
  the budget (`null` when the budget is zero), `nature` is `debit` or `credit` (the direction the amounts are read in) and
  `favorable` is true when a debit line is at or under its budget, or a credit line at or over it. `totals` never adds
  debit and credit lines: `{debit, credit, net}` where `debit` and `credit` carry `{budget, actual, variance,
  variance_percent}` and `net` is the credit side less the debit side. Draft entries are not counted (`target_move` is
  always `posted`). The budget detail lines carry `nature` too, but no `favorable` (there is no actual in a detail).
- The rules live in the ORM too, for any caller: `mis.budget.by.account.item` create, write and unlink are refused unless the
  budget is a draft; `action_confirm`, `action_cancel` and `action_draft` check the same source states as the routes; a copy
  of a budget is a draft. A request body that repeats a path key (`budget_id`, `line_id`) is 422 `invalid`.
- OCA's overlap rule is kept: lines of one account cannot overlap in time, so **one account cannot be budgeted for two
  analytic accounts in the same period** (use one line for the account, or distinct periods).
- Not covered: budget by KPI, account-group lines, copying a budget, commitments (purchase orders), budget control on
  postings, and several analytic accounts or shares on one line.
