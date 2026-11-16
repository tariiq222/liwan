// Part of the isolated UI mock stack: the invoices of an order (the `liwan_sales_finance` bridge), shaped like
// packages/contracts/src/sales/finance.ts, and the finance record page of an invoice the bridge made. The state lives on the Sales
// mock's orders (`order.invoices`) and follows the server's rules:
//  - the invoicing block is null for a caller who cannot read finance invoices (the cookie `mock_finance=hidden`); with
//    `mock_finance=read` it shows and offers nothing, and so does `mock_finance=retained` (Finance kept for reading only);
//    an online order shows it and offers nothing;
//  - `invoice_actor` (setting): under `owner` only the salesperson of the order or an assign holder may invoice it (403
//    `forbidden`, `details.reason` `not_the_salesperson`) and the others are offered nothing; `any_biller` lets any caller who
//    holds both rights;
//  - `amount_paid` is what payments settled on the posted invoices less what the posted credit notes settled, never below zero;
//  - an `Idempotency-Key` repeats the first answer (the same key with another body is 422 `idempotency_key_reused`);
//  - an invoice is a draft until finance posts it (`POST /api/v1/finance/invoices/<id>/post`); drafts claim an amount, posted
//    invoices are invoiced, a down payment is a share of the order total, and the whole order invoices what is left;
//  - 403 `forbidden` `details.reason` `online_order`, 422 `order_not_confirmed`, `nothing_to_invoice`, `down_payment_refused`, and
//    422 `invalid` on `percent` or `amount` beyond what is left (`details.max_amount`);
//  - `POST /api/v1/public/sales/__mock/invoice-paid {id, amount}` stands in for a payment registered in finance.
import { salesFinancePlan } from './sales-finance-mock-state.mjs'

const round2 = value => Math.round(value * 100) / 100
const FIRST_ID = 9001
const FINANCE_DETAIL = /^\/api\/v1\/finance\/invoices\/(9\d{3})(?:\/(post))?$/
const JOURNAL = { id: 1, name: 'مبيعات العملاء' }
const hasCookie = (cookie, value) => new RegExp(`(?:^|;\\s*)${value}(?:;|$)`).test(cookie ?? '')
const refusal = (status, code, message, extra = {}) => ({ status, body: { code, message, ...extra } })
const invalid = (field, message, extra = {}) => refusal(422, 'invalid', message, { field, ...extra })

let nextId = FIRST_ID
const index = new Map()
// The first answer of each `Idempotency-Key`: `{order, body, answer}`.
const keys = new Map()

export const resetSalesFinance = () => { nextId = FIRST_ID; index.clear(); keys.clear() }

const sum = (list, pick = invoice => invoice.total) => round2(list.reduce((total, invoice) => total + pick(invoice), 0))

/** The figures of an order's invoices, as `sale.order._liwan_invoice_figures` counts them. */
function figures(order, total) {
  const all = order.invoices ?? []
  const posted = all.filter(invoice => invoice.state === 'posted' && invoice.kind !== 'credit_note')
  const creditNotes = all.filter(invoice => invoice.state === 'posted' && invoice.kind === 'credit_note')
  const invoiced = sum(posted)
  const drafted = sum(all.filter(invoice => invoice.state === 'draft' && invoice.kind !== 'credit_note'))
  const credited = sum(all.filter(invoice => invoice.state === 'posted' && invoice.kind === 'credit_note'))
  const paid = Math.max(round2(sum(posted, invoice => invoice.paid) - sum(creditNotes, invoice => invoice.paid)), 0)
  return { invoiced, drafted, credited, toInvoice: order.state === 'confirmed' ? Math.max(round2(total - invoiced - drafted), 0) : 0, paid }
}

function statusOf(order, total, parts) {
  if (order.state !== 'confirmed' || total === 0) return 'none'
  const live = (order.invoices ?? []).some(invoice => invoice.state !== 'cancel')
  if (parts.toInvoice === 0) return live ? 'invoiced' : 'none'
  return live ? 'partial' : 'to_invoice'
}

const dumpInvoice = invoice => ({
  id: invoice.id, number: invoice.number, state: invoice.state, kind: invoice.kind, payment_state: invoice.paid >= invoice.total && invoice.state === 'posted' ? 'paid' : invoice.paid > 0 ? 'partial' : 'not_paid',
  invoice_date: invoice.state === 'posted' ? '2026-11-14' : null, invoice_date_due: '2026-11-30', amount_total: invoice.total, amount_residual: invoice.state === 'posted' ? round2(invoice.total - invoice.paid) : invoice.total, currency: 'SAR',
})

/** Whether the caller reads finance invoices, and whether they may make one (`mock_finance=read`, `retained` and `hidden` take it away). */
const finance = cookie => ({ read: !hasCookie(cookie, 'mock_finance=hidden'), manage: !['hidden', 'read', 'retained'].some(value => hasCookie(cookie, `mock_finance=${value}`)) })

/** Whether the `invoice_actor` setting lets the caller invoice this order; `mine` is the salesperson or an assign holder. */
const mayAct = (settings, mine) => settings.invoice_actor === 'any_biller' || mine

/** The invoicing block of the staff order shape; null without the bridge or without finance read. `settings` are the Sales mock's. */
export function invoicingOf(order, total, caps, cookie, settings, mine) {
  if (!salesFinancePlan() || !finance(cookie).read) return null
  const parts = figures(order, total)
  const rights = finance(cookie).manage && caps.includes('sales.orders.confirm') && order.source === 'staff' && order.state === 'confirmed' && mayAct(settings, mine)
  return {
    status: statusOf(order, total, parts), amount_invoiced: parts.invoiced, amount_credited: parts.credited, amount_drafted: parts.drafted, amount_to_invoice: parts.toInvoice, amount_paid: parts.paid,
    invoices: [...(order.invoices ?? [])].sort((a, b) => b.id - a.id).map(dumpInvoice),
    can_invoice: rights && parts.toInvoice > 0, can_down_payment: rights && parts.toInvoice > 0 && settings.invoice_down_payment === 'allow',
  }
}

/** An order with a posted invoice is not cancelled, and one with a draft is cancelled only by someone who may cancel the draft. */
export function invoicesBlockCancel(order, cookie) {
  if (!salesFinancePlan()) return false
  const live = (order.invoices ?? []).filter(invoice => invoice.state !== 'cancel')
  return live.some(invoice => invoice.state === 'posted') || (live.length > 0 && !finance(cookie).manage)
}

/** Cancelling an order cancels its draft invoices. */
export const cancelDraftInvoices = order => { for (const invoice of order.invoices ?? []) if (invoice.state === 'draft') invoice.state = 'cancel' }

/** The body of an invoice request as the server parses it: `{method, percent?, amount?}`, or the 422 that names the field. */
function parseBody(body) {
  const unknown = Object.keys(body).find(key => !['method', 'percent', 'amount'].includes(key))
  if (unknown) return { failure: invalid(unknown, `field '${unknown}' is not accepted`) }
  if (!['order', 'percent', 'amount'].includes(body.method)) return { failure: invalid('method', 'method must be one of order, percent, amount') }
  for (const key of ['percent', 'amount']) if (key in body && key !== body.method) return { failure: invalid(key, `${key} belongs to the ${key} method only`) }
  if (body.method === 'percent' && !(typeof body.percent === 'number' && body.percent >= 1 && body.percent <= 100)) return { failure: invalid('percent', 'percent must be a number from 1 to 100') }
  if (body.method === 'amount' && !(typeof body.amount === 'number' && body.amount > 0 && body.amount <= 1e12)) return { failure: invalid('amount', 'amount must be a number above zero') }
  return { body }
}

/** Makes a draft invoice of a confirmed staff order, or the refusal the server answers. `total` is the order total. */
export function invoiceOrder(order, total, body, caps, cookie, settings, mine) {
  const parsed = parseBody(body)
  if (parsed.failure) return parsed.failure
  if (!salesFinancePlan()) return refusal(403, 'feature_not_included', 'this feature is not included')
  if (!caps.includes('sales.orders.confirm') || !finance(cookie).manage) return refusal(403, 'forbidden', 'forbidden')
  if (order.source !== 'staff') return refusal(403, 'forbidden', 'an online order is invoiced when it is paid', { details: { reason: 'online_order' } })
  if (!mayAct(settings, mine)) return refusal(403, 'forbidden', 'this company lets only the salesperson of an order invoice it', { details: { reason: 'not_the_salesperson' } })
  if (order.state !== 'confirmed') return refusal(422, 'order_not_confirmed', 'only a confirmed order is invoiced')
  const left = figures(order, total).toInvoice
  if (parsed.body.method !== 'order' && settings.invoice_down_payment !== 'allow') return refusal(422, 'down_payment_refused', 'down payments are off in the Sales settings', { field: 'method' })
  if (left <= 0) return refusal(422, 'nothing_to_invoice', 'nothing is left to invoice on this order')
  const share = parsed.body.method === 'percent' ? round2(total * parsed.body.percent / 100) : parsed.body.method === 'amount' ? round2(parsed.body.amount) : left
  if (share <= 0) return invalid(parsed.body.method, 'the down payment must be more than zero')
  if (share > left) return invalid(parsed.body.method, 'the down payment is more than what is left to invoice', { details: { max_amount: left } })
  const invoice = { id: nextId++, number: null, state: 'draft', kind: parsed.body.method === 'order' ? 'invoice' : 'down_payment', total: share, paid: 0 }
  order.invoices = [...(order.invoices ?? []), invoice]
  index.set(invoice.id, { order, invoice })
  return null
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/

/** `make()` once per `Idempotency-Key`: a repeat of the same order and body gets the first answer, the same key for another request is refused. */
export function idempotentInvoice(key, order, body, make) {
  if (key === undefined) return make()
  if (!IDEMPOTENCY_KEY.test(key)) return invalid('Idempotency-Key', 'Idempotency-Key must be 8 to 128 letters, digits or _ . : -')
  const seen = keys.get(key)
  if (seen) return seen.order === order.id && seen.body === JSON.stringify(body) ? seen.answer : refusal(422, 'idempotency_key_reused', 'this Idempotency-Key was used for another request')
  const answer = make()
  if (answer.status === 200) keys.set(key, { order: order.id, body: JSON.stringify(body), answer })
  return answer
}

const FINANCE_ACTIONS = { draft: ['edit', 'delete', 'post'], posted: ['credit_note', 'register_payment', 'pdf'], cancel: ['reset_to_draft'] }

/** The finance record page of an invoice the bridge made, with the order it came from. */
function financeDetail({ order, invoice }) {
  const base = dumpInvoice(invoice)
  return {
    id: invoice.id, name: invoice.number, move_type: 'out_invoice', state: invoice.state, payment_state: base.payment_state, partner: { id: order.customer_id, name: order.customer_name }, journal: JOURNAL,
    invoice_date: base.invoice_date, invoice_date_due: base.invoice_date_due, payment_term: null, currency: 'SAR',
    amount_untaxed: round2(invoice.total / 1.15), amount_tax: round2(invoice.total - invoice.total / 1.15), amount_total: invoice.total, amount_residual: base.amount_residual,
    ref: order.number, debit_origin: null, credit_origin: null, zatca: null,
    lines: [{ id: invoice.id * 10, name: invoice.kind === 'down_payment' ? 'دفعة مقدمة' : order.number, product: null, account: null, quantity: 1, price_unit: invoice.total, discount: 0, taxes: [], price_subtotal: invoice.total, price_total: invoice.total, analytic_distribution: [], asset_profile: null, asset: null }],
    allowed_actions: FINANCE_ACTIONS[invoice.state], blocked_actions: [],
    source_order: { id: order.id, number: order.number },
  }
}

/** The finance routes of an invoice the bridge made: its record and its posting. Any other path is not this stub's. */
export function handleSalesFinance(req, path, json) {
  const match = FINANCE_DETAIL.exec(path)
  if (!match || !salesFinancePlan()) return false
  const found = index.get(Number(match[1]))
  if (!found) {
    json(404, { code: 'not_found', message: 'not found' })
    return true
  }
  if (!match[2] && req.method === 'GET') json(200, financeDetail(found))
  else if (match[2] === 'post' && req.method === 'POST') {
    if (found.invoice.state !== 'draft') json(422, { code: 'not_draft', message: 'the record must be in the draft state' })
    else {
      Object.assign(found.invoice, { state: 'posted', number: `INV/2026/${String(found.invoice.id).padStart(5, '0')}` })
      json(200, financeDetail(found))
    }
  } else return false
  return true
}

/** A posted credit note of `amount` against a posted invoice: it settles what the invoice still owes (up to its amount), and the order's paid figure subtracts it. */
export function creditInvoice(id, amount) {
  const found = index.get(id)
  if (!found || found.invoice.state !== 'posted') return false
  const applied = round2(Math.min(amount, found.invoice.total - found.invoice.paid))
  found.invoice.paid = round2(found.invoice.paid + applied)
  const note = { id: nextId++, number: `RINV/2026/${String(nextId).padStart(5, '0')}`, state: 'posted', kind: 'credit_note', total: round2(amount), paid: applied }
  found.order.invoices = [...found.order.invoices, note]
  return true
}

/** Registers a payment on a posted invoice, as finance does; the order then reads it as paid. */
export function payInvoice(id, amount) {
  const found = index.get(id)
  if (!found || found.invoice.state !== 'posted') return false
  found.invoice.paid = round2(Math.min(found.invoice.total, found.invoice.paid + amount))
  return true
}
