# Sales (quotations and orders)

Pages: `/sales`, `/sales/new`, `/sales/[id]`, `/sales/[id]/edit`, `/settings/apps/sales`, and the customer's public `/quote/[id]` (no session: the access token in the address is the only credential). Owner: `liwan_sales`
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

## Send and the customer's answer

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-26 | Send a draft quotation to a customer with an email address | crm_agent | The state becomes «مُرسَل»; the answer block says «بانتظار العميل»; the send button now reads «إعادة الإرسال»; the customer receives the link and the PDF | `POST /api/v1/sales/orders/<id>/send` `cap sales.quotations.manage` | planned | |
| SALES-27 | Send to a customer with no email or a malformed one, then an expired quotation, then one with no product line | crm_agent | Each refusal is worded at the record (422 `customer_email_missing` for a missing or malformed address, `quotation_expired`, `invalid` on `lines`); the quotation keeps its state | `POST /api/v1/sales/orders/<id>/send` | planned | |
| SALES-28 | Download the quotation PDF from the record | crm_agent | The browser downloads a PDF; when the renderer is missing the route answers 503 `pdf_unavailable` | `GET /api/v1/sales/orders/<id>/pdf` | planned | |
| SALES-29 | Reopen a sent quotation as a draft, and see an expired one | crm_agent | The reopen button reads «إعادة إلى مسودة»; an expired quotation carries the «منتهي الصلاحية» marker in the list and on the record and offers no confirm | `POST /api/v1/sales/orders/<id>/reopen` `POST /api/v1/sales/orders/<id>/confirm` | planned | |
| SALES-30 | Open the quotation link without signing in | customer (no account) | The page reads in Arabic RTL under the company's name with the lines, totals, terms and a PDF link; a wrong token, a malformed address and an unsent quotation all show «الرابط لا يعمل» | `page /quote/[id]` `GET /api/v1/public/sales/quotations/<id>` `GET /api/v1/public/sales/quotations/<id>/pdf` | automated | apps/web/e2e/sales-quote-mocked.spec.ts (the open page, and the wrong token, unsent, missing and malformed links) |
| SALES-31 | Accept a quotation sent as «قبول أو رفض» | customer (no account) | One tap asks «هل تريد قبول عرض السعر؟» once; confirming accepts, and the page shows the acceptance and offers no further answer; the staff record shows the acceptance | `POST /api/v1/public/sales/quotations/<id>/accept` | automated | apps/web/e2e/sales-quote-mocked.spec.ts (the confirm question and going back, accept, reload, then the staff record) |
| SALES-32 | Accept a quotation sent as «قبول بتوقيع» | customer (no account) | The name and a signature (drawn, or the typed name unless the tenant allows drawing only) are required; the record shows the signer and how they signed; a missing or invalid signature answers 422 `signature_required` or `signature_invalid` | `POST /api/v1/public/sales/quotations/<id>/accept` | planned | mocked spec covers the required name and drawing and the signer on the staff record (apps/web/e2e/sales-quote-mocked.spec.ts, apps/web/e2e/sales.spec.ts); the server's 422 `signature_required` and `signature_invalid` are not yet exercised end to end |
| SALES-33 | Decline with a reason, and answer a quotation already answered or expired | customer (no account) | Decline asks first and records the reason; a second answer or an expired quotation is refused in words (422 `already_answered`, `quotation_expired`, `answer_not_allowed`) | `POST /api/v1/public/sales/quotations/<id>/decline` | planned | mocked spec covers the decline question and reason, an answer given elsewhere (`already_answered`) and the expired page (apps/web/e2e/sales-quote-mocked.spec.ts); the server's 422 `quotation_expired` and `answer_not_allowed` are not yet exercised end to end |
| SALES-34 | Answer a quotation in a read-only workspace | customer (no account) | The answer is refused in words (403 `branch_read_only`) and the quotation stays open | `POST /api/v1/public/sales/quotations/<id>/accept` | automated | apps/web/e2e/sales-quote-mocked.spec.ts (read-only workspace) |
| SALES-35 | Choose how the customer answers and whether acceptance confirms the order | crm_manager | Three options; the switch is disabled for «القراءة فقط»; with the switch on an acceptance confirms the order without staff action | `PATCH /api/v1/sales/settings` `cap sales.settings.manage` | planned | |
| SALES-36 | Choose whether a quotation the customer already answered can be sent again | crm_manager | Two options, «السماح» and «المنع»; under «المنع» an accepted quotation has no send button, the record says «ردّ العميل على هذا العرض. أعد فتحه لإرساله من جديد.», a send answers 409 `quotation_answered`, and after reopening it is sent again | `PATCH /api/v1/sales/settings` `POST /api/v1/sales/orders/<id>/send` `cap sales.settings.manage` | automated | apps/web/e2e/sales.spec.ts (the settings card, then the refused send and the reopen) |
| SALES-37 | Choose how a signing customer may sign | crm_manager | The choice is disabled unless the answer is «القبول بتوقيع»; under «بالرسم فقط» the public page has no «وقّع باسمي» button and a typed signature is refused (422 `invalid` on `signature_method`); the record says whether the signature was drawn or typed | `PATCH /api/v1/sales/settings` `POST /api/v1/public/sales/quotations/<id>/accept` `cap sales.settings.manage` | automated | apps/web/e2e/sales.spec.ts (the settings card), apps/web/e2e/sales-quote-mocked.spec.ts (no typed button under drawing only) |

## Payment to confirm (the payments bridge)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-38 | Choose how a new quotation asks to be paid (no payment, all of the total, a percentage) | crm_manager | The card appears only while the tenant has online payments; the percentage field is enabled under «نسبة من الإجمالي»; the choice applies to new quotations only; a value outside 1 to 100 answers 422 `invalid` on `prepayment_percent` | `GET /api/v1/sales/settings` `PATCH /api/v1/sales/settings` `cap sales.settings.manage` | automated | apps/web/e2e/sales.spec.ts (the card, the saved values, and no card without payments) |
| SALES-39 | Make a quotation that asks to be paid and read its payment on the record | crm_agent | The form starts with the tenant's default; the record shows how it asks, what is needed, received and due, and the pay link state; a draft's choice is edited, a sent one is not | `POST /api/v1/sales/orders` `PATCH /api/v1/sales/orders/<id>` `GET /api/v1/sales/orders/<id>` | automated | apps/web/e2e/sales.spec.ts (create, send, edit the choice) |
| SALES-40 | Open the quotation link of a quotation that asks to be paid | customer (no account) | The page shows the amount and a pay button that leads to `/pay/order/<id>`; a customer who must sign is told to sign first and gets the button once signed; with payments off the page shows no pay action | `page /quote/[id]` `GET /api/v1/public/sales/quotations/<id>` | automated | apps/web/e2e/sales-quote-mocked.spec.ts (the pay link, sign first, no payment, payments off) |
| SALES-42 | The customer paid and the order is not confirmed yet | customer (no account) | The page says the payment was received and the confirmation follows; a customer who still must sign is told the signature is what remains; a quotation the staff confirmed without the payment says nothing about payment | `page /quote/[id]` `GET /api/v1/public/sales/quotations/<id>` | automated | apps/web/e2e/sales-quote-mocked.spec.ts (received, received with a signature to give, confirmed without payment) |
| SALES-43 | Read a quotation whose payment cannot be taken, and give back money that arrived | crm_agent | With no live gateway the record says so and links to the payments settings; with the refund right the record has «تسجيل رد مبلغ», prefilled with the most that may go back, and records the gateway's reference; an amount above the limit is refused in words and nothing changes; without the right (or nothing to give back) the action is absent | `POST /api/v1/sales/orders/<id>/refunds` `GET /api/v1/sales/orders/<id>` `cap payments.refund` | automated | apps/web/e2e/sales.spec.ts (no gateway, refund, over-amount, no right) |
| SALES-41 | The customer pays | customer (no account) | The order is confirmed once and the customer's acceptance is recorded; a payment that arrives after the quotation expired, was reopened or was cancelled is recorded on the order, the order stays as it was, and the record says why and what to give back | `page /pay/[kind]/[id]` `POST /api/v1/public/payments/orders/<id>/transactions` | planned | apps/web/e2e/sales-quote-mocked.spec.ts and apps/web/e2e/sales.spec.ts cover the mock's gateway; the real gateway path is covered by the Odoo tests of `liwan_sales_payments` only |

## The CRM bridge

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| SALES-44 | Open a quotation that was written from an opportunity | crm_agent | The aside shows «الفرصة» with the opportunity's name linking to `/crm/opportunities/<id>` and where it stands; a user who cannot read that opportunity in CRM (no CRM right, another agent's opportunity, CRM not in the plan) sees no panel and never the name | `GET /api/v1/sales/orders/<id>` `cap crm.leads.read` | automated | apps/web/e2e/sales-crm.spec.ts (the panel and its link); liwan_sales_crm test_opportunity_orders.py (hidden without CRM read, with CRM off, for another agent's opportunity) |
| SALES-45 | Choose when an order wins its CRM opportunity and for what amount | crm_manager | The card «ربح الفرصة بالطلب» appears only while the tenant has CRM; two choices of when (عند تأكيد الطلب, يدويًا) and two of the amount (قبل الضريبة, بعد الضريبة); a value outside the choices answers 422 `invalid` on its field; without CRM the settings carry neither and a write is 403 `feature_not_included` | `GET /api/v1/sales/settings` `PATCH /api/v1/sales/settings` `cap sales.settings.manage` | automated | apps/web/e2e/sales-crm.spec.ts (the card and its saved values); liwan_sales_crm test_opportunity_settings.py |
