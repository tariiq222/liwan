# Sales (quotations and orders)

Pages: `/sales`, `/sales/new`, `/sales/[id]`, `/sales/[id]/edit`, `/settings/apps/sales`. Owner: `liwan_sales`
(rank-4 application, feature `sales.enabled`). Staff quotations and orders live on `sale.order` beside the online
orders other channels make; an online order is listed with source «طلب إلكتروني» and is read-only in sales. The body of
a write carries no price and no tax: the server prices every product line from the products service. The record page
shows exactly the moves the server returns in `actions`. Personas and status values: [README](README.md).

Persona note: the seed has no sales roles yet. Until it does, the scenarios use custom roles: «مندوب مبيعات»
(`sales.read`, `sales.quotations.manage`, `sales.orders.confirm`) on `crm_agent` and `crm_agent2`, and «مدير مبيعات»
(every sales capability) on `crm_manager`. Customers are picked through `GET /api/v1/customers/pick`, products through
`GET /api/v1/products/pick`.

## List and filters

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-01 | Open the sales list | crm_agent | The list shows number, customer, salesperson, date, state, source and total; under `own` only the agent's documents and the online orders | `page /sales` `GET /api/v1/sales/orders` `cap sales.read` | planned | |
| SALES-02 | Filter by stage, source, «mine only» and search, then open a record and go Back | crm_agent | The filters stay in the URL; Back returns to the same filtered page | `page /sales` `GET /api/v1/sales/orders` | planned | |
| SALES-03 | A user without a sales capability opens `/sales` | staff1 | The page is closed; the list route answers 403 `forbidden` | `page /sales` `cap sales.read` | planned | |
| SALES-04 | Sales feature off | crm_manager | The rail entry and the pages are hidden; every sales route answers 403 `feature_not_included` | `GET /api/v1/sales/orders` | planned | exclusive phase (feature off) |

## Quotations

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-05 | Create a quotation from the panel: pick a customer, a product line, a section and a note | crm_agent | The panel opens over the list from a direct link and after a refresh; the new draft carries the server's price, the settings' validity and default terms, and the agent as salesperson | `page /sales/new` `POST /api/v1/sales/orders` `cap sales.quotations.manage` | planned | |
| SALES-06 | Leave the create panel with unsaved lines | crm_agent | The page asks before leaving | `page /sales/new` | planned | |
| SALES-07 | A reader without the quotation right opens `/sales/new` | custom `sales.read` only | The panel shows the forbidden state; the create route answers 403 | `page /sales/new` `POST /api/v1/sales/orders` `cap sales.quotations.manage` | planned | |
| SALES-08 | Edit a draft: change a quantity, add a line, reorder lines, remove one | crm_agent | The record shows the new lines in order; the kept line keeps its price | `page /sales/[id]/edit` `PATCH /api/v1/sales/orders/<id>` | planned | |
| SALES-09 | Set a discount above the tenant's limit | crm_agent | The form shows the refusal at that line's discount (403 `forbidden`, reason `discount_above_limit`) | `PATCH /api/v1/sales/orders/<id>` `cap sales.discounts.approve` | planned | |
| SALES-10 | The same discount by the manager | crm_manager | The quotation is saved with the discount | `PATCH /api/v1/sales/orders/<id>` `cap sales.discounts.approve` | planned | |
| SALES-11 | A product line with quantity 0 or without a product | crm_agent | The form refuses before sending; a server 422 on `lines.<i>.quantity` shows at that line | `POST /api/v1/sales/orders` | planned | |

## Record and moves

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-12 | Open a quotation | crm_agent | Title is the number, a state tag; lines with amounts and totals; aside with customer, salesperson, dates, validity and terms | `page /sales/[id]` `GET /api/v1/sales/orders/<id>` | planned | |
| SALES-13 | Confirm a draft | crm_agent | The state becomes «مؤكَّد»; the confirm button disappears; lock and cancel appear | `POST /api/v1/sales/orders/<id>/confirm` `cap sales.orders.confirm` | planned | |
| SALES-14 | Lock and unlock a confirmed order; cancel a locked one | crm_agent | Lock shows the «مقفل» tag; a locked order offers no cancel; unlock brings it back | `POST /api/v1/sales/orders/<id>/lock` `POST /api/v1/sales/orders/<id>/unlock` | planned | |
| SALES-15 | Cancel through the inline confirmation, then reopen | crm_agent | Cancel asks first; the order becomes «ملغى»; reopen returns it to «مسودة» | `POST /api/v1/sales/orders/<id>/cancel` `POST /api/v1/sales/orders/<id>/reopen` | planned | |
| SALES-16 | A move the state does not allow (stale page) | crm_agent | The record shows the 403 `transition_forbidden` message | `POST /api/v1/sales/orders/<id>/confirm` | planned | |
| SALES-17 | Duplicate an order | crm_agent | A new draft of the agent opens with fresh prices | `POST /api/v1/sales/orders/<id>/duplicate` | planned | |
| SALES-18 | Change the salesperson of a document | crm_manager | The picker lists `GET /api/v1/sales/salespeople`; the aside shows the new salesperson | `POST /api/v1/sales/orders/<id>/assign` `GET /api/v1/sales/salespeople` `cap sales.documents.assign` | planned | |
| SALES-19 | An agent has no assign button and cannot list salespeople | crm_agent | No button; the salespeople route answers 403 | `GET /api/v1/sales/salespeople` `cap sales.documents.assign` | planned | |
| SALES-20 | Open an online order | crm_agent | Read-only notice that names the payments orders list; no edit or move buttons; every write answers 403 | `page /sales/[id]` `PATCH /api/v1/sales/orders/<id>` | planned | |
| SALES-21 | A colleague's document under `own` | crm_agent2 | The record answers 404; under `all` it opens without edit | `GET /api/v1/sales/orders/<id>` | planned | |
| SALES-22 | Open the edit page of a confirmed order by its link | crm_agent | The page says the document is not editable now | `page /sales/[id]/edit` | planned | |

## Settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-23 | Change visibility, validity days, discount limit and default terms in the root company | crm_manager | Each card saves with the revision; a stale revision answers 409 `conflict` and the card asks to reload | `GET /api/v1/sales/settings` `PATCH /api/v1/sales/settings` `cap sales.settings.manage` | planned | |
| SALES-24 | Open the settings in a branch session | dammam_manager with «مدير مبيعات» | The page is read-only with the reason; a write answers 403 | `PATCH /api/v1/sales/settings` `cap sales.settings.manage` | planned | |
| SALES-25 | A holder without the settings right opens `/settings/apps/sales` | crm_agent | The page is closed | `cap sales.settings.manage` | planned | |
