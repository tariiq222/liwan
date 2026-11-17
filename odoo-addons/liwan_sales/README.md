# liwan_sales

The Sales application (rank 4): staff quotations and orders on stock `sale.order`, under `/api/v1/sales`.
Plan: `docs/superpowers/plans/2026-11-14-liwan-sales.md`. Design: `docs/superpowers/specs/2026-11-14-liwan-sales-design.md`.

## What it owns

- The capabilities, capability groups, the two built-in roles and the read rules of Sales.
- `liwan.sales.settings`, one record per tenant.
- `liwan.sales.visibility` (who reads and writes which document) and `liwan.sales.service` (the write side).
- `sale.order.liwan_staff_document`: set on create by the service. The wire `source` is `staff` when it is set and
  `online` otherwise. Every write route refuses a document without it.
- The send state of a quotation on `sale.order`: `liwan_answer_mode`, `liwan_acceptance_confirms` and
  `liwan_signature_methods` (the three settings copied at send, empty before the first send), `liwan_answer`
  (`accepted` or `declined`), `liwan_answered_on`, `liwan_signature_method` (`drawn` or `typed`) and
  `liwan_decline_reason`. The signature is stock's `require_signature`, `signature`, `signed_by` and `signed_on`.
  Expiry is stock's computed `is_expired`; nothing stores it and no cron runs.
- `liwan.sales.document` (the PDF and the e-mail) and `liwan.sales.answer` (the customer's side, by access token).
- the public PDF read counter is the shared `liwan.api.public.limit` of `liwan_api` (scope `sales.quotation_pdf`, one row per quotation); and the `sales.answered` bell kind with the
  two `mail.message` columns it writes (`liwan_sales_answer`, `liwan_sales_order_name`).

- `liwan.sales.reports` (the figures of the reports, read from stock `sale.report`) and `sale.report.liwan_staff_document` (the source of an order, added through stock's two query hooks).

Customers come from `liwan_customers` and products and prices from `liwan_products`; Sales only picks from them.
The tax rule of an order line belongs to `liwan_orders`.

## Capabilities and roles

| Capability | Agent | Manager |
| --- | --- | --- |
| `sales.read` | yes | yes |
| `sales.quotations.manage` | yes | yes |
| `sales.orders.confirm` | yes | yes |
| `sales.discounts.approve` | | yes |
| `sales.documents.assign` | | yes |
| `sales.reports.read` | | yes |
| `sales.settings.manage` | | yes |

## Settings

`visibility` (`own` or `all`), `validity_days` (30; 0 gives no validity date), `discount_limit_percent` (0, no limit),
`default_terms`, `customer_answer` (`none`, `accept` or `accept_and_sign`; default `accept`), `acceptance_confirms`
(default false), `answered_resend` (`allow` or `refuse`; default `allow`), `signature_methods` (`draw` or
`draw_or_type`; default `draw_or_type`), `revision`. Changed only in the root company by a holder of
`sales.settings.manage`.

`customer_answer`, `acceptance_confirms` and `signature_methods` apply to quotations sent after the change: each send
copies them onto the order, so a sent quotation keeps the terms it was sent under until it is sent again.

`answered_resend` is read at send time, never snapshotted. `allow` lets staff send again a quotation the customer has
answered (the send clears the answer and the signature); `refuse` makes that send 409 `quotation_answered` before any
write and takes `send` out of the order's `actions`, so staff reopen the quotation first. A quotation without an answer
is unaffected. `signature_methods` says how a customer may sign under `accept_and_sign`: `draw` accepts a hand-drawn
signature only, `draw_or_type` also accepts a typed name that the page renders as the signature image.

## Extension points for bridges

Sales names no other application. The bridges `liwan_sales_crm` and `liwan_sales_finance` add their own values through
four hooks that return nothing in Sales itself (the online payment, below, is Sales' own and is not in them):
`liwan.sales.settings._liwan_patch_parsers` and `_liwan_wire_extras` (keys of the settings write and read),
`sale.order._liwan_staff_extras` (keys of the staff wire shape) and `liwan.sales.settings._liwan_preset_extras` (their
choices in each sector preset). A bridge extends a hook with
`super()`. The CRM bridge uses the settings and the staff-shape hooks and
extends `liwan.sales.service._liwan_move`, the one path a staff move, the customer's confirming acceptance and a payment's
confirmation share. The finance bridge uses the settings and the staff-shape hooks and extends
`sale.order._liwan_actions` (an order with a posted invoice is not cancelled).

`sale.order._liwan_lines()` is the lines Sales shows, edits and prints: the order lines without the section and the line
stock adds for a down payment (`is_downpayment`). The staff and public shapes, the lines write (it never names or removes
such a line), the product-line check and the quotation PDF (`_get_order_lines_to_report`, for a staff document) all use it,
and a duplicate already skips them through stock's `_get_copiable_order_lines`. `liwan.sales.visibility._liwan_acts_for` is the
actor rule (the salesperson, or an assign holder) that every write and a bridge's own check share.

## Visibility

- `own`: a reader sees the documents they are the salesperson of and the unassigned ones, which are the online orders.
- `all`: a reader sees every document of the company and still writes only their own.
- `sales.documents.assign`: sees and writes every document of the company and may change the salesperson.

`group_cap_sales_read` implies the stock salesman group (own and unassigned); no Sales group implies the stock
all-documents group, whose rule would follow the user into every company. Capability groups are a union over the
user's companies, so Sales scopes its own rules per company: an open read rule per model (`sale.order`,
`sale.order.line`) for the companies where the user reads everything, and an assign rule on `sale.order` (read, write,
create) for the companies where the user holds `sales.documents.assign`. `liwan.sales.visibility._liwan_domain`
mirrors them for the routes.

## State table

Every move needs a staff document that the caller owns or may assign. `sale.order._liwan_actions` holds the table;
the routes authorise each move from it.

| From | Action | To | Capability |
| --- | --- | --- | --- |
| none | create | `draft` | `sales.quotations.manage` |
| `draft` | edit | `draft` | `sales.quotations.manage` |
| `draft`, `sent` | send (not expired, a usable customer e-mail and a product line; not answered when `answered_resend` is `refuse`) | `sent` | `sales.quotations.manage` |
| `draft`, `sent` | confirm (needs a product line, not expired) | `confirmed` | `sales.orders.confirm` |
| `draft`, `sent` | cancel | `cancelled` | `sales.quotations.manage` |
| `confirmed`, not locked | cancel | `cancelled` | `sales.orders.confirm` |
| `cancelled`, `sent` | reopen | `draft` | `sales.orders.confirm` |
| `confirmed` | lock, unlock | `confirmed` | `sales.orders.confirm` |
| any readable | duplicate | new `draft` | `sales.quotations.manage` |
| any | assign | same | `sales.documents.assign` |

A `sent` staff document confirms and cancels as a `draft` does, and only a `draft` is edited: staff reopen a sent
quotation to change it and send it again.

A move outside the table is 403 `transition_forbidden`; a document the caller cannot read is 404; a document that is
not theirs to write is 403 `forbidden`. Confirm and send on an expired quotation are 422 `quotation_expired`, ahead of
the table's 403. Only send mails the customer; confirm, cancel, reopen, lock and unlock send nothing.

## Sending a quotation

`POST /api/v1/sales/orders/{id}/send` (`sales.quotations.manage`, own document, from `draft` or `sent`; a second send
is a resend). 422 `customer_email_missing` when the customer has no e-mail or one that is not a usable address,
409 `quotation_answered` when the customer answered and the tenant refuses a resend, 422 `quotation_expired`, and `invalid` on
`lines` without a product line; 503 `mail_unavailable` when no sender address is configured (checked before any
write, so the order stays as it was). In one transaction it makes the access token, copies the two answer settings onto the
order (`require_signature` only for `accept_and_sign`), clears any earlier answer and signature, moves a draft to
`sent` with stock `action_quotation_sent`, and queues one `mail.mail` row to the customer: Arabic then English, the link
`<base url>/quote/<id>?access_token=<token>` and the quotation PDF. The stock mail wizard and mail templates are not
used. With `customer_answer` `none` the mail still carries the link and the page is read only.

`GET /api/v1/sales/orders/{id}/pdf` (`sales.read`, within the visibility) is the stock report
`sale.action_report_saleorder`; a missing wkhtmltopdf is 503 `pdf_unavailable`.

An expired quotation (stock `is_expired`: a validity date before today, state `draft` or `sent`) cannot be sent,
accepted or confirmed. Staff extend it: reopen, change the validity date, send again.

## The customer's page

Under `/api/v1/public/sales/quotations/{id}` (`auth='public'`, `save_session=False`, `sales.enabled`, no capability),
authorized by the order's access token alone. A wrong or non-ASCII token, a missing order, an online order, a draft and a
quotation never sent are the same 404 `not_found`; the token is compared in constant time and capped at 128 characters.
Unknown body fields are 422 `unknown_field`.

| Route | Effect |
| --- | --- |
| `GET ?access_token=` | The public shape: figures, lines, `answer_mode`, `signature_methods` (the snapshot), `answer`, `can_accept`, `can_decline`; no salesperson, contact data or partner ids |
| `POST /accept` `{access_token, signed_by?, signature?, signature_method?}` | Records `accepted`; with `acceptance_confirms` it confirms the order through the staff confirm path and sends no stock mail. 422 `answer_not_allowed` (mode `none`), `already_answered`, `quotation_expired`, and for `accept_and_sign` `signature_required` or `signature_invalid` (a base64 PNG of at most 48 KB, no `data:` prefix), and 422 `invalid` on `signature_method` (`drawn` or `typed`, required with the signature, refused without one, `typed` refused when `signature_methods` is `draw`); in mode `accept` the signature fields are unknown |
| `POST /decline` `{access_token, reason?}` | Records `declined` with the reason (at most 1000 characters) and cancels the quotation; allowed while sent and unanswered, expired or not |
| `GET /pdf?access_token=` | The same report; it prints the signature once the quotation is signed. At most 10 reads a minute per quotation (`PDF_LIMIT` in `controllers/public.py`, counted in the shared `liwan.api.public.limit` once the token is valid), then 429 `rate_limited` until the window turns; the proxy gives it the heavy pool and deadline |

The two POSTs go through the ORM as the public user, so a read-only tenant or branch refuses them like any write.

Each answer puts one bell row (`sales.answered`: `accepted`, `signed` or `declined`) in the bell of the order's salesperson
through `liwan_notify`; bell only, no e-mail or setting, and nobody when the order has no salesperson. The row carries
`order_id`, `answer` and the order number as `title`, shows while the caller still reads the order, and the UI links it to
`/sales/{id}`.

## Salespeople

`GET /api/v1/sales/salespeople` (`sales.enabled`, `sales.documents.assign`) feeds the shared person picker, so it
answers the people-list shape of `/api/v1/people` and `/api/v1/crm/agents`: a bare array of `{id, name, user_id}`,
matched by `q` on the name and capped at 50. It is a search source the picker queries as the user types, not an
`{items, total}` list, and takes no `limit` or `offset`. The people are the internal users of the working company who
hold `sales.quotations.manage` there (`liwan.access.service._liwan_users_with_capability`).

## Price and tax of a line

The wire carries neither a price nor a tax. When a line is created or its product changes, its unit price is
`liwan.products.service._liwan_price(...)['unit_price']` for the product, quantity, company and customer. Every write
of a product line also writes the stored `price_unit`, because stock reprices from the list price on a quantity change
otherwise. Taxes come from the stock compute with the `liwan_orders` rule (none while the establishment is not
registered for VAT). Duplicate builds a new quotation through the same create path, so prices and taxes are fresh.
A new `customer_id` on PATCH keeps the unit price of every kept line (D6) and only recomputes the taxes.

Duplicate skips a product line of quantity zero (a removed line), checks every other copied quantity and discount
against the bounds of a write (the quantity bound is `liwan_products.models.products_service.valid_quantity`, the discount bound is `models/sale_order.py`; the parser uses both), and refuses a combo line (a combo
product or a combo item) with 422 on its `product_id`.

A line names a product template and takes its one variant: a template with more than one variant is refused with 422
on `lines.<i>.product_id` in create, edit and duplicate until products with variants arrive.

## Elevated line write

A branch session cannot write `sale.order.line.tax_ids`: the branch fence hides the root's `account.tax`. The order
header is written as the caller; the lines are created, written, deleted and re-taxed in one helper,
`liwan.sales.service._liwan_write_lines`, elevated with the order's company, after every check of the service has
passed. It is documented in `tools/arch_documented_sudo.json`, like the other elevated calls of the addon:
`liwan.sales.answer._liwan_open` (the anonymous customer reads and answers through one record found by access token),
`liwan.sales.document._liwan_queue_mail` (creating a `mail.mail` row needs `base.group_system`) and
`sale.order._liwan_own_payments` (the stock transactions field is for accounting groups only).

## Reports and export

`GET /api/v1/sales/reports/summary`, `/breakdown` and `/export` need `sales.enabled`, `sales.reports.read` **and**
`sales.read`: a report is aggregated document data, so it needs the right to read the documents, and no capability implies
another. The role editor enforces the same (`sales.reports.read` depends on `sales.read`, like four other capabilities); the
routes check both anyway, so a 403 `forbidden` answers a caller who holds one. The manager role holds the capability, the
agent role does not.

| Route | Answers |
| --- | --- |
| `summary` | `{currency, confirmed, quotations, cancelled}`, each `{orders, amount_untaxed, amount_total}`; `quotations` adds `draft` and `sent` |
| `breakdown?by=` | `{by, period, currency, items, total}` grouped by `period` (`period=day`, `week` or `month`, default `month`, oldest first), `salesperson`, `customer` or `product` (largest total first); `limit` and `offset` page the groups, `total` counts all of them. A group is `{key, label, orders, quantity, amount_untaxed, amount_total}`: `key` is the record id or the ISO day a period starts on, `null` for the orders nobody owns (the online ones) under `salesperson`; `quantity` is given for `product` only |
| `export` | A UTF-8 CSV with a byte-order mark: one row per product line group of an order, newest first, columns `number, date, state, source, customer, salesperson, product, quantity, unit_price, discount_percent, amount_untaxed, amount_total, currency` |

Filters, the same on all three: `date_from` and `date_to` (calendar days of the order date in the caller's time zone, both
included), `salesperson_id`, `customer_id`, `product_id` (the template the order lines show), `state` (wire states, comma
separated) and `source` (`staff` or `online`). A bad value is 422 `invalid` on its field. Without `state`, `breakdown` and
`export` count confirmed orders only (a cancelled order or a quotation never adds to a confirmed figure) and `summary` shows
every group, so a `state` filter zeroes the groups outside it.

- **Visibility.** Every read starts from `liwan.sales.visibility._liwan_domain`, the domain the lists use: the working
  company only (a branch session reads the branch, the root session the root, never another company), and under `own` the
  caller's documents and the unassigned ones unless they hold `sales.documents.assign`; under `all`, every document. The
  stock analysis has its own personal rule for the salesman group; `rule_sales_report_open_read` opens the whole company
  exactly where the order rule does, so the record rules constrain `sale.report` the same way on every ORM path and a test
  compares them with the list for each user and each setting. No `sudo()`.
- **Amounts.** The company currency of the working company; stock converts each order from its own currency at the rate
  recorded on the order. A line without a product (a section, and the line stock adds for a down payment, whose quantity
  is 0) is left out, so a down payment adds neither an amount nor a group to the product breakdown or a row to the export.
- **The source.** `sale.report` has no notion of it, so Sales adds `liwan_staff_document` through the hooks stock's own
  bridge modules extend (`_select_additional_fields`, `_group_by_sale`); nothing runs SQL outside the analysis query (R9).
- **Export.** The shared CSV helpers of `liwan_api` (`csv_bytes`, `safe_cell`, `refuse_oversized_export`): formula-safe
  cells, 422 `export_too_large` past 50,000 rows (`details: {rows, max_rows}`), counted before any row is loaded. The route is a read-only `GET`
  like the CRM and customer exports and keeps no log row, so a read-only tenant, branch or seat still exports.
- **The export is not a tenant export.** Sales has no dataset in the tenant data export yet, and the report export writes no audit row.

## Quotation templates

`/api/v1/sales/templates` serves stock `sale.order.template` (`sale_management`) through `liwan.sales.template`
(`models/template_service.py`): a name, `validity_days`, `terms` and lines (a product with a quantity, a section, a note).

| Route | Capability | Effect |
| --- | --- | --- |
| `GET /templates` (`q`, `archived`, `limit`, `offset`) | `sales.quotations.manage` or `sales.settings.manage` | `{items, total}` of the working company's active templates, by name; `archived=true` is the manager's (403 otherwise) |
| `GET /templates/{id}` | the same | The detail with terms and lines; an archived template is the manager's, 404 for anyone else |
| `POST /templates`, `PATCH /templates/{id}` | `sales.settings.manage` | Create and edit; `lines` replaces the whole list. An archived template is 403 `transition_forbidden` until restored |
| `POST /templates/{id}/archive`, `.../restore` | `sales.settings.manage` | Archive and restore (stock `active`); a repeat is 403 `transition_forbidden` |

- **Company.** A template belongs to the company it was made in (stock `company_id`) and serves that company's quotations
  only: the list, the detail and starting a quotation look at the working company, so a branch and the root each keep
  their own and another company's template is 404 (422 on `template_id`). Stock refuses a product of another company in a
  template, so the write refuses it first with 422 on `lines.<i>.product_id`. The settings stay tenant wide because they are
  one policy; templates are records of a company, as products and customers are.
- **No price.** A line holds a product, a quantity and a text. The wire and the write carry no price, tax or discount
  (a key of that kind is 422), and nothing reads stock's price fields of a template.
- **The one language of a template.** Terms and a line's text are translated stock fields, so the service reads and writes them
  in one language (`en_US`) whatever the language of the screen.
- **Picking products.** Building a template picks products, so `sales.settings.manage` joins the pick capabilities of
  `liwan.products.service` (`models/products_service.py`), with `sales.quotations.manage`. A settings-only role (no
  quotation right) therefore reads product names and prices through the product pick list. No narrower mode exists yet:
  the pick list is one shape (name, price, tax) behind one capability check, and a names-only variant would be a second
  shape and a second check for one role. Add it when a tenant needs a settings manager who must not see prices.
- **Line text.** A product line of a template keeps only text staff wrote. The default description of the product is neither
  stored nor passed on, so a quotation started from the template shows the product's current name in the quotation's language.
- **Stock routes.** The stock quotation-template routes and portal stay closed by the `ir.http` guard of `liwan_platform`
  (`/my/orders/...` is 404 for a session and for a visitor); a test pins it.

### Starting a quotation from a template

`POST /api/v1/sales/orders` takes `template_id` (create only: a PATCH with it is 422; with `lines` it is 422 too). The template
gives what the body leaves out: its lines, its terms (empty terms leave the settings' default terms) and its validity (0 days
leaves the settings' validity). `validity_date` and `terms` in the body win.

`liwan.sales.template._liwan_start` turns the template's lines into the entries of a hand-made quotation and the create path
(`_liwan_line_plan`) does the rest, so each product line gets the current price of the price function and the tax rule of a
hand-made line, as it would on the day the quotation is made. A line stock marks optional is left out (Sales has no optional
lines); a subsection is a section. The order keeps no link to the template: it never changes with it, and stock's
template-driven fields (`require_signature`, `require_payment`) are never read. A template line whose product is archived, of
another company or with several variants refuses the whole quotation with 422 `template_unusable` on `template_id`
(`details.product` names it) and nothing is created; a missing, archived or other company's template is 422 `invalid` on
`template_id`. The template shape tells in advance: `usable` on the template and on each line.

## Sector presets

A preset is a named bundle of values for settings that already exist. `GET /api/v1/sales/settings/presets`
(`sales.settings.manage`) answers `{items: [{key, values, matches}], total}`: `values` holds only the settings this tenant
carries, `matches` says the settings already hold all of them (derived on every read, nothing is stored). Applying one is the
ordinary `PATCH /api/v1/sales/settings` with those values and the revision the caller read, so the capability, the root-company
rule, the validation and the 409 are the settings write's; the page lists what would change first.

The catalog is one constant, `models/sales_presets.py`, with a comment per option naming the workflow behind it:
`services` (consulting, agencies), `trading` (shops, wholesale) and `contracting` (contracting and project work). It names no
customer and no customer type (R6), and never holds the default terms. A bridge adds the choices it owns through
`liwan.sales.settings._liwan_preset_extras` (`{preset: {key: value}}`), as it adds settings through `_liwan_wire_extras`:
payments set `payment_to_confirm`, CRM `opportunity_win` and `opportunity_win_amount`, finance `invoice_down_payment` and
`invoice_actor`. A key the tenant's settings do not carry (no bridge, or its application is not in the plan) is left out of
every preset.

## Online payment

A staff quotation can ask to be paid before it becomes an order, and the payment confirms it. Sales extends the shared service
`liwan_payments` (an application may depend on a shared service): it reuses the pay page, the gateway, the transaction and the
refund service, and adds the choice "pay to confirm", what the customer's page and the e-mail say about it and the
confirmation of the order once the payment arrives. It adds no model. One `sudo()`: the sum of the order's own
transactions, whose stock field Sales staff cannot read (`tools/arch_documented_sudo.json`).

### The choice

The choice of one quotation lives in stock's own fields: `require_payment` and `prepayment_percent` (a fraction). Wire
value `payment_to_confirm`: `off` (`require_payment` false), `full` (a percentage of 100) or `percent`, with
`prepayment_percent` as a whole number from 1 to 100. A percentage of 100 reads back as `full`.

The tenant's default is two fields added to `liwan.sales.settings`: `payment_to_confirm` (`off` by default) and
`prepayment_percent` (50), tenant scope, changed by `sales.settings.manage` through `PATCH /api/v1/sales/settings` (the
Sales settings parser and wire hooks, see `liwan_sales`). A new quotation takes the default once, through the Sales create
path (a duplicate included); the value kept on each quotation is what counts after that, so a change of the default applies
to new quotations only. The staff choose it per quotation in the body of `POST /api/v1/sales/orders` and of `PATCH` on a
draft (`payment_to_confirm`, `prepayment_percent`; 422 `invalid` on `prepayment_percent` unless the mode is `percent`).

Every route and field of the payment works in `saas` and `non_saas`. While the tenant cannot take payments
(`payments.enabled` not included, or the tenant read-only) the settings carry neither value, a quotation is created with
`require_payment` false whatever the default, a choice other than `off` is 403 `feature_not_included`, and the staff and
public shapes carry `payment: null`.

### What received means

A quotation asks to be paid only with `require_payment` and a required amount above zero (`_liwan_asks_payment`): a total
of zero, or a percentage that rounds to 0.00, asks for nothing everywhere (acceptance confirms per its snapshot, the customer
sees no payment, the staff shape reads `status` and `link` `none`).


One rule for the confirmation threshold, `held`, `amount_received`, `amount_due` and the customer's state: a staff quotation
received the sum of its own authorized and done payments, less their done refunds (`sale.order._liwan_received`). A
transaction shared with another order is not counted and stays stock's, which confirms no grouped payment either. What can
go back counts done payments only (`_liwan_net_received` of `liwan_payments`): an authorized payment is not captured yet and
is voided at the gateway, not refunded. Before it is confirmed a staff quotation keeps nothing, so everything done it
holds may go back (`amount_refundable`); a confirmed one keeps its total, as an online order does.

### Money due back

Any money a quotation holds once it is cancelled (declined included), expired or reopened to a draft is due back, whatever
its amount: `held` names the state, `amount_to_refund` equals `amount_refundable`, and each payment that arrives on such a
quotation gets one chatter note. Sending it again does not confirm it (see "Sending again").

### What each page says

- Staff `GET /api/v1/sales/orders/{id}`: `payment` = `{mode, percent, currency, amount_required, amount_received,
  amount_due, amount_to_refund, amount_refundable, can_refund, status, link, held, needs_attention, attention}`. `status` is the payer
  status or `cancelled`. `link` is `none` (nothing asked, paid, being paid or confirmed), `ready`, `no_gateway` (payable but
  no live gateway, the check the pay page makes), `awaiting_signature` or `unavailable`. `held` says why money that reached
  what the quotation asks did not confirm it: `expired`, `reopened`, `cancelled` (any amount held) or `awaiting_signature`.
  `attention` is `payment_not_recorded` (money received but not recorded for an hour), `payment_reversed` (confirmed, then a
  payment it counted was voided, so it holds less than it asked), `payment_awaits_confirmation` (sent again without an
  answer mode, it holds what it asks and waits for a staff confirm) or null; `needs_attention` is true exactly when it is set.
  `amount_to_refund` is what must go back (all the money of an expired, reopened or cancelled quotation that holds what it
  asks, or what a confirmed order received beyond its total); `amount_refundable` is the most one refund may record now;
  `can_refund` is true when the reader may change the quotation in Sales, holds `payments.refund` in its company, the
  tenant can take payments and something may go back. An order the staff confirmed without the payment shows `link`
  `none` and `amount_due` 0.
- Customer `GET /api/v1/public/sales/quotations/{id}`: `payment` = `{percent, amount, currency, pay_url, state}` or null
  (nothing asked, the tenant cannot take payments, or the staff confirmed the order without the payment). `state` is
  `payable`, `awaiting_signature`, `processing`, `paid` (confirmed with what it asks), `received` (what it asks arrived and
  the seller has not confirmed the order yet: a customer who paid never reads `unavailable`) or `unavailable`; `pay_url` is
  the pay page's path with the quotation's own access token (`/pay/order/<id>?access_token=...`) only while `payable`, which
  needs a live gateway.
- The pay routes of `liwan_payments` open a staff quotation only while its own customer page opens (sent, confirmed or
  cancelled, and not reopened since): a draft, a reopened quotation and an old token after a reopen get the same 404 as
  Sales. Confirmed and cancelled ones stay readable so the pay page can show that it is paid or no longer payable.
- The send e-mail adds the amount and, when nothing else is needed and a gateway is live, the pay link; a customer who must
  sign first is told to.

### Signature, acceptance and payment

A staff quotation is payable only while it is `sent` and, when the tenant asked for a signature (`accept_and_sign`), signed.
The check is on the server (`sale.order._liwan_pay_state`), so the pay routes answer 409 `not_payable` to a customer who has
not signed. A quotation that asks to be paid is confirmed by its payment and never by the acceptance alone, whatever the
`acceptance_confirms` setting and whether the tenant can take payments now (`_liwan_acceptance_confirms`): the acceptance is recorded, the order stays `sent`, and the
payment confirms it; a customer who paid first and signs later confirms it by signing. With `accept` the payment is the
acceptance and is recorded as one; with `none` the payment alone confirms. Staff holding `sales.orders.confirm` may still
confirm an unpaid quotation by hand.

### Confirmation by payment

`payment.transaction._check_amount_and_confirm_order` sends a staff quotation to `sale.order._liwan_confirm_by_payment`,
which locks the order row and reads it again, then confirms through `liwan.sales.service._liwan_move` in the order's
company (the path staff confirm uses) only from `sent`, not expired, signed when a signature is asked, with what the
quotation asks received. The customer then gets the Sales confirmation e-mail once
(`liwan.sales.document._liwan_queue_confirmation_mail`): the tenant's outbound sender, the quotation's own `/quote/<id>`
link and no Odoo portal link, built like the send e-mail. Without a sender the order is still confirmed and a chatter note
says no e-mail went. A repeated callback finds the order confirmed and sends nothing. A row another transaction holds
raises `LockError` on the payment callback (stock retries it) and answers 409 `conflict` on the customer's acceptance.
Every other order, online orders and transactions shared by several orders included, is stock's.

A payment for a quotation that cannot be confirmed now (expired, reopened to a draft, or cancelled) is never refused and
never confirms the order, as `liwan_payments` does for its own late payments: the transaction stays recorded on the order,
one chatter note per transaction says why, and the staff record shows `held` and `amount_to_refund`. The staff send the
quotation again (below) or give the money back.

### Sending again

A send never confirms by itself: confirming needs `sales.orders.confirm`, and the reopened quotation may carry new terms the
money was not paid against. The send clears the answer as Sales does; the money already received stays recorded and is never
taken as an acceptance, and the customer's page reads `received` (or `payable` for a difference). Then:

- `accept` or `accept_and_sign`: the customer's new acceptance, or signature, confirms it through the payment path, with one
  confirmation e-mail, since the amount is reached.
- `none`: nobody answers, so staff with `sales.orders.confirm` confirm it; until then the staff shape reads `attention`
  `payment_awaits_confirmation` (`needs_attention` true).
- A payment that arrives on the sent, unexpired quotation still confirms it, as any payment does.

A draft that holds money keeps its customer (422 `invalid` on `customer_id`: the money belongs to the payer). Its lines and
percentage stay editable: priced higher, it is payable again for the difference after the send; priced lower, the surplus is
due back once it is confirmed (`amount_to_refund`).

### Refunds

`POST /api/v1/sales/orders/{id}/refunds` with `{amount, reference}` (the gateway's refund reference, the body of the
payments refund route) records a refund the tenant already made in its gateway dashboard. It needs `sales.enabled` and
`payments.enabled` (write), `sales.read` and `payments.refund`; Sales decides who reaches the document (404 unreadable, 403
`forbidden` for another salesperson's quotation or an online order, whose refunds stay on the payments orders list) and the
payments service (`liwan.payments.service._liwan_record_refund`) checks the capability in the order's company and the amount
(422 `invalid` on `amount` beyond `amount_refundable`, 409 `conflict` while a payment is still being recorded or for an exact
replay). The answer is the staff order.

## Later pull requests

The reports and the export are above, and the payment links are in "Online payment". The invoices and down payments (PR 4) and the CRM link (PR 5) are the bridges `liwan_sales_finance` and `liwan_sales_crm`.
