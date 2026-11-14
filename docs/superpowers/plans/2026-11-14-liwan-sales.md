# `liwan_sales` implementation plan (sales PR 2)

> PR 2 of [the sales application design](../specs/2026-11-14-liwan-sales-design.md). PR 1 (`liwan_orders`) merged as #725 (`3d9af4333`). Status: plan only, written on 2026-11-14; no code exists. The facts of section 3 were read on `main` at `3d9af4333` and in the Odoo 19 checkout by read-only agents, and step 1 of section 6 rechecks each one before any code. The spike of step 2 ran the same day on a scratch database (section 11) and changed D6 and D8 and added D17. Section 5 lists what the owner still decides.

## 1. Goal

Staff write a quotation for a customer, edit it, confirm it as an order, cancel it, reopen it and lock it, from `/sales`, on stock `sale.order`. Online orders appear in the same list, read-only. Sending, the customer's answer, invoices, the CRM and payment links, templates and reports are later pull requests (design, section 8).

## 2. Scope

In this pull request:

- The application `liwan_sales` (rank 4) on `liwan_orders`, `liwan_customers`, `liwan_products` and stock `sale_management`, with its scaffolded AI bridge `liwan_sales_ai` (rank 5).
- Capabilities, the two built-in roles, the tenant settings record and the visibility rule.
- Routes under `/api/v1/sales`, the `sales` contracts namespace and the pages `/sales`, `/sales/new`, `/sales/[id]`, `/sales/[id]/edit` and `/settings/apps/sales`.
- Two changes outside the application that it cannot work without: a pick route in `liwan_customers`, and a read rule for the privacy capabilities in `liwan_payments_customers` (D4, D9).

Not in this pull request, with the pull request that owns each:

| Left out | Owner |
| --- | --- |
| The state `sent`, the e-mail, the PDF, the public page, acceptance, signature, expiry and the settings "Customer answer" and "Acceptance confirms the order" | PR 3 |
| Invoices, down payments, payment terms on the quotation | PR 4 |
| The quotation from an opportunity, the pay link | PR 5 |
| Templates, reports, export, sector presets and the capability `sales.reports.read` | PR 6 |
| Sales teams, an order-level discount, a typed unit price, units other than the product's own, pricelists | No pull request yet; see D6, D7 and O2 |

A capability or a setting is added by the pull request that first uses it, so nothing unused is installed.

## 3. Facts the plan rests on

Stock Odoo 19 (`/Users/tariq/code/odoo/addons`):

- States are `draft`, `sent`, `sale`, `cancel`; `locked` is a separate boolean (`sale/models/sale_order.py:26-31`, `:78`). There is no `done` state and no cancel wizard.
- `action_confirm` accepts `draft` and `sent`, refuses a line without a product, writes `state='sale'` and sends mail only when the context carries `send_email` (`:1168-1233`). `action_cancel` refuses a locked order and cancels draft invoices (`:1326-1340`). `action_draft` moves only `cancel` and `sent` back and silently skips anything else (`:1060`). `action_lock` and `action_unlock` check nothing in Python (`:1320-1325`).
- A line of a locked order refuses a write of product, name, price, unit, quantity, taxes and discount (`sale/models/sale_order_line.py:1423`). A product line of a confirmed order cannot be deleted (`:1455-1480`).
- `price_unit` is a stored compute that reads the order's pricelist. An explicit `price_unit` in the create or write values is kept (`:590-640`, `:1325-1390`).
- `tax_ids` is computed from `product_id` and `company_id` (`:545`), and `liwan_orders` clears it for an establishment that is not registered (`odoo-addons/liwan_orders/models/sale_order_line.py:10-26`).
- `sale.order.copy_data` copies each line's `tax_ids` as an explicit value (`sale_order.py:1021-1031`); `liwan_orders` drops it only for an establishment that is not registered (`liwan_orders/models/sale_order_line.py:28-45`).
- `require_signature` defaults to the company's `portal_confirmation_sign`, which defaults to true (`sale_order.py:353`, `sale/models/res_company.py:15`). `validity_date` defaults from the company's `quotation_validity_days` (`sale_order.py:368`).
- ACL: `sales_team.group_sale_salesman` reads, writes and creates `sale.order` and has full rights on its lines (`sale/security/ir.model.access.csv:32`, `:39`). Rules: that group sees its own and unassigned documents (`sale/security/ir_rules.xml:44`), `group_sale_salesman_all_leads` sees all (`:50`), and the same pair exists for lines (`:70`, `:77`).
- Stock refuses to give a product a company once another company has order lines for it (`sale/models/product_template.py:108-125`).

LiwanOS:

- An application registers capabilities through `liwan.access.service` hooks, permission records, capability groups and built-in roles (`odoo-addons/liwan_crm/models/access_service.py:33-68`, `data/crm_access_permissions.xml`). A capability group may imply a stock group: `group_cap_crm_leads_read` implies `sales_team.group_sale_salesman` and `group_cap_crm_leads_assign` implies `group_sale_salesman_all_leads` (`liwan_crm/security/crm_capability_groups.xml:3-5`).
- CRM's visibility is `own` or `all`. Its `team` value was removed by `liwan_crm/migrations/19.0.1.3.0/post-remove_team_visibility.py`. The holder of `crm.leads.assign` sees every opportunity whatever the setting (`liwan_crm/models/visibility.py:29-57`).
- CRM refuses a discount above the tenant's limit with 403 unless the caller holds `crm.discount.approve` (`liwan_crm/models/crm_lead_flow.py:48-56`). There is no pending state.
- A tenant-wide settings record is a data-installed singleton changed only by a holder of the capability in the working company and in the root company (`liwan_products/models/products_settings.py:10-63`).
- `liwan.products.service._liwan_price(product, quantity, uom, company, customer, date)` returns the unit price as typed and the amounts (`liwan_products/models/products_service.py:309-347`); `_liwan_pick_product` returns an active service product or 404 (`:153`). A consumer registers its feature key, pick capabilities and price capabilities (`:69-80`).
- `liwan.customers.service._liwan_resolve(customer_id=...)` returns an active party the caller can see (`liwan_customers/models/customers_service.py:175`). The only list route needs `customers.read` (`liwan_customers/controllers/customers.py:46-49`); no route lets a holder of a pick capability search customers by name, and the web client has no customer picker.
- An online order is told apart by `liwan_payment_deadline` alone (`liwan_payments/models/order_service.py:9`). `liwan_payments` creates orders elevated, with no salesperson (`:46-62`). Its list and its cron read only orders with a deadline (`:198-218`, `liwan_payments/models/sale_order.py:155-172`).
- `liwan_payments_customers` gives the two privacy capability groups a read ACL on `sale.order` and its lines and searches them as the caller (`security/ir.model.access.csv:2-5`, `models/privacy_hooks.py:59-64`).
- A branch session cannot read the root company's taxes; `liwan_products_account` documents one elevated read for that (`liwan_products_account/models/elevated.py:5-10`).
- `tools/new_app.py` scaffolds the addon, the AI bridge, the contracts namespace and the web manifest, and edits `tools/arch_layers.json`, `deploy/catalog/solutions/platform_v4.json` and `packages/contracts/src/index.ts`. The `liwan-new-app` skill names eleven foundation tests that pin the set of applications.
- Web: an application's pages, components, composables, manifest, locale files, stories and mock routes follow the products pages of #722 (`apps/web/app/pages/products`, `components/products`, `composables/products`, `modules/products/manifest.ts`, `e2e/products-mock-routes.mjs`). The only line editor is inside finance's `InvoiceForm.vue`, which another application may not use (R3). Create forms open in `SharedCreatePanel` on a `/new` route (DESIGN.md, section 5).

## 4. Design points

| # | Point | Decision | Why |
| --- | --- | --- | --- |
| D1 | States and who moves them | The table below. Wire names: `draft`, `sent`, `confirmed`, `cancelled`, plus `locked` | Stock states, kept as the design says |
| D2 | What is a staff document | `sale.order.liwan_staff_document` (boolean, read-only, not copied, indexed), set only by the sales service on create. The wire `source` is `staff` when it is set and `online` otherwise. Every write route refuses a document without it | The deadline cannot be the marker: PR 5 gives a staff quotation a pay link and a deadline. Sales does not depend on `liwan_payments` |
| D3 | Visibility | `own` or `all` (O2). Under `own` a reader sees the documents whose salesperson they are and the ones with no salesperson, which are the online orders. Under `all` a reader sees every document of the company and still writes only their own. The holder of `sales.documents.assign` (O1) sees and writes every document of the company | The stock meaning of "own documents", and CRM's assign rule |
| D4 | How visibility is enforced | No global rule and no rule that neutralises a stock one. `group_cap_sales_read` implies `sales_team.group_sale_salesman`, so the stock rule gives own and unassigned. `group_cap_sales_documents_assign` implies `group_sale_salesman_all_leads`, so the stock rule gives all. Sales adds one read-only group rule per model on `group_cap_sales_read`: `[('company_id', 'in', user.liwan_sales_open_company_ids.ids)]`, a computed field of `res.users` holding the companies where the user reads all. `liwan.sales.visibility._liwan_domain` mirrors it for the routes. Saving the settings clears the registry cache so the rule follows at once | A global rule on `sale.order` would cut finance and the privacy search, which read it under other ACLs. Group rules only add, and the stock groups keep the ACL list out of LiwanOS |
| D5 | Company | A document belongs to the working company. Its customer and every product must be usable there, checked by the two services and by stock's `check_company` | The branch fence |
| D6 | Price of a line | The service asks `_liwan_price` when a line gets its product and writes `price_unit` explicitly, and it writes the stored price again in every write that changes the quantity. The wire accepts no price. Sales never reads `list_price` | Design decision 3, and "a line keeps the name and price it was created with". The spike showed that stock recomputes the price from the list price on a quantity change when the write carries no price, even for a line created with an explicit one |
| D7 | Discount | A percentage on the line, 0 to 100. With a limit above 0 in the settings, a write that sets a line above the limit needs `sales.discounts.approve`, else 403. A value already stored may stay. No pending state | CRM's rule, and the design's "new and edited lines" |
| D8 | Tax | The wire accepts no tax and the serializer reads only the stored amounts of the line and the order, never a tax record | Plan D6 of `liwan_orders`; a branch session cannot read the root's taxes. The spike read the stored amounts as a branch agent without error |
| D9 | Duplicate | `POST .../duplicate` builds a new quotation through the same create path from the source's lines (product, name, quantity, discount). It does not call stock `copy`. Prices come from the price function and taxes from the stock compute. A line whose product can no longer be picked is refused with 422 | The copied `tax_ids` of stock skips the tax compute; PR 1 left this to the first route that copies |
| D10 | Settings in this pull request | One `liwan.sales.settings` record per tenant: `visibility`, `validity_days` (30), `discount_limit` (0, no limit), `default_terms` (empty), `revision`. The service writes `validity_date` and `note` explicitly on create; the stock company fields are not a second store | Design, section 7 |
| D11 | What a staff quotation never does here | `require_signature` and `require_payment` are written false on create, no e-mail leaves on any transition, and expiry is shown but not enforced | PR 3 owns the customer's side |
| D12 | Customer | The wire takes `customer_id`. `liwan_customers` gains `GET /api/v1/customers/pick?q=`, opened by the registered pick capabilities, returning `id`, `name`, `is_company` and the last four digits of the phone. The web gets `SharedCustomerPicker` beside `SharedProductPicker` | The products pick route is the precedent; `customers.read` would open the whole directory to every agent |
| D13 | Privacy | `liwan_payments_customers` adds a read group rule `[(1, '=', 1)]` on `sale.order` and its lines for its two privacy groups | A privacy officer who is also an agent would otherwise export only their own orders once staff quotations exist |
| D14 | Built-in roles | `role_sales_agent`: `sales.read`, `sales.quotations.manage`, `sales.orders.confirm`. `role_sales_manager`: every sales capability. Both also get what picking needs through the registered pick and price capabilities, not through `customers.read` or `products.read` | An agent confirms the order they sold; a tenant that separates the two builds a custom role |
| D15 | Edit after confirmation | Lines and header are editable only in `draft`. A confirmed order is changed by cancel, reopen, edit | One simple rule; stock's partial edits of a confirmed order are not exposed |
| D17 | Writing lines in a branch | The service creates and writes order lines in an elevated environment, after its own checks of capability, visibility, company, customer and product, and returns the records in the caller's environment. One entry in `tools/arch_documented_sudo.json` names the call and the blocking rule | The spike: a branch agent's plain create of a taxed line fails with `AccessError` on the write of `sale.order.line.tax_ids`, because the branch fence hides the root's `account.tax`; the same create passes in a root session. `liwan_products_account` took the same route for the same fence (its D24). The other answer, letting a branch read its establishment's taxes in `liwan_core`, changes the branch policy for every application and is not part of this pull request |
| D16 | Line editor | `components/sales/SalesLinesEditor.vue`, owned by sales | Finance's editor types a name and a price; this one picks a product and shows a price. R3 forbids sharing finance's file |

States (D1). "Own" means the caller is the salesperson or holds `sales.documents.assign`; every row also needs a staff document.

| From | Action | To | Capability | Refused when |
| --- | --- | --- | --- | --- |
| none | create | `draft` | `sales.quotations.manage` | Customer or product not usable in the company; discount above the limit without approval |
| `draft` | edit | `draft` | `sales.quotations.manage`, own | Same as create |
| `draft` | confirm | `confirmed` | `sales.orders.confirm`, own | No product line |
| `draft` | cancel | `cancelled` | `sales.quotations.manage`, own | |
| `confirmed`, not locked | cancel | `cancelled` | `sales.orders.confirm`, own | |
| `cancelled` | reopen | `draft` | `sales.orders.confirm`, own | |
| `confirmed` | lock, unlock | `confirmed` | `sales.orders.confirm`, own | |
| any | duplicate | new `draft` | `sales.quotations.manage`; the source only needs to be readable | D9 |
| any | change salesperson | same | `sales.documents.assign` | The new salesperson does not hold `sales.quotations.manage` in the company |

A transition from a state that is not in the table answers 403 `transition_forbidden`. A document the caller cannot read answers 404.

Readers and writers of `sale.order` after this pull request: the sales service (staff documents), `liwan_payments` (online orders, elevated), the two payment bridges through `liwan_payments`, the privacy hooks (read), and CRM agents at the ORM level through the stock group they already hold (no route).

## 5. Owner decisions

The owner approved the recommended answer of all four on 2026-11-14, in the coordinating session's conversation, after reading this table. The sales design records them as decisions 8 to 11 of its section 9.

| # | Question | Options | Recommended |
| --- | --- | --- | --- |
| O1 | Under `own`, who sees every document and who may change a salesperson? The design's six capabilities name nobody | A: a seventh capability `sales.documents.assign`, held by the manager role, as `crm.leads.assign`. B: `sales.orders.confirm` also sees all. C: nobody; a tenant that needs it sets `all` | A. B ties seeing everything to confirming, and C leaves a manager blind under the default |
| O2 | Does the visibility setting have `team`? The design lists it; CRM removed its own `team` value | A: `own` and `all` now, `team` with a screen for sales teams later. B: `team` now, which adds teams, their members and their management to this pull request | A |
| O3 | How is Sales sold? The scaffold adds a sellable tier `sales` with `sales.enabled` to the catalog; no price exists | A: its own application, priced before launch. B: included with CRM | A for the build. The price and whether it joins release 1 are separate decisions, not needed to write the code |
| O4 | Design decision 8 says products PR 4 merges before sales writes orders for a tenant; products PR 3 to PR 6 are not started | A: it gates the release of sales, and PR 2 is built now. B: it gates the build, and PR 2 waits for products PR 4 | A. Nothing is released, and D5 keeps a product inside companies that may use it |

## 6. Tasks

Full path: failing tests first, a Sonnet implementer per slice, a tester, and a reviewer separate from the implementers. One writer per file.

1. **Recheck.** Every fact of section 3 on the then current `origin/main`, with line numbers. Also: whether `platform_v4.json` is published (a new application then needs `platform_v5.json` and the owner's word); whether the eleven pinned foundation tests still fail on a new application; that the `_action_confirm` and `_action_cancel` overrides of `liwan_inbox_payments` do nothing for an order without inbox lines; that confirming posts no e-mail and subscribes no customer. A fact that fails stops the work at that line. Read on 2026-11-14 on `main` at `3d9af4333`: the two overrides of `liwan_inbox_payments` act only on orders with inbox lines (`liwan_inbox_payments/models/sale_order.py:8-33`), and `_liwan_past_deadline` is false without a deadline (`liwan_payments/models/sale_order.py:63-65`); stock `action_confirm` sends mail only with `send_email` in the context and subscribes nobody (`sale/models/sale_order.py:1168-1198`), and the spike agrees. Still open: the pinned tests can only be seen failing after the scaffold, and the repository does not record whether `platform_v4.json` was published, so the owner or the operator answers that before step 4.
2. **Spike, thrown away.** Done on 2026-11-14 (section 11): a branch-only user holding only the stock salesman group through a capability creates and confirms a taxed quotation, and a second user is refused. It proved the stock part of D4 and D8, refuted a plain line write in a branch (D17) and corrected D6.
3. **Foundation tests.** Generalise the pinned tests of step 1 in their own commit, before the scaffold.
4. **Scaffold.** `python3 -B tools/new_app.py sales --name-ar "المبيعات" --name-en "Sales"`; add `liwan_orders`, `liwan_customers`, `liwan_products` and `sale_management` to the manifest.
5. **Odoo, tests first for every line of section 7.** Capabilities, groups, roles, the one rule per model, `res.users.liwan_sales_open_company_ids`, `liwan.sales.settings` and its data record, `liwan.sales.visibility`, the service (`_liwan_create`, `_liwan_update`, the transitions, `_liwan_duplicate`), serializers, controllers, the feature registry, and the registration of the feature key and the pick and price capabilities in the two shared services. The AI bridge's read tool uses the visibility domain.
6. **Outside the application.** The customers pick route with its tests in `liwan_customers`; the privacy read rule with its test in `liwan_payments_customers`.
7. **Contracts.** `packages/contracts/src/sales/index.ts`, field for field with the serializers, and its schema tests.
8. **Web, after the contracts are fixed.** Manifest, the five pages, `components/sales` (directory, table, form, lines editor, record details, settings card), `composables/sales`, `SharedCustomerPicker` with its story and its entry in `STORYBOOK_COMPONENTS`, locale files in `ar` and `en`, stories, `e2e/sales-mock-routes.mjs` wired into the mock server, the mock contract test, the catalog rows in `docs/design-system/components.md`, and `e2e/scenarios/sales.md`.
9. **Orchestrator files.** `docs/agents/repository-layout.md`, the release-list copies, and this plan's evidence table.

Routes of step 5, all `type='json2'`, `auth='user'`, `api_handler`, `requires_feature('sales.enabled')`, then a capability:

| Route | Capability |
| --- | --- |
| `GET /api/v1/sales/orders` (`q`, `state`, `source`, `mine`, `limit`, `offset`) | `sales.read` |
| `GET /api/v1/sales/orders/<id>` | `sales.read` |
| `POST /api/v1/sales/orders`, `PATCH /api/v1/sales/orders/<id>` | `sales.quotations.manage` |
| `POST .../confirm`, `.../reopen`, `.../lock`, `.../unlock` | `sales.orders.confirm` |
| `POST .../cancel` | `sales.quotations.manage` or `sales.orders.confirm`, decided by the state |
| `POST .../duplicate` | `sales.quotations.manage` |
| `GET /api/v1/sales/salespeople` | `sales.documents.assign` |
| `GET /api/v1/sales/settings` | `sales.read` or `sales.settings.manage` |
| `PATCH /api/v1/sales/settings` | `sales.settings.manage`, in the root company |

The order's wire shape: `id`, `number`, `state`, `locked`, `source`, `customer`, `salesperson` (a `PersonRef`), `validity_date`, `date`, `terms` (plain text), `currency`, `amount_untaxed`, `amount_tax`, `amount_total`, `lines` and `actions` (what the caller may do now). A line: `id`, `kind` (`product`, `section`, `note`), `product`, `name`, `quantity`, `unit`, `unit_price`, `discount_percent`, `amount_untaxed`, `amount_tax`, `amount_total`. A write sends `customer_id`, `salesperson_id`, `validity_date`, `terms` and the whole `lines` list, each line with `id` when it exists, `kind`, `product_id`, `name`, `quantity` and `discount_percent`.

## 7. PR 2 proves

Each line is a test. Lines marked (modes) run in `saas` and `non_saas`; lines marked (sessions) run in a root session and a branch session.

Access:

- Every route answers 403 `feature_not_included` with `sales.enabled` off, and 403 without its capability. (modes)
- Under `own`: an agent lists and reads their own documents and the online orders, and gets 404 for a colleague's. Under `all`: they read a colleague's and get 403 on its edit. The assign holder reads and edits all. The route's domain and an ORM search as the same user return the same records in each case. (sessions)
- A role in company A gives nothing in company B. A user without a sales capability who holds the finance invoice group reads what they read before this pull request.
- A change of the visibility setting, and the grant or removal of the assign capability, apply on the next request.
- A privacy officer who is also an agent under `own` exports every order of the subject.
- The settings are read by a reader, changed only in the root company by a holder of the capability, and a stale `revision` answers 409.

Documents:

- A created quotation is `draft`, belongs to the working company, carries the staff marker, the caller as salesperson, the validity date of the setting and the default terms, and requires neither signature nor payment. (sessions)
- A line's price is the unit price of the price function for that product, quantity, company and customer; a change of quantity keeps it; a change of product takes the new one. A payload with a price or a tax is refused with 422.
- Registered establishment: 100 at 15% gives 115 with a tax-excluded tax and 100 with a tax-included one. Not registered: no tax, under both. (sessions)
- A discount above the limit is 403 for an agent and saved for an approver; with a limit of 0 any discount up to 100 is saved; a stored value above a lowered limit survives an edit that leaves it alone.
- A customer or a product of another branch, an archived one, and a product the service does not own are each refused with 422 on their field.
- Section and note lines are saved in order and carry no amount.
- In a branch session of a registered establishment, a taxed line is created, its quantity and its product are changed, and each write keeps the right tax and price; a branch agent gets 404 or 403, never a written line, on a document they may not edit. The elevated write has its entry in `tools/arch_documented_sudo.json`. (D17)
- Each row of the state table moves as written, and each move outside it answers 403 `transition_forbidden`. A locked order refuses cancel. An order with no product line refuses confirm.
- An online order is listed with `source` `online` and every write route refuses it.
- Duplicate: the copy is a new draft of the caller with fresh prices. An untaxed quotation written before the establishment registered is duplicated with tax, and a taxed one is duplicated without tax after the registration ends. A source with a product that can no longer be picked is refused.
- No e-mail is queued by create, confirm, cancel or reopen, and the customer is not added as a follower.
- With `liwan_inbox_payments` and `liwan_appointments_payments` installed, confirming and cancelling a staff order leaves their records alone, and the payments list and the expiry cron never see a staff order.

Pick route and web:

- `GET /api/v1/customers/pick` answers a holder of a registered pick capability, hides what the caller's company cannot see, returns no phone beyond four digits, and is 403 for anyone else.
- The manifest opens `/sales` to a reader and `/sales/new` and `/sales/[id]/edit` to a writer, and closes all with the feature off.
- Each mock answer parses with the contracts. The list keeps its filters in the URL and Back returns to them; the create panel opens from a direct link; an unsaved form asks before leaving.

## 8. Checks before the push

- `npm run test:odoo -- --addons liwan_sales,liwan_sales_ai,liwan_orders,liwan_customers,liwan_products,liwan_payments,liwan_payments_customers,liwan_inbox_payments,liwan_appointments_payments`, through `agent-local-load heavy`, on a scratch database.
- `deploy/ci/odoo-app-standalone.sh liwan_sales` and `deploy/ci/odoo-bridge.sh liwan_sales_ai`.
- `python3 -B -m unittest discover -s tools`, `tools/arch_policy.py` with and without `--base origin/main`, `tools/git_policy.py`, `tools/sudo_gate.py`, `tools/catalog_check.py`, `tools/docs_policy.py`, `tools/ui_policy.py`, `tools/e2e_scenario_coverage.py --check --app sales`, `ruff check odoo-addons`.
- `npm -w packages/contracts run test`, `npm -w apps/web run test`, `npm -w apps/web run lint`.
- The pages in Arabic and English, light and dark, at 390, 768 and 1440 pixels, on the isolated mock stack.
- A review of the whole diff by a reviewer who wrote none of it.

## 9. Risks

| Risk | Answer |
| --- | --- |
| A branch session cannot write a taxed line through the plain ORM | Found by the spike; D17. The elevated write sits behind the service's own checks, and section 7 proves a branch agent cannot write a line of a document they may not edit |
| A later stock method reads a root record as the branch user (a change of product, an invoice in PR 4) | Each transition of the state table is tested in a branch session; the spike already passed confirm, lock, unlock, cancel and reopen |
| The stock "own documents" rule also lets an agent write an online order at the ORM level | No route writes a document without the staff marker, and Odoo's generic endpoints are closed. Recorded here, not hidden |
| A CRM agent already holds the stock salesman group and reads own and unassigned orders at the ORM level | True on `main` today for online orders; no sales route answers without a sales capability |
| Products PR 3 adds variants, and a line stores the first variant of the picked product | The service takes the variant from the product service in one place; PR 3 changes that place |
| The pull request is large (two addons, a shared-service route, contracts, five pages) | Slices are separate commits with their own tests; the web starts only after the contracts are fixed. It stays one pull request, as the design's row 2 says |
| `platform_v4.json` is already published | Step 1 finds it; the answer is a new catalog version and the owner's word |
| Another pull request edits `tools/arch_layers.json`, the catalog or the release-list copies at the same time | The scaffold and step 9 run on a branch started after that pull request merges, under a claim |

## 10. Where the work runs

PR 2 is long and touches authorization, so it belongs in the lane `claude-2`, on its own branch from `origin/main`, never together with other fixes. On 2026-11-14 `claude-2` carries `platform-integrations-service` and `claude-1` carries the follow-ups of issue 724, so the build waits for `claude-2` to return. Step 1 and the owner's answers to section 5 need no lane.

## 11. Evidence status

| Claim | Status |
| --- | --- |
| Section 3 | Read on `main` at `3d9af4333` and in the Odoo 19 checkout on 2026-11-14; not run; rechecked in step 1 |
| The stock part of D4: own and unassigned for the salesman group, all for the all-documents group, nothing across companies | Run on 2026-11-14 in a throwaway addon outside the repository, on a scratch database built from `main` at `3d9af4333`, with CRM's `crm.leads.read` and `crm.leads.assign` standing in for the sales capabilities: a second branch agent is refused read and write of the order and its line, the assign holder reads and writes it, an agent of the root alone does not reach the branch, every agent reads an unassigned order, and a user without the group is refused by the ACL |
| The added `all` rule of D4 and the route domain | Not run; they need the application's own rule and field |
| A branch agent's plain create of a taxed line | Refuted by the same run: `AccessError` on the write of `sale.order.line.tax_ids`. A root agent's create in the root passes (D17) |
| With the line written elevated, a branch agent reads the stored amounts (86.96, 13.04, 100.00 under a tax-included tax), edits quantity and discount, confirms, locks, unlocks, cancels and reopens | Run, same spike |
| A quantity change keeps an explicit price | Refuted: 100.0 became the list price 50.0 (D6) |
| Create and confirm queue no e-mail and do not add the customer as a follower | Run, same spike: no `mail.mail` row, the only follower is the agent |
| A branch agent reading the tax record itself | Not settled: the read passed right after the elevated write, which may have been the cache. D8 does not depend on it |
| Sections 4 to 8 | Plan; nothing is built |
| O1 to O4 | Approved by the owner on 2026-11-14: the recommended answer of each (section 5) |
