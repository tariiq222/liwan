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
//  - the settings carry a revision: a stale one answers 409 `conflict`; `mock_sales=branch` reads `can_manage: false`.
import { capabilitiesForRequest } from './mock-capabilities.mjs'
import { findMockCustomer } from './customers-mock-routes.mjs'
import { findMockProduct } from './products-mock-routes.mjs'

export const SALES_CAPABILITIES = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm', 'sales.discounts.approve', 'sales.documents.assign', 'sales.settings.manage']

const RESET_PATH = '/api/v1/__mock/reset-sales'
const LIST_PATH = '/api/v1/sales/orders'
const SETTINGS_PATH = '/api/v1/sales/settings'
const SALESPEOPLE_PATH = '/api/v1/sales/salespeople'
const RECORD_PATH = /^\/api\/v1\/sales\/orders\/(\d+)(?:\/(confirm|cancel|reopen|lock|unlock|duplicate|assign))?$/
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ME = { id: 2, name: 'Admin', user_id: 2 }
const PEOPLE = [ME, { id: 7, name: 'مها الثبيتي', user_id: 7 }, { id: 8, name: 'نايف العسيري', user_id: 8 }]
const LINE_KEYS = ['id', 'kind', 'product_id', 'name', 'quantity', 'discount_percent']
const WRITE_KEYS = ['customer_id', 'salesperson_id', 'validity_date', 'terms', 'lines']
const round2 = value => Math.round(value * 100) / 100

const freshSettings = () => ({ visibility: 'own', validity_days: 30, discount_limit_percent: 20, default_terms: 'الأسعار شاملة التوصيل داخل المدينة.', revision: 1 })
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
let orders = freshOrders()
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

const own = (order, caps) => caps.includes('sales.documents.assign') || order.salesperson?.id === ME.id

function actionsOf(order, caps) {
  const staff = order.source === 'staff'
  const mine = staff && own(order, caps)
  const quote = caps.includes('sales.quotations.manage')
  const confirm = caps.includes('sales.orders.confirm')
  const draft = order.state === 'draft'
  const confirmed = order.state === 'confirmed'
  return {
    edit: mine && quote && draft,
    confirm: mine && confirm && draft && order.lines.some(item => item.kind === 'product'),
    cancel: mine && ((draft && quote) || (confirmed && !order.locked && confirm)),
    reopen: mine && confirm && order.state === 'cancelled',
    lock: mine && confirm && confirmed && !order.locked,
    unlock: mine && confirm && confirmed && order.locked,
    duplicate: quote,
    assign: staff && caps.includes('sales.documents.assign'),
  }
}

function dumpItem(order) {
  const lines = order.lines.map(dumpLine)
  const untaxed = round2(lines.reduce((sum, item) => sum + item.amount_untaxed, 0))
  const tax = round2(lines.reduce((sum, item) => sum + item.amount_tax, 0))
  return {
    id: order.id, number: order.number, state: order.state, locked: order.locked, source: order.source,
    customer: { id: order.customer_id, name: order.customer_name },
    salesperson: order.salesperson, validity_date: order.validity_date, date: order.date, terms: order.terms, currency: CURRENCY,
    amount_untaxed: untaxed, amount_tax: tax, amount_total: round2(untaxed + tax),
  }
}

const dump = (order, caps) => ({ ...dumpItem(order), lines: order.lines.map(dumpLine), actions: actionsOf(order, caps) })

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
  reopen: { allowed: actions => actions.reopen, apply: order => { order.state = 'draft' } },
  lock: { allowed: actions => actions.lock, apply: order => { order.locked = true } },
  unlock: { allowed: actions => actions.unlock, apply: order => { order.locked = false } },
}

function updateSettings(body, manage) {
  if (!manage) return refusal(403, 'forbidden', 'only the main company manages these settings')
  if (body.revision !== settings.revision) return refusal(409, 'conflict', 'Sales settings changed; reload before saving')
  const next = { ...settings }
  if ('visibility' in body) { if (!['own', 'all'].includes(body.visibility)) return invalid('visibility'); next.visibility = body.visibility }
  if ('validity_days' in body) { if (!Number.isInteger(body.validity_days) || body.validity_days < 0 || body.validity_days > 3650) return invalid('validity_days'); next.validity_days = body.validity_days }
  if ('discount_limit_percent' in body) { const value = body.discount_limit_percent; if (!Number.isInteger(value) || value < 0 || value > 100) return invalid('discount_limit_percent'); next.discount_limit_percent = value }
  if ('default_terms' in body) { if (typeof body.default_terms !== 'string') return invalid('default_terms'); next.default_terms = body.default_terms }
  settings = { ...next, revision: settings.revision + 1 }
  return { status: 200, body: { ...settings, can_manage: true } }
}

/** Answers a sales request and returns true; any other path is not this stub's. */
export async function handleSales(req, res, path, url, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    orders = freshOrders()
    settings = freshSettings()
    nextOrderId = 100
    nextLineId = 1000
    json(res, 200, {})
    return true
  }
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
      const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))
      const matches = PEOPLE.filter(person => !q || person.name.toLowerCase().includes(q))
      json(res, 200, { items: matches.slice(offset, offset + limit), total: matches.length })
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
  if (req.method !== (action ? 'POST' : 'PATCH')) return false
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
    if (!move.allowed(actionsOf(order, caps))) send(refusal(403, 'transition_forbidden', `${action} is not allowed now`))
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
