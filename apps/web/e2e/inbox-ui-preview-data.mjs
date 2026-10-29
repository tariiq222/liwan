// Synthetic Customer Inbox API for the isolated UI mock (internal-ui-audit-mock.mjs). Never reads or writes Odoo data.
// Every response is shaped like packages/contracts/src/inbox; app/composables/inbox/__tests__/inboxMockContract.test.ts
// parses them with the contract schemas, so the mock cannot drift from the wire shape.

export const INBOX_CAPABILITIES = [
  'inbox.conversations.read', 'inbox.conversations.reply', 'inbox.conversations.assign', 'inbox.conversations.export',
  'inbox.channels.manage', 'inbox.settings.manage', 'inbox.templates.manage',
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
    phone_number_id: '109876543210987', business_account_id: '203456789012345', has_access_token: true, has_app_secret: true, app_id: '1234567890123',
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
    id: nextMessageId++, direction, kind: 'text', body, author: direction === 'in' ? null : AGENTS[0], template: null,
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
      message('out', 'مرحبًا فهد، نذكّرك بموعدك يوم الخميس.', 37, {
        kind: 'template', delivery_state: 'read',
        template: { name: 'appointment_reminder', header_text: 'تذكير بموعدك', footer: 'عيادة الأمل', buttons: [{ type: 'quick_reply', text: 'تأكيد الحضور' }, { type: 'url', text: 'إدارة الموعد' }] },
      }),
    ],
    3: [message('in', 'شكرًا لكم على الخدمة.', 5), message('out', 'العفو، سعداء بخدمتك.', 4.9, { delivery_state: 'delivered' })],
    4: [message('in', 'أحتاج مساعدة عاجلة في طلبي رقم 4521.', 1)],
  }
  for (const c of conversations) {
    const last = messages[c.id].at(-1)
    c.last_message_at = last.created_at
    c.last_message_preview = last.body.slice(0, 140)
  }
  const sample = { id: 7, name: 'عينة-العيادة.jpg', mimetype: 'image/jpeg', size: 90000 }
  const template = (id, name, rest) => ({
    id, name, language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green', header: null,
    body: 'نشكرك على تواصلك.', body_examples: [], footer: null, buttons: [], add_security_recommendation: false, code_expiration_minutes: null,
    param_count: 0, editable: true, otp_button_text: null, supported: true, ...rest,
  })
  const templates = [
    template(1, 'appointment_reminder', {
      header: { type: 'text', text: 'تذكير بموعدك', example: null }, body: 'مرحبًا {{1}}، نذكّرك بموعدك يوم {{2}}.', body_examples: ['فهد', 'الخميس'], param_count: 2, footer: 'عيادة الأمل',
      buttons: [{ type: 'quick_reply', text: 'تأكيد الحضور' }, { type: 'url', text: 'إدارة الموعد', url: 'https://example.test/appointments/{{1}}', example: 'https://example.test/appointments/4521' }],
    }),
    template(2, 'follow_up', {
      category: 'marketing', quality: 'yellow', header: { type: 'image', example_attachment: sample },
      body: 'نشكرك على تواصلك. هل يمكننا مساعدتك في شيء آخر؟', buttons: [{ type: 'phone_number', text: 'اتصل بنا', phone_number: '+966112345678' }],
    }),
    template(3, 'summer_offer', {
      category: 'marketing', status: 'rejected', quality: 'unknown', status_reason: 'Meta: the variable at the start of the text is not allowed.',
      body: 'خصم {{1}} على جميع الخدمات هذا الأسبوع.', body_examples: ['20%'], param_count: 1,
    }),
    template(4, 'login_code', {
      category: 'authentication', body: '{{1}} هو رمز التحقق الخاص بك. حفاظًا على أمانك، لا تشارك هذا الرمز مع أحد.', param_count: 1,
      add_security_recommendation: true, code_expiration_minutes: 10, otp_button_text: 'نسخ الرمز',
    }),
    template(5, 'weekly_digest', { status: 'pending', quality: 'unknown', editable: false, body: 'ملخص أسبوعك: {{1}} طلبات جديدة.', body_examples: ['12'], param_count: 1 }),
    template(6, 'named_greeting', { supported: false, body: 'مرحبًا {{customer_name}}، شكرًا لزيارتك.' }),
  ]
  const canned = [
    { id: 1, shortcut: 'hello', body: 'أهلًا بك، كيف يمكنني مساعدتك؟' },
    { id: 2, shortcut: 'hours', body: 'ساعات العمل من 9 صباحًا حتى 5 مساءً، من الأحد إلى الخميس.' },
  ]
  return {
    settings: { visibility_policy: 'department', auto_close_hours: 72, retention_months: 24 },
    departments, tags, channels, contacts, conversations, messages, templates, canned,
    ids: { department: 3, tag: 4, canned: 3, channel: 2, template: 7, upload: 100, message: () => nextMessageId++ },
    statuses: new Map(),
    // Files uploaded to a conversation and not yet sent: attachment id -> { conversationId, attachment }.
    uploads: new Map(),
    // Sample files of template headers: attachment id -> attachment.
    samples: new Map(),
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
    id: state.ids.message(), direction: 'out', kind: 'text', body: '', author: ME, template: null, delivery_state: 'queued', error: null, attachments: [],
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
function newUpload(body) {
  const { name, mimetype, data } = body
  if (!name || !mimetype || !data) return { refusal: fail(422, 'invalid', 'name, mimetype and data are required') }
  const family = mimetype.split('/')[0]
  if (family in GENERIC_MEDIA && !GENERIC_MEDIA[family].includes(mimetype)) return { refusal: fail(422, 'invalid', 'نوع الملف غير مدعوم', 'mimetype') }
  const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
  if (size > (family === 'image' ? 5 : 10) * MIB) return { refusal: fail(413, 'payload_too_large', 'الملف أكبر من الحد المسموح') }
  return { attachment: { id: state.ids.upload++, name, mimetype, size } }
}

function upload(conv, body) {
  const { attachment, refusal } = newUpload(body)
  if (refusal) return refusal
  state.uploads.set(attachment.id, { conversationId: conv.id, attachment })
  return { status: 201, body: attachment }
}

// The sample file of a template header, kept for the template that references it.
function templateSample(body) {
  const { attachment, refusal } = newUpload(body)
  if (refusal) return refusal
  state.samples.set(attachment.id, attachment)
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
  return sendTemplate(conv, body)
}

// The buttons that take a value per message, by position: a url ending in a variable and a copy-code button.
const dynamicButtonIndexes = template => template.buttons.flatMap((button, index) => button.type === 'copy_code' || (button.type === 'url' && button.url.endsWith('{{1}}')) ? [index] : [])

// Same refusals as the reply route for a template: it must be approved and every parameter present and counted.
function sendTemplate(conv, body) {
  if ('reply_to_id' in body) return fail(422, 'invalid', 'القوالب لا تدعم الرد على رسالة', 'reply_to_id')
  const template = state.templates.find(item => item.id === body.template_id)
  if (!template) return fail(422, 'invalid', 'القالب غير موجود لهذه القناة', 'template_id')
  if (template.status !== 'approved') return fail(422, 'invalid', 'القالب غير معتمد بعد', 'template_id')
  if (!template.supported) return fail(422, 'invalid', 'القالب غير مدعوم في ويب فيو', 'template_id')
  if ((body.params ?? []).length !== template.param_count) return fail(422, 'invalid', 'عدد المتغيرات غير صحيح', 'params')
  const header = template.header
  let headerText = null
  let attachments = []
  let location = null
  if (header?.type === 'text') {
    headerText = header.text
    if (header.example !== null) {
      if (!body.header_param) return fail(422, 'invalid', 'قيمة الرأس مطلوبة', 'header_param')
      headerText = renderTemplate(header.text, [body.header_param])
    }
  } else if (header?.type === 'location') {
    if (!body.header_location) return fail(422, 'invalid', 'موقع الرأس مطلوب', 'header_location')
    location = body.header_location
  } else if (header) {
    const held = state.uploads.get(body.header_attachment_id)
    if (!held || held.conversationId !== conv.id) return fail(422, 'invalid', 'ملف الرأس غير موجود في هذه المحادثة', 'header_attachment_id')
    if (!held.attachment.mimetype.startsWith(`${header.type === 'document' ? 'application' : header.type}/`)) return fail(422, 'invalid', 'نوع ملف الرأس لا يطابق القالب', 'header_attachment_id')
    state.uploads.delete(body.header_attachment_id)
    attachments = [held.attachment]
  }
  const expected = dynamicButtonIndexes(template)
  const given = (body.button_params ?? []).map(item => item.index)
  if (expected.join() !== given.join()) return fail(422, 'invalid', 'عدد متغيرات الأزرار غير صحيح', 'button_params')
  return ok(appendMessage(conv, {
    kind: 'template', body: renderTemplate(template.body, body.params), attachments, location,
    template: { name: template.name, header_text: headerText, footer: template.footer, buttons: template.buttons.map(button => ({ type: button.type, text: button.text ?? 'نسخ الرمز' })) },
  }))
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

function channelRoute(method, parts, body, url) {
  const id = parts[4] ? Number(parts[4]) : undefined
  const action = parts[5] === 'templates' && parts[6] ? parts[6] : parts[5]
  const channel = state.channels.find(item => item.id === id)
  if (id !== undefined && !channel) return fail(404, 'not_found', 'not found')
  if (method === 'GET' && action === 'ref') return ok({ id: channel.id, name: channel.name })
  if (action === 'templates') return method === 'GET' ? templateList(url) : createTemplate(channel, body)
  if (method === 'POST' && action === 'uploads') return templateSample(body)
  if (method === 'POST' && action === 'test') { channel.state = 'connected'; channel.last_error = null; return ok(channel) }
  if (method === 'POST' && action === 'sync') return ok(list(state.templates))
  const department = value => value ? { id: value, name: state.departments.find(item => item.id === value)?.name ?? '' } : null
  return crud('channels', method, id, body, (input, current) => ({
    id: current?.id ?? state.ids.channel++,
    name: input.name ?? current.name, kind: 'whatsapp', state: input.state ?? current?.state ?? 'draft',
    department: 'department_id' in input ? department(input.department_id) : current?.department ?? null,
    phone_number_id: current?.phone_number_id ?? input.phone_number_id, business_account_id: current?.business_account_id ?? input.business_account_id,
    has_access_token: current?.has_access_token || !!input.access_token, has_app_secret: current?.has_app_secret || !!input.app_secret,
    app_id: 'app_id' in input ? input.app_id : current?.app_id ?? null,
    verify_token: current?.verify_token ?? `mock-verify-token-${state.ids.channel}`, callback_url: 'https://app.example.test/api/v1/inbox/hooks/whatsapp',
    last_error: current?.last_error ?? null, last_event_at: current?.last_event_at ?? null,
  }))
}

const placeholderCount = text => Math.max(0, ...[...text.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1])))
const AUTH_BODY = '{{1}} هو رمز التحقق الخاص بك.'
const AUTH_SECURITY = ' حفاظًا على أمانك، لا تشارك هذا الرمز مع أحد.'

// The stored template for a write: Meta's fixed text for authentication, the sample file for a media header, and the
// review status "pending" a template always gets when it is submitted. Returns { refusal } the way Meta or the server would.
function templateFromWrite(channel, input, current) {
  const duplicate = state.templates.some(item => item.id !== current?.id && item.name === input.name && item.language === input.language)
  if (duplicate) return { refusal: fail(422, 'invalid', 'Meta: a template with this name and language already exists.', 'name') }
  if (current && (input.name !== current.name || input.language !== current.language)) return { refusal: fail(422, 'invalid', 'الاسم واللغة لا يتغيران', 'name') }
  const base = { id: current?.id ?? state.ids.template++, name: input.name, language: input.language, category: input.category, status: 'pending', status_reason: null, quality: 'unknown', editable: false, otp_button_text: null, supported: true }
  if (input.category === 'authentication') {
    return {
      template: {
        ...base, header: null, body: AUTH_BODY + (input.add_security_recommendation ? AUTH_SECURITY : ''), body_examples: [],
        footer: input.code_expiration_minutes ? `تنتهي صلاحية هذا الرمز خلال ${input.code_expiration_minutes} دقيقة.` : null,
        buttons: [], otp_button_text: input.otp_button_text, add_security_recommendation: input.add_security_recommendation,
        code_expiration_minutes: input.code_expiration_minutes, param_count: 1,
      },
    }
  }
  if (/forbidden/i.test(input.body)) return { refusal: fail(422, 'invalid', 'Meta: the body contains text that is not allowed.', 'body') }
  let header = null
  if (input.header && ['image', 'video', 'document'].includes(input.header.type)) {
    if (!channel.app_id) return { refusal: fail(422, 'invalid', 'معرّف تطبيق Meta مطلوب لرفع عينة الرأس', 'app_id') }
    const example = state.samples.get(input.header.example_attachment_id)
    if (!example) return { refusal: fail(422, 'invalid', 'ملف العينة غير موجود', 'header') }
    header = { type: input.header.type, example_attachment: example }
  } else header = input.header
  return {
    template: {
      ...base, header, body: input.body, body_examples: input.body_examples, footer: input.footer, buttons: input.buttons,
      add_security_recommendation: false, code_expiration_minutes: null, param_count: placeholderCount(input.body),
    },
  }
}

function templateList(url) {
  const wanted = { status: url.searchParams.get('status'), category: url.searchParams.get('category'), q: (url.searchParams.get('q') ?? '').trim().toLowerCase() }
  const items = state.templates
    .filter(item => !wanted.status || item.status === wanted.status)
    .filter(item => !wanted.category || item.category === wanted.category)
    .filter(item => !wanted.q || item.name.includes(wanted.q))
  return ok(page(items, url))
}

function createTemplate(channel, body) {
  const { template, refusal } = templateFromWrite(channel, body)
  if (refusal) return refusal
  state.templates.push(template)
  return { status: 201, body: template }
}

function templateRoute(method, id, body) {
  const index = state.templates.findIndex(item => item.id === id)
  if (index < 0) return fail(404, 'not_found', 'not found')
  const current = state.templates[index]
  if (method === 'GET') return ok(current)
  if (method === 'DELETE') {
    state.templates.splice(index, 1)
    return { status: 204, body: undefined }
  }
  if (method !== 'PATCH') return fail(404, 'not_found', 'not found')
  if (!current.supported) return fail(422, 'invalid', 'القالب غير مدعوم في ويب فيو')
  if (!current.editable) return fail(422, 'invalid', 'Meta: this template cannot be edited in its current status.')
  const { template, refusal } = templateFromWrite(state.channels[0], body, current)
  if (refusal) return refusal
  state.templates[index] = template
  return ok(template)
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
  if (resource === 'templates' && id !== undefined) return templateRoute(method, id, body)
  if (resource === 'channels') return channelRoute(method, parts, body, url)
  return undefined
}

/** Test hook: back to the seed data, so specs start from a known inbox. */
export function resetInboxPreview() {
  state = seed()
}
