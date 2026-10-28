// Part of the isolated UI mock stack: the payments settings routes of webvue_payments. One in-memory gateway that follows the
// server's rules, so the settings page can be exercised end to end: keys are write-only, a gateway that is on is checked
// inside every change, and a change the check refuses saves nothing. A secret key containing "reject" is refused by the
// gateway; one containing "nomethods" leaves the gateway account without a payment method WebVue needs.
import { capabilitiesForRequest } from './mock-capabilities.mjs'

export const PAYMENTS_MANAGE = 'payments.providers.manage'

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

/** Answers a payments request and returns true; any other path is not this stub's and returns false. */
export async function handlePayments(req, res, path, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    provider = freshProvider()
    json(res, 200, {})
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
