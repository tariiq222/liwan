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
  Saudi-national buyer. Else 422 `invalid` on `taxes`. More than one tax is accepted; their amounts combine. The taxes must all belong to one
  company (the product's own or the root's): stock puts on a sale the taxes of the first level that owns one, so a
  mixed list is 422 on `taxes` instead of being stored whole and priced with one level. The choices route still lists
  both levels, since a branch may pick either.
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
(`account.fiscal.position._get_fiscal_position`). The unit price follows the mapping the way a stock sale line does
(`product.product._get_tax_included_unit_price_from_price`, ending in `account.tax._adapt_price_unit_to_another_taxes`,
on the taxes of every owning company): when every product tax is price-included, the price loses the tax the mapping
drops and takes the one it adds (115 with 15% included, for a customer mapped to export 0%, is 100 / 0 / 100; mapped to
5% included, 100 / 5 / 105); with any added tax the price is left as typed. Each tax follows stock's price mode of the company that owns it
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

`_liwan_adopt` is extended: an adopted product keeps the sale taxes that are valid establishment sale taxes (a dormant
chart tax among them is activated, as picking it does); the establishment default takes over only when none is valid
or the product has none, and with no default either the product is left untaxed and a warning in the log names it.
An adopted product is shared, so its taxes are the root's and the one-company rule holds. Its purchase taxes are cleared. The case is
documented in `tools/arch_documented_sudo.json`.
