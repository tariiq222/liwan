# liwan_orders

Shared service (rank 3) over `liwan_api` and stock `sale`. It installs itself wherever both are installed, so no
application or bridge names it to get its rule.

## What it owns

One rule: an order line of an establishment that is not registered for VAT carries no tax.
`res.company._liwan_vat_registered()` gives the answer for the line's own company (a branch answers from its root).
The addon has no model, route, capability, setting or feature key, and no elevated call.

## Where the rule sits

`sale.order.line._compute_tax_ids` is overridden: stock computes first, then the lines of unregistered
establishments are cleared. The rule applies when a line is created without explicit taxes, when its product or
company is edited, when the order's taxes are recomputed, and when a line of an unregistered establishment is copied.
The override declares no `@api.depends`.

A copied line of an unregistered establishment computes its taxes anew, so it carries none. Stock copies `tax_ids` as
an explicit value, which would skip the compute, so `copy_data` drops it for such a line, also when the copy goes into
an order of another company. A `tax_ids` passed in the copy's defaults is kept. In a registered establishment the copy
is stock's copy, taxes included: a hand-set tax and a global discount line carry taxes the compute cannot reproduce.

Open limit: an untaxed line issued before the establishment registered is copied untaxed by stock. No LiwanOS route
copies an order today; the route that will (sales PR 2) must recompute the taxes of the copy.

Down payment lines (`sale.order._prepare_down_payment_line_values_from_base_line`, `sale_order.py:2100`) and discount
lines (`sale/wizard/sale_order_discount.py:94`) are created by stock with the taxes of the order's existing lines, so
they follow the order. This is consistent with a document keeping what it was issued with.

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
therefore gets this addon only when `-i` names it. `deploy/ci/upgrade.sh` passes the release module list to both
`-u` and `-i`, and that list is the install closure computed by `tools/catalog_check.py --release-modules`, which
holds this addon. An upgrade with `-u` alone leaves it out, and then nothing clears the tax of an unregistered
establishment.

## The order factory

The online order factory stays in `liwan_payments` until the store starts. It creates lines through the ORM and
relies on this rule.
