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
//    sent.
import { capabilitiesForRequest } from './mock-capabilities.mjs'
import { findMockCustomer } from './customers-mock-routes.mjs'
import { findMockProduct } from './products-mock-routes.mjs'

export const SALES_CAPABILITIES = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm', 'sales.discounts.approve', 'sales.documents.assign', 'sales.settings.manage']

// Answers without a session, so a spec that never signs in (the customer's quotation page) can reset it too.
const RESET_PATH = '/api/v1/public/sales/__mock/reset'
const LIST_PATH = '/api/v1/sales/orders'
const SETTINGS_PATH = '/api/v1/sales/settings'
const SALESPEOPLE_PATH = '/api/v1/sales/salespeople'
const SALESPEOPLE_LIMIT = 50
const RECORD_PATH = /^\/api\/v1\/sales\/orders\/(\d+)(?:\/(confirm|cancel|reopen|lock|unlock|duplicate|assign|send|pdf))?$/
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
const WRITE_KEYS = ['customer_id', 'salesperson_id', 'validity_date', 'terms', 'lines']
const round2 = value => Math.round(value * 100) / 100

const freshSettings = () => ({ visibility: 'own', validity_days: 30, discount_limit_percent: 20, default_terms: 'الأسعار شاملة التوصيل داخل المدينة.', customer_answer: 'accept', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 1 })
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
let orders = [...freshOrders(), ...sentOrders()]
let settings = freshSettings()
let nextOrderId = 100
let nextLineId = 1000

const refusal = (status, code, message, extra = {}) => ({ status, body: { code, message, ...extra } })
const invalid = (field, message = `${field} is not valid`) => refusal(422, 'invalid', message, { field })
const hasCookie = (cookie, value) => new RegExp(`(?:^|;\\s*)${value}(?:;|$)`).test(cookie ?? '')

function capabilities(cookie) {
  const caps = capabilitiesForRequest(cookie, SALES_CAPABILITIES)
  if (hasCookie(cookie, 'mock_caps=reader')) return caps.filter(cap => cap === 'sales.read')
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
    cancel: mine && ((open && quote) || (confirmed && !order.locked && confirm)),
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

const dump = (order, caps) => ({ ...dumpItem(order), lines: order.lines.map(dumpLine), actions: actionsOf(order, caps), resend_refused: sendOpen(order, caps) && resendRefused(order) })

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
    stored.push(line(old?.id ?? nextLineId++, 'product', { product_id: product.id, name: product.name, quantity: input.quantity, discount_percent: discount, unit_price: unitPrice }))
  }
  return { stored }
}

function parseWrite(body, previous, caps) {
  const unknown = Object.keys(body).find(key => !WRITE_KEYS.includes(key))
  if (unknown) return { failure: refusal(422, 'unknown_field', `field ${unknown} is not accepted`, { field: unknown }) }
  const values = {}
  if ('customer_id' in body) {
    const customer = findMockCustomer(body.customer_id)
    if (!customer) return { failure: invalid('customer_id') }
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
  return { values }
}

function validityFromSettings() {
  const day = new Date(Date.UTC(2026, 10, 14) + settings.validity_days * 86_400_000)
  return day.toISOString().slice(0, 10)
}

function create(body, caps) {
  if (!('customer_id' in body)) return invalid('customer_id', 'customer_id is required')
  const parsed = parseWrite(body, [], caps)
  if (parsed.failure) return parsed.failure
  const id = nextOrderId++
  const order = {
    id, number: `S${String(id).padStart(5, '0')}`, state: 'draft', locked: false, source: 'staff', salesperson: ME,
    validity_date: validityFromSettings(), date: '2026-11-14T10:00:00Z', terms: settings.default_terms, lines: [], ...parsed.values,
  }
  orders = [order, ...orders]
  return { status: 201, body: dump(order, caps) }
}

const MOVES = {
  confirm: { allowed: actions => actions.confirm, apply: order => { order.state = 'confirmed' } },
  cancel: { allowed: actions => actions.cancel, apply: order => { order.state = 'cancelled' } },
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
  settings = { ...next, revision: settings.revision + 1 }
  return { status: 200, body: { ...settings, can_manage: true } }
}

/** Answers a sales request and returns true; any other path is not this stub's. */
export async function handleSales(req, res, path, url, { json, readBody }) {
  const record = path.match(RECORD_PATH)
  if (!(path === LIST_PATH || path === SETTINGS_PATH || path === SALESPEOPLE_PATH || record)) return false
  const caps = capabilities(req.headers.cookie)
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
      else json(res, 200, { ...settings, can_manage: manage })
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
    if (need('sales.quotations.manage')) send(create(body, caps))
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
    send(create({ customer_id: order.customer_id, lines }, caps))
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
    else { move.apply(order); send({ status: 200, body: dump(order, caps) }) }
    return true
  }
  if (!need('sales.quotations.manage')) return true
  if (!actionsOf(order, caps).edit) return send(refusal(403, order.state === 'draft' ? 'forbidden' : 'transition_forbidden', 'not editable')), true
  if (!Object.keys(body).length) return send(invalid('customer_id', 'nothing to change')), true
  const parsed = parseWrite(body, order.lines, caps)
  if (parsed.failure) return send(parsed.failure), true
  Object.assign(order, parsed.values)
  send({ status: 200, body: dump(order, caps) })
  return true
}

const publicLine = stored => {
  const { id: _id, product: _product, ...rest } = dumpLine(stored)
  return rest
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
  }
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
    if (order.answer.acceptance_confirms) order.state = 'confirmed'
  }
  return null
}

/** The routes of the customer's quotation link: no session, the access token `tok-<id>` is the only credential. */
export async function handlePublicSales(req, res, path, url, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    orders = [...freshOrders(), ...sentOrders()]
    settings = freshSettings()
    nextOrderId = 100
    nextLineId = 1000
    json(res, 200, {})
    return true
  }
  const route = PUBLIC_PATH.exec(path)
  if (!route) return false
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
