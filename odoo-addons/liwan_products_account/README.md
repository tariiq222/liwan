# liwan_products_account

A product's sale taxes and the tax part of the products price function (plan D6, D12, D21, D24). A rank-5 bridge of
the D19 kind: `liwan_products` and stock `account`, `auto_install` on both.

## The `taxes` field (D21)

Contributed through `product.template._liwan_product_extension_specs()` under the wire name `taxes`:

- Shown on `Product` as `taxes: [{id, name, amount}]` (the product's taxes that apply in the session's company, stock
  `_filter_taxes_by_company`) and accepted on create and edit as a non-empty list of tax ids, only for an
  establishment registered for VAT (`res.company._liwan_vat_registered()`). Otherwise the field is absent and a write
  of it is 422 `invalid` on `taxes`.
- A change needs `products.manage` and follows D23, like any other field.
- The ids must be among the choices: the sale taxes of the product's company (the root for a shared product) and of
  its ancestors: the active ones and the inactive ones a chart loaded (an accountant's archived tax is never offered
  or re-activated), less the Saudi chart's private education and healthcare 0% taxes, which need a
  Saudi-national buyer. Else 422 `invalid` on `taxes`. More than one tax is accepted; their amounts combine.
- "No tax" on a registered establishment is a zero-rated or exempt tax picked from the choices; picking an inactive
  chart tax activates it. A ZATCA invoice line needs a tax (`l10n_sa_edi` `account_edi_format.py:403-404`).
- A new product takes the establishment's default sale tax (the company's `account_sale_tax_id`, else its root's, as
  stock does), also while the establishment is not registered, so that registering later needs no change; the price
  ignores it until then. Its purchase taxes stay empty: vendor bills wait for purchasing (D20).

`GET /api/v1/products/taxes` (`products.manage`, D23 on the session's new-product company): `{items: [{id, name,
amount, active}], total}`, the choices for a new product of this session; empty for an unregistered establishment.

## The tax part of the price (D6)

`liwan.products.service._liwan_price_amounts` computes, for a registered establishment, the stock tax computation
(`account.tax.compute_all`) on the product's taxes that stock would put on a sale line of the company
(`_filter_taxes_by_company`), mapped through the fiscal position stock picks for the customer
(`account.fiscal.position._get_fiscal_position`). When the mapping drops a price-included tax, the price loses it
first, as a stock line does (`account.tax._fix_tax_included_price_company`): 115 with 15% included, for a customer
mapped to export 0%, is 100 / 0 / 100. Each tax follows stock's price mode of the company that owns it
(`account_price_include`, the establishment's one choice, managed by `liwan_api_account`); there is no LiwanOS copy of
it. For an establishment that is not registered there is no tax, whatever taxes the product still carries.

## The one elevated case (D24)

The company fence hides the root's taxes from a branch session: an unelevated read of a shared product's taxes there
returns none, and stock refuses a branch session's write of taxes it cannot read (`fields_relational.py:1503`), which
is also why the create blanks both stock tax defaults first. `models/elevated.py` returns the superuser environment in
which the choices, the default, the stored taxes, the dumped taxes and the amounts are read or written, always after
the service's capability and company checks. Only tax ids, names, rates, active flags and computed amounts leave it, as plain values: the choices are dicts,
the stored value between parse and write is a tuple of ids, and the product returned to the service stays in the
caller's environment.

`_liwan_adopt` is extended: an adopted product whose sale taxes are not valid establishment sale taxes (or has none)
gets the establishment default, and its purchase taxes are cleared. The case is
documented in `tools/arch_documented_sudo.json`.
