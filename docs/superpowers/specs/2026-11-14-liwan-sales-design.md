# Sales application design

> Status: design written on 2026-11-14 at the owner's request ("build sales completely, on the Odoo module"). The owner decided two things in that request: the application is built now, and it stands on stock Odoo `sale`. The owner approved the eight points of section 9 the same day, each as recommended. Nothing here is built. Facts were read on `origin/main` at `65cb936d0`, after products PR 1 merged, and in the Odoo 19 checkout; none was run (section 10). The owner moved the draft from the Codex session to a Claude session the same day; this file supersedes the copy on `codex/sales-build` (`f3e819604`).

## 1. Problem

LiwanOS has no sales application. A tenant can win a CRM opportunity with a package and a price, take an online order through payments and write a customer invoice in finance, but staff cannot write a quotation, send it, have it accepted, confirm it as an order and invoice it.

`sale.order` is already in every tenant that has online payments: `liwan_payments` depends on `sale` and its `_liwan_new_order` is the only order factory, elevated and for online payment only (`liwan_payments/models/order_service.py:46`). No LiwanOS user holds a sales right, and no route writes an order line a member of staff typed.

## 2. Decisions

| # | Decision | Source |
| --- | --- | --- |
| 1 | The application is `liwan_sales`, rank 4, on stock `sale`. `sale.order` and `sale.order.line` are extended, never recreated (R9) | Owner, 2026-11-14 |
| 2 | It is built now, ahead of the store that the foundation design tied orders to ([section 5 there](2026-11-11-customers-and-products-foundation-design.md#5-orders)) | Owner, 2026-11-14 |
| 3 | A customer comes from `liwan_customers` and a product, with its price, from `liwan_products`. Sales creates neither and never reads `list_price` | Foundation design 3.2 and 4.2 |
| 4 | The tax on a line is the company's tax mode, applied by stock, with the one rule that an establishment not registered for VAT charges none | Products plan, PR 1, merged as #711 |

## 3. Place in the layers

| Addon | Rank | Depends on | Owns |
| --- | --- | --- | --- |
| `liwan_orders` | 3 | `liwan_api`, `sale`; installs itself with the two | The tax rule of decision 4 on the order line. The order factory joins it when the store starts ([foundation design, section 5](2026-11-11-customers-and-products-foundation-design.md#5-orders)) |
| `liwan_sales` | 4 | `liwan_orders`, `liwan_customers`, `liwan_products`, `sale_management` | Quotations and orders written by staff, their settings, capabilities, routes under `/api/v1/sales` and the pages under `/sales` |
| `liwan_sales_finance` | 5 | `liwan_sales`, `liwan_finance` | Invoices made from an order, and the links between the two |
| `liwan_sales_crm` | 5 | `liwan_sales`, `liwan_crm` | A quotation from an opportunity, and the opportunity won when its order is confirmed |
| `liwan_sales_payments` | 5 | `liwan_sales`, `liwan_payments` | The pay link of a quotation and its confirmation by payment |
| `liwan_sales_ai` | 5 | `liwan_sales`, `liwan_ai` | The agent and its read tool, as `tools/new_app.py` scaffolds them |

`liwan_orders` is step 4 of the foundation design, brought forward for the tax rule. Without it the rule would live twice, in payments and in sales, or sales would depend on the payment gateway to tax a line.

The tax rule of decision 4 sits on the line's stock tax compute, extended in `liwan_orders` (point 7 of section 9). A line of an establishment that is not registered then carries no tax when it is created and after every edit, whether an online channel or a member of staff wrote it. When the establishment's registration changes later, a document keeps what it was issued with, as online orders do today (`liwan_payments/tests/test_vat_registered.py`).

`liwan_orders` installs itself wherever `liwan_api` and stock `sale` are installed, as `liwan_api_account` does with stock `account`, so the rule holds without a caller naming the addon. `liwan_payments` cannot name it: both are rank 3, and a layered addon reaches a strictly lower rank only (`tools/arch_policy.py:168-177`). The two payment bridges cannot either: the bridge job accepts a bridge with exactly two sides (`tools/app_isolation.py`, `deploy/ci/odoo-bridge.sh`). `liwan_sales` depends on it by name.

The order factory stays in `liwan_payments` and drops its own copy of the tax rule. It moves to `liwan_orders` when the store starts, as the foundation design says, and the store design decides how its callers reach both services.

## 4. What the application does

Stock states are kept: `draft` (quotation), `sent`, `sale` (order), `cancel`, with `locked` and `invoice_status` as stock computes them.

- **Quotation.** Customer, validity date, payment terms, salesperson, team, notes and terms. Lines: a product picked from the product service, quantity, unit, the unit price the price function returns, a discount, the taxes stock picks, and section and note lines. A line keeps the name and price it was created with.
- **Templates.** Stock quotation templates (`sale_management`): a named set of lines, validity and terms that starts a quotation.
- **Send.** The PDF and an e-mail to the customer with a link.
- **Customer answer.** The link opens a page under the public namespace, authorized by the order's own access token (`portal.mixin` on `sale.order`): the customer reads the quotation, accepts or declines, and signs when the tenant asks for a signature. The Odoo portal stays closed.
- **Confirm, cancel, reopen, lock.** By staff, or by the customer's acceptance when the tenant allows it. A quotation past its validity date is marked expired and is not confirmable until staff extend it.
- **Invoice.** From a confirmed order, through `liwan_sales_finance`: the whole order, or a down payment as a percentage or an amount, with stock's `sale.advance.payment.inv` logic. The order shows what is invoiced and what is paid. Stock copies each order line's product, unit price, discount and taxes onto its invoice line (`addons/sale/models/sale_order_line.py:1513-1544`). Finance neither returns nor accepts a product on an invoice line today, and products PR 6 adds it with its tax rule. The bridge follows that pull request, so finance reads and edits an invoice made from an order with the same product line a hand-written invoice has.
- **Reports.** Orders and amounts by period, salesperson, team, customer and product, from stock `sale.report`, and an export.

Out of this design: pricelists (the product service adds them behind the price function), delivery and stock, subscriptions, coupons and loyalty, commissions, margins and the store.

## 5. Online orders

An online order and a staff quotation are rows of the same model. Sales lists both and states the source of each. An online order is read-only in sales: its lines, payment, expiry and refunds stay with the channel that made it and with payments. The payments orders list remains the place for refunds.

## 6. Capabilities

| Capability | Allows |
| --- | --- |
| `sales.read` | Quotations and orders within the visibility setting |
| `sales.quotations.manage` | Create, edit, send and cancel a quotation |
| `sales.orders.confirm` | Confirm, lock, reopen and cancel an order |
| `sales.discounts.approve` | A discount above the tenant's limit |
| `sales.reports.read` | Reports and export |
| `sales.settings.manage` | The settings of section 7 |

No capability implies another. The roles `role_sales_agent` and `role_sales_manager` imply the stock groups `sales_team.group_sale_salesman` and `group_sale_salesman_all_leads` only so that stock ACLs allow the ORM calls, as CRM does; every route checks a capability and record rules enforce the visibility setting for reads, writes, exports and attachments.

## 7. Settings

One record per tenant, changed in the root company by holders of `sales.settings.manage`, readable through the API.

| Setting | Values | Default | Effect on existing data |
| --- | --- | --- | --- |
| Visibility | `own`, `team`, `all` | `own` | Applies to every existing document at once |
| Quotation validity | Days | 30 | New quotations only |
| Customer answer | `none`, `accept`, `accept_and_sign` | `accept` | Quotations sent after the change |
| Acceptance confirms the order | Yes, no | No | Quotations sent after the change |
| Discount limit without approval | Percent | 0, meaning no limit | New and edited lines |
| Default terms and conditions | Text | Empty | New quotations only |

Sector presets set several of these at once.

## 8. Order of work

Sales changes authorization and money documents, so each pull request takes the full path: failing tests first, an implementer, and a reviewer separate from the implementer.

| PR | Work | Starts after |
| --- | --- | --- |
| 1 | `liwan_orders`: the tax rule on the order line, installed with stock `sale`. `liwan_payments` drops its copy of the rule and keeps the factory ([plan](../plans/2026-11-14-liwan-orders.md)) | Products PR 2 is merged; it edits the same lists of installed addons and the VAT tests of the customer messages payments bridge. Products PR 1 is merged |
| 2 | `liwan_sales`: scaffold, capabilities, settings, quotations and orders with their lines and states, the list and record pages | Products PR 2 is merged; it brings the pick list and the price function |
| 3 | Send, the public page, acceptance, signature and expiry | PR 2 |
| 4 | `liwan_sales_finance`: invoices and down payments | PR 2 and products PR 6 (a product on finance invoice lines) |
| 5 | `liwan_sales_crm` and `liwan_sales_payments` | PR 2 |
| 6 | Templates, reports, export and sector presets | PR 2 |

Each pull request proves its lines in `saas` and `non_saas`, with a branch session and a root session, and with each value of the visibility setting.

## 9. Owner decisions of 2026-11-14

The owner approved each point as written here.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Start before the product service exists, with sales reading stock products itself? | No. It would be a fourth product writer and reader that the products plan then removes. Wait for products PR 2; PR 1 is merged |
| 2 | Bring `liwan_orders` forward (section 3)? | Yes |
| 3 | Do online orders appear in sales (section 5)? | Yes, read-only |
| 4 | Can a tenant invoice an order without the finance application? | No. The order stops at confirmed, and the invoice is made in finance once the tenant has it |
| 5 | With CRM and sales both installed, does winning an opportunity still take a package and a price, or an order? | An order. The package form stays for a tenant without sales |
| 6 | Application id, route and names | `sales`, `/sales`, "المبيعات", "Sales" |
| 7 | Where does the tax rule of an establishment that is not registered sit? | On the stock tax compute of the order line (`sale.order.line._compute_tax_ids`), extended in `liwan_orders`. Stock recomputes a line's taxes when its product or company changes (`addons/sale/models/sale_order_line.py:544-545`), so a rule applied once after the line is created, as payments does today, is lost on a staff edit. Upgrade cost: one stock method name, covered by a test |
| 8 | Is products PR 4 (the transfer between sharing modes) merged before sales writes orders for a tenant? | Yes. Stock refuses to give a product a company once another company has order lines for it (`addons/sale/models/product_template.py:108-131`), and staff quotations multiply such lines |

## 10. Evidence status

| Claim | Status |
| --- | --- |
| The order factory, its elevation, its two callers and the payments dependency on `sale` | Read on `origin/main` at `65cb936d0`; not run |
| A rank-3 addon cannot depend on a rank-3 addon, and `liwan_payments` is rank 3 | Read in `tools/arch_policy.py:168-177` and `tools/arch_layers.json`; the policy was not run on a `liwan_orders` manifest |
| The bridge job accepts a bridge with exactly two sides, so a payment bridge cannot name a third LiwanOS module | Read in `tools/app_isolation.py` and `deploy/ci/odoo-bridge.sh` on `origin/claude/products-service-pr2` at `366053b67`; not run |
| A rank-3 service that installs itself passes the isolation checks and the module closure | Inferred: no rank-3 addon installs itself today. The first check of PR 1 |
| The tax rule on the stock compute holds through a staff edit and for an online order | Inferred from the compute's dependencies; the first test of PR 1 |
| Stock puts the order line's product on the invoice line, and no file of `liwan_finance` outside its tests names a product | Read in Odoo 19 source and on `origin/main` at `65cb936d0`; not run |
| Stock refuses a company on a product that another company has sold | Read in Odoo 19 source; not run |
| Stock states, `locked`, `validity_date`, `require_signature`, `prepayment_percent`, `portal.mixin` on `sale.order`, the down-payment wizard | Read in Odoo 19 source; not run |
| `sale_management` holds quotation templates and depends on `sale` and `digest` | Read in its manifest and models folder; not run |
| Products PR 1 is merged (#711, `65cb936d0`); PR 2 is in progress on `claude/products-service-pr2`; PR 3 to PR 6 are not started | Read from Git on 2026-11-14 |
| A role may imply the stock sales groups without opening stock routes | Inferred from CRM; the first test of PR 2 |
| The public page can authorize by the order's access token alone | Inferred from the public namespace rule; the first test of PR 3 |
| Everything in sections 3 to 8 | Design, not built |
