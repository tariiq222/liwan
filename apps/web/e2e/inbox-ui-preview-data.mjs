// Synthetic Customer Inbox API for the isolated UI mock (internal-ui-audit-mock.mjs). Never reads or writes Odoo data.
// Every response is shaped like packages/contracts/src/inbox; app/composables/inbox/__tests__/inboxMockContract.test.ts
// parses them with the contract schemas, so the mock cannot drift from the wire shape.

import { channelHealthRoute, emptyHealth, reportsRoute, seedChannelExtras, seedHealth } from './inbox-reports-preview-data.mjs'

export const INBOX_CAPABILITIES = [
  'inbox.conversations.read', 'inbox.conversations.reply', 'inbox.conversations.assign', 'inbox.conversations.export',
  'inbox.channels.manage', 'inbox.settings.manage', 'inbox.templates.manage', 'inbox.automation.manage', 'inbox.flows.manage', 'inbox.reports.read',
]
export const INBOX_FEATURES = ['inbox.enabled', 'inbox.whatsapp', 'inbox.templates', 'inbox.automation', 'inbox.flows', 'inbox.reports']

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
    last_error: null, last_event_at: ago(0.2), health: seedHealth(ago),
  }]
  const contacts = [
    { id: 1, name: 'ليلى القحطاني', phone: '+966500000001', email: null },
    { id: 2, name: 'فهد الدوسري', phone: '+966500000002', email: 'fahad@example.test' },
    { id: 3, name: 'منى العتيبي', phone: '+966500000003', email: null },
    { id: 4, name: 'خالد الشمري', phone: '+966500000004', email: null },
  ]
  const conversation = (id, contact, rest) => ({
    id, contact, channel: { id: 1, name: channels[0].name, kind: 'whatsapp' }, department: null, assignee: null, state: 'open', priority: 'normal', tags: [],
    last_message_at: null, last_message_preview: null, unread: false, reply_window_ends_at: null, csat: null, ...rest,
  })
  const conversations = [
    conversation(1, contacts[0], { assignee: ME, department: { id: 1, name: 'الاستقبال' }, tags: [tags[1]], unread: true, reply_window_ends_at: iso(Date.now() + 20 * HOUR) }),
    conversation(2, contacts[1], { state: 'pending', priority: 'high', department: { id: 2, name: 'المبيعات' }, reply_window_ends_at: ago(30) }),
    conversation(3, contacts[2], { csat: { score: 'good', at: ago(4.8) }, state: 'resolved', assignee: AGENTS[0], department: { id: 1, name: 'الاستقبال' }, tags: [tags[2]], reply_window_ends_at: iso(Date.now() + 2 * HOUR) }),
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
    reactions: { customer: null, agent: null }, location: null, interactive: null, selected_option: null, flow_response: null, automated: false, created_at: ago(hoursAgo), ...extra,
  })
  const quote = target => ({ id: target.id, preview: target.body.slice(0, 80) })
  const first = message('in', 'السلام عليكم، أريد حجز موعد يوم الخميس.', 3)
  const answer = message('out', 'وعليكم السلام ورحمة الله، يسعدنا خدمتك. هل الفترة الصباحية مناسبة؟', 2.8, { delivery_state: 'read', author: ME, reply_to: quote(first), reactions: { customer: '👍', agent: null } })
  const confirmation = message('out', 'هل تؤكد حجز الخميس الساعة 10 صباحًا؟', 2.0, {
    kind: 'interactive', delivery_state: 'read', author: ME,
    interactive: { type: 'buttons', body: 'هل تؤكد حجز الخميس الساعة 10 صباحًا؟', header: 'تأكيد الموعد', footer: 'عيادة الأمل', buttons: [{ id: 'btn_1', title: 'نعم، أؤكد' }, { id: 'btn_2', title: 'تغيير الموعد' }] },
  })
  const chosen = message('in', 'نعم، أؤكد', 1.9, { kind: 'interactive', reply_to: quote(confirmation), selected_option: { id: 'btn_1', title: 'نعم، أؤكد' } })
  // Forms (WhatsApp Flows): a published one with two screens, a draft, and one made in WhatsApp Manager (unsupported).
  const channelRef = { id: channels[0].id, name: channels[0].name }
  let nextFieldId = 1
  const field = (shape) => ({ id: nextFieldId++, ...shape })
  const screens = (list) => list.map((screen, index) => ({ id: index + 1, key: `SCREEN_${String.fromCharCode(65 + index)}`, ...screen }))
  const flows = [
    {
      id: 1, channel: channelRef, name: 'طلب موعد', category: 'appointment_booking', language: 'ar', status: 'published', health: 'available', provider_flow_id: '4401234567890',
      json_version: '7.3', supported: true, editable: false, sendable: true, error_count: 0, submission_count: 1, version_warning: null, published_at: ago(72), updated_at: ago(72),
      completion_message: 'وصلنا طلبك وسنؤكد الموعد قريبًا.', replaces: null, validation_errors: [],
      screens: screens([
        { title: 'بياناتك', footer_label: 'التالي', fields: [
          field({ kind: 'heading', text: 'أخبرنا عن نفسك' }),
          field({ kind: 'text_input', key: 'full_name', label: 'الاسم الكامل', required: true, sensitive: false, input_type: 'text', helper_text: null, min_chars: null, max_chars: null }),
          field({ kind: 'text_input', key: 'phone', label: 'رقم الجوال', required: true, sensitive: false, input_type: 'phone', helper_text: 'يبدأ بـ 05', min_chars: null, max_chars: null }),
        ] },
        { title: 'تفاصيل الموعد', footer_label: 'إرسال', fields: [
          field({ kind: 'dropdown', key: 'service', label: 'نوع الخدمة', required: true, sensitive: false, options: [{ key: 'o1', title: 'كشف', description: null }, { key: 'o2', title: 'متابعة', description: 'لمراجعين سابقين' }, { key: 'o3', title: 'استشارة', description: null }] }),
          field({ kind: 'date', key: 'preferred_date', label: 'التاريخ المفضل', required: true, sensitive: false, helper_text: null, min_date: null, max_date: null }),
          field({ kind: 'radio', key: 'period', label: 'الفترة', required: true, sensitive: false, options: [{ key: 'o1', title: 'صباحًا', description: null }, { key: 'o2', title: 'مساءً', description: null }] }),
          field({ kind: 'opt_in', key: 'consent', label: 'أوافق على التواصل معي', required: false }),
        ] },
      ]),
    },
    {
      id: 2, channel: channelRef, name: 'استفسار عن طلب', category: 'customer_support', language: 'ar', status: 'draft', health: 'unknown', provider_flow_id: '4401234567891',
      json_version: null, supported: true, editable: true, sendable: false, error_count: 0, submission_count: 0, version_warning: null, published_at: null, updated_at: ago(5),
      completion_message: null, replaces: null, validation_errors: [],
      screens: screens([{ title: 'استفسارك', footer_label: 'إرسال', fields: [
        field({ kind: 'text_input', key: 'order_number', label: 'رقم الطلب', required: false, sensitive: false, input_type: 'number', helper_text: null, min_chars: null, max_chars: null }),
        field({ kind: 'text_area', key: 'details', label: 'التفاصيل', required: true, sensitive: false, helper_text: null, max_length: null }),
        field({ kind: 'checkbox', key: 'topics', label: 'الموضوع', required: false, sensitive: false, min_selected: null, max_selected: null, options: [{ key: 'o1', title: 'حالة الطلب', description: null }, { key: 'o2', title: 'استرجاع', description: null }] }),
      ] }]),
    },
    {
      id: 3, channel: channelRef, name: 'Customer feedback', category: 'survey', language: 'en', status: 'published', health: 'limited', provider_flow_id: '4401234567892',
      json_version: '6.2', supported: false, editable: false, sendable: true, error_count: 0, submission_count: 0, version_warning: 'Flow JSON 6.2 will be frozen in 60 days: copy the form to move it on.', published_at: ago(500), updated_at: ago(500),
      completion_message: null, replaces: null, validation_errors: [], screens: [],
    },
  ]
  const flowRequest = message('out', 'املأ النموذج لنحجز لك موعدًا', 1.88, {
    kind: 'interactive', author: ME, delivery_state: 'read',
    interactive: { type: 'flow', body: 'املأ النموذج لنحجز لك موعدًا', header: 'طلب موعد', footer: 'عيادة الأمل', flow_id: 1, cta: 'املأ النموذج' },
  })
  const flowAnswer = message('in', 'طلب موعد', 1.86, { kind: 'flow_response', reply_to: quote(flowRequest) })
  const submissions = [{
    id: 1, flow: { id: 1, name: 'طلب موعد' }, conversation_id: 1, contact: { id: contacts[0].id, name: contacts[0].name }, request_message_id: flowRequest.id, message_id: flowAnswer.id, submitted_at: flowAnswer.created_at,
    answers: [
      { key: 'full_name', label: 'الاسم الكامل', kind: 'text_input', value: 'ليلى القحطاني' },
      { key: 'phone', label: 'رقم الجوال', kind: 'text_input', value: '0500000001' },
      { key: 'service', label: 'نوع الخدمة', kind: 'dropdown', choices: [{ key: 'o2', title: 'متابعة' }] },
      { key: 'preferred_date', label: 'التاريخ المفضل', kind: 'date', value: '2026-11-05' },
      { key: 'period', label: 'الفترة', kind: 'radio', choices: [{ key: 'o1', title: 'صباحًا' }] },
      { key: 'consent', label: 'أوافق على التواصل معي', kind: 'opt_in', value: true },
    ],
  }]
  flowAnswer.flow_response = submissions[0]
  const messages = {
    1: [
      first,
      message('note', 'رد آلي: القاعدة «حجز موعد»', 2.94, { author: null, delivery_state: 'sent' }),
      message('out', 'أهلًا بك في عيادة الأمل! سيرد عليك أحد موظفينا قريبًا.', 2.95, { author: null, delivery_state: 'delivered', automated: true }),
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
      flowRequest,
      flowAnswer,
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
    template(7, 'booking_form', { body: 'يمكنك حجز موعدك الآن من خلال النموذج.', buttons: [{ type: 'flow', text: 'احجز موعدًا', flow: { id: 1, name: 'طلب موعد' }, provider_flow_id: '4401234567890' }] }),
  ]
  const canned = [
    { id: 1, shortcut: 'hello', body: 'أهلًا بك، كيف يمكنني مساعدتك؟' },
    { id: 2, shortcut: 'hours', body: 'ساعات العمل من 9 صباحًا حتى 5 مساءً، من الأحد إلى الخميس.' },
  ]
  return {
    settings: { visibility_policy: 'department', auto_close_hours: 72, retention_months: 24, assignment_policy: 'manual', first_response_alert_minutes: 0 },
    hours: { timezone: 'Asia/Riyadh', days: [0, 1, 2, 3, 6].map(weekday => ({ weekday, from: '09:00', to: '17:00' })), holidays: [{ name: 'اليوم الوطني', date_from: '2026-09-23', date_to: '2026-09-23' }] },
    // Department id -> its own hours; a department without an entry follows the company's.
    departmentHours: new Map(),
    // Channel id -> its automatic messages (the seed channel has the welcome on, the others off).
    automation: new Map([[1, {
      welcome: { enabled: true, idle_days: 0, content: { body: 'أهلًا بك في عيادة الأمل! سيرد عليك أحد موظفينا قريبًا.' } },
      away: { enabled: false, repeat_hours: 12, content: null },
      csat: { enabled: false, question: 'كيف كانت تجربتك معنا؟', good: 'ممتاز', neutral: 'مقبول', bad: 'سيئ' },
    }]]),
    rules: [
      { id: 1, sequence: 10, channel: null, flow: null, name: 'حجز موعد', active: true, match_kind: 'contains', keywords: ['حجز', 'موعد'], option_id: null, hours: 'any', stop: true,
        reply: { body: 'يسعدنا حجز موعدك، ما اليوم الأنسب لك؟' }, resolve: false, department: { id: 1, name: 'الاستقبال' }, assignee: null, tags: [{ id: 2, name: 'حجز' }], priority: null },
      { id: 2, sequence: 20, channel: null, flow: null, name: 'شكوى عاجلة', active: true, match_kind: 'starts_with', keywords: ['شكوى'], option_id: null, hours: 'any', stop: false,
        reply: null, resolve: false, department: null, assignee: null, tags: [{ id: 1, name: 'شكوى' }], priority: 'urgent' },
    ],
    departments, tags, channels, contacts, conversations, messages, templates, canned, flows, submissions,
    // Number-health timeline and business profile per channel (inbox-reports-preview-data.mjs).
    health: seedChannelExtras(channels.map(item => item.id), ago),
    ids: { department: 3, tag: 4, canned: 3, channel: 2, template: 8, rule: 3, flow: 4, submission: 2, field: nextFieldId, upload: 100, message: () => nextMessageId++ },
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
    csat: url.searchParams.get('csat'),
  }
  const items = state.conversations
    .filter(c => !wanted.state || c.state === wanted.state)
    .filter(c => !wanted.department || c.department?.id === wanted.department)
    .filter(c => !wanted.csat || c.csat?.score === wanted.csat)
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
    reply_to: null, reactions: { customer: null, agent: null }, location: null, interactive: null, selected_option: null, flow_response: null, automated: false, created_at: iso(Date.now()), ...fields,
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

function interactiveProblem(interactive, conv) {
  if (interactive.type === 'flow') {
    const flow = state.flows.find(item => item.id === interactive.flow_id)
    if (!flow || flow.channel.id !== conv.channel.id || !flow.sendable) return 'flow'
    return null
  }
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
    if (interactiveProblem(body.interactive, conv)) return fail(422, 'invalid', 'حدود الرسالة التفاعلية', 'interactive')
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
  if (action === 'flows' || (parts[5] === 'flows' && parts[6] === 'sync')) return channelFlows(channel, method, parts[6], body, url)
  if (action === 'templates') return method === 'GET' ? templateList(url) : createTemplate(channel, body)
  if (action === 'automation' && (method === 'GET' || method === 'PATCH')) return automationRoute(method, channel, body)
  if (method === 'POST' && action === 'uploads') return templateSample(body)
  if (method === 'POST' && action === 'test') {
    channel.state = 'connected'
    channel.last_error = null
    channel.health = { ...(channel.health.checked_at ? channel.health : seedHealth(ago)), checked_at: iso(Date.now()) }
    return ok(channel)
  }
  if (channel) {
    const answer = channelHealthRoute(mockContext(), method, action, parts, url, body, channel)
    if (answer) return answer
  }
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
    last_error: current?.last_error ?? null, last_event_at: current?.last_event_at ?? null, health: current?.health ?? emptyHealth(),
  }))
}

// ---------------------------------------------------------------- automation (working hours, automatic messages, rules)

const WEEKDAYS_BY_NAME = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function hoursProblem(input) {
  if (!input || typeof input.timezone !== 'string' || !input.timezone) return ['timezone', 'المنطقة الزمنية مطلوبة']
  if (!Array.isArray(input.days) || !Array.isArray(input.holidays)) return ['days', 'صيغة الساعات غير صحيحة']
  for (const range of input.days) {
    if (!Number.isInteger(range.weekday) || range.weekday < 0 || range.weekday > 6 || !CLOCK.test(range.from) || !CLOCK.test(range.to)) return ['days', 'فترة غير صحيحة']
    if (range.from >= range.to) return ['days', 'تنتهي الفترة بعد أن تبدأ']
  }
  for (const holiday of input.holidays) {
    if (!holiday.name || !ISO_DATE.test(holiday.date_from) || !ISO_DATE.test(holiday.date_to) || holiday.date_from > holiday.date_to) return ['holidays', 'عطلة غير صحيحة']
  }
  return null
}

const cleanHours = input => ({
  timezone: input.timezone,
  days: input.days.map(({ weekday, from, to }) => ({ weekday, from, to })),
  holidays: input.holidays.map(({ name, date_from, date_to }) => ({ name, date_from, date_to })),
})

function saveHours(input, store) {
  const problem = hoursProblem(input)
  if (problem) return fail(422, 'invalid', problem[1], problem[0])
  store(cleanHours(input))
  return null
}

/** Whether `at` falls inside the hours: no ranges at all means always open, a holiday means closed. */
function insideHours(hours, at) {
  if (!hours.days.length) return true
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at).map(part => [part.type, part.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  if (hours.holidays.some(holiday => holiday.date_from <= date && date <= holiday.date_to)) return false
  const clock = `${parts.hour}:${parts.minute}`
  return hours.days.some(range => range.weekday === WEEKDAYS_BY_NAME[parts.weekday] && range.from <= clock && clock < range.to)
}

function departmentHoursRoute(method, id, body) {
  if (!state.departments.some(item => item.id === id)) return fail(404, 'not_found', 'not found')
  if (method === 'PUT') {
    if (body.working_hours === null) state.departmentHours.delete(id)
    else {
      const refusal = saveHours(body.working_hours, value => state.departmentHours.set(id, value))
      if (refusal) return refusal
    }
  }
  return ok({ working_hours: state.departmentHours.get(id) ?? null })
}

const AUTO_PURPOSES = ['welcome', 'away']

function automationProblem(automation) {
  for (const purpose of AUTO_PURPOSES) {
    const block = automation[purpose]
    if (block?.enabled && !block.content) return [`${purpose}.content`, 'الرسالة المفعّلة تحتاج محتوى']
  }
  const csat = automation.csat
  if (!csat?.question || !csat.good || !csat.neutral || !csat.bad || [csat.good, csat.neutral, csat.bad].some(label => label.length > 20)) return ['csat', 'نص الاستبيان غير صحيح']
  return null
}

function automationRoute(method, channel, body) {
  const current = state.automation.get(channel.id) ?? {
    welcome: { enabled: false, idle_days: 0, content: null },
    away: { enabled: false, repeat_hours: 12, content: null },
    csat: { enabled: false, question: 'كيف كانت تجربتك معنا؟', good: 'ممتاز', neutral: 'مقبول', bad: 'سيئ' },
  }
  if (method === 'PATCH') {
    const next = { ...current, ...body }
    const problem = automationProblem(next)
    if (problem) return fail(422, 'invalid', problem[1], problem[0])
    state.automation.set(channel.id, next)
    return ok(next)
  }
  return ok(current)
}

// Case, Arabic diacritics, tatweel and alef / yaa / hamza variants do not matter when words are compared.
const normalizeText = text => String(text ?? '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').trim()

function ruleMatches(rule, { channelId, text, optionId, flowId = null, inside }) {
  if (rule.channel && rule.channel.id !== channelId) return false
  if (rule.hours === 'inside' && !inside) return false
  if (rule.hours === 'outside' && inside) return false
  const words = rule.keywords.map(normalizeText)
  const said = normalizeText(text)
  if (rule.match_kind === 'any') return true
  if (rule.match_kind === 'option') return !!optionId && optionId === rule.option_id
  if (rule.match_kind === 'flow') return flowId !== null && flowId === rule.flow?.id
  if (!said) return false
  if (rule.match_kind === 'exact') return words.includes(said)
  if (rule.match_kind === 'starts_with') return words.some(word => said.startsWith(word))
  return words.some(word => said.includes(word))
}

function ruleTest(body) {
  if (!state.channels.some(item => item.id === body.channel_id)) return fail(422, 'invalid', 'القناة غير موجودة', 'channel_id')
  const inside = insideHours(state.hours, body.at ? new Date(body.at) : new Date())
  const automation = state.automation.get(body.channel_id)
  const autoMessage = !inside && automation?.away.enabled ? 'away' : inside && automation?.welcome.enabled ? 'welcome' : null
  const matched = []
  for (const rule of [...state.rules].sort((a, b) => a.sequence - b.sequence)) {
    if (!rule.active || !ruleMatches(rule, { channelId: body.channel_id, text: body.text, optionId: body.option_id, flowId: body.flow_id ?? null, inside })) continue
    matched.push({ id: rule.id, name: rule.name })
    if (rule.stop) break
  }
  return ok({ inside_hours: inside, auto_message: autoMessage, rules: matched })
}

const TEXT_KINDS = ['contains', 'exact', 'starts_with']

function ruleProblem(rule, input) {
  if (!rule.name?.trim()) return ['name', 'اسم القاعدة مطلوب']
  if (TEXT_KINDS.includes(rule.match_kind) && !(rule.keywords.length > 0 && rule.option_id === null)) return ['keywords', 'الكلمات مطلوبة لهذا النوع']
  if (rule.match_kind === 'option' && !(rule.option_id && rule.keywords.length === 0)) return ['option_id', 'معرّف الخيار مطلوب']
  if (rule.match_kind === 'any' && (rule.keywords.length || rule.option_id)) return ['match_kind', 'لا كلمات مع هذا النوع']
  if (rule.match_kind === 'flow' && !(rule.flow && rule.keywords.length === 0 && rule.option_id === null)) return ['flow_id', 'النموذج مطلوب لهذا النوع']
  if (rule.match_kind !== 'flow' && input.flow_id) return ['flow_id', 'النموذج يخص نوع «إرسال نموذج» فقط']
  if (rule.flow && rule.channel && state.flows.find(item => item.id === rule.flow.id)?.channel.id !== rule.channel.id) return ['flow_id', 'النموذج من قناة أخرى']
  if (input.channel_id && !state.channels.some(item => item.id === input.channel_id)) return ['channel_id', 'القناة غير موجودة']
  const acts = rule.reply || rule.department || rule.assignee || rule.tags.length || rule.priority || rule.resolve
  return acts ? null : ['reply', 'تحتاج القاعدة إجراءً واحدًا على الأقل']
}

const flowRef = id => { const flow = state.flows.find(item => item.id === id); return flow ? { id: flow.id, name: flow.name } : null }

function ruleFromWrite(input, current) {
  const refId = (value, list) => value ? list.find(item => item.id === value) ?? null : null
  const pick = (key, fallback) => (key in input ? input[key] : fallback)
  const department = 'department_id' in input ? refId(input.department_id, state.departments) : current?.department ?? null
  const assignee = 'assignee_id' in input ? ([ME, ...AGENTS].find(item => item.id === input.assignee_id) ?? null) : current?.assignee ?? null
  const channel = 'channel_id' in input ? refId(input.channel_id, state.channels) : current?.channel ?? null
  return {
    id: current?.id ?? state.ids.rule++,
    sequence: current?.sequence ?? Math.max(0, ...state.rules.map(item => item.sequence)) + 10,
    channel: channel ? { id: channel.id, name: channel.name } : null,
    flow: 'flow_id' in input ? flowRef(input.flow_id) : current?.flow ?? null,
    name: pick('name', current?.name), active: pick('active', current?.active ?? true), match_kind: pick('match_kind', current?.match_kind),
    keywords: pick('keywords', current?.keywords ?? []), option_id: pick('option_id', current?.option_id ?? null), hours: pick('hours', current?.hours ?? 'any'),
    stop: pick('stop', current?.stop ?? true), reply: pick('reply', current?.reply ?? null), resolve: pick('resolve', current?.resolve ?? false),
    department: department ? { id: department.id, name: department.name } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    tags: 'tag_ids' in input ? state.tags.filter(tag => input.tag_ids.includes(tag.id)) : current?.tags ?? [],
    priority: pick('priority', current?.priority ?? null),
  }
}

function ruleRoute(method, parts, body) {
  const id = parts[4] && /^\d+$/.test(parts[4]) ? Number(parts[4]) : undefined
  if (parts[4] === 'reorder' && method === 'POST') {
    const ids = body.ids ?? []
    if (ids.length !== state.rules.length || !state.rules.every(rule => ids.includes(rule.id))) return fail(422, 'invalid', 'ترتيب غير مكتمل', 'ids')
    ids.forEach((ruleId, index) => { state.rules.find(rule => rule.id === ruleId).sequence = (index + 1) * 10 })
    return ok(list([...state.rules].sort((a, b) => a.sequence - b.sequence)))
  }
  if (parts[4] === 'test' && method === 'POST') {
    if (!['channel_id', 'text', 'option_id', 'flow_id', 'at'].every(key => key in body)) return fail(422, 'invalid', 'كل المفاتيح الأربعة مطلوبة')
    return ruleTest(body)
  }
  if (id === undefined) {
    if (method === 'GET') return ok(list([...state.rules].sort((a, b) => a.sequence - b.sequence)))
    if (method !== 'POST') return undefined
    const created = ruleFromWrite(body)
    const problem = ruleProblem(created, body)
    if (problem) return fail(422, 'invalid', problem[1], problem[0])
    state.rules.push(created)
    return { status: 201, body: created }
  }
  const current = state.rules.find(rule => rule.id === id)
  if (!current) return fail(404, 'not_found', 'not found')
  if (method === 'GET') return ok(current)
  if (method === 'DELETE') {
    state.rules.splice(state.rules.indexOf(current), 1)
    return { status: 204, body: undefined }
  }
  if (method === 'PATCH') {
    const next = ruleFromWrite(body, current)
    const problem = ruleProblem(next, body)
    if (problem) return fail(422, 'invalid', problem[1], problem[0])
    state.rules[state.rules.indexOf(current)] = next
    return ok(next)
  }
  return undefined
}

// A flow button is written with the form's id and read back with the form (a ref) and Meta's id.
const readButton = button => {
  if (button.type !== 'flow') return button
  const flow = state.flows.find(item => item.id === button.flow_id)
  return { type: 'flow', text: button.text, flow: flow ? { id: flow.id, name: flow.name } : null, provider_flow_id: flow?.provider_flow_id ?? '' }
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
      ...base, header, body: input.body, body_examples: input.body_examples, footer: input.footer, buttons: input.buttons.map(readButton),
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

// ---------------------------------------------------------------- forms (WhatsApp Flows)

const FLOW_KEY = /^[a-z][a-z0-9_]{0,39}$/
const flowSummary = ({ completion_message, replaces, screens, validation_errors, ...summary }) => summary
const flowCounts = flow => { flow.error_count = flow.validation_errors.length; flow.submission_count = state.submissions.filter(item => item.flow?.id === flow.id).length }

function flowList(channel, url) {
  const wanted = { status: url.searchParams.get('status'), q: (url.searchParams.get('q') ?? '').trim().toLowerCase(), sendable: url.searchParams.get('sendable') }
  const items = state.flows
    .filter(flow => flow.channel.id === channel.id)
    .filter(flow => !wanted.status || flow.status === wanted.status)
    .filter(flow => !wanted.q || flow.name.toLowerCase().includes(wanted.q))
    .filter(flow => !wanted.sendable || flow.sendable === (wanted.sendable === 'true'))
    .map(flow => (flowCounts(flow), flowSummary(flow)))
  return ok(page(items, url))
}

// Every field is given its id and, for a choice, the option keys o1, o2, ... the server generates.
function storedScreens(input) {
  return input.screens.map((screen, index) => ({
    id: index + 1, key: `SCREEN_${String.fromCharCode(65 + index)}`, title: screen.title, footer_label: screen.footer_label,
    fields: screen.fields.map(field => ({ id: state.ids.field++, ...field, ...('options' in field ? { options: field.options.map((option, position) => ({ key: `o${position + 1}`, ...option })) } : {}) })),
  }))
}

// The contract's own cross-field rules, as the server re-checks them.
function flowProblem(input) {
  if (!input.name?.trim() || input.name.length > 128) return ['name', 'اسم النموذج مطلوب']
  if (!Array.isArray(input.screens) || input.screens.length < 1 || input.screens.length > 10) return ['screens', 'من شاشة إلى 10 شاشات']
  const inputs = input.screens.flatMap(screen => screen.fields).filter(field => 'key' in field)
  if (!inputs.length) return ['screens', 'يحتاج النموذج حقلًا واحدًا على الأقل يجمع إجابة']
  const keys = inputs.map(field => field.key)
  if (keys.some(key => !FLOW_KEY.test(key) || key === 'flow_token')) return ['screens', 'مفتاح إجابة غير صالح']
  if (new Set(keys).size !== keys.length) return ['screens', 'مفتاح الإجابة مكرر']
  return null
}

// Meta's side: text containing "forbidden" is rejected with a validation error at the field (children[i] of the screen).
function metaErrors(screens) {
  return screens.flatMap((screen, s) => screen.fields.flatMap((field, f) => {
    const text = field.text ?? field.label ?? ''
    return /forbidden/i.test(text) ? [{ message: 'Meta: the text contains words that are not allowed.', path: `$.screens[${s}].layout.children[${f}]`, line: null, column: null }] : []
  }))
}

function flowSave(channel, input, current) {
  const problem = flowProblem(input)
  if (problem) return { refusal: fail(422, 'invalid', problem[1], problem[0]) }
  if (state.flows.some(flow => flow.id !== current?.id && flow.channel.id === channel.id && flow.name === input.name)) return { refusal: fail(422, 'invalid', 'يوجد نموذج بهذا الاسم في القناة', 'name') }
  const screens = storedScreens(input)
  const stored = {
    ...(current ?? { id: state.ids.flow++, channel: { id: channel.id, name: channel.name }, status: 'draft', health: 'unknown', provider_flow_id: `44${String(Date.now()).slice(-10)}`, json_version: null, supported: true, sendable: false, published_at: null, replaces: null }),
    name: input.name, category: input.category, language: input.language, completion_message: input.completion_message, screens,
    editable: true, version_warning: null, updated_at: iso(Date.now()), validation_errors: metaErrors(screens),
  }
  flowCounts(stored)
  return { flow: stored }
}

function flowRoute(method, id, action, body, url) {
  const flow = state.flows.find(item => item.id === id)
  if (!flow) return fail(404, 'not_found', 'not found')
  flowCounts(flow)
  if (!action) {
    if (method === 'GET') return ok(flow)
    if (method === 'PATCH') {
      if (!flow.editable) return fail(422, 'invalid', 'لا يُعدَّل النموذج بعد نشره، انسخه لتعدّله')
      const { flow: next, refusal } = flowSave(state.channels.find(item => item.id === flow.channel.id), body, flow)
      if (refusal) return refusal
      state.flows[state.flows.indexOf(flow)] = next
      return ok(next)
    }
    if (method === 'DELETE') {
      if (flow.status !== 'draft') return fail(422, 'invalid', 'تُحذف المسودات فقط')
      state.flows.splice(state.flows.indexOf(flow), 1)
      return { status: 204, body: undefined }
    }
    return undefined
  }
  if (action === 'preview' && method === 'GET') {
    if (!flow.provider_flow_id) return fail(422, 'invalid', 'النموذج غير موجود في Meta')
    return ok({ url: `https://business.facebook.com/wa/manage/flows/preview/mock-${flow.id}`, expires_at: iso(Date.now() + 30 * 24 * HOUR) })
  }
  if (action === 'submissions' && method === 'GET') {
    const from = url.searchParams.get('date_from')
    const to = url.searchParams.get('date_to')
    const items = state.submissions
      .filter(item => item.flow?.id === id)
      .filter(item => !from || item.submitted_at.slice(0, 10) >= from)
      .filter(item => !to || item.submitted_at.slice(0, 10) <= to)
      .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))
    return ok(page(items, url))
  }
  if (method !== 'POST') return undefined
  if (action === 'publish') {
    if (flow.status !== 'draft') return fail(422, 'invalid', 'تُنشر المسودات فقط')
    if (flow.validation_errors.length) return fail(422, 'invalid', 'أصلح مشكلات Meta قبل النشر')
    Object.assign(flow, { status: 'published', health: 'available', sendable: true, editable: false, json_version: '7.3', published_at: iso(Date.now()), updated_at: iso(Date.now()) })
    const original = flow.replaces && state.flows.find(item => item.id === flow.replaces.id)
    if (original) {
      Object.assign(original, { status: 'deprecated', sendable: false })
      for (const rule of state.rules) if (rule.flow?.id === original.id) rule.flow = { id: flow.id, name: flow.name }
      flow.replaces = null
    }
    return ok(flow)
  }
  if (action === 'deprecate') {
    if (flow.status !== 'published') return fail(422, 'invalid', 'يُوقف المنشور فقط')
    Object.assign(flow, { status: 'deprecated', sendable: false, updated_at: iso(Date.now()) })
    return ok(flow)
  }
  if (action === 'copy') {
    if (!flow.supported) return fail(422, 'invalid', 'لا يُنسخ نموذج من WhatsApp Manager')
    if (!body.name?.trim()) return fail(422, 'invalid', 'اسم النسخة مطلوب', 'name')
    const channel = state.channels.find(item => item.id === flow.channel.id)
    const { flow: copy, refusal } = flowSave(channel, {
      name: body.name.trim(), category: flow.category, language: flow.language, completion_message: flow.completion_message,
      screens: flow.screens.map(({ title, footer_label, fields }) => ({ title, footer_label, fields: fields.map(({ id: _id, ...field }) => ({ ...field, ...('options' in field ? { options: field.options.map(({ key: _key, ...option }) => option) } : {}) })) })),
    })
    if (refusal) return refusal
    copy.replaces = body.replace ? { id: flow.id, name: flow.name } : null
    state.flows.push(copy)
    return { status: 201, body: copy }
  }
  return undefined
}

function channelFlows(channel, method, action, body, url) {
  if (action === 'sync' && method === 'POST') return ok(list(state.flows.filter(flow => flow.channel.id === channel.id).map(flowSummary)))
  if (method === 'GET') return flowList(channel, url)
  const { flow, refusal } = flowSave(channel, body)
  if (refusal) return refusal
  state.flows.push(flow)
  return { status: 201, body: flow }
}

// Test hook: the customer answers a form sent in a conversation (what the signed webhook does on the server).
function answerFlow(body) {
  const conv = state.conversations.find(item => item.id === body.conversation_id)
  const flow = state.flows.find(item => item.id === body.flow_id)
  if (!conv || !flow) return fail(404, 'not_found', 'not found')
  const request = state.messages[conv.id].find(item => item.interactive?.flow_id === flow.id && item.direction === 'out')
  const sample = field => {
    const text = body.values?.[field.key]
    if ('options' in field) return { key: field.key, label: field.label, kind: field.kind, choices: (field.kind === 'checkbox' ? field.options.slice(0, 1) : field.options.slice(0, 1)).map(({ key, title }) => ({ key, title })) }
    if (field.kind === 'date') return { key: field.key, label: field.label, kind: 'date', value: text ?? '2026-11-10' }
    if (field.kind === 'opt_in') return { key: field.key, label: field.label, kind: 'opt_in', value: true }
    return { key: field.key, label: field.label, kind: field.kind, value: text ?? 'قيمة تجريبية' }
  }
  const answers = flow.screens.flatMap(screen => screen.fields).filter(field => 'key' in field).map(sample)
  const created = appendMessage(conv, { direction: 'in', kind: 'flow_response', body: flow.name, author: null, delivery_state: 'received', reply_to: request ? { id: request.id, preview: request.body.slice(0, 80) } : null })
  const submission = {
    id: state.ids.submission++, flow: { id: flow.id, name: flow.name }, conversation_id: conv.id, contact: { id: conv.contact.id, name: conv.contact.name },
    request_message_id: request?.id ?? null, message_id: created.id, submitted_at: created.created_at, answers,
  }
  created.flow_response = submission
  state.submissions.push(submission)
  conv.last_message_at = created.created_at
  conv.last_message_preview = flow.name
  return { status: 201, body: created }
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
    if (method === 'PATCH') {
      if ('assignment_policy' in body && !['manual', 'round_robin', 'least_open'].includes(body.assignment_policy)) return fail(422, 'invalid', 'سياسة التوزيع غير معروفة', 'assignment_policy')
      Object.assign(state.settings, body)
    }
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
    if (parts[5] === 'flow-submissions' && method === 'GET') return ok(list(state.submissions.filter(item => item.conversation_id === conv.id)))
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
  if (resource === 'working-hours' && (method === 'GET' || method === 'PUT')) {
    if (method === 'PUT') {
      const refusal = saveHours(body, value => { state.hours = value })
      if (refusal) return refusal
    }
    return ok(state.hours)
  }
  if (resource === 'automation' && parts[4] === 'channels' && method === 'GET') return ok(list(state.channels.map(({ id, name }) => ({ id, name }))))
  if (resource === 'rules') return ruleRoute(method, parts, body)
  if (resource === 'departments' && id !== undefined && parts[5] === 'working-hours' && (method === 'GET' || method === 'PUT')) return departmentHoursRoute(method, id, body)
  if (resource === 'departments') {
    return crud('departments', method, id, body, (input, current) => ({
      id: current?.id ?? state.ids.department++, name: input.name ?? current.name,
      members: (input.member_ids ?? current?.members.map(member => member.id) ?? []).map(member => ({ id: member, name: nameOf(member) })),
    }))
  }
  if (resource === '__mock' && parts[4] === 'flow-answer' && method === 'POST') return answerFlow(body)
  if (resource === 'flows' && id !== undefined) return flowRoute(method, id, parts[5], body, url)
  if (resource === 'templates' && id !== undefined) return templateRoute(method, id, body)
  if (resource === 'reports') return reportsRoute(mockContext(), method, parts, url)
  if (resource === 'channels') return channelRoute(method, parts, body, url)
  return undefined
}

/** What the sibling mock modules need from this one. */
function mockContext() {
  return { state, ok, fail, iso, ME, AGENTS, page }
}

/** Test hook: back to the seed data, so specs start from a known inbox. */
export function resetInboxPreview() {
  state = seed()
}
