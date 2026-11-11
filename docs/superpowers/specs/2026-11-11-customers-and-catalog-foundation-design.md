# Customers and catalog foundation design

Status: the owner approved the direction and four decisions on 2026-11-11 (section 2.1). On 2026-11-12 two further reviews found design faults and the owner set the goal that one build serves any sector through free settings, with no sector presets for now; the changes are in section 2.2 and still need the owner's confirmation. Nothing here is implemented in any branch. The evidence is a read of `main` at `b3db19af2`; no test was run and no load was measured. Section 11 lists which claims were checked in code.

This file records the design. It does not change the rules in [AGENTS.md](../../../AGENTS.md). [repository-layout.md](../../agents/repository-layout.md) and `tools/arch_layers.json` change in the pull requests that build it.

## 1. Problem

The store, bookings and medical practice applications the owner plans all need a customer, a product or service, an order, a payment and an invoice. Today the customer and the product are shared only because every application writes the same Odoo tables. No LiwanOS addon owns either record.

Customer (`res.partner`):

- Three places create a partner, each with its own values: appointments (`liwan_appointments/controllers/appointment_bookings.py:292`), finance (`liwan_finance/controllers/finance_partners.py:134`) and the WhatsApp contact at its first checkout, through `sudo()` (`liwan_inbox_payments/models/contact.py:19`). Finance also edits and archives partners directly (`finance_partners.py:144`).
- All three set `company_id` to the current company. A branch is a child `res.company` of the root (`liwan_platform/models/tenant_profile.py:567`), every request pins `allowed_company_ids` to the current company (`liwan_api/controllers/common.py:275`), and the stock partner rule shows a partner only to companies at or below the partner's own (`odoo/addons/base/security/base_security.xml:19`). A customer created in one branch is invisible in the next branch, which then creates the same person again.
- Nothing matches a new partner against existing ones. The only phone match is on `crm.lead` (`liwan_crm/models/crm_lead.py:48`), and its normaliser is private to CRM (`crm_lead.py:68`).
- `liwan_crm` never links a lead to a partner. `liwan.inbox.contact` is a separate record by design (`liwan_inbox/models/contact.py:6`). The owner decision of 2026-11-06, one customer record across inbox contact, lead and orders, is therefore not implemented.
- There is no customer merge and no customer erasure.

Product (`product.template`):

- Two per-application columns mark whose product a row is: `liwan_crm_package` (`liwan_crm/models/product_template.py:8`) and `liwan_inbox_catalog` (`liwan_inbox_payments/models/product.py:16`). A third link, OCA `resource_booking_type_id`, ties a product to one booking type.
- Each application creates and edits its products under its own capability. The CRM settings manager holds an unrestricted write ACL on every product (`liwan_crm/security/ir.model.access.csv:10`). Appointments writes products through `sudo()` (`liwan_appointments_payments/models/resource_booking_type.py:94`). The WhatsApp catalog editor creates its own (`liwan_inbox_payments/controllers/catalog_items.py:67`).
- Tax is handled three ways: CRM clears product taxes on create (`liwan_crm/controllers/lists.py:317`), the payments order service re-prices the tax on every line from the company's VAT status and tax mode (`liwan_payments/models/order_service.py:77`), and the other creators leave the default.
- The whole Meta commerce catalog lives in `liwan_inbox_payments`, a bridge that installs only when payments is installed, and its routes are gated by `inbox.catalog` (`liwan_inbox_payments/controllers/catalog_items.py:80`).

Each new application built this way adds one more partner creator, one more product column and one more bridge per application it touches.

## 2. Decisions

### 2.1 Approved by the owner on 2026-11-11

1. Two shared services at rank 3 own the two records: `liwan_customers` and `liwan_catalog`. Applications call them and stop writing the tables directly.
2. Customer sharing is an explicit setting, establishment or branch, with establishment as the default.
3. The catalog starts with one base price per product.
4. Erasing a customer who has posted invoices anonymises the customer. The invoices keep their numbers and amounts.

Settled in the first design review:

5. `res.partner` is the commercial party: who is contacted and who is billed. A phone number suggests a match and is never unique on the partner, because one number can serve several members of a family.
6. An application that needs a distinct person (a patient, a dependant on a booking) owns its own model with a `Many2one` to the partner. Several persons may share one partner.
7. The catalog does not own taxes. The effective tax stays on the order line, computed as today.
8. The order schema does not change now. A rank-3 `liwan_orders` service is created when the store starts. Until then no store logic is added to `liwan_payments`.

### 2.2 Changes of 2026-11-12, awaiting the owner's confirmation

9. Free settings and no sector presets. Every behaviour that differs between companies is its own typed setting with a stated default, and a tenant shapes the two services by changing settings one at a time. No preset layer is built for these two services now.
10. Customer sharing, catalog sharing and pricing are three independent settings. A franchise can share product definitions, keep each branch's customers apart and later price per branch. The earlier proposal to derive the catalog scope from the customer scope is withdrawn, and so is the special default for the `group_of_companies` preset: both settings default to establishment for every tenant.
11. Decision 3 is a limit of the first phase. Every price an application shows or charges comes from one function of the catalog service, which runs the same stock computation as the sale line, so pricelists can be added later without touching the applications.
12. A shared record has no company. "Establishment" means `company_id` is unset. Section 3.3 gives the reason.
13. Shared services do not depend on each other. Section 3.1 gives the reason and the pattern.
14. Every change to a customer's identity goes through `liwan_customers`, including edits and archiving, which finance does directly today.
15. A service in the catalog can be offered for booking more than once, for example in two branches with different staff and durations. The booking and the order line keep the offer that was chosen.
16. Candidate customers are shown to authorised staff only. A public form never links to an existing customer and never returns one's data; it creates a new customer that staff can merge.
17. Automatic linking is limited to a channel that authenticates the sender's number, such as WhatsApp. A phone number typed into a form proves nothing about who typed it.
18. Tenant-wide settings are changed with a capability held in the root company, so a branch manager cannot change what other branches see.

This design implements the 2026-11-06 decision on one customer record.

## 3. `liwan_customers`

### 3.1 Place in the layers

Rank 3, depends on `liwan_api` and `phone_validation`. It names no application. `liwan_core` cannot own it because R1 limits it to `base`, and `liwan_directory` is the user picker with a different population and contract.

`tools/arch_policy.py:168` lets an addon reach only a strictly lower rank, and no rank-3 addon depends on another today. The design keeps that. Shared services exchange stock records: an application gets a partner from `liwan_customers` and a product from `liwan_catalog` and passes both to the order service, as callers of `liwan_payments` already do. Where one shared service must extend another, a rank-5 bridge with `auto_install` does it, as `liwan_ai_notify` does for `liwan_ai` and `liwan_notify`.

`phone_validation` installs itself whenever `mail` is present (`odoo/addons/phone_validation/__manifest__.py:28`). The service still declares the dependency so that `phone_sanitized` on `res.partner` is guaranteed by the addon that reads it.

### 3.2 What the service owns

- Every write to a commercial party's identity: create, edit, archive and restore. The identity fields are `name`, `phone`, `email`, `is_company`, `parent_id` (a contact of a company), `active` and `company_id`.
- The phone normaliser, moved out of `crm.lead` so that CRM, appointments, inbox and finance read numbers the same way.
- The candidate search and the matching policy in 3.4.
- The settings in 3.6, including the tenant's own customer fields.
- Merge and erasure (3.7).
- The capabilities in 3.5 and the routes under `/api/v1/customers` with `{items, total}` list envelopes. The routes are gated with `requires_registered_feature`, and each consuming application registers its feature key, as applications do for `/api/v1/people`.
- Its own marker in the `res.partner` write guard (`liwan_core/models/res_partner.py:49`), so an identity write by a protected actor is allowed only through the service.

Finance keeps its accounting fields on the same record (VAT number, registry, address, customer and vendor ranks, bank accounts) behind its own routes and capabilities. A vendor is a finance kind on the same commercial party. Finance calls the service for the identity part of a create, an edit or an archive and writes its own fields afterwards.

### 3.3 Sharing between branches

LiwanOS adds its own company fence on top of the stock rule: a record is readable when its `company_id` is unset or is one of the companies in which the user holds the capability (`liwan_core/models/ir_rule.py:50`). A partner owned by the root company therefore stays hidden from staff who work only in a branch. A partner with no company passes both the fence and the stock rule. It passes them for every operation, so the capability check of the service in the current company is what gates each read and each write of a shared record.

| Sharing | `company_id` of a new customer | Who finds it |
| --- | --- | --- |
| `establishment` | Unset | Every branch |
| `branch` | The branch that created it | That branch only |

Each tenant is one database with one root company, so a record with no company is shared inside that tenant and nowhere else.

Sharing a customer shares the identity only. Bookings, invoices, conversations and leads stay under each application's and branch's own rules in both modes.

The setting is separate from `liwan_branch_access_mode`. That mode decides whether the parent's users may act inside branches (`liwan_core/models/access_branch.py:141`) and says nothing about records shared between sibling branches.

Changing the setting after customers exist runs a transfer with a preview, in both directions:

- Branch to establishment: every customer loses its company. Customers with the same normalised phone are listed as probable duplicates for merge.
- Establishment to branch: a customer whose documents all belong to one branch moves to that branch. A customer with documents in several branches stays shared and is listed, so the tenant can split or keep it. New customers belong to the branch that creates them. The settings screen shows these shared exceptions in the preview and keeps showing them after the change.

### 3.4 Matching policy

The service returns the partners in scope whose `phone_sanitized` equals the normalised number.

| Matches | Staff present | Authenticated channel (inbound WhatsApp) | Public form (a visitor types the data) |
| --- | --- | --- | --- |
| None | Create | Create when the path needs a customer; otherwise wait | Create |
| One | Suggest it; staff confirm or create a new customer | Staff confirm the first link and later messages reuse it. Links without staff only when the tenant enabled it (3.6) | Create a new customer from the data given and flag it as a probable duplicate |
| Two or more | Staff choose one or create a new customer | Leave unlinked for staff | Same as one match |

A staff request that has candidates answers `409 conflict` with the candidate list and is repeated naming an existing customer or stating that a new one is wanted. The service never merges on its own.

A public path always ends with a customer of its own. The booking engine requires a requester (`oca-19.0/calendar/resource_booking/models/resource_booking.py:105`) and so does a payment, and the guest booking page shows the requester's name, phone and email (`liwan_appointments/serializers/appointment_guest.py:88`), so linking a visitor to an existing record by a typed phone number would show them another person's data. Staff see the flagged duplicates in one list and merge the ones that are the same person.

### 3.5 Capabilities

| Capability | Allows |
| --- | --- |
| Picking a customer inside an action | Comes with the consuming application's own capability. Returns the name and the last four digits of the phone |
| `customers.read` | The customer directory and full contact data |
| `customers.manage` | Create, edit, archive, restore |
| `customers.export` | Export |
| `customers.merge` | Merge, with a preview of the documents that move |
| `customers.erase` | Erasure |
| `customers.settings.manage` | The settings in 3.6. Checked in the root company |

Every internal user can read every partner field at ACL level; the routes are the gate, and the Odoo client is closed by the `ir.http` guard. The service adds no path that returns partner fields without one of the rows above.

### 3.6 Settings

One settings record per tenant, changed by holders of `customers.settings.manage`, readable through the API.

| Setting | Values | Default | Effect on existing data |
| --- | --- | --- | --- |
| Customer sharing | `establishment`, `branch` | `establishment` | The transfer in 3.3 |
| Party kinds | `individuals`, `companies`, `both` | `both` | None. Decides which forms and fields new customers get |
| Automatic linking on a single match, for channels that authenticate the number | on, off | off | None. Applies to contacts that arrive after the change |
| Customer fields | A list the tenant defines: label, type, choices | Empty | Removing a field removes its values, after a confirmation that names the count |

Customer fields use the stock `properties` field of `res.partner` and its per-database definition (`odoo/addons/base/models/res_partner.py:187`), which CRM already uses for leads. A wholesaler can add a credit tier and a retailer a loyalty tier without a schema change. A field that describes a person belongs to the application's person model: a guardian who pays for two children is one customer, and each child's medical file number sits on that child's patient record.

Which identity fields a journey requires stays with the application that runs it, as appointments already does with its requester field settings. The service requires only a name.

When a customer record is created (at first contact, at qualification or at the first transaction) is likewise decided by each application. The first phase keeps today's moments: a booking creates one, a conversation creates one when staff link it or an order is placed, and a lead links when staff choose or when it is won.

### 3.7 Merge and erasure

Merge keeps one partner and repoints every document. Stock Odoo ships `base.partner.merge.automatic.wizard`; the plan must evaluate reusing its merge before writing one.

Erasure replaces the name with a placeholder, clears phone, email, address, image and the tenant's customer fields, and archives the partner. Posted invoices keep their numbers and amounts. Each application that holds a person or channel record for the customer clears its own data through a hook the service calls.

### 3.8 What changes in each consumer

- Appointments: `_requester` calls the service. Its own create, its `company_id in [False, current]` lookup and the partner create ACL of the bookings capability are removed.
- Customer messages: `partner_id` moves from the payments bridge to `liwan_inbox`, which may depend on a rank-3 service. The contact stays the channel identity and is linked under the authenticated channel column of 3.4. The `sudo()` create in `liwan_inbox_payments/models/contact.py` and its entry in `tools/arch_documented_sudo.json` are deleted. Placing an order needs a partner at once (`liwan_inbox_payments/models/order.py:183`); the agent placing it is staff, so an unlinked contact makes the request answer with the candidates.
- CRM: the stock `partner_id` of the lead is set when staff link the lead to a customer, and at the latest when the lead is won. Early leads stay unlinked. The one-phone-per-company index on leads blocks a second request from a returning customer; turning it into a CRM setting (block, warn, allow) is CRM work that follows this design and is not part of it.
- Finance: the partner routes call the service for identity writes and archiving, and keep their accounting fields and audit log.
- Payments: no change. The order service receives a partner as it does today.

### 3.9 Sensitive persons

The medical application owns the patient and the visit, with their own capabilities and record rules, in the way payroll is isolated inside HR. No clinical field and no chatter goes on `res.partner`, and no clinical value goes into the tenant's customer fields. The name of a service on a booking or an invoice line can itself reveal a diagnosis; the medical design has to handle that and it is outside this file.

## 4. `liwan_catalog`

### 4.1 Place in the layers

Rank 3, depends on `liwan_api` and `product`. Applications and bridges that touch products depend on it. It knows none of its consumers, and `liwan_payments` does not depend on it (3.1).

### 4.2 What the service owns

- Every write to a product's definition: `name`, `type` (goods, service or combo, the stock values), `list_price`, `image_1920`, `description_sale`, `default_code`, `barcode`, `categ_id`, `uom_id`, `active`, `sale_ok` and `company_id`.
- Variants. Sizes, colours and similar options use stock product attributes and belong to the catalog, whichever application first needs them.
- The price function. It takes a variant (`product.product`), a quantity, a unit of measure, a company, a customer and a date, and returns the unit price in the company's currency. It runs the stock computation the sale line already uses (`odoo/addons/sale/models/sale_order_line.py:590`), so a screen and an order agree, and it includes a variant's extra: a product at 100 whose variant adds 20 is shown and sold at 120 (`odoo/addons/product/models/product_product.py:325`). Whether that price includes tax is decided by the company's tax mode and stated next to every price the API returns. Applications never read `list_price` themselves. Pricelists later change what the stock computation returns and nothing else.
- The settings in 4.5, including the tenant's categories and its own product fields.
- The capabilities in 4.4, the routes under `/api/v1/catalog` and the "Products and services" screen, built from the Storybook catalog under [DESIGN.md](../../../DESIGN.md).
- An extension hook through which another addon contributes product fields to the catalog's serializer and parser, in the way applications extend the company profile.

Applications lose their direct product ACLs and their `sudo()` product writes.

A booking, an order line and a lead keep the name and price they were created with. Editing or archiving a product changes future transactions only; `sale.order.line` and the lead's package price already work this way.

### 4.3 How each application records its use of a product

The catalog holds no column per consumer. Each application keeps the relation in its own models:

- CRM: the packages a company offers become a relation on `liwan.crm.settings`. The `liwan_crm_package` column, the three domains that read it (`crm_lead.py:23`, `controllers/sale.py:24`, `models/intake.py:214`) and CRM's product create and its tax clearing are replaced.
- Customer messages: `liwan.inbox.catalog.item` already states which products are listed in Meta. The `liwan_inbox_catalog` column and the bridge's own product editor go. The product write override that triggers a Meta resync stays with the catalog items. Availability has one source per product: a tracked good takes it from inventory once an inventory application exists, a bookable service from its resources, and anything else, such as an untracked good or digital content, from the manual flag on the channel's item. Publishing a product in a channel stays a separate choice.
- Appointments: a service can have several booking offers, each with its own branch, booking type, duration, resources and deposit. Today the link is a `Many2one` from the product to one booking type (`oca-19.0/sale-workflow/sale_resource_booking/models/product_template.py:10`), LiwanOS adds a unique constraint on it (`liwan_appointments_payments/models/product_template.py:10`), and the sale line reads the type from the product (`sale_resource_booking/models/sale_order_line.py:73`). That shape allows one branch per service. The appointments bridge owns the offer relation and makes the order line carry the chosen offer; its plan decides how far the OCA link can be reused through its extension points. The product is no longer renamed after its booking type.

Each channel owns what it publishes. The store, WhatsApp and any later channel keep their own list of published products and their publication state.

Stock `product.tag` stays free for the tenant's own grouping. A tag the tenant can edit must not decide behaviour.

### 4.4 Capabilities

| Capability | Allows |
| --- | --- |
| `catalog.products.read` | The catalog |
| `catalog.products.manage` | Create, edit, archive: description, image, category, variants |
| `catalog.prices.manage` | The base price |
| `catalog.settings.manage` | The settings in 4.5 |

A discount or a changed price on one transaction belongs to the application that owns the transaction, as CRM's discount settings do today.

### 4.5 Settings

One settings record per tenant, changed by holders of `catalog.settings.manage` in the root company, readable through the API.

| Setting | Values | Default | Effect on existing data |
| --- | --- | --- | --- |
| Catalog sharing | `establishment`, `branch` | `establishment` | The same transfer as 3.3, applied to products |
| Categories | A tree the tenant defines | One general category | Removing a category moves its products to the parent, after a preview of the product fields they lose |
| Product fields | Per category, a list the tenant defines: label, type, choices | Empty | Removing a field removes its values, after a confirmation that names the count |

Product fields use the stock `product_properties` field and its per-category definition (`odoo/addons/product/models/product_template.py:186`). A clinic can add a preparation note to its services and a retailer a material to its goods. Because the fields are defined per category, moving a product to another category can drop values; the move shows which fields and how many values are affected before it is saved.

Pricing is a single base price in this phase. Pricelists by branch, customer, channel or period are stock Odoo and are added behind the price function when a tenant needs them; they need their own settings and a review of currency handling first. A tenant has one currency: a branch takes the currency of its root company (`odoo/odoo/addons/base/models/res_company.py:111`).

### 4.6 Tax

`taxes_id` exists only when `account` is installed, and a rank-3 catalog on `product` must not require it. A rank-5 bridge `liwan_catalog_account`, installed whenever `liwan_catalog` and stock `account` both are, contributes the default tax and the other accounting fields of a product through the extension hook. A tenant that invoices from finance and collects in cash has it, and so does a tenant with online payments and no finance, because `sale` brings `account`. The effective tax on a line stays in the order service, decided by the company's VAT registration and tax mode, so the price a screen shows, the order and the invoice agree.

### 4.7 Meta catalog

Publishing a catalog to Meta should not depend on online payments being enabled. The target is a bridge between `liwan_inbox` and `liwan_catalog` that owns the catalog models, their sync and the public image route, while `liwan_inbox_payments` keeps the carts that become paid orders. This move waits until the catalog contract in 4.2 is built, and it must preserve the existing product links and `retailer_id` values that Meta already holds.

## 5. Orders

`sale.order` is stock. `liwan_payments` adds the payment deadline, the retained amount and the refund-due amount (`liwan_payments/models/sale_order.py:19`), and its `_liwan_new_order` is the only order factory, elevated and for online payment only (`order_service.py:48`).

Nothing changes in the schema now. When the store starts, a rank-3 `liwan_orders` on `sale` takes the order factory and the tax pricing, and `liwan_payments` keeps the pay state, expiry and refunds. It receives a partner and a product from its caller and depends on neither `liwan_customers` nor `liwan_catalog`. The store design then decides how confirmation, delivery and collection sit on the same model.

## 6. How new kinds of product fit

| Added later | What it needs | Owner |
| --- | --- | --- |
| Physical goods | Variants, barcode, unit | The catalog (4.2) |
| | Stock, warehouses, availability | An inventory application on stock `stock`, contributing its fields through the hook |
| | Shipping and delivery | The store or `liwan_orders` |
| Services | Duration, resources, deposit | Appointments, through booking offers (4.3) |
| | Recurring billing | A subscriptions application that links a product to a plan |
| Bundles | Components | The catalog, with the stock `combo` type |
| Digital content | The file and its delivery | The application that delivers it |

Each of these reuses the customer, order and payment models and adds the extension it needs: a subscription adds a billing cycle, and a booking offer adds a reference on the order line.

## 7. Boundary of this design

A tenant is one database with one root company, one currency and one set of accounts; its branches are child companies. The `group_of_companies` preset is a branch access pattern on that same structure (`liwan_core/models/access_branch.py:15`). A group of separate legal companies, each with its own accounts or currency inside one tenant, is not modelled today and this design does not add it. Such a group is served today as separate tenants.

## 8. Order of work

| Step | Work | Notes |
| --- | --- | --- |
| 1 | `liwan_customers`, with the changes of 3.8 | First, because a customer on the wrong company is wrong data, and the fix removes a `sudo()` case and three creators |
| 2 | `liwan_catalog`, with the changes of 4.3 and the tax bridge of 4.6 | Can be built in parallel with step 1. Booking offers are a part of this step that needs its own plan |
| 3 | Move the Meta catalog to an inbox and catalog bridge | After step 2 |
| 4 | `liwan_orders` | With the store |

Steps 1 and 2 share `tools/arch_layers.json`, `tools/arch_documented_sudo.json`, `tools/arch_baseline.json`, `liwan_inbox_payments/__manifest__.py` and `docs/agents/repository-layout.md`; the orchestrator owns those, merges one pull request and rebases the other.

Both steps change schema and authorization across layers, so each takes the full path: implementer, tester and a reviewer separate from the implementer, with a design review of states and readers before code. Each schema change carries its version bump and migration in the same commit under [migrations.md](../../migrations.md). There are no live tenants, so a migration only carries development data forward.

## 9. What each pull request must prove

Customers:

- Under `establishment`, a customer created in one branch is found by staff who work only in another branch. Under `branch`, it is hidden from them.
- Shared catalog with separate customers: `catalog sharing = establishment` and `customer sharing = branch` in the same tenant.
- A phone shared by two customers: staff are offered both and can create a third; an inbound message links to neither.
- Automatic linking off and on for an inbound WhatsApp message with one match.
- A public form with a matching phone creates a new customer, flags it, and returns nothing of the existing one.
- A settings change is refused for a holder of the capability in a branch only.
- Changing customer sharing in each direction after invoices exist, including a customer with documents in two branches.
- A finance edit and a finance archive go through the service and keep the finance audit entry.
- Each capability of 3.5 is enforced on the server for read, write and export.
- A tenant-defined customer field is saved, returned by the API and cleared by erasure.
- The `sudo()` registry shrinks by the inbox contact case, and no new case is added.

Catalog:

- A product created through the service is visible to staff of every branch under `establishment`.
- One service offered in two branches with different durations; the booking and the order line keep the chosen offer.
- CRM, appointments and the inbox bridge hold no product write ACL and no `sudo()` product write, and the registry shrinks accordingly.
- An order line for a catalog product is taxed exactly as before the change, for a VAT-registered company and for one that is not.
- Editing or archiving a product leaves an existing booking, order line and lead unchanged.
- A product at 100 with a variant extra of 20 shows 120 in the catalog API and on the order line.
- A tenant with finance and no online payments has the default tax on its products.
- Moving a product to another category shows the fields it loses before saving.
- `arch_policy.py` passes with no baseline growth.

Both run in `saas` and `non_saas` (R8), register their features (R10) and add no reference to the control plane (R5).

## 10. Open points

| Point | Proposal | Needs |
| --- | --- | --- |
| The changes in section 2.2 | As written | Owner confirmation |
| Capacity | Not measured. The pass mark is in the [hosting contract](liwan-shared-saas-and-sovereign-deployment.md) | The load test planned there |
| Currency and pricelists in the order service | Not reviewed | A read before pricelists or `liwan_orders` are designed |
| Where the tax mode lives for a tenant with finance and no online payments | Not decided. It is a `liwan_payments` setting today | The catalog plan |
| What stock Odoo does with product field values when the category changes | Not reviewed | The catalog plan |
| How far the OCA booking link can carry several offers per service | Not reviewed | The appointments plan |
| A group of separate legal companies in one tenant | Outside this design (section 7) | An owner decision if a customer needs it |

## 11. Evidence status

| Claim | Status |
| --- | --- |
| The partner creators, their `company_id`, the stock partner and product rules, the request company pin, finance's direct edit and archive | Checked in code on `main` at `b3db19af2` |
| The LiwanOS company fence admits a record with no company and rejects one owned by a company the user holds no capability in | Read in `ir_rule.py`; the first test of step 1 must confirm it |
| `arch_policy.py` rejects a dependency between two addons of the same rank, and none exists today | Checked in code and against the current manifests |
| `liwan_branch_access_mode` controls only parent access into branches | Checked in code |
| `phone_validation` installs with `mail` | Checked in the Odoo manifest |
| Stock `properties` on `res.partner`, `product_properties` per category, `currency_id` delegated to the root company, the product types | Checked in Odoo source |
| The product to booking type link and its use on the sale line, the required requester of a booking | Checked in OCA and LiwanOS source |
| A variant's price extra, the sale line computing its own price | Checked in Odoo source |
| The guest booking page returns the requester's name, phone and email | Checked in code |
| The two product columns, CRM's product ACL, the appointments `sudo()` write, the tax handling | Checked in code |
| Everything in sections 3 to 8 | Design, not built |

## 12. Options rejected

- Phone as a unique customer key: wrong for shared family numbers, and unsafe for a medical record.
- A shared record owned by the root company: hidden from branch staff by the LiwanOS company fence.
- Deriving customer scope from the branch access mode, or catalog scope from customer scope: one setting with two meanings.
- Sector presets for these two services now: the owner asked for free settings first.
- A dependency from one shared service on another: rejected by the layer check.
- A marker column per application on `product.template`: one schema change for every new consumer, and the catalog would know its consumers.
- Product tags to mark packages or listings: the tenant can edit them.
- Taxes inside the catalog: the field needs `account`, and the order service already decides the effective tax.
- Tying the product's accounting fields to online payments: a tenant that invoices and collects in cash would have none.
- Linking a public form to an existing customer by a typed phone number: it would show a visitor another person's data.
- A price function of our own beside the stock computation: the sale line would disagree with the screen.
- A generic master-data addon, an event bus or separate services: the fault is missing ownership of two records, and two small addons fix it inside the existing layers.
