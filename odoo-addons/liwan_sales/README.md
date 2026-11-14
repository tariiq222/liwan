# liwan_sales

The Sales application (rank 4): staff quotations and orders on stock `sale.order`, under `/api/v1/sales`.
Plan: `docs/superpowers/plans/2026-11-14-liwan-sales.md`. Design: `docs/superpowers/specs/2026-11-14-liwan-sales-design.md`.

## What it owns

- The capabilities, capability groups, the two built-in roles and the read rules of Sales.
- `liwan.sales.settings`, one record per tenant.
- `liwan.sales.visibility` (who reads and writes which document) and `liwan.sales.service` (the write side).
- `sale.order.liwan_staff_document`: set on create by the service. The wire `source` is `staff` when it is set and
  `online` otherwise. Every write route refuses a document without it.

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
`default_terms`, `revision`. Changed only in the root company by a holder of `sales.settings.manage`.

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
| `draft` | confirm (needs a product line) | `confirmed` | `sales.orders.confirm` |
| `draft` | cancel | `cancelled` | `sales.quotations.manage` |
| `confirmed`, not locked | cancel | `cancelled` | `sales.orders.confirm` |
| `cancelled` | reopen | `draft` | `sales.orders.confirm` |
| `confirmed` | lock, unlock | `confirmed` | `sales.orders.confirm` |
| any readable | duplicate | new `draft` | `sales.quotations.manage` |
| any | assign | same | `sales.documents.assign` |

Stock `sent` is a quotation state that no route of Sales produces yet: a `sent` staff document confirms and cancels
as a `draft` does, and only a `draft` is edited.

A move outside the table is 403 `transition_forbidden`; a document the caller cannot read is 404; a document that is
not theirs to write is 403 `forbidden`. No transition sends an e-mail.

## Price and tax of a line

The wire carries neither a price nor a tax. When a line is created or its product changes, its unit price is
`liwan.products.service._liwan_price(...)['unit_price']` for the product, quantity, company and customer. Every write
of a product line also writes the stored `price_unit`, because stock reprices from the list price on a quantity change
otherwise. Taxes come from the stock compute with the `liwan_orders` rule (none while the establishment is not
registered for VAT). Duplicate builds a new quotation through the same create path, so prices and taxes are fresh.
A new `customer_id` on PATCH keeps the unit price of every kept line (D6) and only recomputes the taxes.

Duplicate skips a product line of quantity zero (a removed line), checks every other copied quantity and discount
against the bounds of a write (`models/sale_order.py`, shared with the parser), and refuses a combo line (a combo
product or a combo item) with 422 on its `product_id`.

A line names a product template and takes its one variant: a template with more than one variant is refused with 422
on `lines.<i>.product_id` in create, edit and duplicate until products with variants arrive.

## Elevated line write

A branch session cannot write `sale.order.line.tax_ids`: the branch fence hides the root's `account.tax`. The order
header is written as the caller; the lines are created, written, deleted and re-taxed in one helper,
`liwan.sales.service._liwan_write_lines`, elevated with the order's company, after every check of the service has
passed. It is the addon's only `sudo()`, documented in `tools/arch_documented_sudo.json`.

## Later pull requests

Sending a quotation and the customer's answer (PR 3), invoices and down payments (PR 4), the CRM link and payment
links (PR 5), templates and reports (PR 6).
