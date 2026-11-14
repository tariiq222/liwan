// Part of the isolated UI mock stack: the routes of liwan_products and liwan_products_account, shaped like
// packages/contracts/src/products. One in-memory list of products that follows the server's rules, so the products list,
// the create panel, the edit page and the settings page can be exercised end to end, and the applications' pickers (CRM
// packages, the Meta catalog) pick from the same list:
//  - a product carries the sale taxes of the establishment, added on top of its unit price; the price breakdown follows
//    them. The cookie `mock_products=untaxed` is an establishment that is not registered for VAT: no `taxes` key, no tax
//    in the price, the tax choices are empty and a write of `taxes` is 422;
//  - the definition is `products.manage`, `list_price` is `products.prices.manage` (403 `forbidden` otherwise), and a
//    shared product (no company) is written in the root session while a branch's product is not (403 `forbidden` with
//    `details.reason` `managed_in_branch`). The mock session is the root company (id 1);
//  - the cookie `mock_products=refuse` makes every write answer 403 `managed_in_root_company`, as a session the web did
//    not expect would;
//  - the settings carry a revision: a stale one answers 409 `conflict`; changing the sharing mode while products exist
//    answers 409 `sharing_transfer_required`; the cookie `mock_products=branch` is a branch manager (`can_manage: false`).
import { capabilitiesForRequest } from './mock-capabilities.mjs'

export const PRODUCTS_CAPABILITIES = ['products.read', 'products.manage', 'products.prices.manage', 'products.settings.manage']
export const PRODUCT_PICK_PATH = '/api/v1/products/pick'

const RESET_PATH = '/api/v1/__mock/reset-products'
const LIST_PATH = '/api/v1/products'
const SETTINGS_PATH = '/api/v1/products/settings'
const TAXES_PATH = '/api/v1/products/taxes'
const RECORD_PATH = /^\/api\/v1\/products\/(\d+)(?:\/(archive|restore))?$/
const MAX_PRICE = 1_000_000_000
const MAX_IMAGE_DATA = 4 * Math.ceil((5 * 1024 * 1024) / 3)
const ROOT_COMPANY = { id: 1, name: 'ليوان' }
const BRANCH = { id: 2, name: 'فرع جدة' }
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const VAT = { id: 11, name: 'ضريبة القيمة المضافة', amount: 15 }
const ZERO = { id: 12, name: 'نسبة صفر', amount: 0 }
const CHOICES = [{ ...VAT, active: true }, { ...ZERO, active: true }, { id: 13, name: 'معفى', amount: 0, active: false }]
const round2 = value => Math.round(value * 100) / 100

// id -> the product template: its name, type and the unit price as typed on it.
const freshProducts = () => [
  { id: 1, name: 'باقة أساسية', type: 'service', unit_price: 120, description: 'اشتراك شهري للفرق الصغيرة', has_image: true, company: null, active: true, taxes: [VAT] },
  { id: 2, name: 'باقة متقدمة', type: 'service', unit_price: 280, description: null, has_image: true, company: null, active: true, taxes: [VAT] },
  { id: 3, name: 'باقة الأعمال', type: 'service', unit_price: 450, description: null, has_image: true, company: null, active: true, taxes: [VAT] },
  { id: 201, name: 'شاي أخضر', type: 'goods', unit_price: 22, description: null, has_image: true, company: null, active: true, taxes: [VAT] },
  { id: 202, name: 'عسل سدر', type: 'goods', unit_price: 160, description: 'عسل طبيعي، عبوة كيلو', has_image: true, company: null, active: true, taxes: [VAT, ZERO] },
  { id: 203, name: 'ميزان مطبخ', type: 'goods', unit_price: 75, description: null, has_image: true, company: BRANCH, active: true, taxes: [VAT] },
  { id: 204, name: 'منتج بلا صورة', type: 'goods', unit_price: 10, description: null, has_image: false, company: null, active: true, taxes: [VAT] },
  { id: 205, name: 'باقة قديمة', type: 'service', unit_price: 90, description: null, has_image: false, company: null, active: false, taxes: [VAT] },
]
let products = freshProducts()
let settings = { sharing: 'establishment', revision: 1 }
let nextId = 300

const refusal = (status, code, message, extra = {}) => ({ status, body: { code, message, ...extra } })
const untaxed = cookie => /(?:^|;\s*)mock_products=untaxed(?:;|$)/.test(cookie ?? '')

export const findMockProduct = id => products.find(product => product.id === id && product.active)

function priceOf(product, registered) {
  const rate = registered ? product.taxes.reduce((sum, tax) => sum + tax.amount, 0) : 0
  const tax = round2(product.unit_price * rate / 100)
  return { unit_price: product.unit_price, amount_untaxed: product.unit_price, amount_tax: tax, amount_total: round2(product.unit_price + tax), currency: CURRENCY }
}

function dump(product, registered) {
  return {
    id: product.id, name: product.name, type: product.type, description: product.description, has_image: product.has_image,
    list_price: product.unit_price, price: priceOf(product, registered), company: product.company, active: product.active,
    ...(registered ? { taxes: product.taxes } : {}),
  }
}

const pickOf = product => {
  const { unit_price, amount_untaxed, amount_tax, amount_total, currency } = priceOf(product, true)
  return { id: product.id, name: product.name, type: product.type, unit_price, amount_untaxed, amount_tax, amount_total, currency }
}

/** One page of the pick list: `q` filters by name, `limit` and `offset` page it. */
export function productPickPage(url) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
  const matches = products.filter(product => product.active && (!q || product.name.toLowerCase().includes(q)))
  return { items: matches.slice(offset, offset + limit).map(pickOf), total: matches.length }
}

function listPage(url, registered) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const type = url.searchParams.get('type')
  const archived = url.searchParams.get('archived') === 'true'
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
  if (type !== null && type !== 'goods' && type !== 'service') return refusal(422, 'invalid', 'type must be goods or service', { field: 'type' })
  const matches = products.filter(product => product.active !== archived && (!q || product.name.toLowerCase().includes(q)) && (!type || product.type === type))
  return { status: 200, body: { items: matches.slice(offset, offset + limit).map(product => dump(product, registered)), total: matches.length } }
}

/** The 403 the server answers a write the session may not make: the capability, then D23 on the product's company. */
function writeRefusal(product, keys, caps, cookie) {
  if (/(?:^|;\s*)mock_products=refuse(?:;|$)/.test(cookie ?? '')) return refusal(403, 'forbidden', 'managed in the root company', { details: { reason: 'managed_in_root_company' } })
  const needsPrice = keys.includes('list_price')
  const needsDefinition = keys.some(key => key !== 'list_price')
  if ((needsPrice && !caps.includes('products.prices.manage')) || (needsDefinition && !caps.includes('products.manage'))) return refusal(403, 'forbidden', 'forbidden')
  if (product.company && product.company.id !== ROOT_COMPANY.id) return refusal(403, 'forbidden', 'managed in a branch', { details: { reason: 'managed_in_branch' } })
  return null
}

function invalid(field, message = `${field} is not valid`) {
  return refusal(422, 'invalid', message, { field })
}

const isImage = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => ['name', 'mimetype', 'data'].includes(key))
  && typeof value.name === 'string' && value.name.trim() !== '' && ['image/jpeg', 'image/png'].includes(value.mimetype)
  && typeof value.data === 'string' && value.data !== '' && value.data.length <= MAX_IMAGE_DATA

/** The values of a write as stored, or the 422 the server answers: each key is checked for its kind first. */
function parseValues(body, registered) {
  const stored = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'name') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) return { failure: invalid('name') }
      stored.name = value.trim()
    } else if (key === 'type') {
      if (value !== 'goods' && value !== 'service') return { failure: invalid('type') }
      stored.type = value
    } else if (key === 'list_price') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_PRICE) return { failure: invalid('list_price') }
      stored.unit_price = value
    } else if (key === 'description') {
      if (value !== null && (typeof value !== 'string' || value.length > 4000)) return { failure: invalid('description') }
      stored.description = value
    } else if (key === 'image') {
      if (value !== null && !isImage(value)) return { failure: invalid('image') }
      stored.has_image = value !== null
    } else if (key === 'taxes') {
      const chosen = Array.isArray(value) && value.length ? value.map(id => CHOICES.find(choice => choice.id === id)) : null
      if (!registered || !chosen || chosen.includes(undefined)) return { failure: invalid('taxes') }
      stored.taxes = chosen.map(({ id, name, amount }) => ({ id, name, amount }))
    } else {
      return { failure: refusal(422, 'unknown_field', `field ${key} is not writable`, { field: key }) }
    }
  }
  return { stored }
}

function create(body, caps, registered) {
  if (typeof body.name !== 'string' || !('type' in body)) return invalid(typeof body.name === 'string' ? 'type' : 'name', 'name and type are required')
  const keys = Object.keys(body)
  if (!caps.includes('products.manage') || (keys.includes('list_price') && !caps.includes('products.prices.manage'))) return refusal(403, 'forbidden', 'forbidden')
  const parsed = parseValues(body, registered)
  if (parsed.failure) return parsed.failure
  const product = {
    id: nextId++, description: null, has_image: false, unit_price: 0, active: true, taxes: [VAT],
    company: settings.sharing === 'establishment' ? null : ROOT_COMPANY, ...parsed.stored,
  }
  products = [...products, product]
  return { status: 201, body: dump(product, registered) }
}

function patch(product, body, caps, cookie, registered) {
  if (!Object.keys(body).length) return invalid('name', 'nothing to change')
  const denied = writeRefusal(product, Object.keys(body), caps, cookie)
  if (denied) return denied
  const parsed = parseValues(body, registered)
  if (parsed.failure) return parsed.failure
  Object.assign(product, parsed.stored)
  return { status: 200, body: dump(product, registered) }
}

function updateSettings(body, manage) {
  if (!manage) return refusal(403, 'forbidden', 'only the main company manages these settings')
  if (body.revision !== settings.revision) return refusal(409, 'conflict', 'Product settings changed; reload before saving')
  if (body.sharing !== 'establishment' && body.sharing !== 'branch') return invalid('sharing')
  if (body.sharing !== settings.sharing && products.length) return refusal(409, 'sharing_transfer_required', 'products exist', { field: 'sharing' })
  settings = { sharing: body.sharing, revision: settings.revision + 1 }
  return { status: 200, body: { ...settings, can_manage: manage } }
}

/** Answers a products request and returns true; any other path is not this stub's and returns false. */
export async function handleProducts(req, res, path, url, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    products = freshProducts()
    settings = { sharing: 'establishment', revision: 1 }
    nextId = 300
    json(res, 200, {})
    return true
  }
  const record = path.match(RECORD_PATH)
  if (!(path === LIST_PATH || path === PRODUCT_PICK_PATH || path === SETTINGS_PATH || path === TAXES_PATH || record)) return false
  const caps = capabilitiesForRequest(req.headers.cookie, PRODUCTS_CAPABILITIES)
  const registered = !untaxed(req.headers.cookie)
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

  if (path === PRODUCT_PICK_PATH && req.method === 'GET') {
    if (need('products.read')) json(res, 200, productPickPage(url))
    return true
  }
  if (path === TAXES_PATH && req.method === 'GET') {
    if (need('products.manage')) json(res, 200, { items: registered ? CHOICES : [], total: registered ? CHOICES.length : 0 })
    return true
  }
  if (path === SETTINGS_PATH) {
    const branchManager = /(?:^|;\s*)mock_products=branch(?:;|$)/.test(req.headers.cookie ?? '')
    if (req.method === 'GET') {
      if (!caps.includes('products.read') && !caps.includes('products.settings.manage')) json(res, 403, { code: 'forbidden', message: 'forbidden' })
      else json(res, 200, { ...settings, can_manage: caps.includes('products.settings.manage') && !branchManager })
      return true
    }
    if (req.method === 'PATCH' && need('products.settings.manage')) send(updateSettings(body, !branchManager))
    return true
  }
  if (path === LIST_PATH && req.method === 'GET') {
    if (need('products.read')) send(listPage(url, registered))
    return true
  }
  if (path === LIST_PATH && req.method === 'POST') {
    send(create(body, caps, registered))
    return true
  }
  if (!record) return false
  const product = products.find(candidate => candidate.id === Number(record[1]))
  if (!need('products.read')) return true
  if (!product) {
    send(refusal(404, 'not_found', 'not found'))
    return true
  }
  if (record[2] === 'archive' || record[2] === 'restore') {
    if (req.method !== 'POST') return false
    if (!need('products.manage')) return true
    const denied = writeRefusal(product, ['active'], caps, req.headers.cookie)
    if (denied) send(denied)
    else { product.active = record[2] === 'restore'; send({ status: 200, body: dump(product, registered) }) }
    return true
  }
  if (req.method === 'GET') {
    send({ status: 200, body: dump(product, registered) })
    return true
  }
  if (req.method === 'PATCH') {
    send(patch(product, body, caps, req.headers.cookie, registered))
    return true
  }
  return false
}
