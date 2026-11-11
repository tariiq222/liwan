# Customers and catalog foundation design

Status: the owner approved the direction and the three defaults in section 2 on 2026-11-11. Nothing here is implemented in any branch. The evidence is a read of `main` at `b3db19af2`; no test was run and no load was measured. Section 9 lists which claims were checked in code and which are proposals.

This file records the design. It does not change the rules in [AGENTS.md](../../../AGENTS.md). [repository-layout.md](../../agents/repository-layout.md) and `tools/arch_layers.json` change in the pull requests that build it.

## 1. Problem

The store, bookings and medical practice applications the owner plans all need a customer, a product or service, an order, a payment and an invoice. Today the customer and the product are shared only because every application writes the same Odoo tables. No LiwanOS addon owns either record.

Customer (`res.partner`):

- Three places create a partner, each with its own values: appointments (`liwan_appointments/controllers/appointment_bookings.py:292`), finance (`liwan_finance/controllers/finance_partners.py:134`) and the WhatsApp contact at its first checkout, through `sudo()` (`liwan_inbox_payments/models/contact.py:19`).
- All three set `company_id` to the current company. A branch is a child `res.company` of the root (`liwan_platform/models/tenant_profile.py:567`), every request pins `allowed_company_ids` to the current company (`liwan_api/controllers/common.py:275`), and the stock partner rule shows a partner only to companies at or below the partner's own (`odoo/addons/base/security/base_security.xml:19`). A customer created in one branch is invisible in the next branch, which then creates the same person again.
- Nothing matches a new partner against existing ones. The only phone match is on `crm.lead` (`liwan_crm/models/crm_lead.py:48`), and its normaliser is private to CRM (`crm_lead.py:68`).
- `liwan_crm` never links a lead to a partner. `liwan.inbox.contact` is a separate record by design (`liwan_inbox/models/contact.py:6`). The owner decision of 2026-11-06, one customer record across inbox contact, lead and orders, is therefore not implemented.
- There is no customer merge and no customer erasure.

Product (`product.template`):

- Two per-application columns mark whose product a row is: `liwan_crm_package` (`liwan_crm/models/product_template.py:8`) and `liwan_inbox_catalog` (`liwan_inbox_payments/models/product.py:16`). A third link, OCA `resource_booking_type_id`, ties a product to a booking type.
- Each application creates and edits its products under its own capability. The CRM settings manager holds an unrestricted write ACL on every product (`liwan_crm/security/ir.model.access.csv:10`). Appointments writes products through `sudo()` (`liwan_appointments_payments/models/resource_booking_type.py:94`). The WhatsApp catalog editor creates its own (`liwan_inbox_payments/controllers/catalog_items.py:67`).
- Tax is handled three ways: CRM clears product taxes on create (`liwan_crm/controllers/lists.py:317`), the payments order service re-prices the tax on every line from the company's VAT status and tax mode (`liwan_payments/models/order_service.py:77`), and the other creators leave the default.
- The whole Meta commerce catalog lives in `liwan_inbox_payments`, a bridge that installs only when payments is installed, and its routes are gated by `inbox.catalog` (`liwan_inbox_payments/controllers/catalog_items.py:80`).

Each new application built this way adds one more partner creator, one more product column and one more bridge per application it touches.

## 2. Decisions

Approved by the owner on 2026-11-11:

1. Two shared services at rank 3 own the two records: `liwan_customers` and `liwan_catalog`. Applications call them and stop writing the tables directly.
2. Customer scope is an explicit setting with two values, establishment or branch. The default is establishment. A tenant whose branch preset is `group_of_companies` starts on branch.
3. One catalog and one price per establishment. A price per branch comes later through stock pricelists and is not built now.
4. Erasing a customer who has posted invoices anonymises the customer. The invoices keep their numbers and amounts.

Settled in the design review that produced this file:

5. `res.partner` is the commercial party: who is contacted and who is billed. A phone number suggests a match and is never unique on the partner, because one number can serve several members of a family.
6. An application that needs a distinct person (a patient, a dependant on a booking) owns its own model with a `Many2one` to the partner. Several persons may share one partner.
7. The catalog does not own taxes. The effective tax stays on the order line, computed as today.
8. The order schema does not change now. A rank-3 `liwan_orders` service is created when the store starts. Until then no store logic is added to `liwan_payments`.

This design implements the 2026-11-06 decision on one customer record.

## 3. `liwan_customers`

### 3.1 Place in the layers

Rank 3, depends on `liwan_api` and `phone_validation`. It names no application. `liwan_core` cannot own it because R1 limits it to `base`, and `liwan_directory` is the user picker with a different population and contract.

`phone_validation` installs itself whenever `mail` is present (`odoo/addons/phone_validation/__manifest__.py:28`), and every current application brings `mail`. The service still declares the dependency so that `phone_sanitized` on `res.partner` is guaranteed by the addon that reads it.

### 3.2 What the service owns

- One create path for a commercial party, and the identity fields it writes: `name`, `phone`, `email`, `company_id`.
- The phone normaliser, moved out of `crm.lead` so that CRM, appointments, inbox and finance read numbers the same way.
- The candidate search and the matching policy in 3.4.
- The customer scope setting in 3.3.
- Merge, archive and erasure (3.6).
- The capabilities `customers.read` and `customers.manage`, and the routes under `/api/v1/customers` with `{items, total}` list envelopes. The routes are gated with `requires_registered_feature`, and each consuming application registers its feature key, as applications do for `/api/v1/people`.
- Its own marker in the `res.partner` write guard (`liwan_core/models/res_partner.py:49`), so a customer write by a protected actor is allowed only through the service.

Finance keeps its accounting fields on the same record (VAT number, registry, address, customer and vendor ranks, bank accounts) behind its own routes and capabilities. A vendor is a finance kind on the same commercial party and is created through the same service.

Every internal user can read every partner field at ACL level; the routes are the gate, and the Odoo client is closed by the `ir.http` guard. The service keeps it that way and adds no path that returns partner fields without `customers.read` or the consuming application's own capability.

### 3.3 Customer scope setting

| Item | Value |
| --- | --- |
| Owner | `liwan_customers` settings, one row per tenant |
| Values | `establishment`: `company_id` is the root company. `branch`: `company_id` is the branch that created the customer |
| Default | `establishment`; `branch` when the branch preset is `group_of_companies` |
| Effect | Under `establishment` every branch finds and reuses the same customer. Under `branch` the stock partner rule hides a branch's customers from its siblings and from the root |
| Visibility of documents | Unchanged. Bookings, invoices, conversations and leads stay under each application's and branch's own rules in both modes |

The setting is separate from `liwan_branch_access_mode`. That mode decides whether the parent's users may act inside branches (`liwan_core/models/access_branch.py:141`); it says nothing about records shared between sibling branches, and giving it a second meaning would force every partner to change owner whenever the mode changes.

Who may change the setting and what a change does to existing customers is an open point (section 8).

### 3.4 Matching policy

The service returns the partners in scope whose `phone_sanitized` equals the normalised number.

| Matches | A person is present | Unattended (inbound WhatsApp) |
| --- | --- | --- |
| None | Create | Create |
| One | Suggest it; the person confirms or creates a new customer | Link |
| Two or more | The person chooses one or creates a new customer | Leave unlinked and show it for a person to resolve |

A create that has candidates answers `409 conflict` with the candidate list. The caller repeats the request naming an existing customer or stating that a new one is wanted. The service never merges on its own.

### 3.5 What changes in each consumer

- Appointments: `_requester` calls the service. Its own create, its `company_id in [False, current]` lookup, which rejects a root-owned customer from a branch (`appointment_bookings.py:297`), and the partner create ACL of the bookings capability are removed.
- Customer messages: `partner_id` moves from the payments bridge to `liwan_inbox`, which may depend on a rank-3 service. A contact is linked when its conversation starts, under the unattended column above, so the link no longer waits for a checkout. The contact stays the channel identity. The `sudo()` create in `liwan_inbox_payments/models/contact.py` and its entry in `tools/arch_documented_sudo.json` are deleted. Placing an order needs a partner at once (`liwan_inbox_payments/models/order.py:183`), so an unlinked contact makes the order request answer with the candidates for the agent to choose.
- CRM: the lead keeps its one-phone-per-company index, which is a lead deduplication policy of CRM. The stock `partner_id` of the lead is set when staff link the lead to a customer, and at the latest when the lead is won, through the same suggest flow. Early leads stay unlinked.
- Finance: `POST /api/v1/finance/partners` creates through the service and then writes its accounting fields.
- Payments: no change. The order service receives a partner as it does today.

### 3.6 Merge, archive and erasure

Merge keeps one partner and repoints every document. Stock Odoo ships `base.partner.merge.automatic.wizard`; the plan must evaluate reusing its merge before writing one.

Erasure replaces the name with a placeholder, clears phone, email, address and image, and archives the partner. Posted invoices keep their numbers and amounts. Each application that holds a person or channel record for the customer clears its own data through a hook the service calls.

### 3.7 Sensitive persons

The medical application owns the patient and the visit, with their own capabilities and record rules, in the way payroll is isolated inside HR. No clinical field and no chatter goes on `res.partner`. The name of a service on a booking or an invoice line can itself reveal a diagnosis; the medical design has to handle that and it is outside this file.

## 4. `liwan_catalog`

### 4.1 Place in the layers

Rank 3, depends on `liwan_api` and `product`. `liwan_crm`, `liwan_payments` and the bridges that touch products depend on it. It knows none of its consumers.

### 4.2 What the service owns

- The fields `name`, `type`, `list_price`, `image_1920`, `description_sale`, `default_code`, `active`, `sale_ok` and `company_id`.
- `company_id` is the root company, so one catalog serves every branch. The stock product rule has the same shape as the partner rule (`odoo/addons/product/security/product_security.xml:36`), so a product created on a branch has the same visibility fault as a customer.
- The capabilities `catalog.products.read` and `catalog.products.manage`, the routes under `/api/v1/catalog`, and the "Products and services" screen, built from the Storybook catalog under [DESIGN.md](../../../DESIGN.md).
- An extension hook through which another addon contributes product fields to the catalog's serializer and parser, in the way applications extend the company profile.

Applications lose their direct product ACLs and their `sudo()` product writes.

### 4.3 How each application records its use of a product

The catalog holds no column per consumer. Each application keeps the relation in its own models:

- CRM: the packages a company offers become a relation on `liwan.crm.settings`. The `liwan_crm_package` column, the three domains that read it (`crm_lead.py:23`, `controllers/sale.py:24`, `models/intake.py:214`) and CRM's product create and its tax clearing are replaced.
- Customer messages: `liwan.inbox.catalog.item` already states which products are listed in Meta. The `liwan_inbox_catalog` column and the bridge's own product editor go. The product write override that triggers a Meta resync stays with the catalog items, because it is inbox behaviour reacting to a catalog change.
- Appointments: a booking type picks an existing service from the catalog or creates one through the catalog service. The OCA `resource_booking_type_id` link and its unique constraint stay. Appointments keeps duration, resources and the deposit. The product is no longer renamed after its booking type; an invoice line carries the catalog name.

Stock `product.tag` stays free for the tenant's own grouping. A tag the tenant can edit must not decide behaviour.

### 4.4 Tax

`taxes_id` exists only when `account` is installed, and a rank-3 catalog on `product` must not require it. The default tax of a product is contributed through the extension hook by `liwan_payments`, where `account` is always present because `sale` brings it, and by `liwan_orders` once that exists. The effective tax on a line stays where it is today, in the order service, decided by the company's VAT registration and tax mode.

### 4.5 Meta catalog

Publishing a catalog to Meta should not depend on online payments being enabled. The target is a bridge between `liwan_inbox` and `liwan_catalog` that owns the catalog models, their sync and the public image route, while `liwan_inbox_payments` keeps the carts that become paid orders. This move waits until the catalog contract in 4.2 is built, and it must preserve the existing product links and `retailer_id` values that Meta already holds.

## 5. Orders

`sale.order` is stock. `liwan_payments` adds the payment deadline, the retained amount and the refund-due amount (`liwan_payments/models/sale_order.py:19`), and its `_liwan_new_order` is the only order factory, elevated and for online payment only (`order_service.py:48`).

Nothing changes in the schema now. When the store starts, a rank-3 `liwan_orders` (depending on `sale`, `liwan_catalog` and `liwan_customers`) takes the order factory and the tax pricing, and `liwan_payments` keeps the pay state, expiry and refunds. The store design then decides how confirmation, delivery and collection sit on the same model.

## 6. Order of work

| Step | Work | Notes |
| --- | --- | --- |
| 1 | `liwan_customers`, with the changes of 3.5 | First, because a customer on the wrong company is wrong data, and the fix removes a `sudo()` case and three creators |
| 2 | `liwan_catalog`, with the changes of 4.3 | Can be built in parallel with step 1 |
| 3 | Move the Meta catalog to an inbox and catalog bridge | After step 2 |
| 4 | `liwan_orders` | With the store |

Steps 1 and 2 edit no common file inside the addons. They share `tools/arch_layers.json`, `tools/arch_documented_sudo.json`, `tools/arch_baseline.json`, `liwan_inbox_payments/__manifest__.py` and `docs/agents/repository-layout.md`; the orchestrator owns those, merges one pull request and rebases the other.

Both steps change schema and authorization across layers, so each takes the full path: implementer, tester and a reviewer separate from the implementer, with a design review of states and readers before code. Each schema change carries its version bump and migration in the same commit under [migrations.md](../../migrations.md). There are no live tenants, so a migration only carries development data forward: partner `company_id` set from the scope setting, the two product columns dropped, and CRM packages moved into the settings relation.

## 7. What each pull request must prove

Customers:

- Under `establishment`, a customer created in one branch is found from another branch. Under `branch`, it is hidden from the sibling and from the root.
- The three rows of the matching table, for a present person and for the unattended path.
- An order placed for an unlinked contact with two candidates is refused with the candidates, and succeeds once one is chosen.
- `customers.read` and `customers.manage` are enforced on the server for read, write and export.
- The `sudo()` registry shrinks by the inbox contact case, and no new case is added.

Catalog:

- A product created through the service is visible in every branch.
- CRM, appointments and the inbox bridge hold no product write ACL and no `sudo()` product write, and the registry shrinks accordingly.
- An order line for a catalog product is taxed exactly as before the change, for a VAT-registered company and for one that is not.

Both run in `saas` and `non_saas` (R8), register their features (R10) and add no reference to the control plane (R5).

## 8. Open points

| Point | Proposal | Needs |
| --- | --- | --- |
| Changing customer scope after customers exist | Allow branch to establishment: partners move to the root and probable duplicates are listed for merge. Refuse establishment to branch once customers exist, because the owning branch cannot be derived | Owner confirmation |
| Catalog scope for `group_of_companies` tenants | Follow the customer scope setting, so separately run companies do not share a price list | Owner confirmation |
| Who holds `customers.read` by default | Staff of applications that pick customers see name and phone in the picker; the full customer list needs the capability | Owner confirmation |
| Capacity | Not measured. The pass mark is in the [hosting contract](liwan-shared-saas-and-sovereign-deployment.md) | The load test planned there |
| Currency and pricelists in the order service | Not reviewed | A read before `liwan_orders` is designed |

## 9. Evidence status

| Claim | Status |
| --- | --- |
| The three partner creators, their `company_id`, the stock partner and product rules, the request company pin | Checked in code on `main` at `b3db19af2` |
| `liwan_branch_access_mode` controls only parent access into branches | Checked in code |
| `phone_validation` installs with `mail`; every current application brings `mail` | First part checked in the Odoo manifest; second part reported by the second reviewer from the manifests |
| The two product columns, CRM's product ACL, the appointments `sudo()` write, the tax handling | Checked in code |
| Steps 1 and 2 share no file inside the addons | Reported by the second reviewer from a search; to be rechecked when the plans are written |
| Everything in sections 3 to 6 | Design, not built |

## 10. Options rejected

- Phone as a unique customer key: wrong for shared family numbers, and unsafe for a medical record.
- Deriving customer scope from the branch access mode: one field with two meanings.
- A marker column per application on `product.template`: one schema change for every new consumer, and the catalog would know its consumers.
- Product tags to mark packages or listings: the tenant can edit them.
- Taxes inside the catalog: the field needs `account`, and the order service already decides the effective tax.
- A generic master-data addon, an event bus or separate services: the fault is missing ownership of two records, and two small addons fix it inside the existing layers.
