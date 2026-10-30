// Part of the isolated UI mock stack: the payments routes of liwan_payments. One in-memory gateway that follows the
// server's rules, so the settings page can be exercised end to end: keys are write-only, a gateway that is on is checked
// inside every change, and a change the check refuses saves nothing. A secret key containing "reject" is refused by the
// gateway; one containing "nomethods" leaves the gateway account without a payment method LiwanOS needs.
// The orders settings (`/api/v1/payments/settings`, capability `payments.settings.manage`) are one in-memory record with
// a revision: a save carries the revision it was made from and a stale one answers 409 `conflict`.
// The payment link route and the public pay routes (no session) serve a fixed set of documents whose access token is
// `tok-<id>`. Invoices: 2 payable, 3 payable in part (its start is refused as `payment_unavailable`), 4 paid,
// 6 processing, 8 not payable, 9 payable but with no payment method (the tenant has no live gateway), 10 answers 429
// (the service is busy). Online orders (their own id space): 21 payable, 22 payable with a deposit, 23 paid,
// 24 processing, 25 not payable (cancelled or expired), 26 payable with no payment method. A draft invoice (1), any other
// id or a wrong token answers 404 `not_found`, like any invalid link. Only a live gateway takes a payment link: test
// mode answers 422 `no_gateway`.
import { capabilitiesForRequest } from './mock-capabilities.mjs'

export const PAYMENTS_MANAGE = 'payments.providers.manage'
export const PAYMENTS_SETTINGS_MANAGE = 'payments.settings.manage'
export const PAYMENTS_LINKS_MANAGE = 'payments.links.manage'

const CREDENTIAL_FIELDS = ['paymob_public_key', 'paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key']
const STATES = ['disabled', 'test', 'enabled']
const COUNTRIES = ['SA', 'AE', 'OM', 'EG']
const MAX_CREDENTIAL_LENGTH = 512
const METHODS = ['card', 'mada', 'apple_pay']
const LIST_PATH = '/api/v1/payments/providers'
const RESET_PATH = '/api/v1/__mock/reset-payments'

const freshProvider = () => ({ id: 7, code: 'paymob', name: 'Paymob', state: 'disabled', accountCountry: 'SA', keys: {}, methods: [] })
let provider = freshProvider()

const isConfigured = candidate => CREDENTIAL_FIELDS.every(field => candidate.keys[field])

function dump(candidate) {
  return {
    id: candidate.id,
    code: candidate.code,
    name: candidate.name,
    state: candidate.state,
    credentials: CREDENTIAL_FIELDS.map(field => ({ field, present: Boolean(candidate.keys[field]) })),
    configured: isConfigured(candidate),
    methods: candidate.methods,
    account_country: candidate.accountCountry,
    account_country_options: COUNTRIES,
  }
}

const refusal = (code, message, field) => ({ status: 422, body: { code, message, ...(field ? { field } : {}) } })

/** The gateway check of a candidate: its outcome, or a refusal body when the gateway cannot be reached or rejects the keys. */
function gatewayCheck(candidate) {
  const secret = candidate.keys.paymob_secret_key ?? ''
  if (secret.includes('reject')) return { failure: refusal('provider_sync_failed', 'the gateway refused the keys') }
  return { status: secret.includes('nomethods') ? 'methods_missing' : 'synced' }
}

function notConfigured(candidate) {
  const missing = CREDENTIAL_FIELDS.find(field => !candidate.keys[field])
  return refusal('provider_not_configured', 'enter every credential first', `credentials.${missing}`)
}

function parseCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || !Object.keys(credentials).length) {
    return { failure: refusal('invalid', 'credentials must be a non-empty object', 'credentials') }
  }
  for (const [field, value] of Object.entries(credentials)) {
    if (!CREDENTIAL_FIELDS.includes(field)) return { failure: refusal('unknown_field', `credential ${field} is not accepted`, `credentials.${field}`) }
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_CREDENTIAL_LENGTH) {
      return { failure: refusal('invalid', 'a credential is a non-empty text', `credentials.${field}`) }
    }
  }
  return { keys: Object.fromEntries(Object.entries(credentials).map(([field, value]) => [field, value.trim()])) }
}

/** Applies a PATCH to a copy and commits it only when the whole change, gateway check included, goes through. */
function update(body) {
  const unknown = Object.keys(body).find(field => !['state', 'credentials', 'account_country'].includes(field))
  if (unknown) return refusal('unknown_field', `field ${unknown} is not writable`, unknown)
  if (!Object.keys(body).length) return refusal('invalid', 'no fields to update')
  const candidate = { ...provider, keys: { ...provider.keys } }
  if ('credentials' in body) {
    const parsed = parseCredentials(body.credentials)
    if (parsed.failure) return parsed.failure
    Object.assign(candidate.keys, parsed.keys)
  }
  if ('account_country' in body) {
    if (!COUNTRIES.includes(body.account_country)) return refusal('invalid', 'account_country is not offered', 'account_country')
    candidate.accountCountry = body.account_country
  }
  if ('state' in body) {
    if (!STATES.includes(body.state)) return refusal('invalid', 'state is not offered', 'state')
    candidate.state = body.state
  }
  if (candidate.state !== 'disabled') {
    if (!isConfigured(candidate)) return notConfigured(candidate)
    const check = gatewayCheck(candidate)
    if (check.failure) return check.failure
    if (check.status === 'methods_missing') return refusal('methods_missing', 'the gateway account lacks a payment method')
    candidate.methods = METHODS
  }
  provider = candidate
  return { status: 200, body: dump(provider) }
}

function sync() {
  if (provider.state === 'disabled') return refusal('provider_disabled', 'turn the gateway on first')
  if (!isConfigured(provider)) return notConfigured(provider)
  const check = gatewayCheck(provider)
  if (check.failure) return check.failure
  provider = { ...provider, methods: check.status === 'synced' ? METHODS : METHODS.slice(0, 1) }
  return { status: 200, body: { provider: dump(provider), status: check.status } }
}

const LINKS_PATH = '/api/v1/payments/links'
const SETTINGS_PATH = '/api/v1/payments/settings'
const PUBLIC_DOCUMENT_PATH = /^\/api\/v1\/public\/payments\/(invoices|orders)\/(\d+)(\/transactions)?$/
const PUBLIC_RETURN_PATH = /^\/api\/v1\/public\/payments\/hooks\/[a-z][a-z0-9_]*\/return$/
const PAYER_OPTIONS = [
  { provider_id: 7, provider: 'paymob', method_id: 11, method: 'card', method_name: 'بطاقة بنكية' },
  { provider_id: 7, provider: 'paymob', method_id: 12, method: 'mada', method_name: 'مدى' },
]
const GATEWAY_URL = 'https://gateway.example/checkout'
const BUSY_INVOICE = 10

const accessToken = id => `tok-${id}`
const payerInvoice = (id, status, extra = {}) => ({
  id,
  merchant: 'ليوان',
  number: `INV/2026/${String(id).padStart(4, '0')}`,
  due_date: '2026-10-31',
  currency: 'SAR',
  amount_total: 16905,
  amount_due: 16905,
  status,
  options: status === 'payable' ? PAYER_OPTIONS : [],
  ...extra,
})
const PAYER_INVOICES = new Map([
  [2, payerInvoice(2, 'payable')],
  [3, payerInvoice(3, 'payable', { amount_due: 3000, amount_total: 8000 })],
  [4, payerInvoice(4, 'paid', { amount_due: 0 })],
  [6, payerInvoice(6, 'processing')],
  [8, payerInvoice(8, 'not_payable', { due_date: null })],
  [9, payerInvoice(9, 'payable', { options: [] })],
])

const payerOrder = (id, status, extra = {}) => ({
  id,
  merchant: 'ليوان',
  number: `S${String(id).padStart(5, '0')}`,
  expires_at: '2026-10-31T12:30:00Z',
  currency: 'SAR',
  amount_total: 16905,
  amount_due: 16905,
  status,
  options: status === 'payable' ? PAYER_OPTIONS : [],
  ...extra,
})
const PAYER_ORDERS = new Map([
  [21, payerOrder(21, 'payable')],
  [22, payerOrder(22, 'payable', { amount_due: 5000 })],
  [23, payerOrder(23, 'paid', { amount_due: 0 })],
  [24, payerOrder(24, 'processing')],
  [25, payerOrder(25, 'not_payable')],
  [26, payerOrder(26, 'payable', { options: [] })],
])
const PAYER_DOCUMENTS = { invoices: PAYER_INVOICES, orders: PAYER_ORDERS }

const notFound = () => ({ status: 404, body: { code: 'not_found', message: 'not found' } })

/** The document the token opens, or a 404 for a wrong id or token (the server never tells them apart). */
function payerDocumentFor(collection, id, token) {
  if (collection === 'invoices' && id === BUSY_INVOICE) return { failure: { status: 429, body: { code: 'rate_limited', message: 'too many requests' } } }
  const document = PAYER_DOCUMENTS[collection].get(id)
  return document && token === accessToken(id) ? { document } : { failure: notFound() }
}

/** The gateway page a started payment sends the browser to: `card` navigates (get), `mada` submits a form (post). */
function startPayment(document, body) {
  if (document.status !== 'payable') return { status: 409, body: { code: 'not_payable', message: 'the document is not payable' } }
  const option = document.options.find(candidate => candidate.provider_id === body.provider_id && candidate.method_id === body.payment_method_id)
  if (!option || document.id === 3) return refusal('payment_unavailable', 'the gateway cannot start this payment')
  const fields = { payment_token: `pt_${document.id}_${option.method}`, reference: document.number }
  return { status: 200, body: { redirect: { method: option.method === 'card' ? 'get' : 'post', url: GATEWAY_URL, fields } } }
}

/** A staff member's request for the pay-by-link address of an invoice. */
function createLink(body) {
  if (!Number.isInteger(body.invoice_id) || body.invoice_id < 1) return refusal('invalid', 'invoice_id must be a positive integer', 'invoice_id')
  const invoice = PAYER_INVOICES.get(body.invoice_id)
  if (!invoice) return notFound()
  if (invoice.status !== 'payable') return { status: 409, body: { code: 'not_payable', message: 'the invoice is not payable' } }
  if (provider.state !== 'enabled') return refusal('no_gateway', 'switch a payment gateway to live first')
  return { status: 200, body: { path: `/pay/invoice/${invoice.id}?access_token=${accessToken(invoice.id)}` } }
}

/** Answers the public payer routes (no session) and returns true; any other path returns false. */
export async function handlePublicPayments(req, res, path, url, { json, readBody }) {
  if (PUBLIC_RETURN_PATH.test(path)) {
    json(res, 200, {})
    return true
  }
  const route = PUBLIC_DOCUMENT_PATH.exec(path)
  if (!route) return false
  const [, collection, rawId, transactions] = route
  const id = Number(rawId)
  if (!transactions && req.method === 'GET') {
    const found = payerDocumentFor(collection, id, url.searchParams.get('access_token'))
    const answer = found.failure ?? { status: 200, body: found.document }
    json(res, answer.status, answer.body)
    return true
  }
  if (transactions && req.method === 'POST') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const found = payerDocumentFor(collection, id, body.access_token)
    const answer = found.failure ?? startPayment(found.document, body)
    json(res, answer.status, answer.body)
    return true
  }
  return false
}

const EXPIRY_MINUTES = { min: 5, max: 1440 }
const SETTINGS_FIELDS = ['revision', 'unpaid_order_expiry_minutes', 'invoice_when_paid', 'refund_policy', 'refund_amounts']
const SETTINGS_CHOICES = { refund_policy: ['full', 'none'], refund_amounts: ['due', 'any'] }
const freshSettings = () => ({ unpaid_order_expiry_minutes: 60, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', revision: 0 })
let settings = freshSettings()

/** A PATCH of the orders settings: validated first, then refused as stale when its revision is not the saved one. */
function updateSettings(body) {
  const unknown = Object.keys(body).find(field => !SETTINGS_FIELDS.includes(field))
  if (unknown) return refusal('unknown_field', `field ${unknown} is not writable`, unknown)
  if (!Number.isInteger(body.revision) || body.revision < 0) return refusal('invalid', 'revision is required', 'revision')
  const minutes = body.unpaid_order_expiry_minutes
  if ('unpaid_order_expiry_minutes' in body && !(Number.isInteger(minutes) && minutes >= EXPIRY_MINUTES.min && minutes <= EXPIRY_MINUTES.max)) {
    return refusal('invalid', `unpaid_order_expiry_minutes must be whole minutes from ${EXPIRY_MINUTES.min} to ${EXPIRY_MINUTES.max}`, 'unpaid_order_expiry_minutes')
  }
  if ('invoice_when_paid' in body && typeof body.invoice_when_paid !== 'boolean') return refusal('invalid', 'invoice_when_paid must be true or false', 'invoice_when_paid')
  const badChoice = Object.keys(SETTINGS_CHOICES).find(field => field in body && !SETTINGS_CHOICES[field].includes(body[field]))
  if (badChoice) return refusal('invalid', `${badChoice} must be one of ${SETTINGS_CHOICES[badChoice].join(', ')}`, badChoice)
  if (body.revision !== settings.revision) return { status: 409, body: { code: 'conflict', message: 'the settings changed; reload and try again' } }
  const changes = { ...body }
  delete changes.revision
  settings = { ...settings, ...changes, revision: settings.revision + 1 }
  return { status: 200, body: settings }
}

async function handleSettings(req, res, { json, readBody }) {
  if (!capabilitiesForRequest(req.headers.cookie, [PAYMENTS_SETTINGS_MANAGE]).includes(PAYMENTS_SETTINGS_MANAGE)) {
    json(res, 403, { code: 'forbidden', message: 'forbidden' })
    return true
  }
  if (req.method === 'GET') {
    json(res, 200, settings)
    return true
  }
  if (req.method === 'PATCH') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const result = updateSettings(body)
    json(res, result.status, result.body)
    return true
  }
  return false
}

/** Answers a payments request and returns true; any other path is not this stub's and returns false. */
export async function handlePayments(req, res, path, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    provider = freshProvider()
    settings = freshSettings()
    json(res, 200, {})
    return true
  }
  if (path === SETTINGS_PATH) return handleSettings(req, res, { json, readBody })
  if (path === LINKS_PATH && req.method === 'POST') {
    if (!capabilitiesForRequest(req.headers.cookie, [PAYMENTS_LINKS_MANAGE]).includes(PAYMENTS_LINKS_MANAGE)) {
      json(res, 403, { code: 'forbidden', message: 'forbidden' })
      return true
    }
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const result = createLink(body)
    json(res, result.status, result.body)
    return true
  }
  const route = path === LIST_PATH ? 'list' : path === `${LIST_PATH}/${provider.id}` ? 'record' : path === `${LIST_PATH}/${provider.id}/sync` ? 'sync' : null
  if (!route) return false
  if (!capabilitiesForRequest(req.headers.cookie, [PAYMENTS_MANAGE]).includes(PAYMENTS_MANAGE)) {
    json(res, 403, { code: 'forbidden', message: 'forbidden' })
    return true
  }
  if (route === 'list' && req.method === 'GET') {
    json(res, 200, { items: [dump(provider)], total: 1 })
    return true
  }
  if (route === 'record' && req.method === 'PATCH') {
    let body = {}
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
    const result = update(body)
    json(res, result.status, result.body)
    return true
  }
  if (route === 'sync' && req.method === 'POST') {
    const result = sync()
    json(res, result.status, result.body)
    return true
  }
  return false
}
