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

Sales names no other application. A bridge adds its own values through hooks that return nothing in Sales itself:
`liwan.sales.settings._liwan_patch_parsers` and `_liwan_wire_extras` (keys of the settings write and read),
`liwan.sales.service._liwan_order_parsers` and `_liwan_write_extras` (keys of an order write, applied after the lines are
saved, with the tenant's defaults on create), `sale.order._liwan_staff_extras` and `_liwan_public_extras` (keys of the
staff and the customer's wire shapes) and `liwan.sales.document._liwan_mail_notes` (notes in the quotation e-mail) and `liwan.sales.settings._liwan_preset_extras` (the bridge's
choices in each sector preset). The
payments bridge `liwan_sales_payments` was the first user; the CRM bridge `liwan_sales_crm` uses the settings and the staff-shape hooks and
extends `liwan.sales.service._liwan_move`, the one path a staff move, the customer's confirming acceptance and a payment's
confirmation share. The finance bridge `liwan_sales_finance` uses the settings and the staff-shape hooks and extends
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
passed. It is documented in `tools/arch_documented_sudo.json`, like the other two elevated calls of the addon:
`liwan.sales.answer._liwan_open` (the anonymous customer reads and answers through one record found by access token) and
`liwan.sales.document._liwan_queue_mail` (creating a `mail.mail` row needs `base.group_system`).

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

## Later pull requests

The reports and the export are above. The invoices and down payments (PR 4), the CRM link and the payment links (PR 5) are the bridges `liwan_sales_finance`, `liwan_sales_crm` and `liwan_sales_payments`.
