// Synthetic Customer Inbox API for the isolated UI mock (internal-ui-audit-mock.mjs). Never reads or writes Odoo data.
// Every response is shaped like packages/contracts/src/inbox; app/composables/inbox/__tests__/inboxMockContract.test.ts
// parses them with the contract schemas, so the mock cannot drift from the wire shape.

export const INBOX_CAPABILITIES = [
  'inbox.conversations.read', 'inbox.conversations.reply', 'inbox.conversations.assign', 'inbox.conversations.export',
  'inbox.channels.manage', 'inbox.settings.manage',
]
export const INBOX_FEATURES = ['inbox.enabled', 'inbox.whatsapp']

const ME = { id: 2, name: 'Admin' }
const AGENTS = [{ id: 5, name: 'نورة الحربي' }, { id: 6, name: 'سارة محمد' }]
const HOUR = 3_600_000
const iso = ms => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
const ago = hours => iso(Date.now() - hours * HOUR)

function seed() {
  const departments = [
    { id: 1, name: 'الاستقبال', members: [AGENTS[0]] },
    { id: 2, name: 'المبيعات', members: [AGENTS[1]] },
  ]
  const tags = [{ id: 1, name: 'شكوى' }, { id: 2, name: 'حجز' }, { id: 3, name: 'استفسار' }]
  const channels = [{
    id: 1, name: 'واتساب الاستقبال', kind: 'whatsapp', state: 'connected', department: { id: 1, name: 'الاستقبال' },
    phone_number_id: '109876543210987', business_account_id: '203456789012345', has_access_token: true, has_app_secret: true,
    verify_token: 'mock-verify-token-4f9c2a', callback_url: 'https://app.example.test/api/v1/inbox/hooks/whatsapp',
    last_error: null, last_event_at: ago(0.2),
  }]
  const contacts = [
    { id: 1, name: 'ليلى القحطاني', phone: '+966500000001', email: null },
    { id: 2, name: 'فهد الدوسري', phone: '+966500000002', email: 'fahad@example.test' },
    { id: 3, name: 'منى العتيبي', phone: '+966500000003', email: null },
    { id: 4, name: 'خالد الشمري', phone: '+966500000004', email: null },
  ]
  const conversation = (id, contact, rest) => ({
    id, contact, channel: { id: 1, name: channels[0].name, kind: 'whatsapp' }, department: null, assignee: null, state: 'open', priority: 'normal', tags: [],
    last_message_at: null, last_message_preview: null, unread: false, reply_window_ends_at: null, ...rest,
  })
  const conversations = [
    conversation(1, contacts[0], { assignee: ME, department: { id: 1, name: 'الاستقبال' }, tags: [tags[1]], unread: true, reply_window_ends_at: iso(Date.now() + 20 * HOUR) }),
    conversation(2, contacts[1], { state: 'pending', priority: 'high', department: { id: 2, name: 'المبيعات' }, reply_window_ends_at: ago(30) }),
    conversation(3, contacts[2], { state: 'resolved', assignee: AGENTS[0], department: { id: 1, name: 'الاستقبال' }, tags: [tags[2]], reply_window_ends_at: iso(Date.now() + 2 * HOUR) }),
    conversation(4, contacts[3], { priority: 'urgent', tags: [tags[0]], reply_window_ends_at: iso(Date.now() + 6 * HOUR) }),
  ]
  const attachment = { id: 1, name: 'نتيجة-الفحص.pdf', mimetype: 'application/pdf', size: 20480 }
  const media = {
    image: { id: 2, name: 'مدخل-العيادة.jpg', mimetype: 'image/jpeg', size: 184320 },
    audio: { id: 3, name: 'رسالة-صوتية.ogg', mimetype: 'audio/ogg', size: 48000 },
    video: { id: 4, name: 'جولة-في-المكان.mp4', mimetype: 'video/mp4', size: 912000 },
    sticker: { id: 5, name: 'sticker.webp', mimetype: 'image/webp', size: 9000 },
    outgoingDocument: { id: 6, name: 'قائمة-الأسعار.pdf', mimetype: 'application/pdf', size: 335872 },
  }
  let nextMessageId = 100
  const message = (direction, body, hoursAgo, extra = {}) => ({
    id: nextMessageId++, direction, kind: 'text', body, author: direction === 'in' ? null : AGENTS[0], template_name: null,
    delivery_state: direction === 'in' ? 'received' : 'sent', error: null, attachments: [], reply_to: null,
    reactions: { customer: null, agent: null }, location: null, interactive: null, selected_option: null, created_at: ago(hoursAgo), ...extra,
  })
  const quote = target => ({ id: target.id, preview: target.body.slice(0, 80) })
  const first = message('in', 'السلام عليكم، أريد حجز موعد يوم الخميس.', 3)
  const answer = message('out', 'وعليكم السلام ورحمة الله، يسعدنا خدمتك. هل الفترة الصباحية مناسبة؟', 2.8, { delivery_state: 'read', author: ME, reply_to: quote(first), reactions: { customer: '👍', agent: null } })
  const confirmation = message('out', 'هل تؤكد حجز الخميس الساعة 10 صباحًا؟', 2.0, {
    kind: 'interactive', delivery_state: 'read', author: ME,
    interactive: { type: 'buttons', body: 'هل تؤكد حجز الخميس الساعة 10 صباحًا؟', header: 'تأكيد الموعد', footer: 'عيادة الأمل', buttons: [{ id: 'btn_1', title: 'نعم، أؤكد' }, { id: 'btn_2', title: 'تغيير الموعد' }] },
  })
  const chosen = message('in', 'نعم، أؤكد', 1.9, { kind: 'interactive', reply_to: quote(confirmation), selected_option: { id: 'btn_1', title: 'نعم، أؤكد' } })
  const messages = {
    1: [
      first,
      answer,
      message('note', 'العميلة لديها ملف قديم، راجعوا الموعد السابق.', 2.7, { author: ME }),
      message('in', 'هذه صورة مدخل المبنى', 2.6, { kind: 'image', attachments: [media.image] }),
      message('in', '', 2.55, { kind: 'location', location: { latitude: 24.7136, longitude: 46.6753, name: 'موقع العميلة', address: 'الرياض، حي الملقا' } }),
      message('in', 'محمد العتيبي: +966500000009', 2.5, { kind: 'contacts' }),
      message('in', '', 2.4, { kind: 'audio', attachments: [media.audio] }),
      message('in', 'فيديو قصير للمكان', 2.3, { kind: 'video', attachments: [media.video] }),
      message('in', '', 2.2, { kind: 'sticker', attachments: [media.sticker] }),
      confirmation,
      chosen,
      message('out', 'اختر الفرع الأنسب لك', 1.8, {
        kind: 'interactive', author: ME, delivery_state: 'delivered',
        interactive: {
          type: 'list', body: 'اختر الفرع الأنسب لك', header: null, footer: null, button: 'الفروع',
          sections: [{ title: 'الرياض', rows: [{ id: 'row_1', title: 'فرع الملقا', description: 'من 9 صباحًا حتى 5 مساءً' }, { id: 'row_2', title: 'فرع العليا', description: null }] }, { title: 'جدة', rows: [{ id: 'row_3', title: 'فرع الحمراء', description: null }] }],
        },
      }),
      message('out', 'للاطلاع على التعليمات قبل الموعد', 1.7, {
        kind: 'interactive', author: ME, delivery_state: 'sent',
        interactive: { type: 'cta_url', body: 'للاطلاع على التعليمات قبل الموعد', header: null, footer: null, display_text: 'التعليمات', url: 'https://example.test/instructions' },
      }),
      message('out', '', 1.6, { kind: 'location', author: ME, delivery_state: 'delivered', location: { latitude: 24.69, longitude: 46.72, name: 'عيادة الأمل', address: 'الرياض، طريق الملك فهد' } }),
      message('out', 'مرفق قائمة الأسعار', 1.4, { kind: 'document', author: ME, delivery_state: 'read', attachments: [media.outgoingDocument], reactions: { customer: '🙏', agent: '❤️' } }),
      message('in', 'نعم الصباح مناسب جدًا، وهذا تقرير الفحص السابق.', 0.5, { attachments: [attachment], kind: 'document' }),
    ],
    2: [
      message('in', 'هل المنتج متوفر بلون آخر؟', 40),
      message('out', 'سنتحقق ونعود إليك.', 39, { delivery_state: 'delivered' }),
      message('out', 'تأكيد توفر اللون الأزرق.', 38, { delivery_state: 'failed', error: 'انتهت نافذة الرد: يلزم إرسال قالب معتمد.' }),
    ],
    3: [message('in', 'شكرًا لكم على الخدمة.', 5), message('out', 'العفو، سعداء بخدمتك.', 4.9, { delivery_state: 'delivered' })],
    4: [message('in', 'أحتاج مساعدة عاجلة في طلبي رقم 4521.', 1)],
  }
  for (const c of conversations) {
    const last = messages[c.id].at(-1)
    c.last_message_at = last.created_at
    c.last_message_preview = last.body.slice(0, 140)
  }
  const templates = [
    { id: 1, name: 'appointment_reminder', language: 'ar', category: 'UTILITY', status: 'APPROVED', body: 'مرحبًا {{1}}، نذكّرك بموعدك يوم {{2}}.', param_count: 2 },
    { id: 2, name: 'follow_up', language: 'ar', category: 'MARKETING', status: 'APPROVED', body: 'نشكرك على تواصلك. هل يمكننا مساعدتك في شيء آخر؟', param_count: 0 },
  ]
  const canned = [
    { id: 1, shortcut: 'hello', body: 'أهلًا بك، كيف يمكنني مساعدتك؟' },
    { id: 2, shortcut: 'hours', body: 'ساعات العمل من 9 صباحًا حتى 5 مساءً، من الأحد إلى الخميس.' },
  ]
  return {
    settings: { visibility_policy: 'department', auto_close_hours: 72, retention_months: 24 },
    departments, tags, channels, contacts, conversations, messages, templates, canned,
    ids: { department: 3, tag: 4, canned: 3, channel: 2, upload: 100, message: () => nextMessageId++ },
    statuses: new Map(),
    // Files uploaded to a conversation and not yet sent: attachment id -> { conversationId, attachment }.
    uploads: new Map(),
  }
}

let state = seed()

const PRESETS = {
  clinic: { departments: ['الاستقبال', 'المواعيد'], tags: ['حجز', 'إلغاء', 'استفسار'], canned: [['appointment', 'يسعدنا حجز موعدك، ما اليوم الأنسب لك؟']], policy: 'department' },
  store: { departments: ['المبيعات', 'الدعم'], tags: ['طلب', 'شكوى', 'استرجاع'], canned: [['order', 'يرجى تزويدنا برقم الطلب لنتحقق منه.']], policy: 'department' },
  public_service: { departments: ['الخدمات'], tags: ['معاملة', 'شكوى'], canned: [['status', 'يمكنك متابعة حالة معاملتك برقمها.']], policy: 'assigned_only', retention: 60 },
}

const ok = body => ({ status: 200, body })
const fail = (status, code, message, field) => ({ status, body: { code, message, ...(field ? { field } : {}) } })
const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
  return { items: items.slice(offset, offset + limit), total: items.length }
}
const list = items => ({ items, total: items.length })
const segments = path => path.split('/').filter(Boolean)
const WINDOW_OPEN = conv => !!conv.reply_window_ends_at && Date.parse(conv.reply_window_ends_at) > Date.now()
const detail = conv => ({ ...conv, can_reply: true, can_assign: true })
const renderTemplate = (body, params) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, index) => params[Number(index) - 1] ?? '')

function conversationList(url) {
  const q = (url.searchParams.get('q') ?? '').trim()
  const assignee = url.searchParams.get('assignee')
  const wanted = {
    state: url.searchParams.get('state'),
    department: Number(url.searchParams.get('department_id')) || null,
  }
  const items = state.conversations
    .filter(c => !wanted.state || c.state === wanted.state)
    .filter(c => !wanted.department || c.department?.id === wanted.department)
    .filter(c => !assignee || (assignee === 'me' ? c.assignee?.id === ME.id : assignee === 'unassigned' ? !c.assignee : c.assignee?.id === Number(assignee)))
    .filter(c => !q || [c.contact.name, c.contact.phone, c.last_message_preview].some(text => text?.includes(q)))
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))
  return page(items, url)
}

function patchConversation(conv, body) {
  if ('assignee_id' in body) {
    if (body.assignee_id === null) conv.assignee = null
    else {
      const person = [ME, ...AGENTS].find(item => item.id === body.assignee_id)
      if (!person) return fail(422, 'invalid', 'المسؤول يجب أن يكون موظفًا يملك صلاحية الرد', 'assignee_id')
      conv.assignee = person
    }
  }
  if ('department_id' in body) {
    const department = state.departments.find(item => item.id === body.department_id)
    conv.department = department ? { id: department.id, name: department.name } : null
  }
  if (body.state) conv.state = body.state
  if (body.priority) conv.priority = body.priority
  if (body.tag_ids) conv.tags = state.tags.filter(tag => body.tag_ids.includes(tag.id))
  return ok(detail(conv))
}

function appendMessage(conv, fields) {
  const created = {
    id: state.ids.message(), direction: 'out', kind: 'text', body: '', author: ME, template_name: null, delivery_state: 'queued', error: null, attachments: [],
    reply_to: null, reactions: { customer: null, agent: null }, location: null, interactive: null, selected_option: null, created_at: iso(Date.now()), ...fields,
  }
  state.messages[conv.id].push(created)
  if (created.direction === 'out') {
    conv.last_message_at = created.created_at
    conv.last_message_preview = (created.body || created.kind).slice(0, 140)
    state.statuses.set(created.id, Date.now())
  }
  return created
}

const MIB = 1024 * 1024
const GENERIC_MEDIA = { image: ['image/jpeg', 'image/png'], video: ['video/mp4', 'video/3gpp'], audio: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'] }
const kindOfMimetype = mimetype => {
  const family = mimetype.split('/')[0]
  return family in GENERIC_MEDIA && GENERIC_MEDIA[family].includes(mimetype) ? family : 'document'
}

// Same refusals as the upload route: unsupported media type 422, over the cap 413 (images 5 MB, others 10 MiB), created 201.
function upload(conv, body) {
  const { name, mimetype, data } = body
  if (!name || !mimetype || !data) return fail(422, 'invalid', 'name, mimetype and data are required')
  const family = mimetype.split('/')[0]
  if (family in GENERIC_MEDIA && !GENERIC_MEDIA[family].includes(mimetype)) return fail(422, 'invalid', 'نوع الملف غير مدعوم', 'mimetype')
  const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
  if (size > (family === 'image' ? 5 : 10) * MIB) return fail(413, 'payload_too_large', 'الملف أكبر من الحد المسموح')
  const attachment = { id: state.ids.upload++, name, mimetype, size }
  state.uploads.set(attachment.id, { conversationId: conv.id, attachment })
  return { status: 201, body: attachment }
}

function interactiveProblem(interactive) {
  const rows = interactive.type === 'list' ? interactive.sections.reduce((total, section) => total + section.rows.length, 0) : 0
  if (interactive.type === 'buttons' && interactive.buttons.length > 3) return 'buttons'
  if (rows > 10) return 'sections'
  return null
}

function reply(conv, body) {
  const free = ['body', 'attachment_id', 'location', 'interactive'].some(key => key in body)
  if (free && !WINDOW_OPEN(conv)) return fail(422, 'invalid', 'انتهت نافذة الرد الحر، أرسل قالبًا معتمدًا')
  let quoted = null
  if (body.reply_to_id !== undefined) {
    const target = state.messages[conv.id].find(item => item.id === body.reply_to_id)
    if (!target) return fail(422, 'invalid', 'الرسالة المردود عليها ليست من هذه المحادثة', 'reply_to_id')
    quoted = { id: target.id, preview: target.body.slice(0, 80) }
  }
  if (typeof body.body === 'string') {
    if (!body.body.trim()) return fail(422, 'invalid', 'الرسالة فارغة', 'body')
    return ok(appendMessage(conv, { body: body.body.trim(), reply_to: quoted }))
  }
  if ('attachment_id' in body) {
    const held = state.uploads.get(body.attachment_id)
    if (!held || held.conversationId !== conv.id) return fail(422, 'invalid', 'المرفق غير موجود في هذه المحادثة', 'attachment_id')
    if (body.caption && held.attachment.mimetype.startsWith('audio/')) return fail(422, 'invalid', 'لا يسمح بتعليق على ملف صوتي', 'caption')
    state.uploads.delete(body.attachment_id)
    return ok(appendMessage(conv, { kind: kindOfMimetype(held.attachment.mimetype), body: body.caption ?? '', attachments: [held.attachment], reply_to: quoted }))
  }
  if (body.location) return ok(appendMessage(conv, { kind: 'location', location: body.location, reply_to: quoted }))
  if (body.interactive) {
    if (interactiveProblem(body.interactive)) return fail(422, 'invalid', 'حدود الرسالة التفاعلية', 'interactive')
    return ok(appendMessage(conv, { kind: 'interactive', body: body.interactive.body, interactive: body.interactive, reply_to: quoted }))
  }
  const template = state.templates.find(item => item.id === body.template_id)
  if (!template) return fail(422, 'invalid', 'القالب غير موجود لهذه القناة', 'template_id')
  if ((body.params ?? []).length !== template.param_count) return fail(422, 'invalid', 'عدد المتغيرات غير صحيح', 'params')
  return ok(appendMessage(conv, { kind: 'template', body: renderTemplate(template.body, body.params), template_name: template.name }))
}

function react(item, body) {
  const conv = state.conversations.find(candidate => state.messages[candidate.id].includes(item))
  if (item.direction === 'note') return fail(422, 'invalid', 'لا يمكن التفاعل مع ملاحظة', 'emoji')
  if (!WINDOW_OPEN(conv)) return fail(422, 'invalid', 'انتهت نافذة الرد الحر')
  item.reactions = { ...item.reactions, agent: body.emoji || null }
  return ok(item)
}

// A queued message becomes "sent" a moment after it is created, as the outbox cron would do.
function settleStatuses(conv) {
  for (const item of state.messages[conv.id]) {
    if (item.delivery_state === 'queued' && Date.now() - (state.statuses.get(item.id) ?? 0) > 1500) item.delivery_state = 'sent'
  }
}

function applyPreset(key) {
  const preset = PRESETS[key]
  for (const name of preset.departments) if (!state.departments.some(item => item.name === name)) state.departments.push({ id: state.ids.department++, name, members: [] })
  for (const name of preset.tags) if (!state.tags.some(item => item.name === name)) state.tags.push({ id: state.ids.tag++, name })
  for (const [shortcut, body] of preset.canned) if (!state.canned.some(item => item.shortcut === shortcut)) state.canned.push({ id: state.ids.canned++, shortcut, body })
  state.settings.visibility_policy = preset.policy
  if (preset.retention) state.settings.retention_months = preset.retention
}

const nameOf = id => [ME, ...AGENTS].find(item => item.id === id)?.name ?? `#${id}`

function crud(collection, method, id, body, make) {
  if (method === 'GET' && id === undefined) return ok(list(state[collection]))
  if (method === 'POST' && id === undefined) {
    const created = make(body)
    state[collection].push(created)
    return ok(created)
  }
  const index = state[collection].findIndex(item => item.id === id)
  if (index < 0) return fail(404, 'not_found', 'not found')
  if (method === 'GET') return ok(state[collection][index])
  if (method === 'DELETE') {
    state[collection].splice(index, 1)
    return { status: 204, body: undefined }
  }
  if (method === 'PATCH') {
    state[collection][index] = make(body, state[collection][index])
    return ok(state[collection][index])
  }
  return fail(404, 'not_found', 'not found')
}

function channelRoute(method, parts, body) {
  const id = parts[4] ? Number(parts[4]) : undefined
  const action = parts[5] === 'templates' && parts[6] === 'sync' ? 'sync' : parts[5]
  if (method === 'GET' && action === 'templates') return ok(list(state.templates.filter(item => item.status === 'APPROVED')))
  const channel = state.channels.find(item => item.id === id)
  if (id !== undefined && !channel) return fail(404, 'not_found', 'not found')
  if (method === 'POST' && action === 'test') { channel.state = 'connected'; channel.last_error = null; return ok(channel) }
  if (method === 'POST' && action === 'sync') return ok(list(state.templates))
  const department = value => value ? { id: value, name: state.departments.find(item => item.id === value)?.name ?? '' } : null
  return crud('channels', method, id, body, (input, current) => ({
    id: current?.id ?? state.ids.channel++,
    name: input.name ?? current.name, kind: 'whatsapp', state: input.state ?? current?.state ?? 'draft',
    department: 'department_id' in input ? department(input.department_id) : current?.department ?? null,
    phone_number_id: current?.phone_number_id ?? input.phone_number_id, business_account_id: current?.business_account_id ?? input.business_account_id,
    has_access_token: current?.has_access_token || !!input.access_token, has_app_secret: current?.has_app_secret || !!input.app_secret,
    verify_token: current?.verify_token ?? `mock-verify-token-${state.ids.channel}`, callback_url: 'https://app.example.test/api/v1/inbox/hooks/whatsapp',
    last_error: current?.last_error ?? null, last_event_at: current?.last_event_at ?? null,
  }))
}

const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#d7e6f5"/><circle cx="130" cy="110" r="38" fill="#f2c94c"/><path d="M0 320 150 170l90 90 80-70 160 130z" fill="#5b8db8"/></svg>'

// The file of an attachment: a drawn picture for images, a tiny PDF otherwise.
function downloadOf(messageId, attachmentId) {
  const item = Object.values(state.messages).flat().find(candidate => candidate.id === messageId)
  const attachment = item?.attachments.find(candidate => candidate.id === attachmentId)
  if (attachment?.mimetype.startsWith('image/')) return { filename: 'file.svg', mime: 'image/svg+xml', body: PICTURE }
  return { filename: 'file.pdf', mime: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' }
}

/** Answers an inbox route, or returns undefined for a path this module does not own. `{ status, body }` or `{ file }`. */
export function inboxPreviewData(method, path, url, body = {}) {
  const parts = segments(path)
  if (parts[2] === 'settings' && parts[3] === 'inbox') {
    if (parts[4] === 'presets' && method === 'POST') {
      if (!PRESETS[parts[5]]) return fail(404, 'not_found', 'unknown preset')
      applyPreset(parts[5])
      return ok(state.settings)
    }
    if (method === 'PATCH') Object.assign(state.settings, body)
    return ok(state.settings)
  }
  if (parts[2] !== 'inbox') return undefined
  const resource = parts[3]
  const id = parts[4] && /^\d+$/.test(parts[4]) ? Number(parts[4]) : undefined

  if (resource === 'conversations') {
    if (parts[4] === 'export.csv') return { file: { filename: 'conversations.csv', body: 'id,contact,state\n' + state.conversations.map(c => `${c.id},${c.contact.name},${c.state}`).join('\n') + '\n' } }
    if (id === undefined) return method === 'GET' ? ok(conversationList(url)) : undefined
    const conv = state.conversations.find(item => item.id === id)
    if (!conv) return fail(404, 'not_found', 'not found')
    if (parts[5] === 'messages') {
      if (method === 'POST') return reply(conv, body)
      settleStatuses(conv)
      const all = state.messages[conv.id]
      const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
      const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
      return ok({ items: all.slice(Math.max(0, all.length - offset - limit), all.length - offset), total: all.length })
    }
    if (parts[5] === 'uploads' && method === 'POST') return upload(conv, body)
    if (parts[5] === 'typing' && method === 'POST') return { status: 204, body: undefined }
    if (parts[5] === 'notes' && method === 'POST') {
      if (!String(body.body ?? '').trim()) return fail(422, 'invalid', 'الملاحظة فارغة', 'body')
      return ok(appendMessage(conv, { direction: 'note', body: body.body.trim(), delivery_state: 'sent' }))
    }
    if (parts[5] === 'read' && method === 'POST') {
      conv.unread = false
      return { status: 204, body: undefined }
    }
    if (method === 'PATCH') return patchConversation(conv, body)
    return ok(detail(conv))
  }
  if (resource === 'messages' && id !== undefined) {
    if (parts[5] === 'retry' && method === 'POST') {
      const item = Object.values(state.messages).flat().find(candidate => candidate.id === id)
      if (!item || item.delivery_state !== 'failed') return fail(422, 'invalid', 'only a failed message can be retried')
      Object.assign(item, { delivery_state: 'queued', error: null })
      state.statuses.set(item.id, Date.now())
      return ok(item)
    }
    if (parts[5] === 'attachments' && parts[7] === 'download') return { file: downloadOf(id, Number(parts[6])) }
    if (parts[5] === 'reaction' && method === 'POST') {
      const item = Object.values(state.messages).flat().find(candidate => candidate.id === id)
      return item ? react(item, body) : fail(404, 'not_found', 'not found')
    }
    return undefined
  }
  if (resource === 'contacts' && id !== undefined && method === 'PATCH') {
    const contact = state.contacts.find(item => item.id === id)
    if (!contact) return fail(404, 'not_found', 'not found')
    Object.assign(contact, body)
    for (const conv of state.conversations) if (conv.contact.id === id) conv.contact = { ...contact }
    return ok(contact)
  }
  if (resource === 'agents' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim()
    return ok(page([ME, ...AGENTS].filter(agent => !q || agent.name.includes(q)), url))
  }
  if (resource === 'canned-replies') return crud('canned', method, id, body, (input, current) => ({ id: current?.id ?? state.ids.canned++, shortcut: input.shortcut ?? current.shortcut, body: input.body ?? current.body }))
  if (resource === 'tags') return crud('tags', method, id, body, (input, current) => ({ id: current?.id ?? state.ids.tag++, name: input.name ?? current.name }))
  if (resource === 'departments') {
    return crud('departments', method, id, body, (input, current) => ({
      id: current?.id ?? state.ids.department++, name: input.name ?? current.name,
      members: (input.member_ids ?? current?.members.map(member => member.id) ?? []).map(member => ({ id: member, name: nameOf(member) })),
    }))
  }
  if (resource === 'channels') return channelRoute(method, parts, body)
  return undefined
}

/** Test hook: back to the seed data, so specs start from a known inbox. */
export function resetInboxPreview() {
  state = seed()
}
