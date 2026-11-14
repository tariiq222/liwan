# liwan_orders

Shared service (rank 3) over `liwan_api` and stock `sale`. It installs itself wherever both are installed, so no
application or bridge names it to get its rule.

## What it owns

One rule: an order line of an establishment that is not registered for VAT carries no tax.
`res.company._liwan_vat_registered()` gives the answer for the line's own company (a branch answers from its root).
The addon has no model, route, capability, setting or feature key, and no elevated call.

## Where the rule sits

`sale.order.line._compute_tax_ids` is overridden: stock computes first, then the lines of unregistered
establishments are cleared. The rule therefore applies to every line, whoever made it (an online channel or a member
of staff), at creation and when the product or company is edited. The override declares no `@api.depends`.

## When the registration changes

Nothing is recomputed. A line keeps the tax it was issued with. A line whose product or company is edited after the
change follows the new answer. A dependency on the registration field is refused on purpose: it would recompute
confirmed and invoiced orders.

## Writing a tax by hand

`tax_ids` stays writable, as in stock, and the compute does not see a direct write. No LiwanOS route accepts a tax
for an order line. No constraint is added, because it would refuse the legitimate rewrite of a line issued while
the establishment was registered.

## Odoo upgrade cost

One stock method name, `_compute_tax_ids`. If Odoo renames it, this addon's tests fail; the rule is not lost
silently.

## The order factory

The online order factory stays in `liwan_payments` until the store starts. It creates lines through the ORM and
relies on this rule.
