# `liwan_products` implementation plan

> Step 2 of [the customers and products foundation design](../specs/2026-11-11-customers-and-products-foundation-design.md), which the owner approved on 2026-11-11 and 2026-11-12 and named on 2026-11-13. Status: the owner decided the six owner points of section 4 on 2026-11-13 and added two decisions: one tax mode for every application, in the company settings, and finance invoice lines that carry a product. Later the same day the owner settled how that tax mode works (D5, D6, D21, D22): stock Odoo's own company setting with its lock, a three-way choice, a default tax per product that can be changed, and excise left for later. Nothing in it is built. The facts in section 3 were read on `main` at `5f91e53f9` and in the Odoo 19 and OCA sources by one read-only pass of one session. No independent reviewer has read the plan against the code. One probe was run, on a throwaway database with stock `sale` and `l10n_sa` only, for the tax facts of section 3; no LiwanOS test was run. The work changes schema and authorization across layers, so every pull request takes the full path: an implementer per layer, a tester, and a reviewer separate from both.

## 1. Goal

One addon, `liwan_products`, is the only writer of a product's definition on `product.template`. CRM, customer messages and appointments stop creating and editing products on their own, a product defined once is offered by every application that sells it, every price a screen shows comes from one function, and a tenant shapes the service from its own settings.

## 2. Scope

In: one tax mode on the company for every application, the service with its settings and price function, the tax bridge `liwan_products_account`, the three writers moved onto it, the "Products and services" screen with categories, tenant-defined fields and variants, the transfer between the two sharing modes, the move of the Meta catalog out of the payments bridge, and a product on finance invoice lines.

Out, by the spec: orders (`liwan_orders`, with the store), pricelists, combo components, inventory and availability from stock, sector presets, and a group of legal companies in one tenant. Booking offers (one service offered several times, decision 15 of the spec) need their own appointments plan; this plan only moves the existing one-type-one-product link onto the service. The appointments screens that set a type's price are built later, with that plan.

`liwan_customers` is on `main` and is the template for the addon's shape: capabilities, groups, tenant settings, feature gate and tests.

## 3. Facts the plan rests on

Each task rechecks the facts it uses. "Read" means the code was opened; "inferred" means the first test of the task must confirm it.

Writers of a product today (read):

- CRM creates, edits and archives "packages" as `product.template` rows under `crm.settings.manage` (`liwan_crm/controllers/lists.py:303-341`). A new package is stamped with the current company, marked `liwan_crm_package` (`models/product_template.py:8`), and has its sale and purchase taxes cleared (`lists.py:317-322`). The right is an ACL row with read, write and create on every product for the settings manager (`security/ir.model.access.csv:10-11`). Three places read the marker: the list domain (`lists.py:80-84`), the sale route (`controllers/sale.py:23-27`) and the import (`models/intake.py:212-217`). A lead stores the package as a `product.template` and copies its `list_price` when it is set or won (`models/crm_lead.py:17-21`, `models/crm_lead_flow.py:68-76`); the discount is computed from that copy. CRM settings are one row per company (`models/crm_settings.py:140-144,203`).
- Customer messages creates a product from the catalog editor as goods, in the catalog's company, marked `liwan_inbox_catalog` (`liwan_inbox_payments/controllers/catalog_items.py:67-73`), and edits name, description and price of those only (`:166-170`). Its right is the same kind of ACL row for `inbox.catalog.manage` (`security/ir.model.access.csv:11-12`). It also lists every saleable product of the company to pick from (`:121-143`). A write override on `product.template` and `product.product` resyncs the Meta items when a watched field changes (`models/product.py:5-35`); it is a reader of changes, not a writer.
- Appointments creates one service product per paying booking type and writes its price and name under `sudo()`, after its own capability check (`liwan_appointments_payments/models/resource_booking_type.py`, `_liwan_price_product` and the name sync in `write`; `tools/arch_documented_sudo.json:21`). The link is the OCA column `product.template.resource_booking_type_id` (`oca-19.0/sale-workflow/sale_resource_booking/models/product_template.py:10`) with a LiwanOS unique constraint (`liwan_appointments_payments/models/product_template.py:10-12`), and the OCA sale line reads the type from the product (`sale_resource_booking/models/sale_order_line.py`, `_sync_resource_bookings`). The price is set through `PATCH /api/v1/appointments/types/<id>/payment`. A search of `apps/web/app` found no page that calls it.
- Payments adds refund rules to `product.template` (a policy, amounts and notice tiers) and writes them elevated for the application that sells the product (`liwan_payments/models/refund_policy.py:35,48-52,91-111`, `tools/arch_documented_sudo.json:193`). These are payments' own fields, not part of a product's definition.
- Finance does not use products: no file of `liwan_finance` outside its tests names `product.template`, `product.product` or `product_id`. An invoice line carries no product today.

Tax today (read):

- An online order line takes the product's taxes and then replaces them: none for a company that is not registered for VAT, otherwise the same taxes with the price included or added, by the company's tax mode (`liwan_payments/models/order_service.py:67-84`).
- The tax mode is a per-company row of `liwan.payments.settings` (`liwan_payments/models/payments_settings.py:51,74-77`), edited from the payments settings card (`apps/web/app/components/payments/OrderSettingsCard.vue`). VAT registration is on the company in `liwan_core` (`_liwan_vat_registered`).
- The Meta catalog computes its own price with its own option, `prices_include_tax` per catalog, from the product's taxes (`liwan_inbox_payments/models/catalog.py:35`, `models/catalog_item.py:181-200`). It does not read the tax mode. So one company has two answers to "does this price include tax". Both default to included (`payments_settings.py:20-21`).
- The copies of a tax that the order service makes were added so that "an order can charge as the company decides while the original tax stays as other documents use it" (`liwan_payments/models/account_tax.py:8-11`, commit `16323f7f6`). They exist to give online orders a tax mode of their own, which the owner's decision of one tax mode removes.
- A finance invoice line has a label, a quantity, a unit price, a discount and the taxes the accountant picks; it names no product (`liwan_finance/serializers/invoice.py:18,51-66,101-121`). Each tax says for itself whether its price includes it (`serializers/tax.py:34`).

Stock tax mode (read in Odoo 19, and run on a throwaway database with `sale` and `l10n_sa` on 2026-11-13):

- `res.company.account_price_include` is `tax_included` or `tax_excluded`, default `tax_excluded` (`addons/account/models/company.py:272-278`). A tax follows it unless the tax carries `price_include_override` (`models/account_tax.py:142-147,322-329`). Run: a product at 115 with the 15% tax gives 115 + 17.25 = 132.25 under `tax_excluded` and 100 + 15 = 115 under `tax_included`, on a sale order line and on a manually typed invoice line alike.
- The setting cannot change once the company or a branch has any journal item, a draft invoice included (`company.py:325-328,992-995`). Run: the change is refused after one draft invoice. Run: a draft order made before a change kept 132.25 until it was recomputed, then showed 115, which is what the lock prevents.
- A branch follows its root. Run: an order of a child company used the root's taxes and the root's setting, and changing the branch's own value changed nothing.
- A tax with an explicit override ignores the company. Run: a copy of the 15% tax set to `tax_excluded` added its tax under a `tax_included` company. The finance tax form writes the override on every tax it creates (`liwan_finance/controllers/finance_taxes.py:47-48`).
- The Saudi chart ships 17 sale taxes and none carries an override: 15%, and zero-rated and exempt taxes at 0%, most of them inactive (`addons/l10n_sa/data/template/account.tax-sa.csv`). It ships no excise tax among them.
- A ZATCA invoice refuses a line with no tax (`addons/l10n_sa_edi/models/account_edi_format.py:404`). So a product of a registered company that is not taxed needs a zero-rated or exempt tax, not an empty field.

Stock product model (read in Odoo 19):

- `type` is `consu` (goods), `service` or `combo` (`addons/product/models/product_template.py:54-61`). `company_id` is optional (`:124`).
- Every internal user reads products, categories, attributes, tags and units. Create, write and unlink on all of them belong to `product.group_product_manager` (`addons/product/security/ir.model.access.csv`). The stock rule shows a product with no company or with a company at or above the user's (`security/product_security.xml:33-36`).
- `product.category` has no company. Its parent link deletes children with the parent (`models/product_category.py:21`). Tenant fields are `product_properties` on the template, defined per category in `product_properties_definition` (`product_template.py:186`, `product_category.py:27`). A read returns only the values the product's current category defines (`odoo/orm/fields_properties.py:200-214`). Inferred: values of the previous category stay stored and unreadable after a move, and a child category does not inherit its parent's fields.
- A variant's price is the template's `list_price` plus the extras of its attribute values, converted by unit and currency (`models/product_product.py:1101-1130`). `product.pricelist._get_product_price` is in `product` and accepts an empty pricelist (`models/product_pricelist.py:112-129`). Inferred: on an empty pricelist it returns the same number the sale line computes for an order with no pricelist rule.

LiwanOS rules (read):

- The company fence admits a record whose `company_id` is unset, and a record with a company only for a session that holds the capability in it (`liwan_core/models/ir_rule.py:50-53`). As with customers, the only shared state that works is no company.
- A rank-3 addon cannot depend on another rank-3 addon, and a rank-5 bridge cannot depend on another bridge (`tools/arch_policy.py:168-177`, strictly lower rank only). `liwan_payments` is rank 3, so it cannot read a `liwan_products` setting, and the reverse holds.
- A rank-3 name is not a commit scope; commits use `api`, `web` or an application area. A rank-3 addon has no standalone CI stage, and a bridge gets an `odoo-bridge` job.
- The bridge job accepts only a rank-5 addon that depends on exactly two LiwanOS modules (`tools/app_isolation.py:100-109`, `deploy/ci/odoo-bridge.sh:14-15`). The tax bridge the spec names depends on one, `liwan_products`, and on stock `account`.
- Files that list installed addons and already name `liwan_customers`: `deploy/provision.sh`, `deploy/verification-checks.json`, `deploy/check_isolated.py`, `tools/liwan_cli/operator.py`, `tools/test_module_closure.py`.
- The company profile already has the extension shape the spec asks for (`liwan_api/serializers/company_profile.py:22,35,94`).

## 4. Design points the spec left open

The owner took the recommended option of every point that changes what a user sees or departs from the spec's wording (D4, D5, D9, D14, D18, D19), widened D5 and added D20, all on 2026-11-13. The other points are proposals the pull requests may still refine.

| # | Point | Proposal | Status |
| --- | --- | --- | --- |
| D1 | Which rows are the service's products | A stored, indexed boolean `liwan_product` on `product.template`, owned by the service, `copy=False`: true for a product created or adopted through it. Every list, pick and write of the service filters on it. It is the counterpart of `liwan_party`, and it is not a marker per consumer. Inferred: stock modules create products of their own (a down payment line), which must not appear in the tenant's list | Proposed |
| D2 | Feature gate | As `liwan_customers`: the routes use `requires_registered_feature`, each consuming application registers its key, and the web client reads a derived key `products.enabled` that is never sold | Proposed |
| D3 | One writer without `sudo()` | A technical group of the service with read, write and create on `product.template`, `product.product` and the attribute line models, no unlink, and a group rule that limits write and create to `liwan_product` rows. `products.manage` implies it. A write to a definition field of a service product outside the service is refused for everyone but the superuser, the same single-writer rule customers have. The four ACL rows of section 3 and the appointments `sudo()` writes are deleted | Proposed |
| D4 | Who may create a product from inside an application | Today a CRM settings manager, a catalog manager and an appointments manager each create products with their own capability. Option A: applications only pick an existing product, and creating or pricing one needs `products.manage` or `products.prices.manage`; each application grants those two to its own built-in manager role, so default roles lose nothing, and a custom role must be given them. Option B: each application's capability keeps an inline create through the service, as customers allow for a booking. Recommended: A. A product, unlike a customer, is not created in the middle of serving someone, and B keeps three ways to make a product | Approved by the owner on 2026-11-13: option A |
| D5 | The tax mode | One choice in the company settings, with three values the screen shows together: no tax (the company is not registered for VAT, the existing `liwan_vat_registered` of `liwan_core`), price includes tax, and tax added to the price (stock `account_price_include`). No LiwanOS copy of the stock field and no tax copies: every order line, invoice line and price follows stock. The stock lock is accepted: the choice between included and added is made at setup, is asked of an unregistered company too so that registering later needs no change, and cannot change after the first invoice; the screen says so before the choice. VAT registration itself can change at any time. Labels state what the number typed on a product means, with a worked example, so staff are not misled: «السعر شامل الضريبة» (the price typed for the product is what the customer pays) and «الضريبة تُضاف إلى السعر» (the tax is added on top of the price typed for the product) | Approved by the owner on 2026-11-13. It replaces the option A recorded earlier that day, a LiwanOS field in `liwan_core` |
| D6 | The price function | `liwan.products.service._liwan_price(product, quantity, uom, company, customer, date)` returns, in the company's currency, the amount before tax, the tax and the total the customer pays. The unit price comes from `product.pricelist._get_product_price` on an empty pricelist, so pricelists later change the result without touching a caller, and the three amounts from the stock tax computation on the product's taxes. For a company that is not registered for VAT it returns no tax and a total equal to the price, whatever taxes the product still carries, by the same `_liwan_vat_registered` check the order line keeps. A surface a customer sees (a Meta catalog, a booking page, a store) shows the total. `customer` is accepted and unused until pricelists exist, because the spec fixes the signature now | Approved by the owner on 2026-11-13 for the three amounts and the total on customer surfaces |
| D7 | Company of a new product | From the product sharing setting: unset under `establishment`, the working company under `branch`. Changing the setting answers `409 sharing_transfer_required` while any service product exists, until PR 4 replaces the refusal with the transfer | Proposed |
| D8 | Categories | Stock `product.category`, tenant-wide. `products.settings.manage`, checked in the root company, creates, renames, moves and removes them. Removing a category moves its products and its child categories to the parent first, because stock would delete the children; the one general category cannot be removed | Proposed |
| D9 | Tenant fields and a category change | Fields are defined per category and apply to that category only, which is stock behaviour; the settings screen says so. Moving a product to a category that lacks a field it holds a value for answers `409 product_field_values_lost` with the fields and counts, and the confirmed write clears those values, so nothing stays stored and hidden. Removing a field or an option asks the same way as customers do | Approved by the owner on 2026-11-13 |
| D10 | Types in the first phase | Goods and service. `combo` is offered when its components are built (section 6 of the spec), so no type ships without its editor | Proposed |
| D11 | Variants | Stock attributes and values, tenant-wide. A holder of `products.manage` adds an attribute and its values from the product form; no separate attribute screen in this phase. Each variant can carry a price extra, a code and a barcode | Proposed |
| D12 | The extension hook | `_liwan_product_extension_specs()` on `product.template`, the shape the company profile has: each contributing addon returns its fields with a parser and a serializer. `liwan_products_account` contributes the product's sale taxes under D21; it is `auto_install` on `liwan_products` and `account` | Proposed |
| D13 | How CRM records its packages | A many-to-many on `liwan.crm.settings` from a company to the products it offers as packages. `liwan_crm_package`, its three readers, the create route's tax clearing and the ACL rows go. `/api/v1/crm/packages` lists the company's packages and adds or removes a product from them; creating one follows D4 | Proposed |
| D14 | Appointments | The bridge keeps the OCA link and its one-type-one-product constraint. Setting a type's price picks or prices a product through the service under D4, and the name sync stops: the product's name is edited in the products screen. Booking offers are the appointments plan. The owner noted that the appointments screens for this are built later; this plan adds none | Approved by the owner on 2026-11-13 |
| D15 | Payments' refund rules | They stay on `product.template` as payments' own fields and keep their documented elevated write. They are not a definition field, and `liwan_payments` cannot depend on the service | Proposed |
| D16 | Web placement | `apps/web/app/modules/products/manifest.ts` with a rail entry, the list under `/products`, the settings under `/settings/apps/products`. The folder is not registered in `web_apps`, as with customers, so every application may use the product picker | Proposed |
| D17 | Existing development data | Each consumer's migration adopts the products it made: marks them, and clears their company, which is the sharing default. CRM's migration fills the new relation from the marker before the column is dropped. There are no live tenants | Proposed |
| D18 | Where the Meta catalog moves | The spec says a bridge between `liwan_inbox` and `liwan_products`. The carts stay in `liwan_inbox_payments` and read the catalog models, and a bridge cannot depend on a bridge. Option A: the catalog models move into `liwan_inbox` itself, which then depends on `liwan_products`, behind the existing `inbox.catalog` sub-feature. Option B: a bridge, with the carts moved into it too. Recommended: A. An application may depend on a shared service, so no bridge is needed | Approved by the owner on 2026-11-13: option A. The spec's section 4.7 is edited to match |
| D19 | The shape of the tax bridge | The spec names a rank-5 `liwan_products_account` on `liwan_products` and stock `account`, and the bridge tooling refuses a bridge with one LiwanOS side. Option A: keep the bridge and teach `tools/app_isolation.py` that a bridge may link one LiwanOS module to one stock module named in its `auto_install`. Option B: no bridge; the service contributes the tax field itself when the field exists, as CRM tests `taxes_id` today. Recommended: A. B puts a condition on installed modules inside the service, and the same case returns for inventory fields | Approved by the owner on 2026-11-13: option A |
| D20 | Finance invoice lines and products | The owner decided that finance links to products. A line of a customer invoice or credit note may name a service product; picking one fills the label, the price from the price function and the product's taxes, and the accountant can still change them. A line without a product stays valid. Vendor bills wait for purchasing, because a service product is a thing the company sells. `liwan_finance` depends on `liwan_products` directly, an application on a shared service | The link: Approved by the owner on 2026-11-13. Its scope as written here: proposed |
| D21 | A product's tax | A new product of a registered company takes the company's default sale tax, and a holder of `products.manage` can change it on that product. "No tax" on a product of a registered company is stored as a zero-rated or exempt tax the user picks with its reason, because a ZATCA line needs a tax. A product accepts more than one tax in the API from the start; the screen offers the VAT choice only (taxable, zero-rated, exempt). Excise on tobacco and similar goods is left for a tenant that imports or manufactures them. A company with no tax shows no tax field | Approved by the owner on 2026-11-13 |
| D22 | Which addon shows the tax choice | The stock field is in `account`, which `liwan_core` and `liwan_api` do not depend on. A small `auto_install` addon on `liwan_api` and stock `account`, `liwan_api_account`, contributes the choice to the company profile through its extension hook and owns the refusal when stock's lock applies. It is the D19 kind of bridge, so PR 1 carries the D19 tooling change. A tenant without `account` keeps today's company profile | Proposed |

## 5. Pull requests

Six pull requests, in this order. Each is complete on its own: it removes what it replaces, ships nothing that has no reader yet, and leaves no second path.

### PR 1: one tax mode, on the company

Goal: one answer to "is this company taxed, and does a price typed on a product include the tax", set in the company settings and applied by stock to every document. Shape under D5 and D22.

- [ ] Failing tests first for every line of "Proves" below.
- [ ] Tooling: the D19 change to `tools/app_isolation.py` and its tests, and `"liwan_api_account": 5` in `tools/arch_layers.json`.
- [ ] `liwan_api_account`: the company profile extension with the three-way choice, its parser, serializer and contract. It writes `liwan_vat_registered` through the path `liwan_core` already has and `account_price_include` on the root company. It reports whether the included or added choice is locked, and answers `409 tax_mode_locked` to a change stock would refuse.
- [ ] `liwan_payments`: `_liwan_priced_taxes`, `_liwan_priced_copy`, `_liwan_tax_signature`, `account.tax.liwan_copy_of_id` with its index, and `tax_mode` with its serializer, contract and route all go. `_liwan_add_line` keeps one rule: a company that is not registered charges no tax. Version bump and a migration that sets each root company's stock setting from its old `tax_mode` where stock allows it, and archives the tax copies, which posted documents may still name.
- [ ] Customer messages (`liwan_inbox_payments`): `prices_include_tax` leaves `liwan.inbox.catalog`, its parser, serializer and contract; an item shows the total the customer pays, computed from the product's taxes until PR 2 replaces it with the price function; a change of the company's tax choice queues its synced items for resync, as a change of VAT registration does today; version bump and a migration that drops the column.
- [ ] Finance (`liwan_finance`): a sale tax created from the tax form follows the company instead of carrying an override; the per-tax control stays for purchase taxes, which record what a vendor charged. Version bump and a migration that clears the override the form already wrote on existing sale taxes, so they follow the company too.
- [ ] Web: the choice in the company profile with the labels and the worked example of D5, the lock stated before the first save and shown once it applies; the payments settings card and the catalog connect and settings forms lose their controls; locale keys in both languages.

Proves:

- A product at 115 with the 15% tax is charged 115 under "price includes tax" and 132.25 under "tax added", on an online order line and on a finance invoice line.
- A company with no tax charges none on an order line and shows none on a Meta item.
- An order of a branch follows the root company's choice.
- The included or added choice is refused with `409 tax_mode_locked` once the company has an invoice, and VAT registration can still be switched.
- An unregistered company that chose "price includes tax" at setup, issued invoices and then registered is charged with the tax inside the price, with no change of the locked setting.
- A Meta item shows the total the customer pays under each choice, and changing the choice resends the item.
- No model, route or screen outside the company settings holds a tax mode, and no tax in the database is a LiwanOS copy in use by a new document.
- A change is refused without `settings.company.manage`.
- On an upgraded scratch database, a sale tax that finance had created with an explicit excluded override charges 115, not 132.25, on a product at 115 under "price includes tax".

A development database whose company already has journal items keeps stock's value where it differs from the old `tax_mode`; the migration note says so. There are no live tenants.

### PR 2: the service and its three writers

Goal: one writer. After it, CRM, customer messages and appointments hold no product write, and a product is shared or not by the setting. It is large because splitting it would leave two writers alive between pull requests.

Orchestrator files (one owner, edited once): `tools/arch_layers.json` (`"liwan_products": 3`, `"liwan_products_account": 5`), `tools/arch_documented_sudo.json`, `tools/arch_baseline.json` through `--write-baseline`, `docs/agents/repository-layout.md`, the five files of section 3 that list installed addons, the bridge group of the `odoo-bridge` CI job, `packages/contracts/src/index.ts`, `apps/web/app/modules/registry.ts`.

Server, foundation (one implementer). Files: `odoo-addons/liwan_products/**`, `odoo-addons/liwan_products_account/**`.

- [ ] Failing tests first for every line of "PR 2 proves" below.
- [ ] The addon: manifest (`liwan_api`, `product`), the feature hook of D2, the capabilities `products.read`, `products.manage`, `products.prices.manage` and `products.settings.manage` with their groups, permissions and dependencies, the technical group and its rule of D3, `README.md`.
- [ ] `product.template`: `liwan_product`, the single-writer rule of D3, the extension hook of D12.
- [ ] `liwan.products.settings`: tenant scope, seeded singleton, `revision`. Product sharing only; categories and fields come in PR 3.
- [ ] `liwan.products.service`: list and pick in scope; create, edit, archive and restore under the writer rule, with `list_price` behind `products.prices.manage`; the company of a new product from D7; the price function of D6, which the Meta item then reads in place of its own computation.
- [ ] Routes under `/api/v1/products`: list, detail, create, edit, archive, restore, a pick list (id, name, type and the three amounts of D6, for a holder of any registered pick capability), and `settings`. Serializers whitelist every field, and every price is returned as before tax, tax and total.
- [ ] `liwan_products_account`: a product's sale taxes through the hook under D21, limited to the company's own sale taxes: the company's default on create, a change by a holder of `products.manage`, and "no tax" stored as a zero-rated or exempt tax.

Server, consumers (one implementer per addon, after the service API is committed):

- [ ] CRM (`odoo-addons/liwan_crm/**`): the relation of D13 and its routes; the lead's package domain; the price a sale copies comes from the price function; the marker, the tax clearing and the two ACL rows go; version bump and the migration of D17.
- [ ] Customer messages (`odoo-addons/liwan_inbox_payments/**`): the catalog editor's product create and edit go, an item is created from an existing service product, and the pick list is the service's; `liwan_inbox_catalog` and the two ACL rows go; the write override that resyncs Meta stays; version bump and the migration of D17.
- [ ] Appointments (`odoo-addons/liwan_appointments_payments/**`): `_liwan_price_product` and the name sync call the service or go, under D14; the documented `sudo()` case is removed; version bump and the migration of D17.

Contracts and web (one implementer, after the contracts are committed): `packages/contracts/src/products/**`, the CRM package card and sale form, the inbox catalog item form and its product picker, the mocks and e2e fixtures of the changed routes, locale keys in both languages. The products screen itself is PR 3; until then a product is created through the API and the three application forms pick from the service.

PR 2 proves:

- A product created through the service is found by staff of every branch under `establishment`, and only by its branch under `branch`.
- A holder of `crm.settings.manage`, `inbox.catalog.manage` or `appointments.bookings.manage` alone cannot create or write a product through any route or the ORM.
- A write to a service product's name, type or price outside the service is refused, for an application manager and for a system administrator alike.
- `list_price` is refused without `products.prices.manage` for a holder of `products.manage`.
- The price function returns the number the sale order line computes for the same product, quantity and unit, for a product with no variant extra. Run in a bridge that has both `sale` and the service.
- An order line for a service product is taxed as PR 1 left it, for a company under each of the three choices, and the price function returns the same three amounts as that line. For a company that switched VAT registration off while its products keep their taxes, the function and a Meta item both show the price with no tax.
- A product set to "no tax" in a registered company carries a zero-rated or exempt tax, and its invoice line passes the ZATCA line check.
- The products API accepts two taxes on one product and returns their combined amounts.
- A tenant with `account` and no online payments has a default tax on a new product, and a tenant without `account` gets a products API with no tax field.
- Editing or archiving a product leaves an existing booking, order line and lead unchanged, and a Meta item of an edited product is queued for resync.
- A CRM package offered by one company is not offered by another, although both read the product under `establishment`.
- A migrated scratch database keeps every lead's package, every catalog item's product and every booking type's product.
- The `sudo()` registry loses the appointments product case, and `arch_policy.py` passes with no baseline growth.
- Each line in `saas` and `non_saas`.

### PR 3: the screen, categories, tenant fields and variants

Goal: staff with `products.read` see and manage the tenant's products, and the tenant shapes the service.

- [ ] Server: categories under D8, the field definition per category and its values under D9, variants under D11, the list filters by type, category and a tenant field.
- [ ] Web: the manifest, the list with search and the archived filter, the record page, the create and edit pages under [DESIGN.md](../../../DESIGN.md) section 5, the settings page with one card per setting, on the shared custom-field editor customers use. Stories for each new state. A branch session sees the settings read-only with the reason.

Proves: a product at 100 with a variant extra of 20 shows 120 in the products API and on the order line; moving a product to another category shows the fields it loses before saving and clears them once confirmed; removing a category moves its products and children to the parent; a tenant-defined field is saved, returned and filtered on; a settings change is refused for a holder of the capability in a branch only.

### PR 4: the transfer between sharing modes

Goal: product sharing can change after products exist.

- [ ] A document hook on the service, extended by each consumer with the companies that use a product: CRM settings rows, Meta catalogs, booking types, order lines.
- [ ] A preview route and an apply route. Branch to establishment clears the company of every product. Establishment to branch moves a product used by one branch, leaves a product used by several or by none shared, and lists it.
- [ ] Web: the preview and the confirmation in the settings card.

Proves: both directions after order lines exist, including a product used in two branches; no `check_company` violation on a document written after the move; shared products with separate customers in one tenant.

Open before it starts: whether stock lets a product with posted order lines change its company at all.

### PR 5: the Meta catalog out of the payments bridge

Goal: a tenant publishes its catalog to Meta without online payments. Shape under D18.

- [ ] The catalog models, their sync and the public image route move; the carts stay in `liwan_inbox_payments`.
- [ ] A migration that keeps every product link and every `retailer_id` Meta already holds.

Proves: a tenant with customer messages and no payments connects a catalog and syncs an item; an upgraded scratch database keeps its items, their `retailer_id` and their sync state; a cart still becomes a paid order.

### PR 6: a product on finance invoice lines

Goal: an invoice line can name what was sold, so sales reports and the later sales application read one record. Scope under D20.

- [ ] `liwan_finance` depends on `liwan_products` and registers its feature key and pick capability with the service.
- [ ] A customer invoice or credit note line accepts an optional `product_id`: a service product the caller can pick. The label, unit price and taxes default from the product and stay editable. The line serializer returns the product.
- [ ] Web: a product picker on the invoice and credit note line editors, from the shared picker.
- [ ] Version bump. No migration: existing lines keep no product.

Proves: a line with a product is priced and taxed as an online order line for the same product and company, by stock, with no LiwanOS tax code in between; a product line of a company that is not registered carries no tax; a line without a product still saves; a product the caller cannot read is refused; archiving a product leaves a posted invoice unchanged; a vendor bill line refuses a product.


## 6. Where each proof line of the spec lands

| Spec section 9, products | Pull request |
| --- | --- |
| Visible to every branch under `establishment` | 2 |
| One service offered in two branches with different durations | The appointments booking offers plan |
| No product write ACL and no `sudo()` product write in the three consumers | 2 |
| An order line taxed exactly as before | Replaced by the owner's decision of one tax mode: 1 proves the new behaviour under each choice |
| Editing or archiving a product leaves bookings, order lines and leads unchanged | 2 |
| A variant extra of 20 on a product at 100 shows 120 | 3 |
| A tenant with finance and no online payments has the default tax | 2 |
| Moving a product to another category shows the fields it loses | 3 |
| `arch_policy.py` passes with no baseline growth | Every pull request |
| Shared products with separate customers (customers list) | 4 |

## 7. Checks before each push

The list of the customers plan, section 7, with these changes:

- `npm run test:odoo` for `liwan_products`, `liwan_products_account` and each changed consumer with its dependents.
- `deploy/ci/odoo-app-standalone.sh` for CRM, customer messages and appointments, whose dependency closure gains `liwan_products`, and `deploy/ci/odoo-bridge.sh` for `liwan_inbox_payments`, `liwan_appointments_payments` and `liwan_products_account`.
- `tools/test_module_closure.py`, whose expected closures name the shared services, and the tests of `tools/app_isolation.py` if D19 is decided as option A.

## 8. Risks

- The technical group gives product create and write at ACL level. Its rule limits it to service products; the reviewer checks that no other group its holders can have widens it, and that the `ir.http` guard still closes the generic endpoints.
- A product with no company is editable by a `products.manage` holder of any branch. The spec accepts this for customers; the settings screen says it for products too.
- D4 option A removes an inline create that three screens have today. A tenant's custom role that manages CRM packages needs `products.manage` after the change.
- The OCA booking link is on the product. If appointments later needs several offers per service, that plan may have to replace the link, and PR 2 must not deepen the dependency on it.
- The price function must equal the sale line's price. It is proved for the cases this phase has; pricelists reopen the proof.
- PR 1 removes the order service's tax code, a per-catalog choice and a payments setting in one step, and changes what a typed finance line means: under "price includes tax" an accountant's 115 is recorded as 100 and 15.
- The stock lock is permanent once a company invoices. A tenant that chose wrongly has no in-product way back; the setup screen is the only guard.
- The path of an unregistered company that registers later was reasoned from the stock code and not run.
- The probe ran stock modules only. The same facts were not run with LiwanOS addons installed or through a ZATCA submission.
- Tax copies may sit on posted documents of development data, so they are archived and not deleted.
- This plan was read against the code by one session. An independent read before PR 2 starts is part of the path, as it was for customers.

## 9. Evidence status

| Claim | Status |
| --- | --- |
| The three writers, their markers, ACL rows and `sudo()` case, payments' refund fields, the tax handling in the order service and in the Meta catalog | Read on `main` at `5f91e53f9`; not run |
| Finance uses no product | A search of `liwan_finance` outside its tests; not run |
| No web page sets a booking type's price | A search of `apps/web/app` for the route's fields; the first task of the appointments consumer rechecks |
| Stock product types, ACL rows, company rule, category parent link, properties per category, variant price | Read in Odoo 19 source; not run |
| Values of a previous category stay stored after a move; a child category does not inherit fields | Inferred; the first test of PR 3 |
| An empty pricelist returns the sale line's price | Inferred from `product_pricelist.py`; the first test of PR 2 |
| Stock modules create products that must stay out of the list | Inferred; the first test of PR 2 lists the rows a fresh database with `sale` holds |
| A bridge cannot depend on a bridge | Read in `tools/arch_policy.py:168-177`; not run |
| The bridge job refuses a bridge with one LiwanOS side | Read in `tools/app_isolation.py:100-109`; not run |
| The stock company setting on order and invoice lines, the branch following its root, the explicit override, the lock after a draft invoice | Run on 2026-11-13 on a throwaway database with stock `sale` and `l10n_sa`, since dropped; not run with LiwanOS addons or ZATCA |
| The Saudi sale taxes carry no override, and a ZATCA line needs a tax | Read in `l10n_sa` and `l10n_sa_edi`; not run |
| An unregistered company that registers later keeps its chosen price mode | Inferred; a proof line of PR 1 |
| Everything in section 5 | Plan, not built |
