# Sales application design

> Status: design written on 2026-11-14 at the owner's request ("build sales completely, on the Odoo module"). The owner decided two things in that request: the application is built now, and it stands on stock Odoo `sale`. The owner approved the eight points of section 9 the same day, each as recommended. PR 1 (`liwan_orders`) is merged as #725, and PR 2 (`liwan_sales`) is built on the branch `codex/sales-app` and not pushed. PR 3 (send a quotation, the customer's public answer page, signature, expiry) is built on the local branch `codex/sales-quotation-send`, started from `origin/main` at `d4d310171`; it is not pushed, no pull request is open, and it is not merged or deployed. PR 4 to PR 6 are not built. Facts were read on `origin/main` at `65cb936d0`, after products PR 1 merged, and in the Odoo 19 checkout; none was run (section 10). The owner moved the draft from the Codex session to a Claude session the same day; this file supersedes the copy on `codex/sales-build` (`f3e819604`).

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

- **Quotation.** Customer, validity date, payment terms, salesperson, notes and terms. Lines: a product picked from the product service, quantity, unit, the unit price the price function returns, a discount, the taxes stock picks, and section and note lines. A line keeps the name and price it was created with.
- **Templates.** Stock quotation templates (`sale_management`): a named set of lines, validity and terms that starts a quotation.
- **Send.** The PDF and an e-mail to the customer with a link.
- **Customer answer.** The link opens a page under the public namespace, authorized by the order's own access token (`portal.mixin` on `sale.order`): the customer reads the quotation, accepts or declines, and signs when the tenant asks for a signature. The Odoo portal stays closed.
- **Confirm, cancel, reopen, lock.** By staff, or by the customer's acceptance when the tenant allows it. A quotation past its validity date is marked expired and is not confirmable until staff extend it.
- **Invoice.** From a confirmed order, through `liwan_sales_finance`: the whole order, or a down payment as a percentage or an amount, with stock's `sale.advance.payment.inv` logic. The order shows what is invoiced and what is paid. Stock copies each order line's product, unit price, discount and taxes onto its invoice line (`addons/sale/models/sale_order_line.py:1513-1544`). Finance accepts a product on a customer invoice line since products PR 6, with its tax rule (a company not registered for VAT charges no tax), so finance reads and edits an invoice made from an order with the same product line a hand-written invoice has. The invoice is a draft that finance posts; both applications' capabilities are needed (`sales.orders.confirm` and `finance.invoices.manage`); an online order is invoiced by payments; an order with a posted invoice is not cancelled. Design in `odoo-addons/liwan_sales_finance/README.md`.
- **Reports.** Orders and amounts by period, salesperson, customer and product, from stock `sale.report`, and an export.

Out of this design: sales teams (decision 10), pricelists (the product service adds them behind the price function), delivery and stock, subscriptions, coupons and loyalty, commissions, margins and the store.

## 5. Online orders

An online order and a staff quotation are rows of the same model. Sales lists both and states the source of each. An online order is read-only in sales: its lines, payment, expiry and refunds stay with the channel that made it and with payments. The payments orders list remains the place for its refunds; money on a staff quotation is refunded from the quotation, through the payments bridge, by Sales staff who also hold `payments.refund`.

## 6. Capabilities

| Capability | Allows |
| --- | --- |
| `sales.read` | Quotations and orders within the visibility setting |
| `sales.quotations.manage` | Create, edit, send and cancel a quotation |
| `sales.orders.confirm` | Confirm, lock, reopen and cancel an order |
| `sales.documents.assign` | See every document whatever the visibility setting, and change a document's salesperson. The manager role holds it (decision 9) |
| `sales.discounts.approve` | A discount above the tenant's limit |
| `sales.reports.read` | Reports and export |
| `sales.settings.manage` | The settings of section 7 |

No capability implies another. The roles `role_sales_agent` and `role_sales_manager` imply the stock groups `sales_team.group_sale_salesman` and `group_sale_salesman_all_leads` only so that stock ACLs allow the ORM calls, as CRM does; every route checks a capability and record rules enforce the visibility setting for reads, writes, exports and attachments.

## 7. Settings

One record per tenant, changed in the root company by holders of `sales.settings.manage`, readable through the API.

| Setting | Values | Default | Effect on existing data |
| --- | --- | --- | --- |
| Visibility | `own`, `all` | `own` | Applies to every existing document at once |
| Quotation validity | Days | 30 | New quotations only |
| Customer answer | `none`, `accept`, `accept_and_sign` | `accept` | Quotations sent after the change |
| Acceptance confirms the order | Yes, no | No | Quotations sent after the change |
| Answered quotation may be sent again | `answered_resend`: `allow`, `refuse` | `allow` | Read when staff send, so it applies to every existing answered quotation at once; `refuse` makes the send a 409 until the quotation is reopened |
| How the customer may sign | `signature_methods`: `draw_or_type`, `draw` | `draw_or_type` | Copied onto the quotation when it is sent, so quotations already sent keep theirs |
| Discount limit without approval | Percent | 0, meaning no limit | New and edited lines |
| Default terms and conditions | Text | Empty | New quotations only |
| Payment to confirm (`liwan_sales_payments`) | `payment_to_confirm`: `off`, `full`, `percent`; with `prepayment_percent`, a whole number from 1 to 100 | `off`; 50 | New quotations only: each quotation keeps its own choice (stock `require_payment` and `prepayment_percent`), which staff change on a draft. Present only while the tenant can take online payments |
| Winning an opportunity by order (`liwan_sales_crm`) | `opportunity_win`: `order_confirmed`, `manual` | `order_confirmed` | Read at each confirmation: a confirmed order wins its CRM opportunity, or (`manual`) confirming changes nothing and the opportunity is won with a package. Present only while the tenant has CRM |
| Amount an opportunity is won for (`liwan_sales_crm`) | `opportunity_win_amount`: `untaxed`, `total` | `untaxed` | Read at each confirmation: the sum of the opportunity's confirmed orders in the company's currency, untaxed or taxed. Present only while the tenant has CRM |
| Down payments on an order (`liwan_sales_finance`) | `invoice_down_payment`: `allow`, `refuse` | `allow` | Read each time an invoice is made: `refuse` leaves only the whole order (422 `down_payment_refused` on a down payment). Present only while the tenant has Finance |
| Who invoices an order (`liwan_sales_finance`) | `invoice_actor`: `owner`, `any_biller` | `owner` | Tenant scope, read each time an invoice is made and mirrored in `can_invoice` and `can_down_payment`. `owner`: the order's salesperson or a holder of `sales.documents.assign` (the actor rule Sales uses for confirm and cancel); `any_biller`: any caller who reads the order and holds `sales.orders.confirm` and `finance.invoices.manage`. A refused caller gets 403 `forbidden`, `details.reason` `not_the_salesperson`. Present only while the tenant has Finance |

The two settings added in PR 3 (`answered_resend` and `signature_methods`) have tenant scope and are changed by holders of `sales.settings.manage`, like the others. The payment setting added by the payments bridge, the two settings added by the CRM bridge and the down payment setting added by the finance bridge have the same scope and right; the bridge adds its two fields to `liwan.sales.settings` and to the settings wire shape through hooks of `liwan_sales` (README of `liwan_sales`, "Extension points for bridges").

Sector presets set several of these at once.

## 8. Order of work

Sales changes authorization and money documents, so each pull request takes the full path: failing tests first, an implementer, and a reviewer separate from the implementer.

| PR | Work | Starts after |
| --- | --- | --- |
| 1 | `liwan_orders`: the tax rule on the order line, installed with stock `sale`. `liwan_payments` drops its copy of the rule and keeps the factory ([plan](../plans/2026-11-14-liwan-orders.md)) | Products PR 2 is merged; it edits the same lists of installed addons and the VAT tests of the customer messages payments bridge. Products PR 1 is merged |
| 2 | `liwan_sales`: scaffold, capabilities, settings, quotations and orders with their lines and states, the list and record pages | Products PR 2 is merged; it brings the pick list and the price function |
| 3 | Send, the public page, acceptance, signature and expiry | PR 2 |
| 4 | `liwan_sales_finance`: invoices and down payments; built (see the status rows below) | PR 2 and products PR 6 (a product on finance invoice lines) |
| 5 | `liwan_sales_crm` and `liwan_sales_payments`; both parts are built (see the status rows below) | PR 2 |
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
| 8 | Is products PR 4 (the transfer between sharing modes) merged before sales writes orders for a tenant? | Before sales is released to a tenant, yes; before it is built, no. Stock refuses to give a product a company once another company has order lines for it (`addons/sale/models/product_template.py:108-131`), and staff quotations multiply such lines. Nothing is released yet, so the sales pull requests are built before products PR 4 |
| 9 | Under `own`, who sees every document and who may change a salesperson? | The holder of a seventh capability, `sales.documents.assign`, which the manager role holds, as `crm.leads.assign` does in CRM |
| 10 | Does the visibility setting have a `team` value? | Not now: `own` and `all`. `team` comes later together with a screen for sales teams |
| 11 | How is sales sold? | As its own sellable application. Its price, and whether it joins release 1, are decided before launch |

## 10. Evidence status

| Claim | Status |
| --- | --- |
| The order factory, its elevation, its two callers and the payments dependency on `sale` | Read on `origin/main` at `65cb936d0`; not run |
| A rank-3 addon cannot depend on a rank-3 addon, and `liwan_payments` is rank 3 | Read in `tools/arch_policy.py:168-177` and `tools/arch_layers.json`; the policy was not run on a `liwan_orders` manifest |
| The bridge job accepts a bridge with exactly two sides, so a payment bridge cannot name a third LiwanOS module | Read in `tools/app_isolation.py` and `deploy/ci/odoo-bridge.sh` on `origin/claude/products-service-pr2` at `366053b67`; not run |
| A rank-3 service that installs itself passes the isolation checks and the module closure | Run locally on 2026-11-14 on the branch `api-liwan-orders` merged with `origin/main` at `aa678e8ce`: both payment bridge stages pass and the closure test passes; the foundation standalone stage passed before that merge. GitHub CI is the `ci-result` of the pull request of PR 1 |
| The tax rule on the stock compute holds through a staff edit and for an online order | Run on a scratch database on 2026-11-14: the tests of `liwan_orders` and the unchanged payments VAT tests pass. A copied order needed a second override, `copy_data`, for an unregistered establishment ([plan](../plans/2026-11-14-liwan-orders.md), D8) |
| Stock puts the order line's product on the invoice line, and no file of `liwan_finance` outside its tests names a product | Read in Odoo 19 source and on `origin/main` at `65cb936d0`; not run |
| Stock refuses a company on a product that another company has sold | Read in Odoo 19 source; not run |
| Stock states, `locked`, `validity_date`, `require_signature`, `prepayment_percent`, `portal.mixin` on `sale.order`, the down-payment wizard | Read in Odoo 19 source; not run |
| `sale_management` holds quotation templates and depends on `sale` and `digest` | Read in its manifest and models folder; not run |
| Products PR 1 is merged (#711, `65cb936d0`); PR 2 is merged (#722, `aa678e8ce`); PR 3 to PR 6 are not started | Read from Git on 2026-11-14 |
| A role may imply the stock sales groups without opening stock routes | Inferred from CRM; the first test of PR 2 |
| The public page can authorize by the order's access token alone | Built in PR 3 on `codex/sales-quotation-send`; its routes and tests ran locally on 2026-11-16 (rows below) |
| Everything in sections 3 to 8 | Design. PR 1 is merged (#725, `3d9af4333`). PR 2 is built on `codex/sales-app` in local commits and checked locally ([plan](../plans/2026-11-14-liwan-sales.md), section 11); it is not pushed. PR 3 is built on `codex/sales-quotation-send` (base `origin/main` at `d4d310171`), committed locally (`c099df64b`, `331dfa6c1`, `4c950cd52`, `116599c20`) and not pushed. PR 4 to PR 6 are not built |
| PR 3 Odoo checks | Run locally on 2026-11-16 on the final working tree of `codex/sales-quotation-send`, not in CI and not in production: `python3 -B tools/odoo_test.py --addons liwan_sales --no-dependents` 140 tests, 0 failed, 0 errors (re-run after the review fixes); `deploy/ci/odoo-app-standalone.sh liwan_sales` passed (standalone install, tests, isolation, routes); `deploy/ci/odoo-bridge.sh liwan_sales_ai` passed |
| PR 3 web checks | Run locally on 2026-11-16: `npm -w apps/web run lint` (vue-tsc) clean; `apps/web` vitest 782 files, 7037 tests passed; the sales tests of `packages/contracts` 14 passed; after the review fixes, the sales and quote vitest files 80 passed, the contracts sales tests 14 passed, and the mocked e2e `apps/web/e2e/sales-quote-mocked.spec.ts` and `apps/web/e2e/sales.spec.ts` 35 passed, 0 skipped |
| PR 3 repository checks | Run locally on 2026-11-16: the tools unittest suite 1533 tests OK (2 skipped); `arch_policy`, `route_gate_policy`, `sudo_gate`, `ui_policy`, `secret_guard`, `no_external_refs`, `docs_policy`, `migration_guard` against the merge base and `semgrep_gate` (50 files, 0 findings) all exit 0 |
| PR 4 finance part (`liwan_sales_finance`) | Built on `codex/sales-quotation-send`, not committed and not pushed. `POST /api/v1/sales/orders/{id}/invoices` makes a draft customer invoice of a confirmed staff order through stock's `sale.advance.payment.inv`: the whole order, or a down payment by percent (1 to 100) or by amount; a later regular invoice deducts the posted down payments. Nothing is posted by the bridge. It needs `sales.orders.confirm` and `finance.invoices.manage` in the working company and both features; an online order, an unconfirmed or cancelled order, nothing left to invoice, a down payment beyond what is left and a company without a sales journal are refused with their own codes. The order shape carries `invoicing` (status, invoiced, credited, drafted, to-invoice and paid amounts, the invoices; `null` without finance read) and the finance invoice detail carries `source_order`. An order with a posted invoice is not cancelled; its draft invoices are cancelled with it. Two settings, `invoice_down_payment` and `invoice_actor`. The order row is locked before any figure is read (a second request is 409 `conflict`), and the lines stock adds for a down payment are never shown, edited or printed as sold lines. One documented `sudo()` runs stock's wizard (sale_project's project read and the branch tax fence). A payment received before an invoice counts as paid once stock reconciles it with the posted invoice. Design in `odoo-addons/liwan_sales_finance/README.md` |
| PR 4 Odoo checks | Run locally on 2026-11-16 on the working tree: `python3 -B tools/odoo_test.py --addons liwan_sales_finance,liwan_sales,liwan_finance --no-dependents --shards 3` 1071 tests (finance 884, sales 141, bridge 46), 0 failed, 0 errors; `deploy/ci/odoo-bridge.sh` passed for `liwan_sales_finance` (auto-install, 46 tests, isolation, route probes with each side off), `liwan_sales_payments`, `liwan_sales_crm`, `liwan_hr_finance` and `liwan_pmo_finance`; `deploy/ci/odoo-app-standalone.sh` passed for `liwan_sales` and `liwan_finance`. A first run found two finance tests that pinned the exact keys of the invoice detail; they now ignore the keys a bridge adds |
| PR 4 web checks | Run locally on 2026-11-16: `npm -w apps/web run lint` (vue-tsc) clean; `apps/web` vitest 796 files, 7193 tests passed; contracts 112 files, 1092 tests passed; the mocked e2e `sales.spec.ts`, `sales-quote-mocked.spec.ts`, `sales-crm.spec.ts` and the new `sales-finance.spec.ts` (8 tests) pass with `navigation-system.spec.ts`, `payments-pay-mocked.spec.ts` and `finance-phase3-mocked.spec.ts`: 144 passed, 0 skipped, on a fresh production build |
| PR 4 repository checks | Run locally on 2026-11-16: the tools unittest suite 1569 tests OK (2 skipped); `ruff check` on the touched addons, `arch_policy`, `sudo_gate`, `route_gate_policy`, `ui_policy`, `docs_policy`, `secret_guard`, `git_policy` and `migration_guard` against the merge base all exit 0. `python3 tools/api_surface.py --check` is stale (the new route and the finance `source_order` field), because `docs/api/openapi.json` and `docs/api/route-capabilities.json` are regenerated by the orchestrator |
| PR 4 not verified | A real Odoo e2e with the web pages, a gateway payment reconciled with an invoice (read in stock and observed once in a scratch test with the Paymob notification simulated, not kept as a test), posting under ZATCA (the fixtures use journals that are not onboarded), the choice of journal per customer, and the full CI workflow |
| PR 5 payments part (`liwan_sales_payments`) | Built on `codex/sales-quotation-send`, not committed and not pushed. A staff quotation asks to be paid in full or in part before it becomes an order; the pay link is the existing `/pay/order/<id>` page under the quotation's own access token, open only while the quotation's customer page is; a payment confirms the order through the Sales confirm path, once, under a row lock, with one confirmation mail; acceptance never confirms a quotation that asks to be paid. A payment that cannot confirm it now (expired, reopened, cancelled) stays recorded with a note; a send never confirms: after a resend the customer's new acceptance or signature confirms it, or staff with `sales.orders.confirm` when the quotation takes no answer, and a draft that holds money keeps its customer. Staff refund money on a staff quotation from Sales (`POST /api/v1/sales/orders/{id}/refunds`). The signature comes before the payment. The CRM bridge is the next row. Design in `odoo-addons/liwan_sales_payments/README.md` |
| PR 5 CRM part (`liwan_sales_crm`) | Built on `codex/sales-quotation-send`, not committed and not pushed. `POST /api/v1/crm/opportunities/{id}/orders` writes a draft quotation for the opportunity's customer (the caller reads the opportunity in CRM and holds `sales.quotations.manage`; a lost or archived opportunity is refused); `GET` on the same path lists the opportunity's orders under Sales visibility; the order shape names the opportunity only to a caller who reads it in CRM. Confirming an order wins its opportunity for the sum of its confirmed orders (untaxed by default, taxed by setting, in the company currency), through the one Sales confirm path, so staff, the customer's acceptance and a payment all reach it. A second order adds to the amount; cancelling afterwards leaves the opportunity won and says so in its chatter; a lost or archived opportunity stays as it is. With Sales and `opportunity_win: order_confirmed` the package form and the sold outcome of the opportunity page step aside (decision 5); the API still accepts a package win. Two settings, `opportunity_win` and `opportunity_win_amount`. Design in `odoo-addons/liwan_sales_crm/README.md` |
| PR 5 payments Odoo checks | Run locally on 2026-11-16 on the working tree after the review fixes: `python3 -B tools/odoo_test.py --addons liwan_sales_payments,liwan_sales,liwan_payments --no-dependents` 367 tests, 0 failed, 0 errors; `deploy/ci/odoo-bridge.sh liwan_sales_payments` passed (auto-install, tests, isolation, route probes); `deploy/ci/odoo-app-standalone.sh liwan_sales` passed |
| PR 5 payments web checks | Run locally on 2026-11-16: `npm -w apps/web run lint` clean; `apps/web` vitest 790 files, 7104 tests passed; contracts 110 files, 1078 tests passed; the mocked e2e `sales.spec.ts` and `sales-quote-mocked.spec.ts` 45 passed, 0 skipped, on a fresh production build |
| PR 5 payments not verified | A real gateway payment (the Odoo tests simulate the Paymob notification and post-processing as `liwan_payments` does), real mail delivery, two concurrent callbacks on separate database connections (the row lock is in the code, not exercised by a test), the refund action in `apps/web`, the real-Odoo e2e and the full CI workflow |
| PR 3 not verified | The real-Odoo e2e (`e2e-odoo`), the full CI workflow, real mail delivery, real wkhtmltopdf rendering under load, and a Storybook run of the new stories in RTL. `migration_guard --base origin/main` fails only because local `origin/main` is 21 commits ahead of the branch base (other addons' versions); `origin/main` must be merged into the branch before a pull request |

## 11. Added in PR 3 and open owner decisions

Added beyond the text of sections 4 and 7:

- Staff send is refused with 503 `mail_unavailable` when no sender address is configured. The check runs before any write, so the quotation stays as it was.
- A send from `sent` is a re-send. It clears the customer's earlier answer and signature, so the staff page asks the staff member to confirm before it sends.
- The signature pad has a "sign with my name" button that draws the typed name as the signature, for a customer who cannot draw by keyboard. The drawing always uses dark ink, because it is shown on a white box and printed on white paper.
- Two settings, `answered_resend` (`allow` or `refuse`, default `allow`) and `signature_methods` (`draw_or_type` or `draw`, default `draw_or_type`), are described in section 7. Both are tenant wide and changed by the holder of `sales.settings.manage`. `signature_methods` is snapshotted onto the quotation at send; `answered_resend` is read at send time.
- Under `accept_and_sign` the accept request carries `signature_method` (`drawn` or `typed`), recorded as `signature_method` on the staff order's customer answer. The public page shows `signature_methods`, and a `typed` signature is refused with 422 `invalid` on `signature_method` when the quotation was sent under `draw`. Under `accept` the three signature fields are unknown fields.
- The staff order shape has `resend_refused`: true when the only reason send is missing is `answered_resend: refuse`. The send route answers 403 for a caller who may not send at all, 422 `quotation_expired` for an expired quotation, and 409 `quotation_answered` only when the setting alone refuses it. The staff page shows its hint from this field.
- Accepting without a signature asks the customer to confirm once, because the answer cannot be changed. Signing is its own confirmation.
- A declined quotation is cancelled on the server, and the customer's page shows it as declined, not as cancelled.
- Send refuses a customer e-mail that cannot be delivered (empty, no `@`, more than one address, or `a@b@c`) with 422 `customer_email_missing`, before any write. It uses `email_normalize`, which splits the field the way the mail queue does, and accepts any address that function accepts, such as `o'brien@example.test`.
- The proxy takes bodies of up to 96 KB on `/api/v1/public/sales/`; other public routes keep 16 KB.
- The staff PDF route (`/api/v1/sales/orders/{id}/pdf`) is in the heavy-route list.

Open for the owner. Nothing here is decided, and each point keeps today's behavior until the owner answers.

| # | Question | Today |
| --- | --- | --- |
| 1 | Should the public sales routes have a per-token rate limit? The PDF route is the costly one | Only the edge limit of 300 requests a minute per IP |
| 2 | The werkzeug log filter that masks `access_token` in query strings is installed only by `liwan_appointments` (`hooks.py`). Should sales install it too? | A tenant without appointments logs quotation tokens; the pay routes share the gap |
| 3 | Should staff be notified when a customer answers? | No notification is sent |
| 4 | Should the public PDF use the heavy pool and its longer deadline? | The ordinary 15 s deadline and the public pool |
| 5 | `canonicalApiPath` does not reject `..` segments (existing code, low risk). Fix it in its own change? | Not rejected |
