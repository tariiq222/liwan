// Part of the isolated UI mock stack: the routes of liwan_sales, shaped like packages/contracts/src/sales. One in-memory
// list of documents that follows the server's rules, so the list, the create panel, the record, the edit page and the settings page can be
// exercised end to end:
//  - a product line is priced from the products mock (its unit price, the VAT of the product); the body carries no
//    price and no tax (422 `unknown_field`);
//  - the moves follow the state table: confirm, cancel, reopen, lock, unlock; any other answers 403
//    `transition_forbidden`, and an online order refuses every write;
//  - a discount above the settings' limit by a session without `sales.discounts.approve` answers 403 `forbidden` with
//    `details.reason` `discount_above_limit`;
//  - the cookie `mock_caps=reader` drops every write capability (`.manage` through the shared filter, and confirm,
//    approve and assign here); `mock_sales=agent` keeps the agent role (no assign, approve or settings);
//  - the settings carry a revision: a stale one answers 409 `conflict`; `mock_sales=branch` reads `can_manage: false`;
//  - send mails a quotation (422 `customer_email_missing` for a customer with no email; send and confirm answer
//    422 `quotation_expired` after its validity date, and `actions.send` and `actions.confirm` are false then) and records how the customer may answer and sign from the settings (a quotation the customer answered cannot be sent again while `answered_resend` is `refuse`: 409 `quotation_answered`, and `actions.send` is false; an e-mail that is not an address answers `customer_email_missing`); the public routes (`handlePublicSales`,
//    no session, access token `tok-<id>`) read, accept (with a signature when asked) and decline a quotation that was
//    sent;
//  - the payments bridge: settings carry `payment_to_confirm` and `prepayment_percent` (absent under the cookie
//    `mock_payments=off`, which also makes a non-`off` choice answer 403 `feature_not_included`), a quotation keeps how it asks to be paid (a new one takes
//    the default once), the staff order shape carries `payment` and the public one `payment` with the pay page's path
//    (`/pay/order/<id>?access_token=tok-<id>`) once the customer may pay; `POST /api/v1/public/sales/__mock/pay` stands
//    in for the gateway: it records the payment and confirms the order as the server does, and
//    `POST /api/v1/public/sales/__mock/payments {on}` switches the tenant's payments for the public page, which reads no cookie.
//  - what the customer paid reads `received` on their page until the order is confirmed, and `paid` after; a quotation the staff confirmed
//    without the payment has none. A quotation that asks to be paid is confirmed by its payment, never by the acceptance alone. The staff
//    shape carries `amount_refundable` and `can_refund` (`payments.refund`, a payable document of the caller, something to give back), and
//    `POST /api/v1/sales/orders/{id}/refunds {amount, reference}` records a refund as the bridge does: 422 `invalid` on `amount` beyond
//    `amount_refundable` or on `reference`, 409 `conflict` for an exact replay, 403 `forbidden` without the capability or for an online order,
//    403 `feature_not_included` while the tenant cannot take payments. `mock_gateway=none` makes a payable quotation read `no_gateway`.
//  - sending again never confirms by itself, even with the money received: the public state reads `received`, and the customer's new
//    acceptance (or signature) confirms it; under answer mode `none` the staff payment carries `attention` `payment_awaits_confirmation`
//    until a holder of `sales.orders.confirm` confirms. A draft that holds money refuses another customer (422 `invalid` on `customer_id`).
//  - the CRM bridge, in the plan while `POST /api/v1/__mock/crm-win-by-order {on: true}` (crm-ui-preview-data.mjs) is: settings carry
//    `opportunity_win` and `opportunity_win_amount`; `GET` and `POST /api/v1/crm/opportunities/{id}/orders` list the orders of an
//    opportunity and write a draft quotation for its customer (422 `crm_opportunity_closed`, 422 `crm_opportunity_without_customer`);
//    the cookie `mock_crm_assign=off` makes writing a quotation for another agent's opportunity 403 `forbidden`; the staff shape carries `opportunity`; and confirming an order of an opportunity wins it with the untaxed (or taxed) total of its
//    confirmed orders, as the server does. Cancelling afterwards leaves the opportunity won.
//  - the Finance bridge, in the plan while `POST /api/v1/public/sales/__mock/finance {on: true}` is (sales-finance-mock-routes.mjs):
//    settings carry `invoice_down_payment`, the staff shape carries `invoicing`, and `POST /api/v1/sales/orders/{id}/invoices` makes a draft
//    invoice (an `Idempotency-Key` repeats the first answer); an order with a posted invoice cannot be cancelled, and one with a draft is
//    cancelled only by a caller who may manage invoices (settings also carry `invoice_actor`: who may invoice an order that is not theirs).
//    `__mock/invoice-paid {id, amount}` registers a payment on a posted invoice, `__mock/credit-note {id, amount}` posts a credit note against it.
import { capabilitiesForRequest } from './mock-capabilities.mjs'
import { findMockCustomer } from './customers-mock-routes.mjs'
import { findMockProduct } from './products-mock-routes.mjs'
import { crmPreviewLead, crmPreviewWin } from './crm-ui-preview-data.mjs'
import { salesCrmPlan, setSalesCrmWin } from './sales-crm-mock-state.mjs'
import { salesFinancePlan, setSalesFinancePlan } from './sales-finance-mock-state.mjs'
import { handleSalesReports } from './sales-reports-mock-routes.mjs'
import { handleSalesTemplateHooks, handleSalesTemplates, resetSalesTemplates, startFromTemplate } from './sales-templates-mock-routes.mjs'
import { cancelDraftInvoices, creditInvoice, handleSalesFinance, idempotentInvoice, invoiceOrder, invoicesBlockCancel, invoicingOf, payInvoice, resetSalesFinance } from './sales-finance-mock-routes.mjs'

export const SALES_CAPABILITIES = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm', 'sales.discounts.approve', 'sales.documents.assign', 'sales.reports.read', 'sales.settings.manage', 'payments.refund']

// Answers without a session, so a spec that never signs in (the customer's quotation page) can reset it too.
const RESET_PATH = '/api/v1/public/sales/__mock/reset'
const PAY_PATH = '/api/v1/public/sales/__mock/pay'
const PAYMENTS_PATH = '/api/v1/public/sales/__mock/payments'
const FINANCE_PATH = '/api/v1/public/sales/__mock/finance'
const INVOICE_PAID_PATH = '/api/v1/public/sales/__mock/invoice-paid'
const CREDIT_NOTE_PATH = '/api/v1/public/sales/__mock/credit-note'
const LIST_PATH = '/api/v1/sales/orders'
const SETTINGS_PATH = '/api/v1/sales/settings'
const SALESPEOPLE_PATH = '/api/v1/sales/salespeople'
const SALESPEOPLE_LIMIT = 50
const LEAD_ORDERS_PATH = /^\/api\/v1\/crm\/opportunities\/(\d+)\/orders$/
const RECORD_PATH = /^\/api\/v1\/sales\/orders\/(\d+)(?:\/(confirm|cancel|reopen|lock|unlock|duplicate|assign|send|pdf|refunds|invoices))?$/
const PUBLIC_PATH = /^\/api\/v1\/public\/sales\/quotations\/(\d+)(?:\/(accept|decline|pdf))?$/
// The day of the mock's documents: a quotation whose validity date is before it has expired.
const TODAY = '2026-11-14'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SIGNATURE_MAX_BYTES = 48 * 1024
const PNG_BASE64_PREFIX = 'iVBORw0KGgo'
const PDF_BYTES = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ME = { id: 2, name: 'Admin', user_id: 2 }
const PEOPLE = [ME, { id: 7, name: 'مها الثبيتي', user_id: 7 }, { id: 8, name: 'نايف العسيري', user_id: 8 }]
const LINE_KEYS = ['id', 'kind', 'product_id', 'name', 'quantity', 'discount_percent']
const WRITE_KEYS = ['customer_id', 'salesperson_id', 'validity_date', 'terms', 'lines', 'payment_to_confirm', 'prepayment_percent']
const PAYMENT_MODES = ['off', 'full', 'percent']
const OPPORTUNITY_WINS = ['order_confirmed', 'manual']
const WIN_AMOUNTS = ['untaxed', 'total']
const INVOICE_DOWN_PAYMENTS = ['allow', 'refuse']
const INVOICE_ACTORS = ['owner', 'any_biller']
const round2 = value => Math.round(value * 100) / 100

const freshSettings = () => ({ visibility: 'own', validity_days: 30, discount_limit_percent: 20, default_terms: 'الأسعار شاملة التوصيل داخل المدينة.', customer_answer: 'accept', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type', payment_to_confirm: 'off', prepayment_percent: 50, opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed', invoice_down_payment: 'allow', invoice_actor: 'owner', revision: 1 })
const waiting = mode => ({ mode, acceptance_confirms: false, answer: null, answered_at: null, signed_by: null, signature_method: null, decline_reason: null })
const line = (id, kind, fields) => ({ id, kind, product_id: null, name: '', quantity: 0, discount_percent: 0, ...fields })
const freshOrders = () => [
  { id: 1, number: 'S00001', state: 'draft', locked: false, source: 'staff', customer_id: 2, customer_name: 'مؤسسة النخيل', salesperson: ME, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z', terms: 'الأسعار شاملة التوصيل داخل المدينة.',
    lines: [line(11, 'section', { name: 'الباقات' }), line(12, 'product', { product_id: 1, name: 'باقة أساسية', quantity: 2, discount_percent: 10 }), line(13, 'note', { name: 'يبدأ الاشتراك من أول الشهر.' })] },
  { id: 2, number: 'S00002', state: 'confirmed', locked: false, source: 'staff', customer_id: 1, customer_name: 'منى العتيبي', salesperson: PEOPLE[1], validity_date: '2026-11-30', date: '2026-11-10T09:30:00Z', terms: '',
    lines: [line(21, 'product', { product_id: 202, name: 'عسل سدر', quantity: 3 })] },
  { id: 3, number: 'S00003', state: 'cancelled', locked: false, source: 'staff', customer_id: 3, customer_name: 'خالد الشهري', salesperson: ME, validity_date: null, date: '2026-11-01T12:00:00Z', terms: '',
    lines: [line(31, 'product', { product_id: 201, name: 'شاي أخضر', quantity: 5 })] },
  { id: 4, number: 'S00004', state: 'confirmed', locked: true, source: 'online', customer_id: 1, customer_name: 'منى العتيبي', salesperson: null, validity_date: null, date: '2026-11-12T18:20:00Z', terms: '',
    lines: [line(41, 'product', { product_id: 2, name: 'باقة متقدمة', quantity: 1 })] },
]
// Four quotations sent to a customer, by another salesperson: S00005 (the customer may accept or decline), S00006
// (accept with a signature, drawn or typed), S00007 (expired) and S00008 (read only). Each is open at `/quote/<id>?access_token=tok-<id>`.
const sent = (id, customer, fields) => ({ signature_methods: 'draw_or_type', id, number: `S${String(id).padStart(5, '0')}`, state: 'sent', locked: false, source: 'staff', customer_id: customer.id, customer_name: customer.name, salesperson: PEOPLE[1],
  validity_date: '2026-12-14', date: '2026-11-13T10:00:00Z', terms: 'يسري العرض لمدة شهر من تاريخه.', lines: [line(id * 10 + 1, 'product', { product_id: 1, name: 'باقة أساسية', quantity: 2 })], ...fields })
const sentOrders = () => [
  sent(5, { id: 1, name: 'منى العتيبي' }, { answer: waiting('accept') }),
  sent(6, { id: 1, name: 'منى العتيبي' }, { answer: waiting('accept_and_sign') }),
  sent(7, { id: 3, name: 'خالد الشهري' }, { answer: waiting('accept'), validity_date: '2026-11-01' }),
  sent(8, { id: 3, name: 'خالد الشهري' }, { answer: waiting('none') }),
]
const withPay = list => list.map(order => ({ pay: { mode: 'off', percent: 100, received: 0 }, ...order }))
let orders = withPay([...freshOrders(), ...sentOrders()])
let settings = freshSettings()
// Whether the tenant can take payments: the switch of `__mock/payments` and, for a staff request, its cookie (`mock_payments=off`).
let paymentsSwitch = true
let paymentsOn = true
// Whether a payment gateway is live for a staff request (the cookie `mock_gateway=none` takes it away): a payable quotation then reads `no_gateway`.
let gatewayOn = true
// The cookie of the request being answered: the Finance bridge reads what finance rights it carries (`mock_finance=read`, `hidden`).
let requestCookie = ''
let nextOrderId = 100
let nextLineId = 1000

const refusal = (status, code, message, extra = {}) => ({ status, body: { code, message, ...extra } })
const invalid = (field, message = `${field} is not valid`) => refusal(422, 'invalid', message, { field })
const hasCookie = (cookie, value) => new RegExp(`(?:^|;\\s*)${value}(?:;|$)`).test(cookie ?? '')

function capabilities(cookie) {
  const caps = capabilitiesForRequest(cookie, SALES_CAPABILITIES)
  if (hasCookie(cookie, 'mock_caps=reader')) return caps.filter(cap => cap === 'sales.read' || cap === 'sales.reports.read')
  if (hasCookie(cookie, 'mock_sales=agent')) return caps.filter(cap => ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm'].includes(cap))
  return caps
}

function priced(stored) {
  if (stored.kind !== 'product') return { untaxed: 0, tax: 0, unit_price: 0 }
  const product = findMockProduct(stored.product_id)
  const unit = stored.unit_price ?? product?.unit_price ?? 0
  const rate = (product?.taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0)
  const untaxed = round2(unit * stored.quantity * (1 - stored.discount_percent / 100))
  return { untaxed, tax: round2(untaxed * rate / 100), unit_price: unit }
}

function dumpLine(stored) {
  const amounts = priced(stored)
  const product = stored.kind === 'product' ? { id: stored.product_id, name: findMockProduct(stored.product_id)?.name ?? stored.name } : null
  return {
    id: stored.id, kind: stored.kind, product, name: stored.name, quantity: stored.quantity, unit: stored.kind === 'product' ? 'وحدة' : null,
    unit_price: amounts.unit_price, discount_percent: stored.discount_percent, amount_untaxed: amounts.untaxed, amount_tax: amounts.tax, amount_total: round2(amounts.untaxed + amounts.tax),
  }
}

const expired = order => order.validity_date !== null && order.validity_date < TODAY

/** An expired quotation that is still open: sending or confirming it answers 422 `quotation_expired`, as the server does. */
const expiredOpen = order => expired(order) && (order.state === 'draft' || order.state === 'sent')

const own = (order, caps) => caps.includes('sales.documents.assign') || order.salesperson?.id === ME.id

/** The tenant may refuse sending a quotation the customer answered: it is reopened first. */
const resendRefused = order => !!order.answer?.answer && settings.answered_resend === 'refuse'

/** Send would be offered to the caller but for the resend setting. */
const sendOpen = (order, caps) => order.source === 'staff' && own(order, caps) && caps.includes('sales.quotations.manage')
  && (order.state === 'draft' || order.state === 'sent') && !expired(order)

function actionsOf(order, caps) {
  const staff = order.source === 'staff'
  const mine = staff && own(order, caps)
  const quote = caps.includes('sales.quotations.manage')
  const confirm = caps.includes('sales.orders.confirm')
  const draft = order.state === 'draft'
  const open = draft || order.state === 'sent'
  const confirmed = order.state === 'confirmed'
  return {
    edit: mine && quote && draft,
    confirm: mine && confirm && open && !expired(order) && order.lines.some(item => item.kind === 'product'),
    cancel: mine && ((open && quote) || (confirmed && !order.locked && confirm && !invoicesBlockCancel(order, requestCookie))),
    reopen: mine && confirm && (order.state === 'cancelled' || order.state === 'sent'),
    lock: mine && confirm && confirmed && !order.locked,
    unlock: mine && confirm && confirmed && order.locked,
    duplicate: quote,
    assign: staff && caps.includes('sales.documents.assign'),
    send: sendOpen(order, caps) && !resendRefused(order),
  }
}

function dumpItem(order) {
  const lines = order.lines.map(dumpLine)
  const untaxed = round2(lines.reduce((sum, item) => sum + item.amount_untaxed, 0))
  const tax = round2(lines.reduce((sum, item) => sum + item.amount_tax, 0))
  return {
    id: order.id, number: order.number, state: order.state, locked: order.locked, expired: expired(order), source: order.source, customer_answer: order.answer ?? null,
    customer: { id: order.customer_id, name: order.customer_name },
    salesperson: order.salesperson, validity_date: order.validity_date, date: order.date, terms: order.terms, currency: CURRENCY,
    amount_untaxed: untaxed, amount_tax: tax, amount_total: round2(untaxed + tax),
  }
}

/** The customer still has to sign a quotation sent for a signature before they may pay it. */
const needsSignature = order => order.answer?.mode === 'accept_and_sign' && !order.answer.answer

const requiredAmount = (order, total) => round2(total * (order.pay.mode === 'off' ? 0 : order.pay.mode === 'full' ? 1 : order.pay.percent / 100))

/** The most one refund may record: all of the money before the order is confirmed, what it received beyond its total after. */
const refundable = (order, total) => order.state === 'confirmed' ? Math.max(round2(order.pay.received - total), 0) : order.pay.received

/** How a staff quotation asks to be paid, as the bridge's `payment` of the order shape; null for an online order or while the tenant cannot take payments. */
function staffPayment(order, caps) {
  if (order.source !== 'staff' || !paymentsOn) return null
  const total = dumpItem(order).amount_total
  const required = requiredAmount(order, total)
  const asks = order.pay.mode !== 'off'
  const open = order.state === 'sent' && !expired(order)
  const paid = asks && required > 0 && order.pay.received >= required
  const status = !asks ? 'none' : order.state === 'cancelled' ? 'cancelled' : paid ? 'paid' : open && !needsSignature(order) ? 'payable' : 'not_payable'
  const held = order.state === 'cancelled' && order.pay.received > 0 ? 'cancelled' : paid && order.state !== 'confirmed' && order.state !== 'cancelled' ? (order.state === 'draft' ? 'reopened' : expired(order) ? 'expired' : needsSignature(order) ? 'awaiting_signature' : null) : null
  // Sent again with no answer to wait for, holding what it asks: only a staff confirm can finish it.
  const awaitsConfirmation = paid && open && order.answer?.mode === 'none'
  return {
    mode: order.pay.mode, percent: order.pay.mode === 'off' ? 100 : order.pay.percent, currency: CURRENCY.name, amount_required: required,
    amount_received: order.pay.received, amount_due: asks && order.state !== 'cancelled' && order.state !== 'confirmed' ? Math.max(round2(required - order.pay.received), 0) : 0,
    amount_to_refund: order.state === 'cancelled' || held ? order.pay.received : order.state === 'confirmed' ? Math.max(round2(order.pay.received - total), 0) : 0,
    amount_refundable: refundable(order, total), can_refund: caps.includes('payments.refund') && own(order, caps) && refundable(order, total) > 0, status,
    link: !asks || paid || order.state === 'confirmed' ? 'none' : status === 'payable' ? (gatewayOn ? 'ready' : 'no_gateway') : open && needsSignature(order) ? 'awaiting_signature' : 'unavailable', held, needs_attention: awaitsConfirmation, attention: awaitsConfirmation ? 'payment_awaits_confirmation' : null,
  }
}

/** The opportunity of an order as the bridge names it; null without the bridge, without a link or when the record is gone. */
function opportunityOf(order) {
  const lead = salesCrmPlan() && order.lead_id ? crmPreviewLead(order.lead_id) : undefined
  return lead ? { id: lead.id, contact_name: lead.contact_name, status: lead.status, active: lead.active } : null
}

/** The invoicing of the order as the Finance bridge reports it; absent while Finance is not in the plan, and `invoicing` is part of the shape only then. */
const invoicingPart = (order, caps) => salesFinancePlan() ? { invoicing: invoicingOf(order, dumpItem(order).amount_total, caps, requestCookie, settings, own(order, caps)) } : {}

const dump = (order, caps) => ({ ...dumpItem(order), lines: order.lines.map(dumpLine), actions: actionsOf(order, caps), resend_refused: sendOpen(order, caps) && resendRefused(order), payment: staffPayment(order, caps), opportunity: opportunityOf(order), ...invoicingPart(order, caps) })

/** Under `own` a reader sees their documents and the online orders; the assign holder and `all` see every one. */
const visible = (order, caps) => settings.visibility === 'all' || caps.includes('sales.documents.assign') || order.salesperson === null || order.salesperson.id === ME.id

function listPage(url, caps) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const states = (url.searchParams.get('state') ?? '').split(',').filter(Boolean)
  const source = url.searchParams.get('source')
  const mine = url.searchParams.get('mine') === 'true'
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 25) || 25)
  if (states.some(state => !['draft', 'sent', 'confirmed', 'cancelled'].includes(state))) return invalid('state')
  if (source !== null && source !== 'staff' && source !== 'online') return invalid('source')
  const matches = orders.filter(order => visible(order, caps)).map(dumpItem).filter(order =>
    (!q || order.number.toLowerCase().includes(q) || order.customer.name.toLowerCase().includes(q))
    && (!states.length || states.includes(order.state)) && (!source || order.source === source) && (!mine || order.salesperson?.id === ME.id))
  return { status: 200, body: { items: matches.slice(offset, offset + limit), total: matches.length } }
}

/** The lines of a write as stored, or the refusal the server answers. */
function parseLines(lines, previous, caps) {
  if (!Array.isArray(lines)) return { failure: invalid('lines') }
  const stored = []
  for (const [index, input] of lines.entries()) {
    const unknown = Object.keys(input ?? {}).find(key => !LINE_KEYS.includes(key))
    if (unknown) return { failure: refusal(422, 'unknown_field', `field ${unknown} is not accepted`, { field: `lines.${index}.${unknown}` }) }
    const old = input.id ? previous.find(item => item.id === input.id) : null
    if (input.id && !old) return { failure: invalid(`lines.${index}.id`) }
    if (!['product', 'section', 'note'].includes(input.kind)) return { failure: invalid(`lines.${index}.kind`) }
    if (input.kind !== 'product') {
      if (typeof input.name !== 'string' || !input.name.trim()) return { failure: invalid(`lines.${index}.name`) }
      stored.push(line(old?.id ?? nextLineId++, input.kind, { name: input.name.trim() }))
      continue
    }
    const product = findMockProduct(input.product_id)
    if (!product) return { failure: invalid(`lines.${index}.product_id`) }
    if (typeof input.quantity !== 'number' || !(input.quantity > 0)) return { failure: invalid(`lines.${index}.quantity`) }
    const discount = input.discount_percent ?? 0
    if (typeof discount !== 'number' || discount < 0 || discount > 100) return { failure: invalid(`lines.${index}.discount_percent`) }
    const kept = old && old.discount_percent === discount
    if (!kept && settings.discount_limit_percent > 0 && discount > settings.discount_limit_percent && !caps.includes('sales.discounts.approve')) {
      return { failure: refusal(403, 'forbidden', 'discount above the limit', { field: `lines.${index}.discount_percent`, details: { reason: 'discount_above_limit' } }) }
    }
    // A line keeps the price it was created with until its product changes.
    const unitPrice = old && old.product_id === product.id ? old.unit_price ?? product.unit_price : product.unit_price
    // The server keeps the text staff wrote on a product line; otherwise the line shows the product's current description.
    const own = typeof input.name === 'string' ? input.name.trim() : ''
    const name = own && own !== product.name ? own : product.name
    stored.push(line(old?.id ?? nextLineId++, 'product', { product_id: product.id, name, quantity: input.quantity, discount_percent: discount, unit_price: unitPrice }))
  }
  return { stored }
}

const paymentsOff = cookie => hasCookie(cookie, 'mock_payments=off')

/** The payment choice of a write, as `liwan_sales` parses it, or null when the body makes none. */
function parsePayment(body, order, cookie) {
  if (!('payment_to_confirm' in body) && !('prepayment_percent' in body)) return null
  if ('payment_to_confirm' in body && !PAYMENT_MODES.includes(body.payment_to_confirm)) return { failure: invalid('payment_to_confirm') }
  if ('prepayment_percent' in body && (!Number.isInteger(body.prepayment_percent) || body.prepayment_percent < 1 || body.prepayment_percent > 100)) return { failure: invalid('prepayment_percent') }
  const mode = body.payment_to_confirm ?? order?.pay.mode ?? settings.payment_to_confirm
  if ('prepayment_percent' in body && mode !== 'percent') return { failure: invalid('prepayment_percent', 'the percentage applies only when the customer pays a part') }
  if (mode !== 'off' && paymentsOff(cookie)) return { failure: refusal(403, 'feature_not_included', 'this feature is not included') }
  const kept = order?.pay.mode === 'percent' ? order.pay.percent : settings.prepayment_percent
  return { pay: { mode, percent: mode === 'full' ? 100 : body.prepayment_percent ?? kept, received: order?.pay.received ?? 0 } }
}

function parseWrite(body, previous, caps, cookie, order = null) {
  const unknown = Object.keys(body).find(key => !WRITE_KEYS.includes(key))
  if (unknown) return { failure: refusal(422, 'unknown_field', `field ${unknown} is not accepted`, { field: unknown }) }
  const values = {}
  if ('customer_id' in body) {
    const customer = findMockCustomer(body.customer_id)
    if (!customer) return { failure: invalid('customer_id') }
    // The money on a draft belongs to the payer who made it.
    if (order && order.pay.received > 0 && customer.id !== order.customer_id) return { failure: invalid('customer_id', 'a quotation that holds a payment keeps its customer') }
    values.customer_id = customer.id
    values.customer_name = customer.name
  }
  if ('salesperson_id' in body && caps.includes('sales.documents.assign')) {
    const person = PEOPLE.find(candidate => candidate.id === body.salesperson_id)
    if (!person) return { failure: invalid('salesperson_id') }
    values.salesperson = person
  }
  if ('validity_date' in body) {
    if (body.validity_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.validity_date))) return { failure: invalid('validity_date') }
    values.validity_date = body.validity_date
  }
  if ('terms' in body) {
    if (typeof body.terms !== 'string') return { failure: invalid('terms') }
    values.terms = body.terms
  }
  if ('lines' in body) {
    const parsed = parseLines(body.lines, previous, caps)
    if (parsed.failure) return parsed
    values.lines = parsed.stored
  }
  const pay = parsePayment(body, order, cookie)
  if (pay?.failure) return pay
  if (pay) values.pay = pay.pay
  return { values }
}

function validityFromSettings() {
  const day = new Date(Date.UTC(2026, 10, 14) + settings.validity_days * 86_400_000)
  return day.toISOString().slice(0, 10)
}

function create(body, caps, cookie) {
  if (!('customer_id' in body)) return invalid('customer_id', 'customer_id is required')
  // A template (sales-templates-mock-routes.mjs) gives the lines, terms and validity the body leaves out; the lines are priced below.
  if ('template_id' in body) {
    const started = startFromTemplate(body)
    if (started.failure) return started.failure
    body = started.body
  }
  const parsed = parseWrite(body, [], caps, cookie)
  if (parsed.failure) return parsed.failure
  const id = nextOrderId++
  const order = {
    id, number: `S${String(id).padStart(5, '0')}`, state: 'draft', locked: false, source: 'staff', salesperson: ME,
    validity_date: validityFromSettings(), date: '2026-11-14T10:00:00Z', terms: settings.default_terms, lines: [],
    pay: paymentsOff(cookie) ? { mode: 'off', percent: 100, received: 0 } : { mode: settings.payment_to_confirm, percent: settings.payment_to_confirm === 'full' ? 100 : settings.prepayment_percent, received: 0 },
    ...parsed.values,
  }
  orders = [order, ...orders]
  return { status: 201, body: dump(order, caps) }
}

const MOVES = {
  confirm: { allowed: actions => actions.confirm, apply: order => { order.state = 'confirmed' } },
  cancel: { allowed: actions => actions.cancel, apply: order => { const was = order.state === 'confirmed'; order.state = 'cancelled'; cancelDraftInvoices(order); if (was) winOpportunity(order) } },
  reopen: { allowed: actions => actions.reopen, apply: order => { order.state = 'draft'; order.answer = null } },
  lock: { allowed: actions => actions.lock, apply: order => { order.locked = true } },
  unlock: { allowed: actions => actions.unlock, apply: order => { order.locked = false } },
}

/** Mails the quotation (how the customer may answer is read from the settings now); the refusal, or null when it was sent. */
function sendQuotation(order, caps) {
  if (expiredOpen(order)) return refusal(422, 'quotation_expired', 'the quotation has expired')
  if (sendOpen(order, caps) && resendRefused(order)) return refusal(409, 'quotation_answered', 'the customer answered this quotation; reopen it before sending it again')
  if (!actionsOf(order, caps).send) return refusal(403, 'transition_forbidden', 'send is not allowed now')
  if (!order.lines.some(item => item.kind === 'product')) return invalid('lines', 'a quotation needs a product line to be sent')
  if (!EMAIL.test(findMockCustomer(order.customer_id)?.email ?? '')) return refusal(422, 'customer_email_missing', 'the customer has no email address')
  order.state = 'sent'
  order.answer = { ...waiting(settings.customer_answer), acceptance_confirms: settings.acceptance_confirms }
  order.signature_methods = settings.signature_methods
  return null
}

const settingsView = manage => {
  const { payment_to_confirm: mode, prepayment_percent: percent, opportunity_win: win, opportunity_win_amount: amount, invoice_down_payment: down, invoice_actor: actor, ...rest } = settings
  return { ...rest, ...(paymentsOn ? { payment_to_confirm: mode, prepayment_percent: percent } : {}), ...(salesCrmPlan() ? { opportunity_win: win, opportunity_win_amount: amount } : {}), ...(salesFinancePlan() ? { invoice_down_payment: down, invoice_actor: actor } : {}), can_manage: manage }
}

function updateSettings(body, manage) {
  if (!manage) return refusal(403, 'forbidden', 'only the main company manages these settings')
  if (body.revision !== settings.revision) return refusal(409, 'conflict', 'Sales settings changed; reload before saving')
  const next = { ...settings }
  if ('visibility' in body) { if (!['own', 'all'].includes(body.visibility)) return invalid('visibility'); next.visibility = body.visibility }
  if ('validity_days' in body) { if (!Number.isInteger(body.validity_days) || body.validity_days < 0 || body.validity_days > 3650) return invalid('validity_days'); next.validity_days = body.validity_days }
  if ('discount_limit_percent' in body) { const value = body.discount_limit_percent; if (!Number.isInteger(value) || value < 0 || value > 100) return invalid('discount_limit_percent'); next.discount_limit_percent = value }
  if ('default_terms' in body) { if (typeof body.default_terms !== 'string') return invalid('default_terms'); next.default_terms = body.default_terms }
  if ('customer_answer' in body) { if (!['none', 'accept', 'accept_and_sign'].includes(body.customer_answer)) return invalid('customer_answer'); next.customer_answer = body.customer_answer }
  if ('answered_resend' in body) { if (!['allow', 'refuse'].includes(body.answered_resend)) return invalid('answered_resend'); next.answered_resend = body.answered_resend }
  if ('signature_methods' in body) { if (!['draw', 'draw_or_type'].includes(body.signature_methods)) return invalid('signature_methods'); next.signature_methods = body.signature_methods }
  if ('acceptance_confirms' in body) { if (typeof body.acceptance_confirms !== 'boolean') return invalid('acceptance_confirms'); next.acceptance_confirms = body.acceptance_confirms }
  if ('payment_to_confirm' in body) { if (!PAYMENT_MODES.includes(body.payment_to_confirm)) return invalid('payment_to_confirm'); next.payment_to_confirm = body.payment_to_confirm }
  if ('prepayment_percent' in body) { const value = body.prepayment_percent; if (!Number.isInteger(value) || value < 1 || value > 100) return invalid('prepayment_percent'); next.prepayment_percent = value }
  if ('opportunity_win' in body) { if (!OPPORTUNITY_WINS.includes(body.opportunity_win)) return invalid('opportunity_win'); next.opportunity_win = body.opportunity_win }
  if ('opportunity_win_amount' in body) { if (!WIN_AMOUNTS.includes(body.opportunity_win_amount)) return invalid('opportunity_win_amount'); next.opportunity_win_amount = body.opportunity_win_amount }
  if ('invoice_down_payment' in body) { if (!INVOICE_DOWN_PAYMENTS.includes(body.invoice_down_payment)) return invalid('invoice_down_payment'); next.invoice_down_payment = body.invoice_down_payment }
  if ('invoice_actor' in body) { if (!INVOICE_ACTORS.includes(body.invoice_actor)) return invalid('invoice_actor'); next.invoice_actor = body.invoice_actor }
  if (!salesFinancePlan() && ('invoice_down_payment' in body || 'invoice_actor' in body)) return refusal(403, 'feature_not_included', 'this feature is not included')
  if (!paymentsOn && ('payment_to_confirm' in body || 'prepayment_percent' in body)) return refusal(403, 'feature_not_included', 'this feature is not included')
  if (!salesCrmPlan() && ('opportunity_win' in body || 'opportunity_win_amount' in body)) return refusal(403, 'feature_not_included', 'this feature is not included')
  settings = { ...next, revision: settings.revision + 1 }
  setSalesCrmWin(settings.opportunity_win)
  return { status: 200, body: settingsView(true) }
}

/** What the opportunity is won for: its confirmed orders summed, untaxed or taxed as the settings say. */
function wonAmount(leadId) {
  const key = settings.opportunity_win_amount === 'total' ? 'amount_total' : 'amount_untaxed'
  return round2(orders.filter(order => order.lead_id === leadId && order.state === 'confirmed').reduce((sum, order) => sum + dumpItem(order)[key], 0))
}

/** The server's win: a confirmed order wins its opportunity when the tenant lets it; a lost or archived one stays as it is. */
function winOpportunity(order) {
  if (!order.lead_id || !salesCrmPlan() || settings.opportunity_win !== 'order_confirmed') return
  // An order that left the confirmed state only changes the amount of an opportunity that is already won.
  if (order.state !== 'confirmed' && crmPreviewLead(order.lead_id)?.status !== 'won') return
  crmPreviewWin(order.lead_id, wonAmount(order.lead_id))
}

/** The bridge's two routes: the orders of an opportunity, and a draft quotation written for its customer. */
function leadOrders(req, leadId, url, caps) {
  if (!salesCrmPlan()) return refusal(403, 'feature_not_included', 'this feature is not included')
  const lead = crmPreviewLead(leadId)
  if (!lead) return refusal(404, 'not_found', 'Record does not exist')
  if (req.method === 'GET') {
    if (!caps.includes('sales.read')) return refusal(403, 'forbidden', 'forbidden')
    const found = orders.filter(order => order.lead_id === lead.id && visible(order, caps))
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 25) || 25)
    return { status: 200, body: { items: found.slice(offset, offset + limit).map(dumpItem), total: found.length } }
  }
  if (!caps.includes('sales.quotations.manage')) return refusal(403, 'forbidden', 'forbidden')
  // Linking is a write on the opportunity: its agent or a holder of `crm.leads.assign` only.
  if (lead.user?.id !== ME.id && hasCookie(req.headers.cookie, 'mock_crm_assign=off')) return refusal(403, 'forbidden', 'only the agent of this opportunity may change it')
  if (!lead.active || lead.status === 'lost') return refusal(422, 'invalid', 'a lost or archived opportunity takes no new quotation', { details: { reason: 'crm_opportunity_closed' } })
  if (!lead.customer) return refusal(422, 'invalid', 'link the opportunity to a customer before writing its quotation', { field: 'customer_id', details: { reason: 'crm_opportunity_without_customer' } })
  const created = create({ customer_id: lead.customer.id, lines: [] }, caps, req.headers.cookie)
  if (created.status !== 201) return created
  const stored = orders.find(order => order.id === created.body.id)
  stored.lead_id = lead.id
  return { status: 200, body: dump(stored, caps) }
}

/** The product lines of the documents the caller reads, one row each: what the Sales reports add up (sales-reports-mock-routes.mjs). */
function reportRows(caps) {
  return orders.filter(order => visible(order, caps)).flatMap(order => order.lines.filter(stored => stored.kind === 'product').map((stored) => {
    const shown = dumpLine(stored)
    return {
      lineId: stored.id, orderId: order.id, number: order.number, state: order.state, source: order.source, date: order.date,
      customer: { id: order.customer_id, name: order.customer_name }, salesperson: order.salesperson, product: shown.product,
      quantity: shown.quantity, unit_price: shown.unit_price, discount_percent: shown.discount_percent,
      amount_untaxed: shown.amount_untaxed, amount_total: shown.amount_total,
    }
  }))
}

/** Answers a sales request and returns true; any other path is not this stub's. */
export async function handleSales(req, res, path, url, { json, readBody }) {
  if (handleSalesFinance(req, path, (status, body) => json(res, status, body))) return true
  if (handleSalesReports(req, res, path, url, json, capabilities(req.headers.cookie), reportRows)) return true
  if (await handleSalesTemplates(req, res, path, url, { json, readBody }, capabilities(req.headers.cookie), () => { paymentsOn = paymentsSwitch && !paymentsOff(req.headers.cookie); return settingsView(false) })) return true
  const record = path.match(RECORD_PATH)
  const ofLead = path.match(LEAD_ORDERS_PATH)
  if (!(path === LIST_PATH || path === SETTINGS_PATH || path === SALESPEOPLE_PATH || record || ofLead)) return false
  const caps = capabilities(req.headers.cookie)
  requestCookie = req.headers.cookie ?? ''
  paymentsOn = paymentsSwitch && !paymentsOff(req.headers.cookie)
  gatewayOn = !hasCookie(req.headers.cookie, 'mock_gateway=none')
  const send = result => json(res, result.status, result.body)
  const need = capability => {
    if (caps.includes(capability)) return true
    json(res, 403, { code: 'forbidden', message: 'forbidden' })
    return false
  }
  let body = {}
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
  }

  if (ofLead) {
    if (req.method !== 'GET' && req.method !== 'POST') return false
    send(leadOrders(req, Number(ofLead[1]), url, caps))
    return true
  }
  if (path === SALESPEOPLE_PATH && req.method === 'GET') {
    if (need('sales.documents.assign')) {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      json(res, 200, PEOPLE.filter(person => !q || person.name.toLowerCase().includes(q)).slice(0, SALESPEOPLE_LIMIT))
    }
    return true
  }
  if (path === SETTINGS_PATH) {
    const manage = caps.includes('sales.settings.manage') && !hasCookie(req.headers.cookie, 'mock_sales=branch')
    if (req.method === 'GET') {
      if (!caps.includes('sales.read') && !caps.includes('sales.settings.manage')) json(res, 403, { code: 'forbidden', message: 'forbidden' })
      else json(res, 200, settingsView(manage))
      return true
    }
    if (req.method === 'PATCH' && need('sales.settings.manage')) send(updateSettings(body, manage))
    return true
  }
  if (path === LIST_PATH && req.method === 'GET') {
    if (need('sales.read')) send(listPage(url, caps))
    return true
  }
  if (path === LIST_PATH && req.method === 'POST') {
    if (need('sales.quotations.manage')) send(create(body, caps, req.headers.cookie))
    return true
  }
  if (!record || !need('sales.read')) return Boolean(record)
  const order = orders.find(candidate => candidate.id === Number(record[1]) && visible(candidate, caps))
  if (!order) {
    send(refusal(404, 'not_found', 'not found'))
    return true
  }
  const action = record[2]
  if (!action && req.method === 'GET') {
    send({ status: 200, body: dump(order, caps) })
    return true
  }
  if (action === 'pdf' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${order.number}.pdf"` })
    res.end(PDF_BYTES)
    return true
  }
  if (req.method !== (action ? 'POST' : 'PATCH')) return false
  if (action === 'send') {
    if (!need('sales.quotations.manage')) return true
    send(sendQuotation(order, caps) ?? { status: 200, body: dump(order, caps) })
    return true
  }
  if (action === 'duplicate') {
    if (!need('sales.quotations.manage')) return true
    const lines = order.lines.map(({ id: _id, unit_price: _price, ...rest }) => rest)
    send(create({ customer_id: order.customer_id, lines }, caps, req.headers.cookie))
    return true
  }
  if (action === 'refunds') {
    send(recordRefund(order, body, caps))
    return true
  }
  if (action === 'invoices') {
    send(idempotentInvoice(req.headers['idempotency-key'], order, body, () => invoiceOrder(order, dumpItem(order).amount_total, body, caps, req.headers.cookie, settings, own(order, caps)) ?? { status: 200, body: dump(order, caps) }))
    return true
  }
  if (action === 'assign') {
    if (!need('sales.documents.assign')) return true
    if (order.source !== 'staff') return send(refusal(403, 'forbidden', 'an online order is not written in sales')), true
    const person = PEOPLE.find(candidate => candidate.id === body.salesperson_id)
    if (!person) return send(invalid('salesperson_id')), true
    order.salesperson = person
    send({ status: 200, body: dump(order, caps) })
    return true
  }
  if (action) {
    const move = MOVES[action]
    if (action === 'confirm' && expiredOpen(order)) send(refusal(422, 'quotation_expired', 'the quotation has expired'))
    else if (!move.allowed(actionsOf(order, caps))) send(refusal(403, 'transition_forbidden', `${action} is not allowed now`))
    else { move.apply(order); if (action === 'confirm') winOpportunity(order); send({ status: 200, body: dump(order, caps) }) }
    return true
  }
  if (!need('sales.quotations.manage')) return true
  if (!actionsOf(order, caps).edit) return send(refusal(403, order.state === 'draft' ? 'forbidden' : 'transition_forbidden', 'not editable')), true
  if (!Object.keys(body).length) return send(invalid('customer_id', 'nothing to change')), true
  const parsed = parseWrite(body, order.lines, caps, req.headers.cookie, order)
  if (parsed.failure) return send(parsed.failure), true
  Object.assign(order, parsed.values)
  send({ status: 200, body: dump(order, caps) })
  return true
}

const publicLine = stored => {
  const { id: _id, product: _product, ...rest } = dumpLine(stored)
  return rest
}

/** What the link holder sees of the payment: the pay page's path only while the customer may pay. */
function publicPayment(order, total) {
  if (order.pay.mode === 'off' || !paymentsOn) return null
  const required = requiredAmount(order, total)
  const open = order.state === 'sent' && !expired(order)
  const paid = required > 0 && order.pay.received >= required
  // The staff confirmed the order without the payment: the customer's page says nothing about it.
  if (order.state === 'confirmed' && !paid) return null
  const state = paid ? (order.state === 'confirmed' ? 'paid' : 'received') : !open ? 'unavailable' : needsSignature(order) ? 'awaiting_signature' : 'payable'
  return {
    percent: order.pay.percent, amount: paid ? 0 : Math.max(round2(required - order.pay.received), 0), currency: CURRENCY.name,
    pay_url: state === 'payable' ? `/pay/order/${order.id}?access_token=tok-${order.id}` : null, state,
  }
}

/** The quotation as its customer reads it: the same document, as the link holder's contract describes it. */
function publicQuotation(order) {
  const item = dumpItem(order)
  const open = order.state === 'sent' && !expired(order) && !order.answer.answer && order.answer.mode !== 'none'
  return {
    id: order.id, number: order.number, state: order.state, expired: item.expired, company_name: 'ليوان', customer_name: order.customer_name, date: order.date,
    validity_date: order.validity_date, terms: order.terms, currency: CURRENCY, amount_untaxed: item.amount_untaxed, amount_tax: item.amount_tax,
    amount_total: item.amount_total, lines: order.lines.map(publicLine), answer_mode: order.answer.mode, signature_methods: order.signature_methods, answer: order.answer.answer,
    answered_at: order.answer.answered_at, signed_by: order.answer.signed_by, can_accept: open, can_decline: open,
    payment: publicPayment(order, item.amount_total),
  }
}

/** The gateway's word that the customer paid what the quotation asks: the order is confirmed unless it still waits for a signature or can no longer be (the payment stays recorded). */
function receivePayment(order) {
  order.pay.received = requiredAmount(order, dumpItem(order).amount_total)
  const confirmable = order.state === 'sent' && !expired(order) && !needsSignature(order)
  if (!confirmable) return
  if (order.answer.mode === 'accept' && !order.answer.answer) Object.assign(order.answer, { answer: 'accepted', answered_at: new Date().toISOString() })
  order.state = 'confirmed'
}

/** A refund the tenant already made at its gateway, recorded on a staff quotation as `_liwan_record_refund` checks it. */
function recordRefund(order, body, caps) {
  if (order.source !== 'staff' || !caps.includes('payments.refund') || !own(order, caps)) return refusal(403, 'forbidden', 'forbidden')
  if (!paymentsOn) return refusal(403, 'feature_not_included', 'this feature is not included')
  const unknown = Object.keys(body).find(key => !['amount', 'reference'].includes(key))
  if (unknown) return refusal(422, 'unknown_field', `field '${unknown}' is not accepted`, { field: unknown })
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  if (!reference || reference.length > 128) return invalid('reference', 'reference is 1 to 128 characters')
  if (typeof body.amount !== 'number' || !(body.amount > 0)) return invalid('amount', 'amount must be greater than zero')
  const refunds = (order.refunds ??= [])
  if (refunds.some(done => done.amount === body.amount && done.reference === reference)) return refusal(409, 'conflict', 'this refund was already recorded')
  const most = refundable(order, dumpItem(order).amount_total)
  if (body.amount > most) return invalid('amount', `amount is at most ${most}`)
  refunds.push({ amount: body.amount, reference })
  order.pay.received = round2(order.pay.received - body.amount)
  return { status: 200, body: dump(order, caps) }
}

const SIGNATURE_KEYS = ['signed_by', 'signature', 'signature_method']

/** The signature fields of an acceptance, or the refusal, in the order and with the codes of `parse_signature` in
 * serializers/public.py: mode `accept` takes none (`unknown_field` on the first one given), `accept_and_sign` takes all three. */
function checkSignature(order, body) {
  if (order.answer.mode !== 'accept_and_sign') {
    const given = SIGNATURE_KEYS.find(key => key in body)
    return given ? refusal(422, 'unknown_field', `field '${given}' is not accepted`, { field: given }) : null
  }
  if ('signature_method' in body && (body.signature ?? null) === null) return invalid('signature_method', 'signature_method comes with a signature')
  if (body.signed_by == null || (typeof body.signed_by === 'string' && !body.signed_by.trim())) return refusal(422, 'signature_required', 'the name of the signer is required')
  if (typeof body.signed_by !== 'string' || body.signed_by.trim().length > 120) return refusal(422, 'signature_invalid', 'the name of the signer is at most 120 characters')
  if (body.signature == null) return refusal(422, 'signature_required', 'the signature is required')
  const bytes = typeof body.signature === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(body.signature) ? Buffer.from(body.signature, 'base64') : null
  if (!bytes || bytes.length > SIGNATURE_MAX_BYTES || !body.signature.startsWith(PNG_BASE64_PREFIX)) return refusal(422, 'signature_invalid', 'the signature must be a small PNG image as base64 text')
  if (!['drawn', 'typed'].includes(body.signature_method)) return invalid('signature_method', 'signature_method must be one of drawn or typed')
  if (body.signature_method === 'typed' && order.signature_methods === 'draw') return invalid('signature_method', 'this quotation takes a hand-drawn signature only')
  return null
}

function answerQuotation(order, action, body) {
  if (order.answer.answer) return refusal(422, 'already_answered', 'the quotation was already answered')
  if (expired(order)) return refusal(422, 'quotation_expired', 'the quotation has expired')
  if (!publicQuotation(order).can_accept) return refusal(422, 'answer_not_allowed', 'the quotation cannot be answered')
  const answeredAt = new Date().toISOString()
  if (action === 'decline') {
    if (typeof body.reason === 'string' && body.reason.length > 1000) return invalid('reason')
    Object.assign(order.answer, { answer: 'declined', answered_at: answeredAt, decline_reason: body.reason?.trim() || null })
    // As on the server, a decline cancels the quotation.
    order.state = 'cancelled'
  } else {
    const failure = checkSignature(order, body)
    if (failure) return failure
    Object.assign(order.answer, { answer: 'accepted', answered_at: answeredAt, signed_by: body.signed_by?.trim() ?? null, signature_method: body.signature_method ?? null })
    const paid = order.pay.mode !== 'off' && order.pay.received >= requiredAmount(order, dumpItem(order).amount_total)
    // A quotation that asks to be paid is confirmed by its payment, never by the acceptance alone.
    if ((order.answer.acceptance_confirms && order.pay.mode === 'off') || paid) order.state = 'confirmed'
  }
  return null
}

/** The routes of the customer's quotation link: no session, the access token `tok-<id>` is the only credential. */
export async function handlePublicSales(req, res, path, url, { json, readBody }) {
  if (await handleSalesTemplateHooks(req, res, path, { json, readBody })) return true
  if (path === RESET_PATH && req.method === 'POST') {
    orders = withPay([...freshOrders(), ...sentOrders()])
    paymentsSwitch = true
    setSalesFinancePlan(false)
    resetSalesFinance()
    settings = freshSettings()
    resetSalesTemplates()
    setSalesCrmWin(settings.opportunity_win)
    nextOrderId = 100
    nextLineId = 1000
    json(res, 200, {})
    return true
  }
  if (path === PAY_PATH && req.method === 'POST') {
    let paid = {}
    try { paid = JSON.parse(await readBody(req) || '{}') } catch { paid = {} }
    const target = orders.find(candidate => candidate.id === paid.id && candidate.pay.mode !== 'off')
    if (!target) json(res, 404, { code: 'not_found', message: 'not found' })
    else {
      receivePayment(target)
      json(res, 200, {})
    }
    return true
  }
  if (path === FINANCE_PATH && req.method === 'POST') {
    let switched = {}
    try { switched = JSON.parse(await readBody(req) || '{}') } catch { switched = {} }
    setSalesFinancePlan(switched.on === true)
    json(res, 200, {})
    return true
  }
  if (path === INVOICE_PAID_PATH && req.method === 'POST') {
    let paid = {}
    try { paid = JSON.parse(await readBody(req) || '{}') } catch { paid = {} }
    json(res, payInvoice(paid.id, paid.amount) ? 200 : 404, {})
    return true
  }
  if (path === CREDIT_NOTE_PATH && req.method === 'POST') {
    let credit = {}
    try { credit = JSON.parse(await readBody(req) || '{}') } catch { credit = {} }
    json(res, creditInvoice(credit.id, credit.amount) ? 200 : 404, {})
    return true
  }
  if (path === PAYMENTS_PATH && req.method === 'POST') {
    let switched = {}
    try { switched = JSON.parse(await readBody(req) || '{}') } catch { switched = {} }
    paymentsSwitch = switched.on !== false
    json(res, 200, {})
    return true
  }
  const route = PUBLIC_PATH.exec(path)
  if (!route) return false
  paymentsOn = paymentsSwitch
  const [, rawId, action] = route
  let body = {}
  if (req.method === 'POST') {
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
  }
  const token = req.method === 'POST' ? body.access_token : url.searchParams.get('access_token')
  const order = orders.find(candidate => candidate.id === Number(rawId) && candidate.answer)
  if (!order || token !== `tok-${order.id}`) {
    json(res, 404, { code: 'not_found', message: 'not found' })
    return true
  }
  if (!action && req.method === 'GET') json(res, 200, publicQuotation(order))
  else if (action === 'pdf' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${order.number}.pdf"` })
    res.end(PDF_BYTES)
  } else if ((action === 'accept' || action === 'decline') && req.method === 'POST') {
    const failure = answerQuotation(order, action, body)
    json(res, failure?.status ?? 200, failure?.body ?? publicQuotation(order))
  } else return false
  return true
}
