# Print and export invoices from the vendor console

> Design. Status: the owner approved building it and took the decisions of section 4 on 2026-11-22; not built.
> The study read code only; nothing was run.

## 1. What exists today

- **Vendor invoice page** (`apps/vendor-admin/app/pages/invoices/[id].vue`): no print view. Each payment attempt
  shows status, amount and time. `provider_ref` and `kind` are in the contract
  (`packages/commercial-contracts/src/commercial/billing.ts`, `paymentAttemptSchema`) and are not shown.
- **Vendor invoice list** (`invoices/index.vue`): filters by customer and status, 25 rows a page, no export. The
  route `GET /invoices` takes `limit` up to 200 and `offset`, ordered by `created_at DESC, id`, and returns `total`
  (`apps/control-plane/src/commercial/routes-b.ts`, `invoices.ts`).
- **Customer app** already prints the same invoice: route `apps/web/app/pages/subscription/invoices/print/[id].vue`
  renders `apps/web/app/components/subscription/InvoiceDocument.vue` inside `SharedStandalonePage variant="print"`
  and calls `window.print()`; the browser saves the PDF and does the Arabic shaping. The print CSS is `.liwan-print`
  in `packages/ui/app/assets/css/components.css`.
- **Its data** is `getCustomerInvoice` (`invoices.ts`): the invoice, the customer's legal name, the seller identity
  copied at issue (`invoices.seller`) and the non-void credit notes with a typed cause. The vendor view has no
  seller and carries the operator's free-text reasons and names.
- **CSV** exists only in analytics: `toCsv` in `apps/vendor-admin/app/utils/vendorAnalytics.ts` (BOM, CRLF, quote
  escaping, downloaded as a Blob). It is fixed to four columns and has no formula-injection guard. There is no PDF
  code in the console.
- **Not a tax document.** `official_tax_invoice` is always false and Liwan is not VAT-registered (`billing.ts`). An
  untaxed invoice prints one total and no tax wording.
- **Dates disagree today.** The customer document shows the UTC day (it slices the ISO string); the vendor page
  shows the Riyadh day. They differ for invoices issued between 00:00 and 03:00 Riyadh.

## 2. Behaviour

- **Print.** A "Print or save as PDF" button on the invoice page opens `/invoices/print/[id]`. The route renders
  the customer's own `InvoiceDocument`, moved to `packages/commercial-ui` with its texts, so both apps print one
  document. Data comes from a new read, `GET /invoices/:id/document`, which returns the `getCustomerInvoice` shape.
  The page follows the console's language and direction; numbers, dates and references stay left-to-right.
- **The document shows:** the seller's legal name, address and commercial registration; the customer's legal name;
  number, issue, due and paid dates, period; lines; one total, or subtotal, tax and total when `tax_label` is set;
  credit notes with typed cause, reference and the net amount. Every date is the Riyadh day, in both apps.
- **The document never shows:** the words "tax invoice" or "فاتورة ضريبية", a VAT number, a QR code, "before tax"
  on an untaxed invoice, operator names or free-text reasons, payment attempts or provider references, or any
  console chrome. A draft invoice has no number and is not printable.
- **CSV export.** An "Export CSV" button on the list exports every invoice matching the current customer and status
  filters, not only the visible page. The page reads `GET /invoices` in pages of 200 by `offset` until the first
  response's `total` is reached, dropping repeated ids (a new invoice shifts the offsets).
- **Row cap:** 5,000 rows (25 requests). Above it the first 5,000 are exported, the page says so, and the file name
  ends in `-partial`. The button shows progress and can be cancelled; a failed page aborts with no file.
- **Columns:** number, customer name, kind, status, issue date, due date, paid date, period start, period end,
  currency, subtotal, tax, total, credited, invoice id, customer id. Headers and the kind and status labels follow
  the console language. Dates are `YYYY-MM-DD`, the Riyadh day.
- **Amounts** are plain numbers: Latin digits, a dot, the currency's decimals, no symbol or separator. The currency
  has its own column. `credited` is the sum of applied and refunded credit notes.
- **File:** UTF-8 with a byte-order mark, CRLF, named `liwan-invoices-<status>-<date>.csv`. It is built by a
  general `toCsvTable` in a new `apps/vendor-admin/app/utils/csv.ts`; analytics' `toCsv` calls it.
- **Export audit.** Before the download the page posts the filters and the row count; the control plane writes one
  `invoices.exported` audit event (actor, filters, row count). No file is produced when that call fails.
- **Provider reference.** Each attempt shows its kind (hosted invoice, card form, saved card, bank transfer) and
  `provider_ref`, left-to-right in a monospace face with a copy button. An attempt with no reference shows none.

## 3. Safety rules

- Capability `vendor.billing.manage` for the print route, the document read, the export and the reference. The
  pages already require it. No step-up: nothing is changed.
- Formula injection: a text cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading
  apostrophe, then normal quoting. Number cells are written by code and are exempt. The customer name is the risk.
- The document read answers 404 for an unknown id and never returns operator text.
- The BFF allowlist gains one GET entry and one POST entry (`apps/vendor-admin/server/utils/proxy.ts`). The CSV is
  built in the browser.
- Printing is not audited.

## 4. Decisions (owner, 2026-11-22)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Print mechanism | A print route with the shared customer document (recommended default, taken). |
| D2 | Where the CSV is built | In the browser from the list route (recommended default, taken). |
| D3 | Is the export audited | Yes: one `invoices.exported` event per export. |
| D4 | Which day a date shows | The Riyadh day everywhere, the customer's printed document included. |
| D5 | A vendor-only mark on the print | None; the vendor prints exactly what the customer prints (recommended default, taken). |

## 5. Out of scope

Server-made PDF files, ZATCA or any tax invoice, emailing an invoice, printing credit notes on their own, bulk
print, Excel files, a date-range filter on the list, exporting payment attempts or lines, scheduled exports.

## 6. Tasks (one commit each)

1. Move `InvoiceDocument`, its helpers and texts to `packages/commercial-ui`; the customer app imports it; dates
   become the Riyadh day. Tests: the existing document tests pass from the new place; the Riyadh day at 01:00; an
   untaxed invoice shows one total. The component is shared, so it follows DESIGN.md's rule for stories.
2. `GET /invoices/:id/document` in the control plane and the BFF entry. Tests: the shape, the seller copy against
   current settings, no operator text, 403 without the grant, 404.
3. Vendor print route and the button. Tests: Arabic and English render, forbidden words absent, a draft has no
   button, the back link.
4. `toCsvTable` with the formula guard; analytics moves to it. Tests: BOM, CRLF, quotes, each dangerous first
   character, number cells untouched, analytics output unchanged.
5. List export: paging, de-duplication, the cap, progress and cancel. Tests: two pages, a shifted offset, a failed
   page, the partial name, filters passed through, amounts as plain numbers.
6. Export audit: the route, the BFF entry bound to POST, the call before download, the audit text in both locales.
   Tests: the audit row; no file when the call fails.
7. Provider reference and kind on each attempt, with texts. Tests: each kind, a null reference, the copy action.
