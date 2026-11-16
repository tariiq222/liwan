// Part of the isolated UI mock stack: the quotation templates and the sector presets of liwan_sales, shaped like
// packages/contracts/src/sales/templates.ts and index.ts. One in-memory list of templates that follows the server's rules:
//  - the pick list and the detail answer to `sales.quotations.manage` or `sales.settings.manage`; create, edit, archive and
//    restore to `sales.settings.manage`; an archived template is listed and read by a manager only (404 for the others);
//  - a template line is a product (a product of the products mock) with a quantity, a section or a note: a price, a tax, a
//    discount or any other key is 422 `unknown_field`; a template whose product is gone reads `usable: false`;
//  - starting a quotation (`template_id` on the create route, `startFromTemplate`) takes the template's lines, terms and
//    validity unless the body gives its own, and refuses an unusable template with 422 `template_unusable` on `template_id`;
//  - `POST /api/v1/public/sales/__mock/template-product-gone {id}` archives the first product of a template, and the templates beyond the
//    first page: `POST .../__mock/templates-many {count}` adds that many active templates named "قالب إضافي <n>" (50 per page, `offset`);
//  - the presets (`GET /api/v1/sales/settings/presets`) hold only the settings the tenant carries: the payments, CRM and
//    finance choices appear when the settings view carries their keys, as the bridges add them on the server.
import { findMockProduct } from './products-mock-routes.mjs'

export const TEMPLATES_PATH = '/api/v1/sales/templates'
export const PRESETS_PATH = '/api/v1/sales/settings/presets'
// `POST {id}` makes the first product of a template one that is gone, as if it were archived after the template was chosen.
export const PRODUCT_GONE_PATH = '/api/v1/public/sales/__mock/template-product-gone'
const MANY_PATH = '/api/v1/public/sales/__mock/templates-many'
const RECORD_PATH = /^\/api\/v1\/sales\/templates\/(\d+)(?:\/(archive|restore))?$/
const TODAY = Date.UTC(2026, 10, 14)
const NAME_MAX = 200
const TERMS_MAX = 10_000
const MAX_LINES = 500
// A product the products mock no longer has: the line of a template whose product was archived.
const GONE_PRODUCT = { id: 999, name: 'منتج مؤرشف' }
const LINE_KEYS = { product: ['kind', 'product_id', 'name', 'quantity'], section: ['kind', 'name'], note: ['kind', 'name'] }

const refusal = (status, code, message, extra = {}) => ({ status, body: { code, message, ...extra } })
const invalid = (field, message = `${field} is not valid`) => refusal(422, 'invalid', message, { field })
const unknown = field => refusal(422, 'invalid', `field ${field} is not accepted`, { field })

const freshTemplates = () => [
  { id: 1, name: 'عرض خدمات قياسي', validity_days: 14, terms: 'الدفع خلال 14 يومًا من تاريخ التأكيد.', active: true,
    lines: [{ kind: 'section', name: 'نطاق العمل' }, { kind: 'product', product_id: 1, name: '', quantity: 2 }, { kind: 'product', product_id: 2, name: 'ساعتان أسبوعيًا', quantity: 1 }, { kind: 'note', name: 'يبدأ التنفيذ خلال أسبوع من التأكيد.' }] },
  { id: 2, name: 'توريد شهري', validity_days: 0, terms: '', active: true, lines: [{ kind: 'product', product_id: 201, name: '', quantity: 10 }] },
  { id: 3, name: 'قالب فيه منتج غير متاح', validity_days: 30, terms: '', active: true, lines: [{ kind: 'product', product_id: GONE_PRODUCT.id, name: '', quantity: 1 }, { kind: 'note', name: 'راجع المنتج قبل الاستخدام.' }] },
  { id: 4, name: 'قالب قديم', validity_days: 7, terms: '', active: false, lines: [{ kind: 'product', product_id: 202, name: '', quantity: 1 }] },
]
let templates = freshTemplates()
let nextId = 10

export const resetSalesTemplates = () => { templates = freshTemplates(); nextId = 10 }

const productOf = line => line.product_id === GONE_PRODUCT.id ? null : findMockProduct(line.product_id)
const lineUsable = line => line.kind !== 'product' || Boolean(productOf(line))
const usable = template => template.lines.every(lineUsable)
const canManage = caps => caps.includes('sales.settings.manage')

function dumpLine(line) {
  const product = line.kind === 'product' ? (productOf(line) ?? GONE_PRODUCT) : null
  return {
    kind: line.kind, product: product ? { id: product.id, name: product.name } : null, name: line.name ?? '',
    quantity: line.kind === 'product' ? line.quantity : 0, usable: lineUsable(line),
  }
}

const dumpItem = (template, caps) => ({
  id: template.id, name: template.name, validity_days: template.validity_days, archived: !template.active,
  line_count: template.lines.length, usable: usable(template), can_manage: canManage(caps),
})
const dump = (template, caps) => ({ ...dumpItem(template, caps), terms: template.terms, lines: template.lines.map(dumpLine) })

/** The lines of a write as stored, or the refusal the server answers. */
function parseLines(lines) {
  if (!Array.isArray(lines) || lines.length > MAX_LINES) return { failure: invalid('lines') }
  const stored = []
  for (const [index, input] of lines.entries()) {
    const kind = input?.kind
    if (!LINE_KEYS[kind]) return { failure: invalid(`lines.${index}.kind`) }
    const extra = Object.keys(input).find(key => !LINE_KEYS[kind].includes(key))
    if (extra) return { failure: unknown(`lines.${index}.${extra}`) }
    if (kind !== 'product') {
      if (typeof input.name !== 'string' || !input.name.trim()) return { failure: invalid(`lines.${index}.name`) }
      stored.push({ kind, name: input.name.trim() })
      continue
    }
    if (!Number.isInteger(input.product_id) || input.product_id < 1) return { failure: invalid(`lines.${index}.product_id`) }
    if (!findMockProduct(input.product_id)) return { failure: invalid(`lines.${index}.product_id`, 'the product does not exist') }
    if (typeof input.quantity !== 'number' || !(input.quantity > 0) || input.quantity > 1_000_000) return { failure: invalid(`lines.${index}.quantity`) }
    // The server keeps only text staff wrote: the product's own description is neither stored nor passed on.
    const product = findMockProduct(input.product_id)
    const own = typeof input.name === 'string' ? input.name.trim() : ''
    stored.push({ kind, product_id: input.product_id, name: own === product.name ? '' : own, quantity: input.quantity })
  }
  return { stored }
}

/** The values of a create or an edit, or the refusal. */
function parseBody(body, creating) {
  const field = Object.keys(body).find(key => !['name', 'validity_days', 'terms', 'lines'].includes(key))
  if (field) return { failure: unknown(field) }
  const values = {}
  if (creating && !('name' in body)) return { failure: invalid('name', 'name is required') }
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > NAME_MAX) return { failure: invalid('name') }
    values.name = body.name.trim()
  }
  if ('validity_days' in body) {
    if (!Number.isInteger(body.validity_days) || body.validity_days < 0 || body.validity_days > 3650) return { failure: invalid('validity_days') }
    values.validity_days = body.validity_days
  }
  if ('terms' in body) {
    if (typeof body.terms !== 'string' || body.terms.length > TERMS_MAX) return { failure: invalid('terms') }
    values.terms = body.terms
  }
  if ('lines' in body) {
    const parsed = parseLines(body.lines)
    if (parsed.failure) return parsed
    values.lines = parsed.stored
  }
  if (!Object.keys(values).length) return { failure: invalid(null, 'nothing to change') }
  return { values }
}

/**
 * The body of a create that names `template_id`, with the template's lines, terms and validity wherever the body gives none,
 * or the refusal. The lines are product, quantity and name only: the create route prices them now.
 */
export function startFromTemplate(body) {
  const { template_id: templateId, ...rest } = body
  if ('lines' in rest) return { failure: invalid('template_id', 'give the lines or a template, not both') }
  const template = templates.find(candidate => candidate.id === templateId && candidate.active)
  if (!template) return { failure: invalid('template_id', 'the template does not exist') }
  const gone = template.lines.find(line => !lineUsable(line))
  if (gone) return { failure: refusal(422, 'template_unusable', 'the template cannot start a quotation', { field: 'template_id', details: { product: GONE_PRODUCT.name } }) }
  const lines = template.lines.map(line => line.kind === 'product'
    ? { kind: 'product', product_id: line.product_id, quantity: line.quantity, ...(line.name ? { name: line.name } : {}) }
    : { kind: line.kind, name: line.name })
  const days = template.validity_days
  return {
    body: {
      ...rest, lines,
      ...(!('terms' in rest) && template.terms ? { terms: template.terms } : {}),
      ...(!('validity_date' in rest) && days > 0 ? { validity_date: new Date(TODAY + days * 86_400_000).toISOString().slice(0, 10) } : {}),
    },
  }
}

// The sector presets, as `models/sales_presets.py` and the bridges define them.
const OWN = {
  services: { visibility: 'own', validity_days: 30, discount_limit_percent: 10, customer_answer: 'accept_and_sign', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type' },
  trading: { visibility: 'all', validity_days: 7, discount_limit_percent: 5, customer_answer: 'accept', acceptance_confirms: true, answered_resend: 'allow', signature_methods: 'draw_or_type' },
  contracting: { visibility: 'all', validity_days: 60, discount_limit_percent: 3, customer_answer: 'accept_and_sign', acceptance_confirms: false, answered_resend: 'refuse', signature_methods: 'draw' },
}
const BRIDGES = {
  services: { payment_to_confirm: 'off', opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed', invoice_down_payment: 'allow', invoice_actor: 'owner' },
  trading: { payment_to_confirm: 'full', opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed', invoice_down_payment: 'refuse', invoice_actor: 'any_biller' },
  contracting: { payment_to_confirm: 'off', opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed', invoice_down_payment: 'allow', invoice_actor: 'any_biller' },
}

/** The presets for a tenant whose settings read `wire`: only the keys the settings carry. */
export function presetsView(wire) {
  const items = Object.keys(OWN).map((key) => {
    const values = Object.fromEntries(Object.entries({ ...OWN[key], ...BRIDGES[key] }).filter(([setting]) => setting in wire))
    return { key, values, matches: Object.entries(values).every(([setting, value]) => wire[setting] === value) }
  })
  return { items, total: items.length }
}

/** The test hooks of this stub (public paths: the proxy forwards them without a session). Answers one and returns true. */
export async function handleSalesTemplateHooks(req, res, path, { json, readBody }) {
  if (req.method !== 'POST' || ![PRODUCT_GONE_PATH, MANY_PATH].includes(path)) return false
  if (path === PRODUCT_GONE_PATH) {
    const body = JSON.parse(await readBody(req) || '{}')
    const line = templates.find(candidate => candidate.id === body.id)?.lines.find(candidate => candidate.kind === 'product')
    if (line) line.product_id = GONE_PRODUCT.id
    json(res, line ? 200 : 404, { ok: Boolean(line) })
    return true
  }
  if (path === MANY_PATH) {
    const body = JSON.parse(await readBody(req) || '{}')
    for (let index = 1; index <= Number(body.count || 0); index++) {
      templates = [...templates, { id: nextId++, name: `قالب إضافي ${String(index).padStart(3, '0')}`, validity_days: 0, terms: '', active: true, lines: [{ kind: 'product', product_id: 201, name: '', quantity: 1 }] }]
    }
    json(res, 200, { ok: true })
    return true
  }
  return false
}

/** Answers a template or preset request and returns true; any other path is not this stub's. */
export async function handleSalesTemplates(req, res, path, url, { json, readBody }, caps, settingsWire) {
  const record = path.match(RECORD_PATH)
  if (!(path === TEMPLATES_PATH || path === PRESETS_PATH || record)) return false
  const send = result => json(res, result.status, result.body)
  const need = (...anyOf) => {
    if (anyOf.some(capability => caps.includes(capability))) return true
    json(res, 403, { code: 'forbidden', message: 'forbidden' })
    return false
  }
  if (path === PRESETS_PATH) {
    if (req.method === 'GET' && need('sales.settings.manage')) json(res, 200, presetsView(settingsWire()))
    return true
  }
  let body = {}
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = JSON.parse(await readBody(req) || '{}') } catch { body = {} }
  }
  if (path === TEMPLATES_PATH && req.method === 'GET') {
    if (!need('sales.quotations.manage', 'sales.settings.manage')) return true
    const archived = url.searchParams.get('archived') === 'true'
    if (archived && !canManage(caps)) {
      send(refusal(403, 'forbidden', 'only a settings manager lists archived templates'))
      return true
    }
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const found = templates.filter(template => template.active !== archived && (!q || template.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name))
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
    const offset = Number(url.searchParams.get('offset')) || 0
    json(res, 200, { items: found.slice(offset, offset + limit).map(template => dumpItem(template, caps)), total: found.length })
    return true
  }
  if (path === TEMPLATES_PATH && req.method === 'POST') {
    if (!need('sales.settings.manage')) return true
    const parsed = parseBody(body, true)
    if (parsed.failure) { send(parsed.failure); return true }
    const created = { id: nextId++, name: '', validity_days: 0, terms: '', lines: [], active: true, ...parsed.values }
    templates = [...templates, created]
    json(res, 201, dump(created, caps))
    return true
  }
  if (!record) return true
  if (!need(...(req.method === 'GET' ? ['sales.quotations.manage', 'sales.settings.manage'] : ['sales.settings.manage']))) return true
  const template = templates.find(candidate => candidate.id === Number(record[1]) && (candidate.active || canManage(caps)))
  if (!template) {
    send(refusal(404, 'not_found', 'template not found'))
    return true
  }
  const action = record[2]
  if (!action && req.method === 'GET') json(res, 200, dump(template, caps))
  else if (!action && req.method === 'PATCH') {
    if (!template.active) { send(refusal(403, 'transition_forbidden', 'an archived template is restored before it is edited')); return true }
    const parsed = parseBody(body, false)
    if (parsed.failure) { send(parsed.failure); return true }
    Object.assign(template, parsed.values)
    json(res, 200, dump(template, caps))
  } else if (action && req.method === 'POST') {
    if (template.active === (action === 'restore')) { send(refusal(403, 'transition_forbidden', `the template is already ${action === 'restore' ? 'active' : 'archived'}`)); return true }
    template.active = action === 'restore'
    json(res, 200, dump(template, caps))
  } else return false
  return true
}
