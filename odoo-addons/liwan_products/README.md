# liwan_products

The one writer of a product's definition on stock `product.template` (plan
`docs/superpowers/plans/2026-11-13-liwan-products.md`, PR 2). A rank-3 shared service: it names no application.
Applications pick products, price them and create or edit them only through `liwan.products.service`.

## Capabilities

| Key | Requires | Grants |
| --- | --- | --- |
| `products.read` | | the list, the detail, the settings read, the pick list, the price function |
| `products.manage` | `products.read` | create, edit (every field but the price), archive, restore, a product's taxes |
| `products.prices.manage` | `products.read` | `list_price`, on create and on edit; alone it changes the price and nothing else |
| `products.settings.manage` | | the product settings, in the working company and in the root company |

All four are granted to `liwan_core.role_system_admin`. Each has its capability group. `products.manage` and
`products.prices.manage` imply the technical group `group_products_writer`: read, write and create (no unlink) on
`product.template` and `product.product`, with two group rules for write, create and unlink only:
`liwan_product = True` and `product_tmpl_id.liwan_product = True`. Read is left unruled on purpose, so a writer still
reads the products stock modules make (a down payment on an order line). Because Odoo ORs only the group rules of the
groups a user is in, a user who also holds a stock product right with no rule (for example
`product.group_product_manager`) is narrowed by these rules too.

## A service product

`product.template.liwan_product` (stored, indexed, `copy=False`) marks a product created or adopted through the
service. Every list, pick and write of the service filters on it; products stock modules create never carry it.

Every write method checks the capability and D23 from the keys of `values` before it reads or parses any value,
so a refused caller gets 403, never a 422 about a value. `_liwan_update`, `_liwan_archive` and `_liwan_restore` take
one product. A service product (template or variant) is never deleted except by the superuser; it is archived.

The single-writer guard: for everyone but the superuser, a create with `liwan_product`, and a write that touches a
definition field of a service product (`name`, `type`, `list_price`, `description_sale`, `image_1920`, `active`,
`company_id`, `liwan_product` and every contributed field), is refused with
`AccessError('use_liwan_products_service:<model>_<operation>:<fields>')` unless the service marked it. The same holds on
`product.product`: a variant of a service product is created only while the service creates or writes its template,
and a variant write of `active`, `product_tmpl_id`, `lst_price`, `image_variant_1920` or a definition field is
refused outside the service.

Not single-writer (other code may write them on a service product, after `_liwan_require_write` where a consumer
owns the decision): `supplier_taxes_id`, `uom_id`, `sale_ok`, `standard_price`, payments' refund fields and the OCA
`resource_booking_type_id` link. Do not assume the service guards them.

## Registration hooks (extend through `super()`)

- `liwan.products.service._liwan_products_feature_keys()`: the feature keys that open `/api/v1/products`. The routes
  are open while any of them is readable (`requires_registered_feature`, 403 `feature_not_included` otherwise).
- `liwan.products.service._liwan_products_pick_capabilities()`: capabilities that may browse and pick a product
  (the pick list, picking by id) inside an application's own action; they also price.
- `liwan.products.service._liwan_products_price_capabilities()`: capabilities that may only price a product inside the
  application's own record (a package of the company, a catalog item). They cannot browse or pick: the pick list and
  `GET /api/v1/products/pick` stay closed to them. The base returns none.
- `product.template._liwan_product_extension_specs()`: fields a contributing addon adds to the definition. Each spec
  is a dict `{name, field, applies(env), parse(env, value, company), default(env, company), blank, write(product,
  stored), dump(product)}` (see the method's docstring). The base returns none; `liwan_products_account` adds
  `taxes`.

`products.enabled` is a derived session key (never registered): `/me` reports it, readable and writable alike, while
a registered key is.

## Service methods (`liwan.products.service`)

Every method runs as the caller. Errors are `LiwanAccessRule(code, message, field=, status=, details=)`, which
`api_handler` answers with that status. The write methods check the capabilities and D23 themselves, so an
application that calls them from its own route cannot skip the checks.

| Method | Checks | Returns / errors |
| --- | --- | --- |
| `_liwan_can_pick()` | | `products.read` or a registered pick capability in the current company |
| `_liwan_require_pick()` | | 403 `forbidden` unless `_liwan_can_pick()` |
| `_liwan_can_price()` | | `_liwan_can_pick()`, or a registered price capability in the current company |
| `_liwan_require_price()` | | 403 `forbidden` unless `_liwan_can_price()` |
| `_liwan_product(product_id, include_archived=False)` | record rules and the company fence | the `product.template`, or 404 `not_found` |
| `_liwan_search(query=None, archived=False, type=None, limit=50, offset=0)` | record rules and the fence | `(products, total)` by name; `type` is `goods` or `service`, else 422 `invalid` on `type` |
| `_liwan_pick_search(query=None, limit=50, offset=0)` | `_liwan_require_pick()` | `(products, total)` of the active products |
| `_liwan_pick_product(product_id)` | `_liwan_require_pick()` | the active service product, or 404 `not_found` |
| `_liwan_require_write(company, values)` | | 403 unless the caller may write those keys on a product owned by `company` (D23 and the capabilities); public: a consumer calls it before writing its own link field on a service product |
| `_liwan_create(values)` | `products.manage`; `products.prices.manage` when `list_price` is given; D23 on the new product's company | the new `product.template` |
| `_liwan_update(product, values)` | `products.prices.manage` for `list_price`, `products.manage` for any other key; D23 | `product` |
| `_liwan_archive(product)`, `_liwan_restore(product)` | `products.manage`; D23 | `product` |
| `_liwan_price(product, quantity=1.0, uom=None, company=None, customer=None, date=None)` | `_liwan_require_price()` and `company` in the session's companies, unless the environment is elevated; `quantity` a number above zero (422) | see below |
| `_liwan_price_amounts(variant, unit_price, quantity, company, customer)` | | `(untaxed, tax, total)`; the base has no tax; the tax bridge overrides it |
| `_liwan_adopt(products)` | any `env.su` caller, for consumers' migrations (`AccessError('use_liwan_products_migration: ...')` otherwise) | the templates, marked and with their company cleared (D17); with the tax bridge, sale taxes that are not the establishment's valid sale taxes (or none) become its default, and purchase taxes are cleared |

`values` keys: `name` (text, 1-200 characters, required on create), `type` (`goods` = stock `consu`, `service`;
required on create; `combo` is not offered, D10), `list_price` (a number, zero or more; 0 on a create without it),
`description` (text up to 4000 characters, or null), plus each contributed field that applies (`taxes` with the tax
bridge). Any other key is 422 `invalid` with `field` set to it.

D23: a product with no company (shared) is created, edited, priced, archived and restored only in a root-company
session (`liwan.tenant.profile.root_company_id`) by a holder of the capability there; a product with a company only in
a session of that company by a holder there. Otherwise 403 `forbidden` with `details.reason`
`managed_in_root_company` or `managed_in_branch`. A product the session cannot see answers 404 first.

D7: a new product has no company under the `establishment` sharing, and the working company under `branch`.

The price function returns, in the company's currency, `{unit_price, amount_untaxed, amount_tax, amount_total,
currency}`. `unit_price` is the price as typed on the product, from stock `product.pricelist._get_product_price` on an
empty pricelist (equal to `list_price` for a product with no variant extra: `test_products_price`). The amounts are for
`quantity`; `unit_price` is rounded to the currency, the amounts come from the unrounded unit price. A
`product.template` is priced through its single variant (an archived one too). Without the tax bridge
there is no tax: `amount_tax` is 0 and the total equals the untaxed amount.

An elevated caller (a cron, a public booking or catalog page) is not checked: it must pass `company` explicitly,
because its session company is not the customer's. A non-elevated caller may name only a company of its session.

## Routes

All are `type='json2'`, `auth='user'`, behind `api_handler` and the registered-feature gate.

| Route | Capability | Request | Response |
| --- | --- | --- | --- |
| `GET /api/v1/products` | `products.read` | `q`, `archived` (`true`/`false`), `type`, `limit`, `offset` | `{items: [Product], total}` |
| `GET /api/v1/products/<id>` | `products.read` | | `Product` (archived ones too) |
| `POST /api/v1/products` | `products.manage` (+ the service checks) | `values` | 201 `Product` |
| `PATCH /api/v1/products/<id>` | `products.manage` or `products.prices.manage` (+ the service checks) | `values` (any subset) | `Product` |
| `POST /api/v1/products/<id>/archive`, `/restore` | `products.manage` (+ D23) | | `Product` |
| `GET /api/v1/products/pick` | `products.read` or a registered pick capability (a price capability does not open it) | `q`, `limit`, `offset` | `{items: [Pick], total}` |
| `GET /api/v1/products/settings` | `products.read` or `products.settings.manage` | | `Settings` |
| `PATCH /api/v1/products/settings` | `products.settings.manage` in the working and the root company | `{sharing, revision}` | `Settings` |

- `Product`: `{id, name, type, description, list_price, price: Price, company: {id, name} | null, active}` plus each
  contributed field that applies (`taxes: [{id, name, amount}]` with the tax bridge on a VAT-registered establishment).
- `Price`: `{unit_price, amount_untaxed, amount_tax, amount_total, currency: {id, name, symbol}}`, for one unit in the
  session's company. Every price leaves the API as the unit price as typed plus before tax, tax and total.
- `Pick`: `{id, name, type, unit_price, amount_untaxed, amount_tax, amount_total, currency}`.
- `Settings`: `{sharing: 'establishment' | 'branch', can_manage, revision}`.

Settings errors: 403 `forbidden` outside the root's managers; 409 `conflict` on a stale `revision`; 409
`sharing_transfer_required` (`field: sharing`) while any service product exists, archived ones and every branch's
included (an elevated boolean read, documented in `tools/arch_documented_sudo.json`); 422 `invalid` /
`unknown_field` on a bad body.
