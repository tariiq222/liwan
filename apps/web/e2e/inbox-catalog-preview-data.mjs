// Synthetic WhatsApp catalog, product-message and order API for the isolated UI mock (see inbox-ui-preview-data.mjs, which
// owns the inbox state and calls this module for the catalog routes). Never reads or writes Odoo data. Every response is
// shaped like packages/contracts/src/inbox/catalog.ts; app/composables/inbox/__tests__/inboxMockContract.test.ts parses
// them with the contract schemas, so the mock cannot drift from the wire shape.

const HOUR = 3_600_000
const iso = ms => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
const ago = hours => iso(Date.now() - hours * HOUR)
const META_ID = /^\d{5,32}$/
const RETAILER_ID = /^[A-Za-z0-9._-]{1,100}$/
const VAT = 1.15
const IMAGE_MIN = 500
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_LINK = 'https://wa.me/966112345678'
// Products the "existing product" tab can list: id -> { name, price, hasImage }.
const PRODUCTS = { 201: ['شاي أخضر', 22, true], 202: ['عسل سدر', 160, true], 203: ['ميزان مطبخ', 75, true], 204: ['منتج بلا صورة', 10, false] }

const ok = body => ({ status: 200, body })
const fail = (status, code, message, field) => ({ status, body: { code, message, ...(field ? { field } : {}) } })
const list = items => ({ items, total: items.length })
const round2 = value => Math.round(value * 100) / 100
const image = id => ({ url: `https://app.example.test/api/v1/public/inbox/catalog/images/${id}/mock-token`, width: 1024, height: 1024 })

function makeItem(id, retailerId, name, listPrice, rest = {}) {
  return {
    id, catalog_id: 1, product: { id: 100 + id, name }, product_retailer_id: retailerId, name, description: `${name} - وصف المنتج`, list_price: listPrice, currency: 'SAR',
    availability: 'in_stock', listed: true, link_override: null, image: image(id), sync_state: 'synced', sync_error: null, review_status: 'approved', review_reason: null,
    last_synced_at: ago(2), ...rest,
  }
}

export function seedCatalog() {
  return {
    catalogs: [{
      id: 1, business_account_id: '203456789012345', meta_catalog_id: '9988776655443', name: 'كتالوج المتجر', state: 'connected', last_error: null, brand: 'متجر الأمل',
      default_link: null, prices_include_tax: true, currency: 'SAR', last_sync_at: ago(0.5), created_at: ago(72),
    }],
    items: [
      makeItem(1, 'wv-101', 'قهوة مختصة 250 غ', 45),
      makeItem(2, 'wv-102', 'دلة سفر معدنية', 120),
      makeItem(3, 'wv-103', 'كوب سيراميك', 35, { sync_state: 'pending', review_status: 'pending', last_synced_at: null }),
      makeItem(4, 'wv-104', 'مطحنة يدوية', 210, { availability: 'out_of_stock' }),
      makeItem(5, 'wv-105', 'فلاتر ورقية', 18, { sync_state: 'error', sync_error: 'Meta: الصورة أصغر من الحد الأدنى', review_status: 'unknown', last_synced_at: null }),
      makeItem(6, 'wv-106', 'طقم ملاعق', 60, { review_status: 'rejected', review_reason: 'محتوى مخالف لسياسة التجارة' }),
    ],
    // Channel id -> Meta's commerce switches of that number.
    commerce: new Map([[1, { cart_enabled: true, catalog_visible: false }]]),
    orders: [],
    // Item id -> when it was queued for Meta; the push cron is simulated by settleItems.
    queued: new Map(),
    ids: { catalog: 2, item: 7, order: 1, line: 1, reference: 12, product: 300 },
  }
}

const priceOf = (catalog, item) => round2(catalog.prices_include_tax ? item.list_price * VAT : item.list_price)
const itemOut = (state, item) => {
  const catalog = state.catalog.catalogs.find(candidate => candidate.id === item.catalog_id)
  return { ...item, price: priceOf(catalog, item), link: item.link_override ?? catalog.default_link ?? DEFAULT_LINK }
}
const catalogOut = (state, catalog) => {
  const items = state.catalog.items.filter(item => item.catalog_id === catalog.id)
  const channels = state.channels.map(({ id, name }) => {
    const settings = state.catalog.commerce.get(id)
    return { id, name, cart_enabled: settings?.cart_enabled ?? null, catalog_visible: settings?.catalog_visible ?? null }
  })
  const count = test => items.filter(test).length
  return {
    ...catalog,
    channels,
    counts: { items: items.length, synced: count(item => item.sync_state === 'synced'), pending: count(item => item.sync_state === 'pending' || item.sync_state === 'syncing'), error: count(item => item.sync_state === 'error'), rejected: count(item => item.review_status === 'rejected') },
  }
}
const pickOut = (state, item) => {
  const out = itemOut(state, item)
  return { id: out.id, product_retailer_id: out.product_retailer_id, name: out.name, price: out.price, currency: out.currency, availability: out.availability, image_url: out.image?.url ?? null }
}
// A queued item becomes synced and approved a moment after it was queued, as the sync cron and Meta's review would do.
function settleItems(state) {
  for (const item of state.catalog.items) {
    const since = state.catalog.queued.get(item.id)
    if (since === undefined || Date.now() - since < 1500) continue
    Object.assign(item, { sync_state: 'synced', review_status: 'approved', last_synced_at: iso(Date.now()) })
    state.catalog.queued.delete(item.id)
  }
}
const queue = (state, item) => {
  item.sync_state = 'pending'
  state.catalog.queued.set(item.id, Date.now())
}

const pickable = state => state.catalog.items.filter(item => item.listed && item.sync_state === 'synced' && item.review_status !== 'rejected')

// ---------------------------------------------------------------- image check (PNG and JPEG headers)

function imageSize(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
  }
  return null
}

function imageProblem(upload) {
  if (!upload || !['image/jpeg', 'image/png'].includes(upload.mimetype) || !upload.data) return 'الصورة يجب أن تكون JPEG أو PNG'
  const bytes = Buffer.from(upload.data, 'base64')
  if (bytes.length > IMAGE_MAX_BYTES) return 'الصورة أكبر من 5 ميغابايت'
  const size = imageSize(bytes)
  if (!size || size.width < IMAGE_MIN || size.height < IMAGE_MIN) return 'الصورة أصغر من 500×500'
  return null
}

// ---------------------------------------------------------------- items

function createItem(state, catalog, body) {
  let product
  if ('product_id' in body) {
    const known = PRODUCTS[body.product_id]
    if (!known) return fail(422, 'invalid', 'المنتج غير موجود', 'product_id')
    if (!known[2]) return fail(422, 'invalid', 'المنتج بلا صورة، أضف صورة قبل إدراجه', 'product_id')
    if (state.catalog.items.some(item => item.catalog_id === catalog.id && item.product.id === body.product_id)) return fail(409, 'conflict', 'المنتج مدرج في الكتالوج')
    product = { id: body.product_id, name: known[0], listPrice: known[1], description: known[0] }
  } else {
    const input = body.product ?? {}
    if (!String(input.name ?? '').trim()) return fail(422, 'invalid', 'اسم المنتج مطلوب', 'product.name')
    const problem = imageProblem(input.image)
    if (problem) return fail(422, 'invalid', problem, 'product.image')
    product = { id: state.catalog.ids.product++, name: input.name.trim(), listPrice: input.list_price ?? 0, description: input.description ?? input.name.trim() }
  }
  const retailerId = body.product_retailer_id ?? `wv-${product.id}`
  if (!RETAILER_ID.test(retailerId)) return fail(422, 'invalid', 'معرّف المنتج غير صحيح', 'product_retailer_id')
  if (state.catalog.items.some(item => item.catalog_id === catalog.id && item.product_retailer_id === retailerId)) return fail(409, 'conflict', 'معرّف المنتج مستخدم', 'product_retailer_id')
  const id = state.catalog.ids.item++
  const created = makeItem(id, retailerId, product.name, product.listPrice, {
    product: { id: product.id, name: product.name }, description: product.description, availability: body.availability ?? 'in_stock', listed: body.listed ?? true,
    link_override: body.link_override ?? null, sync_state: 'pending', review_status: 'pending', last_synced_at: null,
  })
  state.catalog.items.push(created)
  queue(state, created)
  return { status: 201, body: itemOut(state, created) }
}

function patchItem(state, item, body) {
  if ('product_retailer_id' in body && body.product_retailer_id !== item.product_retailer_id) {
    if (item.last_synced_at) return fail(422, 'invalid', 'لا يتغير معرّف المنتج بعد المزامنة', 'product_retailer_id')
    if (!RETAILER_ID.test(body.product_retailer_id)) return fail(422, 'invalid', 'معرّف المنتج غير صحيح', 'product_retailer_id')
    item.product_retailer_id = body.product_retailer_id
  }
  if (body.product) {
    if (item.product.id < 300) return fail(422, 'invalid', 'يُعدَّل المنتج الذي أنشأه المحرر هنا فقط', 'product')
    if (body.product.image && imageProblem(body.product.image)) return fail(422, 'invalid', imageProblem(body.product.image), 'product.image')
    if ('name' in body.product) { item.name = body.product.name; item.product = { ...item.product, name: body.product.name } }
    if ('description' in body.product) item.description = body.product.description ?? item.name
    if ('list_price' in body.product) item.list_price = body.product.list_price
  }
  for (const key of ['availability', 'listed', 'link_override']) if (key in body) item[key] = body[key]
  queue(state, item)
  return ok(itemOut(state, item))
}

function itemList(state, catalog, url) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const wanted = { sync: url.searchParams.get('sync_state'), review: url.searchParams.get('review_status'), listed: url.searchParams.get('listed') }
  const items = state.catalog.items
    .filter(item => item.catalog_id === catalog.id)
    .filter(item => !wanted.sync || item.sync_state === wanted.sync)
    .filter(item => !wanted.review || item.review_status === wanted.review)
    .filter(item => wanted.listed === null || String(item.listed) === wanted.listed)
    .filter(item => !q || item.name.toLowerCase().includes(q) || item.product_retailer_id.toLowerCase().includes(q))
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
  return ok({ items: items.slice(offset, offset + limit).map(item => itemOut(state, item)), total: items.length })
}

// ---------------------------------------------------------------- catalogs

function createCatalog(state, body) {
  const channel = state.channels.find(item => item.id === body.channel_id)
  if (!channel) return fail(422, 'invalid', 'القناة غير موجودة', 'channel_id')
  if (!META_ID.test(String(body.meta_catalog_id ?? ''))) return fail(422, 'invalid', 'رقم الكتالوج غير صحيح', 'meta_catalog_id')
  if (!String(body.brand ?? '').trim()) return fail(422, 'invalid', 'العلامة التجارية مطلوبة', 'brand')
  if (body.meta_catalog_id.endsWith('000')) return fail(422, 'invalid', 'هذا الكتالوج ليس من نوع التجارة (commerce)', 'meta_catalog_id')
  if (body.meta_catalog_id.endsWith('999')) return fail(422, 'provider_permission', 'امنح الصلاحية catalog_management وأسند الكتالوج للمستخدم النظامي في ميتا')
  if (state.catalog.catalogs.some(item => item.business_account_id === channel.business_account_id)) return fail(409, 'conflict', 'يوجد كتالوج لهذا الحساب')
  const catalog = {
    id: state.catalog.ids.catalog++, business_account_id: channel.business_account_id, meta_catalog_id: body.meta_catalog_id, name: `كتالوج ${body.meta_catalog_id}`, state: 'connected',
    last_error: null, brand: body.brand.trim(), default_link: body.default_link ?? null, prices_include_tax: body.prices_include_tax, currency: 'SAR', last_sync_at: null, created_at: iso(Date.now()),
  }
  state.catalog.catalogs.push(catalog)
  state.catalog.commerce.set(channel.id, { cart_enabled: true, catalog_visible: false })
  return { status: 201, body: catalogOut(state, catalog) }
}

function catalogRoute(state, method, parts, url, body) {
  const id = parts[4] ? Number(parts[4]) : undefined
  if (id === undefined) {
    if (method === 'GET') return ok(list(state.catalog.catalogs.map(catalog => catalogOut(state, catalog))))
    return method === 'POST' ? createCatalog(state, body) : undefined
  }
  const catalog = state.catalog.catalogs.find(item => item.id === id)
  if (!catalog) return fail(404, 'not_found', 'not found')
  if (parts[5] === 'items') {
    if (method === 'GET') return itemList(state, catalog, url)
    return method === 'POST' ? createItem(state, catalog, body) : undefined
  }
  if (parts[5] === 'sync' && method === 'POST') {
    for (const item of state.catalog.items) if (item.catalog_id === id && item.listed && item.sync_state !== 'error') queue(state, item)
    return { status: 202, body: catalogOut(state, catalog) }
  }
  if (method === 'GET') return ok(catalogOut(state, catalog))
  if (method === 'PATCH') {
    if (!Object.keys(body).length) return fail(422, 'invalid', 'send at least one field')
    if ('brand' in body && !String(body.brand).trim()) return fail(422, 'invalid', 'العلامة التجارية مطلوبة', 'brand')
    Object.assign(catalog, Object.fromEntries(['brand', 'default_link', 'prices_include_tax'].filter(key => key in body).map(key => [key, body[key]])))
    for (const item of state.catalog.items) if (item.catalog_id === id && item.listed) queue(state, item)
    return ok(catalogOut(state, catalog))
  }
  if (method === 'DELETE') {
    state.catalog.catalogs.splice(state.catalog.catalogs.indexOf(catalog), 1)
    state.catalog.items = state.catalog.items.filter(item => item.catalog_id !== id)
    return { status: 204, body: undefined }
  }
  return undefined
}

function itemRoute(state, method, parts, body) {
  const item = state.catalog.items.find(candidate => candidate.id === Number(parts[4]))
  if (!item) return fail(404, 'not_found', 'not found')
  if (method === 'GET') return ok(itemOut(state, item))
  if (method === 'PATCH') return Object.keys(body).length ? patchItem(state, item, body) : fail(422, 'invalid', 'send at least one field')
  if (method === 'DELETE') {
    state.catalog.items.splice(state.catalog.items.indexOf(item), 1)
    return { status: 204, body: undefined }
  }
  return undefined
}

// ---------------------------------------------------------------- channel commerce and the picker

function channelCommerce(state, method, channelId, body) {
  const channel = state.channels.find(item => item.id === channelId)
  if (!channel) return fail(404, 'not_found', 'not found')
  const catalog = state.catalog.catalogs.find(item => item.business_account_id === channel.business_account_id)
  if (method === 'PATCH') {
    if (!catalog) return fail(409, 'no_catalog', 'لا يوجد كتالوج مرتبط')
    if (!Object.keys(body).length) return fail(422, 'invalid', 'send at least one field')
    state.catalog.commerce.set(channelId, { ...(state.catalog.commerce.get(channelId) ?? { cart_enabled: true, catalog_visible: false }), ...body })
  }
  const settings = state.catalog.commerce.get(channelId)
  return ok({ channel_id: channelId, catalog: catalog ? { id: catalog.id, name: catalog.name } : null, cart_enabled: catalog ? settings?.cart_enabled ?? null : null, catalog_visible: catalog ? settings?.catalog_visible ?? null : null })
}

function conversationPick(state, url) {
  if (!state.catalog.catalogs.length) return fail(409, 'no_catalog', 'لا يوجد كتالوج مرتبط')
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const items = pickable(state).filter(item => !q || item.name.toLowerCase().includes(q) || item.product_retailer_id.toLowerCase().includes(q))
  return ok(list(items.map(item => pickOut(state, item))))
}

// ---------------------------------------------------------------- product messages

/** The `commerce` block and the plain fields of an outbound product message, or a refusal. */
export function commerceReply(state, content) {
  const catalog = state.catalog.catalogs[0]
  if (!catalog) return { refusal: fail(409, 'no_catalog', 'لا يوجد كتالوج مرتبط') }
  const ids = content.type === 'product' ? [content.product_retailer_id]
    : content.type === 'product_list' ? content.sections.flatMap(section => section.product_retailer_ids)
      : content.thumbnail_product_retailer_id ? [content.thumbnail_product_retailer_id] : []
  const available = new Map(pickable(state).map(item => [item.product_retailer_id, item]))
  if (ids.some(id => !available.has(id))) return { refusal: fail(422, 'invalid', 'منتج غير موجود أو لم يُزامَن بعد', 'commerce') }
  if (content.type === 'product_list' && (ids.length > 30 || new Set(ids).size !== ids.length || content.sections.length > 10)) return { refusal: fail(422, 'invalid', 'حدود الرسالة', 'commerce') }
  return {
    fields: {
      kind: content.type, body: content.body ?? '',
      commerce: { type: 'sent', catalog_id: catalog.meta_catalog_id, content, products: ids.map(id => ({ product_retailer_id: id, product: commerceProduct(state, available.get(id)) })) },
    },
  }
}

function commerceProduct(state, item) {
  if (!item) return null
  const out = itemOut(state, item)
  return { catalog_item_id: out.id, name: out.name, price: out.price, currency: out.currency, availability: out.availability, image_url: out.image?.url ?? null }
}

// ---------------------------------------------------------------- orders

const summaryOf = order => ({ id: order.id, state: order.state, reference: order.reference, payment_status: order.payment?.status ?? null })

/** The order as the API answers it: lines and totals at today's prices. */
function orderOut(state, order) {
  const catalog = state.catalog.catalogs[0]
  const lines = order.lines.map((line) => {
    const item = state.catalog.items.find(candidate => candidate.product_retailer_id === line.product_retailer_id)
    return {
      id: line.id, product_retailer_id: line.product_retailer_id, catalog_item_id: item?.id ?? null, name: item?.name ?? null, quantity: line.quantity,
      cart_price: line.cart_price, unit_price: item && catalog ? priceOf(catalog, item) : null, currency: 'SAR', availability: item?.availability ?? null,
    }
  })
  const total = round2(lines.reduce((sum, line) => sum + line.quantity * (line.unit_price ?? line.cart_price ?? 0), 0))
  const cartTotal = order.message_id ? round2(lines.reduce((sum, line) => sum + line.quantity * (line.cart_price ?? 0), 0)) : null
  const conv = state.conversations.find(item => item.id === order.conversation_id)
  const payment = order.payment ? { ...order.payment, amount_total: total, amount_due: order.payment.status === 'paid' ? 0 : total } : null
  return {
    id: order.id, conversation_id: order.conversation_id, channel: { id: conv.channel.id, name: conv.channel.name }, contact: { id: conv.contact.id, name: conv.contact.name },
    message_id: order.message_id, state: order.state, reference: order.reference, lines, cart_total: cartTotal, cart_currency: cartTotal === null ? null : 'SAR', total, currency: 'SAR',
    price_changed: cartTotal !== null && cartTotal !== total, payment, pay_link_sent_at: order.pay_link_sent_at, created_by: order.created_by, created_at: order.created_at,
  }
}

function newOrder(state, conv, lines, extra = {}) {
  const order = {
    id: state.catalog.ids.order++, conversation_id: conv.id, message_id: null, state: 'cart', reference: null, payment: null, pay_link_sent_at: null, created_by: null, created_at: iso(Date.now()), ...extra,
    lines: lines.map(line => ({ id: state.catalog.ids.line++, ...line })),
  }
  state.catalog.orders.push(order)
  return order
}

function lineFromItem(state, itemId, quantity) {
  const item = state.catalog.items.find(candidate => candidate.id === itemId)
  if (!item) return null
  return { product_retailer_id: item.product_retailer_id, quantity, cart_price: priceOf(state.catalog.catalogs[0], item) }
}

/** A customer's cart arriving: an inbound `order` message with its cart order. `lines` are `{ retailer_id, quantity }`. */
export function receiveCart(state, conv, lines, text, appendInbound) {
  const catalog = state.catalog.catalogs[0]
  const resolved = lines.map((line) => {
    const item = state.catalog.items.find(candidate => candidate.product_retailer_id === line.retailer_id)
    return { product_retailer_id: line.retailer_id, quantity: line.quantity, cart_price: item && catalog ? priceOf(catalog, item) : 0 }
  })
  const order = newOrder(state, conv, resolved)
  const message = appendInbound(conv, {
    kind: 'order', body: text ?? '',
    commerce: {
      type: 'order', catalog_id: catalog?.meta_catalog_id ?? '9988776655443', text: text ?? null, order: summaryOf(order),
      lines: order.lines.map((line) => {
        const item = state.catalog.items.find(candidate => candidate.product_retailer_id === line.product_retailer_id)
        return { product_retailer_id: line.product_retailer_id, product: commerceProduct(state, item), quantity: line.quantity, item_price: line.cart_price, currency: 'SAR' }
      }),
    },
  })
  order.message_id = message.id
  return { order, message }
}

function buildLines(state, order, requested) {
  const lines = []
  for (const entry of requested) {
    if ('id' in entry) {
      const current = order.lines.find(line => line.id === entry.id)
      if (!current) return { refusal: fail(422, 'invalid', 'بند غير موجود في السلة', 'lines') }
      lines.push({ ...current, quantity: entry.quantity })
    } else {
      const made = lineFromItem(state, entry.catalog_item_id, entry.quantity)
      if (!made) return { refusal: fail(422, 'invalid', 'منتج غير موجود في الكتالوج', 'lines') }
      lines.push({ id: state.catalog.ids.line++, ...made })
    }
  }
  return { lines }
}

const WINDOW_OPEN = conv => !!conv.reply_window_ends_at && Date.parse(conv.reply_window_ends_at) > Date.now()

function checkout(state, order, body, ctx) {
  const conv = state.conversations.find(item => item.id === order.conversation_id)
  if (order.state === 'dismissed') return fail(409, 'order_locked', 'السلة متجاهَلة')
  if (order.state === 'cart' && order.lines.some(line => !state.catalog.items.some(item => item.product_retailer_id === line.product_retailer_id))) return fail(422, 'invalid', 'في السلة منتج غير معروف', 'lines')
  if (order.payment?.status === 'paid') return fail(409, 'not_payable', 'الطلب مدفوع')
  const open = WINDOW_OPEN(conv)
  if (!open) {
    if (!body.template_id) return fail(409, 'window_closed', 'انتهت نافذة الرد، اختر قالب رابط دفع')
    const template = state.templates.find(item => item.id === body.template_id)
    if (!template || template.status !== 'approved' || !template.buttons.some(button => button.type === 'url' && button.url.includes('/pay/order/') && button.url.endsWith('{{1}}'))) return fail(422, 'invalid', 'القالب لا يصلح لرابط الدفع', 'template_id')
  }
  if (order.state === 'cart') {
    order.state = 'ordered'
    order.reference = `S${String(state.catalog.ids.reference++).padStart(5, '0')}`
    order.payment = { status: 'payable', refund_due: false, needs_attention: false, currency: 'SAR', amount_total: 0, amount_due: 0, expires_at: iso(Date.now() + HOUR) }
  }
  const summary = body.body ?? `طلبك ${order.reference}: ${order.lines.length} بنود`
  const message = ctx.appendMessage(conv, open
    ? { kind: 'interactive', body: summary, interactive: { type: 'cta_url', body: summary, header: null, footer: null, display_text: 'ادفع الآن', url: `https://app.example.test/pay/order/${order.id}` } }
    : { kind: 'template', body: summary, template: { name: state.templates.find(item => item.id === body.template_id).name, header_text: null, footer: null, buttons: [{ type: 'url', text: 'ادفع الآن' }] } })
  order.pay_link_sent_at = message.created_at
  return ok({ order: orderOut(state, order), message_id: message.id })
}

function settle(state, order, ctx, status) {
  const conv = state.conversations.find(item => item.id === order.conversation_id)
  order.payment = { ...order.payment, status }
  ctx.appendMessage(conv, { direction: 'note', author: null, delivery_state: 'sent', body: status === 'paid' ? `تم دفع الطلب ${order.reference}` : `أُلغي الطلب ${order.reference}` })
}

function orderList(state, url, conversationId) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const wanted = { state: url.searchParams.get('state'), payment: url.searchParams.get('payment_status'), channel: Number(url.searchParams.get('channel_id')) || null }
  const items = state.catalog.orders
    .map(order => orderOut(state, order))
    .filter(order => conversationId === undefined || order.conversation_id === conversationId)
    .filter(order => !wanted.state || order.state === wanted.state)
    .filter(order => !wanted.payment || order.payment?.status === wanted.payment)
    .filter(order => !wanted.channel || order.channel.id === wanted.channel)
    .filter(order => !q || order.contact.name.toLowerCase().includes(q) || (order.reference ?? '').toLowerCase().includes(q))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
  return ok({ items: conversationId === undefined ? items.slice(offset, offset + limit) : items, total: items.length })
}

function orderRoute(state, method, parts, url, body, ctx) {
  if (parts[4] === undefined) return method === 'GET' ? orderList(state, url) : undefined
  const order = state.catalog.orders.find(item => item.id === Number(parts[4]))
  if (!order) return fail(404, 'not_found', 'not found')
  if (parts[5] === 'checkout' && method === 'POST') return checkout(state, order, body, ctx)
  if (parts[5] === 'cancel' && method === 'POST') {
    if (order.state === 'cart') order.state = 'dismissed'
    else if (order.payment?.status === 'payable') settle(state, order, ctx, 'cancelled')
    else return fail(409, 'not_payable', 'لا يمكن إلغاء هذا الطلب')
    return ok(orderOut(state, order))
  }
  if (method === 'GET') return ok(orderOut(state, order))
  if (method === 'PATCH') {
    if (order.state !== 'cart') return fail(409, 'order_locked', 'لا يُعدَّل إلا السلة')
    const built = buildLines(state, order, body.lines ?? [])
    if (built.refusal) return built.refusal
    order.lines = built.lines
    return ok(orderOut(state, order))
  }
  return undefined
}

function conversationOrders(state, method, conv, body, url, me) {
  if (method === 'GET') return orderList(state, url, conv.id)
  if (method !== 'POST') return undefined
  const lines = []
  for (const entry of body.lines ?? []) {
    const made = lineFromItem(state, entry.catalog_item_id, entry.quantity)
    if (!made) return fail(422, 'invalid', 'منتج غير موجود في الكتالوج', 'lines')
    lines.push(made)
  }
  if (!lines.length) return fail(422, 'invalid', 'أضف بندًا واحدًا على الأقل', 'lines')
  return { status: 201, body: orderOut(state, newOrder(state, conv, lines, { created_by: { id: me.id, name: me.name } })) }
}

/** Mock-only controls: a customer's cart webhook and a gateway payment. `/api/v1/inbox/__mock/...` */
function mockRoute(state, method, parts, body, ctx) {
  if (method !== 'POST') return undefined
  if (parts[4] === 'conversations' && parts[6] === 'cart') {
    const conv = state.conversations.find(item => item.id === Number(parts[5]))
    if (!conv) return fail(404, 'not_found', 'not found')
    const { order, message } = receiveCart(state, conv, body.lines ?? [], body.text, ctx.appendInbound)
    return ok({ order: orderOut(state, order), message_id: message.id })
  }
  if (parts[4] === 'orders' && parts[6] === 'paid') {
    const order = state.catalog.orders.find(item => item.id === Number(parts[5]))
    if (!order || order.payment?.status !== 'payable') return fail(409, 'not_payable', 'الطلب غير قابل للدفع')
    settle(state, order, ctx, 'paid')
    return ok(orderOut(state, order))
  }
  return undefined
}

/** Fills the `order` summary of cart messages from the live order, before a thread is read. */
export function decorateCarts(state, messages) {
  for (const item of messages) {
    if (item.commerce?.type !== 'order') continue
    const order = state.catalog.orders.find(candidate => candidate.message_id === item.id)
    item.commerce.order = order ? summaryOf(order) : null
  }
}

/**
 * Answers a catalog route, or returns undefined for a path this module does not own. `ctx` carries the inbox helpers
 * (`appendMessage`, `appendInbound`) so a mutation lands in the same threads the inbox serves.
 */
export function catalogPreviewRoute(state, method, parts, url, body, ctx) {
  settleItems(state)
  const resource = parts[3]
  if (resource === 'catalogs') return catalogRoute(state, method, parts, url, body)
  if (resource === 'catalog-items') return itemRoute(state, method, parts, body)
  if (resource === 'orders') return orderRoute(state, method, parts, url, body, ctx)
  if (resource === '__mock') return mockRoute(state, method, parts, body, ctx)
  if (resource === 'channels' && parts[5] === 'commerce' && (method === 'GET' || method === 'PATCH')) return channelCommerce(state, method, Number(parts[4]), body)
  if (resource === 'conversations' && parts[4] && (parts[5] === 'catalog-items' || parts[5] === 'orders')) {
    const conv = state.conversations.find(item => item.id === Number(parts[4]))
    if (!conv) return fail(404, 'not_found', 'not found')
    if (parts[5] === 'catalog-items') return method === 'GET' ? conversationPick(state, url) : undefined
    return conversationOrders(state, method, conv, body, url, ctx.me)
  }
  return undefined
}

/** The seed thread of the conversation that shows the commerce cards: a product list, an inquiry and a cart. */
export function seedCommerceThread(state, conv, message) {
  const catalog = state.catalog.catalogs[0]
  const picks = [state.catalog.items[0], state.catalog.items[1], state.catalog.items[3]]
  const sent = message('out', 'اختر من منتجاتنا', 0.9, {
    kind: 'product_list', author: { id: 5, name: 'نورة الحربي' }, delivery_state: 'delivered',
    commerce: {
      type: 'sent', catalog_id: catalog.meta_catalog_id,
      content: { type: 'product_list', header: 'منتجات مختارة', body: 'اختر من منتجاتنا', footer: null, sections: [{ title: 'المنتجات', product_retailer_ids: picks.map(item => item.product_retailer_id) }] },
      products: picks.map(item => ({ product_retailer_id: item.product_retailer_id, product: commerceProduct(state, item) })),
    },
  })
  const inquiry = message('in', 'هل متوفر بلون آخر؟', 0.7, { commerce: { type: 'inquiry', catalog_id: catalog.meta_catalog_id, product_retailer_id: 'wv-102', product: commerceProduct(state, state.catalog.items[1]) } })
  const cartMessage = message('in', '', 0.5, { kind: 'order', commerce: null })
  const order = newOrder(state, conv, [
    { product_retailer_id: 'wv-101', quantity: 2, cart_price: 50.4 },
    { product_retailer_id: 'wv-102', quantity: 1, cart_price: priceOf(catalog, state.catalog.items[1]) },
    { product_retailer_id: 'wv-999', quantity: 1, cart_price: 10 },
  ], { message_id: cartMessage.id })
  cartMessage.commerce = {
    type: 'order', catalog_id: catalog.meta_catalog_id, text: 'أريد هذه المنتجات', order: summaryOf(order),
    lines: order.lines.map((line) => {
      const item = state.catalog.items.find(candidate => candidate.product_retailer_id === line.product_retailer_id)
      return { product_retailer_id: line.product_retailer_id, product: commerceProduct(state, item), quantity: line.quantity, item_price: line.cart_price, currency: 'SAR' }
    }),
  }
  cartMessage.body = 'أريد هذه المنتجات'
  return [sent, inquiry, cartMessage]
}
