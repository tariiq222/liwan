// Part of the isolated UI mock stack: the routes of liwan_customers. One in-memory directory that follows the server's
// rules, so the directory, the create panel and the settings page can be exercised end to end:
//  - phones are E.164 (a national number starting with 0 is read in the settings' phone country, Saudi Arabia); a
//    phone that is not valid answers 422 `invalid_phone`;
//  - a create whose phone another customer holds answers 409 `conflict` with the candidates (name and last four digits)
//    until it is repeated with `create_new`;
//  - the party kinds setting decides which `is_company` a create may carry (422 `invalid` with `party_kind_not_allowed`);
//  - the settings carry a revision: a stale one answers 409 `conflict`; changing the sharing mode while customers exist
//    answers 409 `sharing_transfer_required`; removing a field, or an option of a selection or tags field, that
//    customers hold answers 409 `custom_field_values_exist` with the counts (`fields` and `options`) until the write
//    carries `confirm_field_removal`, which then clears the values;
//  - `is_company=true|false` on the list is a strict filter; `parent_id` must name a company customer (422 on `parent_id`);
//  - the settings countries (`/api/v1/customers/settings/countries`, `customers.settings.manage`) are a fixed list, and
//    `phone_country_id: null` means the main company's country (Saudi Arabia here);
//  - the cookie `mock_customers=branch` is a session of a branch manager: the settings answer `can_manage: false`;
//  - the privacy routes (`customers.erase`, `customers.privacy.export`): the preview mints a one-time token, the erase
//    needs it and the customer's exact name and renames the customer like the server, and the export is a small .xlsx
//    named by the server. The cookie `mock_customers_privacy` shapes the preview: `session` (the session does not cover
//    every branch), `records` (records the caller cannot reach) or `nohook` (an application without a hook).
import { capabilitiesForRequest } from './mock-capabilities.mjs'

export const CUSTOMERS_CAPABILITIES = ['customers.read', 'customers.manage', 'customers.export', 'customers.settings.manage', 'customers.erase', 'customers.privacy.export']

const RESET_PATH = '/api/v1/__mock/reset-customers'
const SETTINGS_PATH = '/api/v1/customers/settings'
const COUNTRIES_PATH = '/api/v1/customers/settings/countries'
const COUNTRIES = [
  { id: 63, code: 'AE', name: 'الإمارات العربية المتحدة' },
  { id: 191, code: 'SA', name: 'المملكة العربية السعودية' },
  { id: 65, code: 'EG', name: 'مصر' },
]
const MAIN_COMPANY_COUNTRY = COUNTRIES[1]
const LIST_PATH = '/api/v1/customers'
const EXPORT_PATH = '/api/v1/customers/export'
const E164 = /^\+[1-9]\d{6,14}$/
const COMPANY = { id: 1, name: 'ليوان' }
const PRIVACY_PATH = /^\/api\/v1\/customers\/(\d+)\/privacy\/(erase-preview|erase|export)$/
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TOKEN_TTL_SECONDS = 600
const NOT_COVERED = ['chatter_history', 'free_text_notes', 'stored_documents', 'backups', 'accounting_name_copies', 'inbox_provider_events']
const PRIVACY_ITEMS = [
  { key: 'customer', owner: 'liwan_customers', action: 'erase', count: 1 },
  { key: 'bank_accounts', owner: 'liwan_customers', action: 'erase', count: 1 },
  { key: 'crm_leads', owner: 'liwan_crm', action: 'erase', count: 3 },
  { key: 'inbox_messages', owner: 'liwan_inbox', action: 'erase', count: 12 },
  { key: 'finance_documents', owner: 'liwan_finance', action: 'retain', count: 4 },
  { key: 'inbox_consent', owner: 'liwan_inbox', action: 'retain', count: 1 },
]
const LIMITS = { max_properties: 20, max_options: 50, max_label: 100 }

const freshSettings = () => ({
  sharing: 'branch',
  party_kinds: 'both',
  phone_country: { id: 191, code: 'SA', name: 'المملكة العربية السعودية' },
  fields: [
    { key: 'city', label: 'المدينة', type: 'char' },
    { key: 'vip', label: 'عميل مميز', type: 'boolean' },
    { key: 'tier', label: 'الفئة', type: 'selection', options: [{ key: 'gold', label: 'ذهبية' }, { key: 'silver', label: 'فضية' }] },
  ],
  field_limits: LIMITS,
  revision: 1,
})
const freshCustomers = () => [
  { id: 1, name: 'منى العتيبي', phone: '+966500000001', email: 'mona@example.com', is_company: false, parent: null, active: true, company: COMPANY, values: { city: 'الرياض', vip: true, tier: 'gold' } },
  { id: 2, name: 'مؤسسة النخيل', phone: '+966500000002', email: null, is_company: true, parent: null, active: true, company: null, values: { city: 'جدة' } },
  { id: 3, name: 'خالد الشهري', phone: '+966500000001', email: null, is_company: false, parent: null, active: true, company: COMPANY, values: {} },
  { id: 4, name: 'سارة الحربي', phone: null, email: 'sara@example.com', is_company: false, parent: { id: 2, name: 'مؤسسة النخيل' }, active: false, company: COMPANY, values: {} },
]
let settings = freshSettings()
let customers = freshCustomers()
let nextId = 10
let privacyTokens = new Map()

const refusal = (status, code, message, extra = {}) => ({ status, body: { code, message, ...extra } })

/** The E.164 form of what the user typed, or null when it is not a valid number. */
function normalisePhone(raw) {
  const compact = String(raw).replace(/[\s-]/g, '')
  const international = compact.startsWith('00') ? `+${compact.slice(2)}` : compact.startsWith('0') ? `+966${compact.slice(1)}` : compact
  return E164.test(international) ? international : null
}

function emptyValue(type) {
  return type === 'tags' ? [] : type === 'boolean' ? false : null
}

function dump(customer) {
  const { values, ...rest } = customer
  return { ...rest, properties: settings.fields.map(field => ({ ...field, value: field.key in values ? values[field.key] : emptyValue(field.type) })) }
}

function matches(customer, url) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const archived = url.searchParams.get('archived') === 'true'
  if (customer.active === archived) return false
  const company = url.searchParams.get('is_company')
  if (company !== null && customer.is_company !== (company === 'true')) return false
  return !q || [customer.name, customer.phone, customer.email].some(value => value && value.toLowerCase().includes(q))
}

/** The parent a `parent_id` names: null clears it; anything but a company customer is refused on the field. */
function resolveParent(parentId) {
  if (parentId === undefined || parentId === null) return { ref: null }
  const company = customers.find(candidate => candidate.id === parentId && candidate.is_company)
  if (!company) return { failure: refusal(422, 'invalid', 'the parent must be a company customer', { field: 'parent_id' }) }
  return { ref: { id: company.id, name: company.name } }
}

function create(body) {
  const unknown = Object.keys(body).find(key => !['name', 'phone', 'email', 'is_company', 'parent_id', 'properties', 'create_new'].includes(key))
  if (unknown) return refusal(422, 'unknown_field', `field ${unknown} is not writable`, { field: unknown })
  if (typeof body.name !== 'string' || !body.name.trim()) return refusal(422, 'invalid', 'a name is required', { field: 'name' })
  const isCompany = body.is_company === true
  if ((settings.party_kinds === 'individuals' && isCompany) || (settings.party_kinds === 'companies' && !isCompany && !body.parent_id)) {
    return refusal(422, 'invalid', 'this party kind is not allowed', { field: 'is_company', details: { reason: 'party_kind_not_allowed' } })
  }
  const phone = body.phone ? normalisePhone(body.phone) : null
  if (body.phone && !phone) return refusal(422, 'invalid_phone', 'the phone number is not valid', { field: 'phone' })
  const sharing = phone ? customers.filter(customer => customer.phone === phone) : []
  if (sharing.length && !body.create_new) {
    return refusal(409, 'conflict', 'customers share this phone', { details: { candidates: sharing.map(customer => ({ id: customer.id, name: customer.name, phone_last4: customer.phone.slice(-4) })) } })
  }
  const parent = resolveParent(body.parent_id)
  if (parent.failure) return parent.failure
  const customer = {
    id: nextId++, name: body.name.trim(), phone, email: body.email ?? null, is_company: isCompany, parent: parent.ref, active: true,
    company: settings.sharing === 'establishment' ? null : COMPANY, values: body.properties ?? {},
  }
  customers = [...customers, customer]
  return { status: 201, body: dump(customer) }
}

function patch(customer, body) {
  if ('phone' in body && body.phone) {
    const phone = normalisePhone(body.phone)
    if (!phone) return refusal(422, 'invalid_phone', 'the phone number is not valid', { field: 'phone' })
    body = { ...body, phone }
  }
  const { properties, parent_id: parentId, ...identity } = body
  if (parentId !== undefined) {
    const parent = resolveParent(parentId)
    if (parent.failure) return parent.failure
    customer.parent = parent.ref
  }
  Object.assign(customer, identity, { values: { ...customer.values, ...(properties ?? {}) } })
  return { status: 200, body: dump(customer) }
}

function csv(list) {
  const rows = list.map(customer => [customer.name, customer.phone ?? '', customer.email ?? ''].join(','))
  return `﻿name,phone,email\n${rows.join('\n')}\n`
}

function valuesHeld(key) {
  return customers.filter(customer => customer.values[key] !== undefined && customer.values[key] !== null && customer.values[key] !== false).length
}

const holdsOption = (value, key) => Array.isArray(value) ? value.includes(key) : value === key

/** The options a new definition drops from a field that stays, with the customers that still hold each one. */
function removedOptionsHeld(definition) {
  return definition.flatMap((field) => {
    const before = settings.fields.find(candidate => candidate.key === field.key)
    const kept = new Set((field.options ?? []).map(option => option.key).filter(Boolean))
    return (before?.options ?? [])
      .filter(option => !kept.has(option.key))
      .map(option => ({ field_key: before.key, field_label: before.label, key: option.key, label: option.label, count: customers.filter(customer => holdsOption(customer.values[before.key], option.key)).length }))
      .filter(entry => entry.count > 0)
  })
}

function clearOption(customer, entry) {
  const value = customer.values[entry.field_key]
  if (Array.isArray(value)) customer.values[entry.field_key] = value.filter(key => key !== entry.key)
  else if (value === entry.key) delete customer.values[entry.field_key]
}

const isErased = customer => customer.name === `Erased customer ${customer.id}`

/** The blockers the cookie asks for; none by default. */
function privacyBlockers(cookie) {
  const mode = /(?:^|;\s*)mock_customers_privacy=(session|records|nohook)(?:;|$)/.exec(cookie ?? '')?.[1]
  if (mode === 'session') return { reach: { shared: true, covers_all: false }, incomplete: [{ key: 'crm_leads', owner: 'liwan_crm', reason: 'session_does_not_cover_every_company' }, { key: 'inbox_messages', owner: 'liwan_inbox', reason: 'session_does_not_cover_every_company' }], extra: [] }
  if (mode === 'records') return { reach: { shared: false, covers_all: true }, incomplete: [{ key: 'crm_leads', owner: 'liwan_crm', reason: 'caller_cannot_reach_all_records' }], extra: [] }
  if (mode === 'nohook') return { reach: { shared: false, covers_all: true }, incomplete: [{ key: 'sale.order', owner: 'sale', reason: 'application_has_no_hook' }], extra: [{ key: 'sale.order', owner: 'sale', action: 'unhandled', count: 2, complete: false }] }
  return { reach: { shared: false, covers_all: true }, incomplete: [], extra: [] }
}

function privacyPreview(customer, cookie) {
  const blocked = privacyBlockers(cookie)
  const flagged = new Set(blocked.incomplete.map(entry => entry.key))
  const token = `mock-token-${customer.id}-${privacyTokens.size + 1}`
  privacyTokens.set(token, customer.id)
  return {
    status: 200,
    body: {
      customer: { id: customer.id, erased: isErased(customer) },
      items: [...PRIVACY_ITEMS.map(item => ({ ...item, complete: !flagged.has(item.key) })), ...blocked.extra],
      incomplete: blocked.incomplete,
      empty_models: [],
      not_covered: NOT_COVERED,
      reach: blocked.reach,
      token,
      expires_in: TOKEN_TTL_SECONDS,
    },
  }
}

function privacyErase(customer, body, cookie) {
  if (isErased(customer)) return { status: 200, body: { customer_id: customer.id, erased: false, request_id: null, items: [] } }
  const blocked = privacyBlockers(cookie)
  if (blocked.incomplete.length) return refusal(409, 'erase_incomplete', 'the caller cannot reach every record to erase', { details: { incomplete: blocked.incomplete } })
  if (privacyTokens.get(body.token) !== customer.id) return refusal(422, 'invalid_token', 'the token is not valid: preview the erase again')
  if (body.confirmation !== customer.name) return refusal(422, 'invalid', 'the confirmation must be the customer name', { field: 'confirmation' })
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) return refusal(422, 'invalid', 'reason is required', { field: 'reason' })
  privacyTokens.delete(body.token)
  Object.assign(customer, { name: `Erased customer ${customer.id}`, phone: null, email: null, values: {} })
  return { status: 200, body: { customer_id: customer.id, erased: true, request_id: customer.id, items: PRIVACY_ITEMS.filter(item => item.action === 'erase').map(({ key, count }) => ({ key, count })) } }
}

function updateSettings(body, manage) {
  if (!manage) return refusal(403, 'forbidden', 'only the main company manages these settings')
  if (body.revision !== settings.revision) return refusal(409, 'conflict', 'Customer settings changed; reload before saving')
  if (body.sharing && body.sharing !== settings.sharing && customers.length) {
    return refusal(409, 'sharing_transfer_required', 'customers exist', { field: 'sharing' })
  }
  const next = { ...settings }
  if (body.sharing) next.sharing = body.sharing
  if (body.party_kinds) next.party_kinds = body.party_kinds
  if ('phone_country_id' in body) next.phone_country = body.phone_country_id === null ? MAIN_COMPANY_COUNTRY : COUNTRIES.find(country => country.id === body.phone_country_id) ?? next.phone_country
  if (body.fields) {
    const keptKeys = new Set(body.fields.map(field => field.key).filter(Boolean))
    const removed = settings.fields.filter(field => !keptKeys.has(field.key))
    const held = removed.map(field => ({ key: field.key, label: field.label, count: valuesHeld(field.key) })).filter(entry => entry.count > 0)
    const heldOptions = removedOptionsHeld(body.fields)
    if ((held.length || heldOptions.length) && body.confirm_field_removal !== true) {
      return refusal(409, 'custom_field_values_exist', 'customers hold values for the removed fields or options', { details: { fields: held, options: heldOptions } })
    }
    for (const entry of heldOptions) for (const customer of customers) clearOption(customer, entry)
    next.fields = body.fields.map((field, index) => ({
      ...field,
      key: field.key ?? `field_${settings.revision}_${index}`,
      ...(field.options ? { options: field.options.map((option, at) => ({ ...option, key: option.key ?? `option_${at}` })) } : {}),
    }))
    for (const field of removed) for (const customer of customers) delete customer.values[field.key]
  }
  settings = { ...next, revision: settings.revision + 1 }
  return { status: 200, body: { ...settings, can_manage: manage } }
}

/** Answers a customers request and returns true; any other path is not this stub's and returns false. */
export async function handleCustomers(req, res, path, url, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    settings = freshSettings()
    customers = freshCustomers()
    nextId = 10
    privacyTokens = new Map()
    json(res, 200, {})
    return true
  }
  const record = path.match(/^\/api\/v1\/customers\/(\d+)(?:\/(archive|restore))?$/)
  const privacy = path.match(PRIVACY_PATH)
  const known = privacy || path === LIST_PATH || path === COUNTRIES_PATH || path === EXPORT_PATH || path === SETTINGS_PATH || record
  if (!known) return false
  const caps = capabilitiesForRequest(req.headers.cookie, CUSTOMERS_CAPABILITIES)
  const branchManager = /(?:^|;\s*)mock_customers=branch(?:;|$)/.test(req.headers.cookie ?? '')
  const need = capability => {
    if (caps.includes(capability)) return true
    json(res, 403, { code: 'forbidden', message: 'forbidden' })
    return false
  }
  let body = {}
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
  }
  const send = result => json(res, result.status, result.body)

  if (privacy) {
    const [, privacyId, route] = privacy
    const subject = customers.find(candidate => candidate.id === Number(privacyId))
    if (req.method !== 'POST') return false
    if (!need(route === 'export' ? 'customers.privacy.export' : 'customers.erase')) return true
    if (!subject) send(refusal(404, 'not_found', 'not found'))
    else if (route === 'erase-preview') send(privacyPreview(subject, req.headers.cookie))
    else if (route === 'erase') send(privacyErase(subject, body, req.headers.cookie))
    else if (typeof body.reason !== 'string' || !body.reason.trim()) send(refusal(422, 'invalid', 'reason is required', { field: 'reason' }))
    else {
      res.writeHead(200, { 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="customer-${subject.id}-personal-data.xlsx"`, 'cache-control': 'private, no-store' })
      res.end(Buffer.from('PK mock workbook'))
    }
    return true
  }

  if (path === SETTINGS_PATH) {
    if (req.method === 'GET') {
      if (!caps.includes('customers.read') && !caps.includes('customers.settings.manage')) {
        json(res, 403, { code: 'forbidden', message: 'forbidden' })
        return true
      }
      json(res, 200, { ...settings, can_manage: caps.includes('customers.settings.manage') && !branchManager })
      return true
    }
    if (req.method === 'PATCH' && need('customers.settings.manage')) send(updateSettings(body, !branchManager))
    return true
  }
  if (path === COUNTRIES_PATH && req.method === 'GET') {
    if (need('customers.settings.manage')) json(res, 200, { items: COUNTRIES, total: COUNTRIES.length })
    return true
  }
  if (path === EXPORT_PATH && req.method === 'GET') {
    if (!need('customers.export')) return true
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="customers-2026-11-13.csv"', 'cache-control': 'no-store' })
    res.end(csv(customers.filter(customer => matches(customer, url))))
    return true
  }
  if (path === LIST_PATH && req.method === 'GET') {
    if (!need('customers.read')) return true
    const found = customers.filter(customer => matches(customer, url))
    const limit = Number(url.searchParams.get('limit') ?? 25)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    json(res, 200, { items: found.slice(offset, offset + limit).map(dump), total: found.length })
    return true
  }
  if (path === LIST_PATH && req.method === 'POST') {
    if (need('customers.manage')) send(create(body))
    return true
  }
  if (!record) return false
  const customer = customers.find(candidate => candidate.id === Number(record[1]))
  if (record[2] === 'archive' || record[2] === 'restore') {
    if (req.method !== 'POST' || !need('customers.manage')) return req.method === 'POST'
    if (!customer) send(refusal(404, 'not_found', 'not found'))
    else { customer.active = record[2] === 'restore'; send({ status: 200, body: dump(customer) }) }
    return true
  }
  if (req.method === 'GET' && need('customers.read')) {
    send(customer ? { status: 200, body: dump(customer) } : refusal(404, 'not_found', 'not found'))
    return true
  }
  if (req.method === 'PATCH' && need('customers.manage')) {
    send(customer ? patch(customer, body) : refusal(404, 'not_found', 'not found'))
    return true
  }
  return false
}
