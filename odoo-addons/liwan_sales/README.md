# liwan_sales

The Sales application (rank 4): staff quotations and orders on stock `sale.order`, under `/api/v1/sales`.
Plan: `docs/superpowers/plans/2026-11-14-liwan-sales.md`. Design: `docs/superpowers/specs/2026-11-14-liwan-sales-design.md`.

## What it owns

- The capabilities, capability groups, the two built-in roles and the read rules of Sales.
- `liwan.sales.settings`, one record per tenant.
- `liwan.sales.visibility` (who reads and writes which document) and `liwan.sales.service` (the write side).
- `sale.order.liwan_staff_document`: set on create by the service. The wire `source` is `staff` when it is set and
  `online` otherwise. Every write route refuses a document without it.
- The send state of a quotation on `sale.order`: `liwan_answer_mode` and `liwan_acceptance_confirms` (the two settings
  copied at send, empty before the first send), `liwan_answer` (`accepted` or `declined`), `liwan_answered_on` and
  `liwan_decline_reason`. The signature is stock's `require_signature`, `signature`, `signed_by` and `signed_on`.
  Expiry is stock's computed `is_expired`; nothing stores it and no cron runs.
- `liwan.sales.document` (the PDF and the e-mail) and `liwan.sales.answer` (the customer's side, by access token).

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
| `sales.settings.manage` | | yes |

## Settings

`visibility` (`own` or `all`), `validity_days` (30; 0 gives no validity date), `discount_limit_percent` (0, no limit),
`default_terms`, `customer_answer` (`none`, `accept` or `accept_and_sign`; default `accept`), `acceptance_confirms`
(default false), `revision`. Changed only in the root company by a holder of `sales.settings.manage`.

`customer_answer` and `acceptance_confirms` apply to quotations sent after the change: each send copies them onto the
order, so a sent quotation keeps the terms it was sent under until it is sent again.

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
| `draft`, `sent` | send (not expired, a customer e-mail and a product line) | `sent` | `sales.quotations.manage` |
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
is a resend). 422 `customer_email_missing` when the customer has no e-mail, `quotation_expired`, and `invalid` on
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
| `GET ?access_token=` | The public shape: figures, lines, `answer_mode`, `answer`, `can_accept`, `can_decline`; no salesperson, contact data or partner ids |
| `POST /accept` `{access_token, signed_by?, signature?}` | Records `accepted`; with `acceptance_confirms` it confirms the order through the staff confirm path and sends no stock mail. 422 `answer_not_allowed` (mode `none`), `already_answered`, `quotation_expired`, and for `accept_and_sign` `signature_required` or `signature_invalid` (a base64 PNG of at most 48 KB, no `data:` prefix); in mode `accept` the signature fields are unknown |
| `POST /decline` `{access_token, reason?}` | Records `declined` with the reason (at most 1000 characters) and cancels the quotation; allowed while sent and unanswered, expired or not |
| `GET /pdf?access_token=` | The same report; it prints the signature once the quotation is signed |

The two POSTs go through the ORM as the public user, so a read-only tenant or branch refuses them like any write.

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

## Later pull requests

Invoices and down payments (PR 4), the CRM link and payment links (PR 5), templates and reports (PR 6).
