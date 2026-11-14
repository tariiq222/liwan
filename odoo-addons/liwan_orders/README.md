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

A copied line computes its taxes anew. Stock copies `tax_ids` as an explicit value, which would skip the compute, so
`copy_data` drops it: a duplicated order follows the establishment's answer at the time of the copy. A `tax_ids`
passed in the copy's defaults is kept.

Two kinds of line are outside the compute by stock design and follow the order's existing lines: down payment lines
(`sale.order._prepare_down_payment_line_values_from_base_line`, `sale_order.py:2100`) and discount lines
(`sale/wizard/sale_order_discount.py`). This is consistent with a document keeping what it was issued with.

## When the registration changes

Nothing is recomputed. A line keeps the tax it was issued with. A line whose product or company is edited after the
change follows the new answer. A dependency on the registration field is refused on purpose: it would recompute
confirmed and invoiced orders.

## Writing a tax by hand

`tax_ids` stays writable, as in stock, and the compute does not see a direct write. No LiwanOS route accepts a tax
for an order line. No constraint is added, because it would refuse the legitimate rewrite of a line issued while
the establishment was registered.

## Odoo upgrade cost

Two names: the stock compute `_compute_tax_ids` and the public ORM method `copy_data`. If Odoo renames the compute,
this addon's tests fail; the rule is not lost silently.

## Installing on an existing database

Odoo installs an `auto_install` module only when one of its trigger dependencies is being installed in the same
operation (`odoo/addons/base/models/ir_module.py:418-422`). A database that already has `liwan_api` and `sale`
therefore gets this addon only when `-i` names it. The release module list does (`deploy/ci/upgrade.sh` passes it to
both `-u` and `-i`). An upgrade with `-u` alone leaves it out, and then nothing clears the tax of an unregistered
establishment.

## The order factory

The online order factory stays in `liwan_payments` until the store starts. It creates lines through the ORM and
relies on this rule.
