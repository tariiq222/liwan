import { beforeEach, describe, expect, it } from 'vitest'
import {
  InboxAttachmentSchema, InboxCannedReplyListSchema, InboxChannelListSchema, InboxChannelSchema, InboxConversationDetailSchema, InboxConversationListSchema,
  InboxChannelAutomationSchema, InboxDepartmentListSchema, InboxDepartmentWorkingHoursSchema, InboxMessageListSchema, InboxRefSchema, InboxRuleListSchema, InboxRuleSchema, InboxRuleTestResultSchema, InboxWorkingHoursSchema, InboxMessageSchema, InboxSettingsSchema, InboxTagListSchema, InboxTemplateListSchema, InboxTemplateSchema,
  InboxCatalogItemListSchema, InboxCatalogItemSchema, InboxCatalogListSchema, InboxCatalogPickItemListSchema, InboxCatalogSchema, InboxChannelCommerceSchema, InboxCatalogProductOptionListSchema, InboxOrderCheckoutResultSchema, InboxOrderListSchema, InboxOrderSchema,
} from '@webvue/contracts'
import { inboxPreviewData, resetInboxPreview } from '../../../../e2e/inbox-ui-preview-data.mjs'

const call = (method: string, target: string, body: object = {}) => {
  const url = new URL(target, 'http://localhost')
  return inboxPreviewData(method, url.pathname, url, body) as { status: number; body: unknown }
}

// The audit mock serves the inbox pages; every shape it answers must be one the contract accepts.
describe('inbox audit mock', () => {
  beforeEach(() => resetInboxPreview())

  it('serves contract-valid lists and details', () => {
    expect(InboxConversationListSchema.parse(call('GET', '/api/v1/inbox/conversations').body).total).toBe(4)
    expect(InboxConversationDetailSchema.parse(call('GET', '/api/v1/inbox/conversations/1').body).can_reply).toBe(true)
    expect(InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/messages').body).items.length).toBeGreaterThan(0)
    expect(InboxCannedReplyListSchema.parse(call('GET', '/api/v1/inbox/canned-replies').body).total).toBe(2)
    expect(InboxTemplateListSchema.parse(call('GET', '/api/v1/inbox/channels/1/templates').body).total).toBe(7)
    expect(InboxTagListSchema.parse(call('GET', '/api/v1/inbox/tags').body).total).toBe(3)
    expect(InboxDepartmentListSchema.parse(call('GET', '/api/v1/inbox/departments').body).total).toBe(2)
    expect(InboxSettingsSchema.parse(call('GET', '/api/v1/settings/inbox').body).visibility_policy).toBe('department')
    expect(InboxChannelListSchema.parse(call('GET', '/api/v1/inbox/channels').body).total).toBe(1)
    expect(InboxRefSchema.parse(call('GET', '/api/v1/inbox/channels/1/ref').body).id).toBe(1)
  })

  it('filters the list like the server', () => {
    const csat = (query: string) => (call('GET', `/api/v1/inbox/conversations?${query}`).body as { items: { id: number }[] }).items.map(item => item.id)
    expect(csat('csat=good')).toEqual([3])
    expect(csat('csat=bad')).toEqual([])
    const ids = (query: string) => (call('GET', `/api/v1/inbox/conversations?${query}`).body as { items: { id: number }[] }).items.map(item => item.id)
    expect(ids('assignee=me')).toEqual([1])
    expect(ids('assignee=unassigned')).toEqual(expect.arrayContaining([2, 4]))
    expect(ids('state=resolved')).toEqual([3])
    expect(ids('q=فهد')).toEqual([2])
  })

  it('refuses free text after the window and accepts an approved template', () => {
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { body: 'مرحبا' }).status).toBe(422)
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { template_id: 1, params: ['فهد'] }).status).toBe(422)
    const sent = call('POST', '/api/v1/inbox/conversations/2/messages', { template_id: 1, params: ['فهد', 'الخميس'], button_params: [{ index: 1, value: '4521' }] })
    expect(InboxMessageSchema.parse(sent.body).delivery_state).toBe('queued')
    expect(call('POST', '/api/v1/inbox/conversations/1/messages', { body: 'مرحبا' }).status).toBe(200)
  })

  it('pages messages from the newest, ascending inside a page, like the server', () => {
    const ids = (query: string) => (call('GET', `/api/v1/inbox/conversations/1/messages?${query}`).body as { items: { id: number }[]; total: number })
    const newest = ids('limit=3&offset=0')
    const older = ids('limit=3&offset=3')
    expect(newest.total).toBeGreaterThan(10)
    expect(newest.items).toHaveLength(3)
    expect(older.items).toHaveLength(3)
    expect(older.items[0]!.id).toBeLessThan(newest.items[0]!.id)
  })

  it('shows one message of every kind with its reply, reaction, location and chosen option', () => {
    const items = InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/messages?limit=100').body).items
    expect(new Set(items.map(item => item.kind))).toEqual(new Set(['text', 'image', 'location', 'contacts', 'audio', 'video', 'sticker', 'interactive', 'document']))
    expect(items.map(item => item.interactive?.type).filter(Boolean)).toEqual(['buttons', 'list', 'cta_url'])
    expect(items.some(item => item.reply_to && item.reactions.customer)).toBe(true)
    expect(items.some(item => item.selected_option?.id === 'btn_1')).toBe(true)
  })

  it('uploads a file, sends it once with a caption and a quoted message, and refuses what the server refuses', () => {
    const upload = (name: string, mimetype: string, size: number) => call('POST', '/api/v1/inbox/conversations/1/uploads', { name, mimetype, data: Buffer.alloc(size, 65).toString('base64') })
    expect(upload('big.png', 'image/png', 5 * 1048576 + 1).status).toBe(413)
    expect(upload('big.pdf', 'application/pdf', 10 * 1048576 + 1).status).toBe(413)
    expect(upload('edge.pdf', 'application/pdf', 10 * 1048576).status).toBe(201)
    expect(upload('anim.gif', 'image/gif', 10).status).toBe(422)
    const attachment = InboxAttachmentSchema.parse(upload('plan.pdf', 'application/pdf', 2048).body)
    const target = (call('GET', '/api/v1/inbox/conversations/1/messages?limit=1').body as { items: { id: number }[] }).items[0]!
    const sent = InboxMessageSchema.parse(call('POST', '/api/v1/inbox/conversations/1/messages', { attachment_id: attachment.id, caption: 'الخطة', reply_to_id: target.id }).body)
    expect(sent).toMatchObject({ kind: 'document', body: 'الخطة', attachments: [attachment], reply_to: { id: target.id } })
    expect(call('POST', '/api/v1/inbox/conversations/1/messages', { attachment_id: attachment.id }).status).toBe(422)
    const voice = InboxAttachmentSchema.parse(upload('note.ogg', 'audio/ogg', 2048).body)
    expect(call('POST', '/api/v1/inbox/conversations/1/messages', { attachment_id: voice.id, caption: 'x' }).status).toBe(422)
    expect(InboxMessageSchema.parse(call('POST', '/api/v1/inbox/conversations/1/messages', { attachment_id: voice.id }).body).kind).toBe('audio')
    expect(call('POST', '/api/v1/inbox/conversations/1/messages', { body: 'x', reply_to_id: 99999 }).status).toBe(422)
  })

  it('sends a location and an interactive message only inside the window', () => {
    const location = { latitude: 24.7, longitude: 46.6, name: null, address: null }
    const interactive = { type: 'buttons', body: 'اختر', header: null, footer: null, buttons: [{ id: 'btn_1', title: 'نعم' }] }
    expect(InboxMessageSchema.parse(call('POST', '/api/v1/inbox/conversations/1/messages', { location }).body).location).toEqual(location)
    expect(InboxMessageSchema.parse(call('POST', '/api/v1/inbox/conversations/1/messages', { interactive }).body).interactive).toEqual(interactive)
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { location }).status).toBe(422)
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { interactive }).status).toBe(422)
  })

  it('reacts to a message, removes the reaction, and answers typing with 204', () => {
    const target = (call('GET', '/api/v1/inbox/conversations/1/messages?limit=1').body as { items: { id: number }[] }).items[0]!
    expect(InboxMessageSchema.parse(call('POST', `/api/v1/inbox/messages/${target.id}/reaction`, { emoji: '👍' }).body).reactions.agent).toBe('👍')
    expect(InboxMessageSchema.parse(call('POST', `/api/v1/inbox/messages/${target.id}/reaction`, { emoji: '' }).body).reactions.agent).toBeNull()
    expect(call('POST', '/api/v1/inbox/conversations/1/typing').status).toBe(204)
  })

  it('retries only a failed message', () => {
    const failed = (call('GET', '/api/v1/inbox/conversations/2/messages').body as { items: { id: number; delivery_state: string }[] }).items.find(item => item.delivery_state === 'failed')!
    expect(InboxMessageSchema.parse(call('POST', `/api/v1/inbox/messages/${failed.id}/retry`).body).delivery_state).toBe('queued')
    expect(call('POST', `/api/v1/inbox/messages/${failed.id}/retry`).status).toBe(422)
  })

  it('creates a channel without ever echoing a secret', () => {
    const created = call('POST', '/api/v1/inbox/channels', { name: 'جديدة', kind: 'whatsapp', phone_number_id: '12345678', business_account_id: '87654321', access_token: 'x'.repeat(20), app_secret: 'y'.repeat(20) })
    const channel = InboxChannelSchema.parse(created.body)
    expect(channel.has_access_token).toBe(true)
    expect(JSON.stringify(created.body)).not.toContain('xxxxx')
  })

  it('applies a preset idempotently', () => {
    call('POST', '/api/v1/settings/inbox/presets/clinic')
    const once = (call('GET', '/api/v1/inbox/tags').body as { total: number }).total
    call('POST', '/api/v1/settings/inbox/presets/clinic')
    expect((call('GET', '/api/v1/inbox/tags').body as { total: number }).total).toBe(once)
    expect(call('POST', '/api/v1/settings/inbox/presets/unknown').status).toBe(404)
  })

  it('refuses an assignee who is not an agent', () => {
    expect(call('PATCH', '/api/v1/inbox/conversations/4', { assignee_id: 999 }).status).toBe(422)
    expect(InboxConversationDetailSchema.parse(call('PATCH', '/api/v1/inbox/conversations/4', { assignee_id: 5, state: 'pending', tag_ids: [1, 2] }).body).tags).toHaveLength(2)
  })

  describe('templates', () => {
    const write = (extra: object = {}) => ({
      name: 'new_template', language: 'ar', category: 'utility', allow_category_change: true, header: null, body: 'مرحبا {{1}}', body_examples: ['فهد'], footer: null, buttons: [], ...extra,
    })
    const sendTo = (body: object) => call('POST', '/api/v1/inbox/conversations/2/messages', body)

    it('serves every template in the contract shape and filters by status, category and name', () => {
      const ids = (query: string) => InboxTemplateListSchema.parse(call('GET', `/api/v1/inbox/channels/1/templates?${query}`).body).items.map(item => item.id)
      expect(ids('')).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(ids('status=approved')).toEqual([1, 2, 4, 6, 7])
      expect(ids('status=rejected')).toEqual([3])
      expect(ids('category=authentication')).toEqual([4])
      expect(ids('q=follow')).toEqual([2])
      expect(InboxTemplateSchema.parse(call('GET', '/api/v1/inbox/templates/3').body).status_reason).toContain('Meta')
      expect(call('GET', '/api/v1/inbox/templates/99').status).toBe(404)
    })

    it('creates a pending template, refuses a duplicate or a Meta rejection with the message and field', () => {
      const created = call('POST', '/api/v1/inbox/channels/1/templates', write())
      expect(created.status).toBe(201)
      expect(InboxTemplateSchema.parse(created.body)).toMatchObject({ status: 'pending', param_count: 1, editable: false })
      expect(call('POST', '/api/v1/inbox/channels/1/templates', write()).body).toMatchObject({ code: 'invalid', field: 'name' })
      expect(call('POST', '/api/v1/inbox/channels/1/templates', write({ name: 'other', body: 'forbidden {{1}}' })).body).toMatchObject({ field: 'body' })
    })

    it('stores Meta\'s fixed text for an authentication template', () => {
      const auth = call('POST', '/api/v1/inbox/channels/1/templates', { name: 'otp', language: 'ar', category: 'authentication', add_security_recommendation: false, code_expiration_minutes: 5, otp_button_text: 'نسخ' })
      expect(InboxTemplateSchema.parse(auth.body)).toMatchObject({ category: 'authentication', param_count: 1, buttons: [], otp_button_text: 'نسخ', footer: expect.stringContaining('5') })
    })

    it('needs the app id and a sample file for a media header', () => {
      const sample = call('POST', '/api/v1/inbox/channels/1/templates/uploads', { name: 'a.png', mimetype: 'image/png', data: 'aGVsbG8=' })
      expect(sample.status).toBe(201)
      const header = { type: 'image', example_attachment_id: (sample.body as { id: number }).id }
      expect(InboxTemplateSchema.parse(call('POST', '/api/v1/inbox/channels/1/templates', write({ header })).body).header).toMatchObject({ type: 'image' })
      expect(call('POST', '/api/v1/inbox/channels/1/templates', write({ name: 'x2', header: { type: 'image', example_attachment_id: 999 } })).body).toMatchObject({ field: 'header' })
      call('PATCH', '/api/v1/inbox/channels/1', { app_id: null })
      expect(call('POST', '/api/v1/inbox/channels/1/templates', write({ name: 'x3', header })).body).toMatchObject({ field: 'app_id' })
    })

    it('flags a template WebVue cannot fill, and refuses to edit or send it', () => {
      const items = InboxTemplateListSchema.parse(call('GET', '/api/v1/inbox/channels/1/templates').body).items
      expect(items.filter(item => !item.supported).map(item => item.id)).toEqual([6])
      expect(call('PATCH', '/api/v1/inbox/templates/6', write({ name: 'named_greeting' })).status).toBe(422)
      expect(sendTo({ template_id: 6, params: [] }).status).toBe(422)
    })

    it('edits an editable template, refuses a rename and a locked template, and deletes', () => {
      expect(InboxTemplateSchema.parse(call('PATCH', '/api/v1/inbox/templates/3', write({ name: 'summer_offer', body: 'جديد' , body_examples: [] })).body).status).toBe('pending')
      expect(call('PATCH', '/api/v1/inbox/templates/2', write({ name: 'renamed' })).body).toMatchObject({ field: 'name' })
      expect(call('PATCH', '/api/v1/inbox/templates/5', write({ name: 'weekly_digest' })).status).toBe(422)
      expect(call('DELETE', '/api/v1/inbox/templates/2').status).toBe(204)
      expect(call('GET', '/api/v1/inbox/templates/2').status).toBe(404)
    })

    it('sends only an approved template with its header and button values', () => {
      expect(sendTo({ template_id: 5, params: ['1'] }).status).toBe(422)
      expect(sendTo({ template_id: 1, params: ['فهد', 'الخميس'] }).body).toMatchObject({ field: 'button_params' })
      const reminder = InboxMessageSchema.parse(sendTo({ template_id: 1, params: ['فهد', 'الخميس'], button_params: [{ index: 1, value: '4521' }] }).body)
      expect(reminder.template).toMatchObject({ name: 'appointment_reminder', header_text: 'تذكير بموعدك', footer: 'عيادة الأمل', buttons: [{ type: 'quick_reply' }, { type: 'url' }] })
      expect(sendTo({ template_id: 2, params: [] }).body).toMatchObject({ field: 'header_attachment_id' })
      const file = call('POST', '/api/v1/inbox/conversations/2/uploads', { name: 'a.png', mimetype: 'image/png', data: 'aGVsbG8=' }).body as { id: number }
      const withImage = InboxMessageSchema.parse(sendTo({ template_id: 2, params: [], header_attachment_id: file.id }).body)
      expect(withImage.attachments).toHaveLength(1)
      expect(sendTo({ template_id: 4, params: ['918273'] }).status).toBe(200)
    })
  })

  describe('automation', () => {
    const rule = (extra: object = {}) => ({
      channel_id: null, name: 'استفسار الأسعار', active: true, match_kind: 'contains', keywords: ['سعر'], option_id: null, hours: 'any', stop: true,
      reply: { body: 'الأسعار في القائمة.' }, resolve: false, department_id: null, assignee_id: null, tag_ids: [], priority: null, ...extra,
    })
    const test = (body: object) => InboxRuleTestResultSchema.parse(call('POST', '/api/v1/inbox/rules/test', { channel_id: 1, text: null, option_id: null, at: null, ...body }).body)

    it('serves the settings, hours, automatic messages and rules in the contract shape', () => {
      expect(InboxSettingsSchema.parse(call('GET', '/api/v1/settings/inbox').body)).toMatchObject({ assignment_policy: 'manual', first_response_alert_minutes: 0 })
      expect(InboxWorkingHoursSchema.parse(call('GET', '/api/v1/inbox/working-hours').body).days.length).toBeGreaterThan(0)
      expect(InboxDepartmentWorkingHoursSchema.parse(call('GET', '/api/v1/inbox/departments/1/working-hours').body).working_hours).toBeNull()
      expect(InboxChannelAutomationSchema.parse(call('GET', '/api/v1/inbox/channels/1/automation').body).welcome.enabled).toBe(true)
      expect(call('GET', '/api/v1/inbox/automation/channels').body).toEqual({ items: [{ id: 1, name: 'واتساب الاستقبال' }], total: 1 })
      expect(call('POST', '/api/v1/inbox/rules/test', { channel_id: 1, text: 'x' }).status).toBe(422)
      expect(InboxRuleListSchema.parse(call('GET', '/api/v1/inbox/rules').body).total).toBe(2)
      const messages = InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/messages?limit=100').body).items
      expect(messages.some(item => item.automated)).toBe(true)
      expect(messages.some(item => item.direction === 'note' && item.author === null && !item.automated)).toBe(true)
      expect(InboxConversationDetailSchema.parse(call('GET', '/api/v1/inbox/conversations/3').body).csat).toMatchObject({ score: 'good' })
    })

    it('saves hours, refuses a backwards range, and gives a department its own hours or none', () => {
      const hours = { timezone: 'Asia/Dubai', days: [{ weekday: 1, from: '08:00', to: '12:00' }], holidays: [] }
      expect(InboxWorkingHoursSchema.parse(call('PUT', '/api/v1/inbox/working-hours', hours).body)).toEqual(hours)
      expect(call('PUT', '/api/v1/inbox/working-hours', { ...hours, days: [{ weekday: 1, from: '12:00', to: '08:00' }] })).toMatchObject({ status: 422, body: { code: 'invalid', field: 'days' } })
      expect(InboxDepartmentWorkingHoursSchema.parse(call('PUT', '/api/v1/inbox/departments/2/working-hours', { working_hours: hours }).body).working_hours).toEqual(hours)
      expect(InboxDepartmentWorkingHoursSchema.parse(call('PUT', '/api/v1/inbox/departments/2/working-hours', { working_hours: null }).body).working_hours).toBeNull()
      expect(call('GET', '/api/v1/inbox/departments/99/working-hours').status).toBe(404)
    })

    it('refuses an enabled automatic message without content and a policy it does not know', () => {
      expect(call('PATCH', '/api/v1/inbox/channels/1/automation', { away: { enabled: true, repeat_hours: 12, content: null } })).toMatchObject({ status: 422, body: { field: 'away.content' } })
      const away = { enabled: true, repeat_hours: 6, content: { body: 'خارج الدوام' } }
      expect(InboxChannelAutomationSchema.parse(call('PATCH', '/api/v1/inbox/channels/1/automation', { away }).body).away).toEqual(away)
      expect(call('PATCH', '/api/v1/settings/inbox', { assignment_policy: 'random' }).status).toBe(422)
      expect(InboxSettingsSchema.parse(call('PATCH', '/api/v1/settings/inbox', { assignment_policy: 'round_robin', first_response_alert_minutes: 15 }).body).assignment_policy).toBe('round_robin')
    })

    it('creates, edits, reorders and deletes rules, refusing a rule without keywords or action', () => {
      const created = call('POST', '/api/v1/inbox/rules', rule())
      expect(created.status).toBe(201)
      const id = InboxRuleSchema.parse(created.body).id
      expect(call('POST', '/api/v1/inbox/rules', rule({ keywords: [] }))).toMatchObject({ status: 422, body: { field: 'keywords' } })
      expect(call('POST', '/api/v1/inbox/rules', rule({ reply: null }))).toMatchObject({ status: 422, body: { field: 'reply' } })
      expect(InboxRuleSchema.parse(call('PATCH', `/api/v1/inbox/rules/${id}`, { active: false }).body)).toMatchObject({ active: false, name: 'استفسار الأسعار' })
      expect(InboxRuleListSchema.parse(call('POST', '/api/v1/inbox/rules/reorder', { ids: [id, 1, 2] }).body).items.map(item => item.id)).toEqual([id, 1, 2])
      expect(InboxRuleListSchema.parse(call('GET', '/api/v1/inbox/rules').body).items.map(item => item.id)).toEqual([id, 1, 2])
      expect(call('POST', '/api/v1/inbox/rules/reorder', { ids: [1] }).status).toBe(422)
      expect(call('DELETE', `/api/v1/inbox/rules/${id}`).status).toBe(204)
      expect(call('GET', `/api/v1/inbox/rules/${id}`).status).toBe(404)
    })

    it('dry-runs the rules: words ignore diacritics, a stop ends the search, an inactive rule never fires', () => {
      expect(test({ text: 'أريد حَجْز موعد' }).rules.map(item => item.id)).toEqual([1])
      expect(test({ text: 'شكوى من التأخير' }).rules.map(item => item.id)).toEqual([2])
      call('PATCH', '/api/v1/inbox/rules/2', { stop: false, active: true })
      call('POST', '/api/v1/inbox/rules', rule({ match_kind: 'any', keywords: [], name: 'كل شيء' }))
      expect(test({ text: 'شكوى' }).rules.map(item => item.name)).toEqual(['شكوى عاجلة', 'كل شيء'])
      call('PATCH', '/api/v1/inbox/rules/1', { active: false })
      expect(test({ text: 'حجز' }).rules.map(item => item.name)).toEqual(['كل شيء'])
      expect(call('POST', '/api/v1/inbox/rules/test', { channel_id: 9, text: 'x', option_id: null, at: null }).status).toBe(422)
    })

    it('answers the welcome inside hours and the away message outside them', () => {
      const monday10 = '2026-10-26T07:00:00Z'
      const monday22 = '2026-10-26T19:00:00Z'
      expect(test({ at: monday10 })).toMatchObject({ inside_hours: true, auto_message: 'welcome' })
      call('PATCH', '/api/v1/inbox/channels/1/automation', { away: { enabled: true, repeat_hours: 12, content: { body: 'خارج الدوام' } } })
      expect(test({ at: monday22 })).toMatchObject({ inside_hours: false, auto_message: 'away' })
      expect(test({ at: '2026-09-23T07:00:00Z' }).inside_hours).toBe(false)
    })
  })
})

describe('inbox audit mock: catalog and orders', () => {
  beforeEach(() => resetInboxPreview())
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(32)
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bytes)
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    return { name: 'a.png', mimetype: 'image/png', data: bytes.toString('base64') }
  }

  it('serves contract-valid catalogs, items, channel commerce and the picker', () => {
    expect(InboxCatalogListSchema.parse(call('GET', '/api/v1/inbox/catalogs').body).items[0]!.counts.items).toBe(6)
    expect(InboxCatalogSchema.parse(call('GET', '/api/v1/inbox/catalogs/1').body).channels).toHaveLength(1)
    expect(InboxCatalogItemListSchema.parse(call('GET', '/api/v1/inbox/catalogs/1/items').body).total).toBe(6)
    expect(InboxCatalogItemSchema.parse(call('GET', '/api/v1/inbox/catalog-items/1').body).price).toBe(51.75)
    expect(InboxChannelCommerceSchema.parse(call('GET', '/api/v1/inbox/channels/1/commerce').body).catalog).toEqual({ id: 1, name: 'كتالوج المتجر' })
    expect(InboxCatalogPickItemListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/catalog-items').body).items.map(item => item.product_retailer_id)).toEqual(['wv-101', 'wv-102', 'wv-104'])
  })

  it('filters the items and refuses what Meta or the server refuses', () => {
    const items = (query: string) => (call('GET', `/api/v1/inbox/catalogs/1/items?${query}`).body as { items: { id: number }[] }).items.map(item => item.id)
    expect(items('sync_state=error')).toEqual([5])
    expect(items('review_status=rejected')).toEqual([6])
    expect(items('q=قهوة')).toEqual([1])
    expect(call('POST', '/api/v1/inbox/catalogs', { channel_id: 1, meta_catalog_id: '1234567', connect: true, brand: 'x', default_link: null, prices_include_tax: true }).status).toBe(409)
  })

  it('connects a checked catalog and maps provider refusals', () => {
    call('DELETE', '/api/v1/inbox/catalogs/1')
    const body = { channel_id: 1, connect: true, brand: 'متجر', default_link: null, prices_include_tax: true }
    expect(call('POST', '/api/v1/inbox/catalogs', { ...body, meta_catalog_id: '1234000' }).body).toMatchObject({ field: 'meta_catalog_id' })
    expect(call('POST', '/api/v1/inbox/catalogs', { ...body, meta_catalog_id: '1234999' }).body).toMatchObject({ code: 'provider_permission' })
    const created = call('POST', '/api/v1/inbox/catalogs', { ...body, meta_catalog_id: '1234567' })
    expect(created.status).toBe(201)
    expect(InboxCatalogSchema.parse(created.body).state).toBe('connected')
    expect(call('GET', '/api/v1/inbox/conversations/1/catalog-items').status).toBe(200)
  })

  it('adds an existing product, and a new one only with a big enough picture', () => {
    expect(call('POST', '/api/v1/inbox/catalogs/1/items', { product_id: 204 }).body).toMatchObject({ field: 'product_id' })
    expect(InboxCatalogItemSchema.parse(call('POST', '/api/v1/inbox/catalogs/1/items', { product_id: 201 }).body).product_retailer_id).toBe('wv-201')
    const made = { name: 'منتج', description: null, list_price: 10 }
    expect(call('POST', '/api/v1/inbox/catalogs/1/items', { product: { ...made, image: png(499, 500) } }).body).toMatchObject({ field: 'product.image' })
    expect(call('POST', '/api/v1/inbox/catalogs/1/items', { product: { ...made, image: { ...png(600, 600), mimetype: 'image/gif' } } }).status).toBe(422)
    const created = call('POST', '/api/v1/inbox/catalogs/1/items', { product: { ...made, image: png(600, 600) } })
    expect(created.status).toBe(201)
    expect(InboxCatalogItemSchema.parse(created.body).sync_state).toBe('pending')
  })

  it('keeps the retailer id once synced and deletes an item', () => {
    expect(call('PATCH', '/api/v1/inbox/catalog-items/1', { product_retailer_id: 'other' }).status).toBe(422)
    expect(call('PATCH', '/api/v1/inbox/catalog-items/3', { product_retailer_id: 'other' }).status).toBe(200)
    expect(call('DELETE', '/api/v1/inbox/catalog-items/3').status).toBe(204)
    expect(call('GET', '/api/v1/inbox/catalog-items/3').status).toBe(404)
  })

  it('lists the company products that may be listed, with image and listed flags', () => {
    const options = InboxCatalogProductOptionListSchema.parse(call('GET', '/api/v1/inbox/catalogs/1/products').body)
    expect(options.items.map(item => [item.id, item.has_image, item.listed])).toEqual([[201, true, false], [202, true, false], [203, true, false], [204, false, false]])
    expect(InboxCatalogProductOptionListSchema.parse(call('GET', '/api/v1/inbox/catalogs/1/products?q=عسل').body).items.map(item => item.id)).toEqual([202])
    call('POST', '/api/v1/inbox/catalogs/1/items', { product_id: 201 })
    expect(InboxCatalogProductOptionListSchema.parse(call('GET', '/api/v1/inbox/catalogs/1/products').body).items[0]).toMatchObject({ id: 201, listed: true })
  })

  it('keeps the paid notice on the channel and refuses an empty or too long text', () => {
    expect(InboxChannelCommerceSchema.parse(call('GET', '/api/v1/inbox/channels/1/commerce').body)).toMatchObject({ paid_notice_enabled: true, paid_notice_text: expect.stringContaining('{reference}') })
    expect(InboxChannelCommerceSchema.parse(call('PATCH', '/api/v1/inbox/channels/1/commerce', { paid_notice_enabled: false, paid_notice_text: 'شكرًا {reference}' }).body)).toMatchObject({ paid_notice_enabled: false, paid_notice_text: 'شكرًا {reference}' })
    expect(call('PATCH', '/api/v1/inbox/channels/1/commerce', { paid_notice_text: ' ' }).body).toMatchObject({ field: 'paid_notice_text' })
    expect(call('PATCH', '/api/v1/inbox/channels/1/commerce', { paid_notice_text: 'x'.repeat(1025) }).status).toBe(422)
  })

  it('toggles a number\'s switches', () => {
    expect(InboxChannelCommerceSchema.parse(call('PATCH', '/api/v1/inbox/channels/1/commerce', { catalog_visible: true }).body).catalog_visible).toBe(true)
  })

  it('sends product messages inside the window, only with synced products', () => {
    const list = { type: 'product_list', header: 'عروض', body: 'اختر', footer: null, sections: [{ title: 'المنتجات', product_retailer_ids: ['wv-101', 'wv-102'] }] }
    const sent = InboxMessageSchema.parse(call('POST', '/api/v1/inbox/conversations/1/messages', { commerce: list }).body)
    expect(sent).toMatchObject({ kind: 'product_list', commerce: { type: 'sent', products: [{ product_retailer_id: 'wv-101' }, { product_retailer_id: 'wv-102' }] } })
    expect(call('POST', '/api/v1/inbox/conversations/1/messages', { commerce: { ...list, sections: [{ title: 'م', product_retailer_ids: ['wv-103'] }] } }).body).toMatchObject({ field: 'commerce' })
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { commerce: list }).status).toBe(422)
    expect(InboxMessageSchema.parse(call('POST', '/api/v1/inbox/conversations/1/messages', { commerce: { type: 'product', body: null, footer: null, product_retailer_id: 'wv-101' } }).body).kind).toBe('product')
  })

  it('shows the seeded cart and the commerce kinds in a thread', () => {
    const items = InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/4/messages?limit=100').body).items
    expect(items.map(item => item.commerce?.type).filter(Boolean)).toEqual(['sent', 'inquiry', 'order'])
    const cart = items.find(item => item.commerce?.type === 'order')!.commerce as { order: { id: number; state: string } | null; lines: { product: unknown }[] }
    expect(cart.order).toMatchObject({ state: 'cart' })
    expect(cart.lines.map(line => line.product === null)).toEqual([false, false, true])
  })

  it('lists orders and edits a cart, refusing a locked one', () => {
    expect(InboxOrderListSchema.parse(call('GET', '/api/v1/inbox/orders').body).total).toBe(1)
    expect(InboxOrderListSchema.parse(call('GET', '/api/v1/inbox/conversations/4/orders').body).total).toBe(1)
    expect(InboxOrderListSchema.parse(call('GET', '/api/v1/inbox/orders?state=ordered').body).total).toBe(0)
    const order = InboxOrderSchema.parse(call('GET', '/api/v1/inbox/orders/1').body)
    expect(order).toMatchObject({ state: 'cart', price_changed: true })
    const patched = InboxOrderSchema.parse(call('PATCH', '/api/v1/inbox/orders/1', { lines: [{ id: order.lines[0]!.id, quantity: 3 }, { catalog_item_id: 2, quantity: 1 }] }).body)
    expect(patched.lines.map(line => line.quantity)).toEqual([3, 1])
  })

  it('builds an order for the customer, checks it out once, takes payment and cancels', () => {
    const made = InboxOrderSchema.parse(call('POST', '/api/v1/inbox/conversations/1/orders', { lines: [{ catalog_item_id: 1, quantity: 2 }] }).body)
    expect(made).toMatchObject({ state: 'cart', message_id: null, total: 103.5 })
    const result = InboxOrderCheckoutResultSchema.parse(call('POST', `/api/v1/inbox/orders/${made.id}/checkout`, {}).body)
    expect(result.order).toMatchObject({ state: 'ordered', payment: { status: 'payable' } })
    expect(result.order.reference).toMatch(/^S\d{5}$/)
    const again = InboxOrderCheckoutResultSchema.parse(call('POST', `/api/v1/inbox/orders/${made.id}/checkout`, {}).body)
    expect(again.order.reference).toBe(result.order.reference)
    expect(call('PATCH', `/api/v1/inbox/orders/${made.id}`, { lines: [{ id: made.lines[0]!.id, quantity: 1 }] }).status).toBe(409)
    expect(InboxOrderSchema.parse(call('POST', `/api/v1/inbox/__mock/orders/${made.id}/paid`).body).payment?.status).toBe('paid')
    expect(call('POST', `/api/v1/inbox/orders/${made.id}/checkout`, {}).status).toBe(409)
    const notes = InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/messages?limit=100').body).items.filter(item => item.direction === 'note')
    expect(notes.at(-1)!.body).toContain(result.order.reference!)
  })

  it('refuses a checkout with an unknown line, and after the window asks for a pay-link template', () => {
    expect(call('POST', '/api/v1/inbox/orders/1/checkout', {}).body).toMatchObject({ field: 'lines' })
    const closed = InboxOrderSchema.parse(call('POST', '/api/v1/inbox/conversations/2/orders', { lines: [{ catalog_item_id: 1, quantity: 1 }] }).body)
    expect(call('POST', `/api/v1/inbox/orders/${closed.id}/checkout`, {}).body).toMatchObject({ code: 'window_closed' })
    expect(call('POST', `/api/v1/inbox/orders/${closed.id}/checkout`, { template_id: 1 }).body).toMatchObject({ field: 'template_id' })
    expect(InboxOrderCheckoutResultSchema.parse(call('POST', `/api/v1/inbox/orders/${closed.id}/checkout`, { template_id: 7 }).body).order.state).toBe('ordered')
  })

  it('dismisses a cart, cancels an unpaid order, and receives a customer cart', () => {
    expect(InboxOrderSchema.parse(call('POST', '/api/v1/inbox/orders/1/cancel').body).state).toBe('dismissed')
    const cart = call('POST', '/api/v1/inbox/__mock/conversations/1/cart', { lines: [{ retailer_id: 'wv-101', quantity: 1 }], text: 'أريد' }).body as { order: { id: number } }
    const messages = InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/messages?limit=100').body).items
    expect(messages.at(-1)).toMatchObject({ kind: 'order', direction: 'in', commerce: { type: 'order', order: { id: cart.order.id, state: 'cart' } } })
  })
})
