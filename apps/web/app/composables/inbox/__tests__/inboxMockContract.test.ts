import { beforeEach, describe, expect, it } from 'vitest'
import {
  InboxAudienceListSchema, InboxAudienceMemberListSchema, InboxAudienceSchema, InboxCampaignListSchema, InboxCampaignPreviewSchema, InboxCampaignRecipientListSchema,
  InboxCampaignSchema, InboxCampaignSettingsSchema, InboxCampaignTestResultSchema, InboxChannelSendingSchema, InboxContactImportResultSchema, InboxContactMarketingSchema,
  InboxAttachmentSchema, InboxCannedReplyListSchema, InboxChannelListSchema, InboxChannelSchema, InboxConversationDetailSchema, InboxConversationListSchema,
  InboxBusinessProfileSchema, InboxChannelAlertListSchema, InboxChannelAutomationSchema, InboxCostReportSchema, InboxReportBreakdownSchema, InboxReportOverviewSchema,
  InboxTemplateAnalyticsDetailSchema, InboxTemplateAnalyticsListSchema, InboxDepartmentListSchema, InboxDepartmentWorkingHoursSchema, InboxMessageListSchema, InboxRefSchema, InboxRuleListSchema, InboxRuleSchema, InboxRuleTestResultSchema, InboxWorkingHoursSchema, InboxMessageSchema, InboxSettingsSchema, InboxTagListSchema, InboxTemplateListSchema, InboxTemplateSchema,
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
    expect(InboxTemplateListSchema.parse(call('GET', '/api/v1/inbox/channels/1/templates').body).total).toBe(6)
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
      expect(ids('')).toEqual([1, 2, 3, 4, 5, 6])
      expect(ids('status=approved')).toEqual([1, 2, 4, 6])
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

  describe('number health and business profile', () => {
    const channel = () => InboxChannelSchema.parse(call('GET', '/api/v1/inbox/channels/1').body)

    it('gives every channel a health block, a new one an empty block, and the test fills and stamps it', () => {
      expect(channel().health).toMatchObject({ quality_rating: 'green', messaging_limit: 'tier_2k', account_state: 'active', template_insights_enabled: false })
      const created = InboxChannelSchema.parse(call('POST', '/api/v1/inbox/channels', { name: 'جديدة', kind: 'whatsapp', phone_number_id: '12345678', business_account_id: '87654321', access_token: 'x'.repeat(20), app_secret: 'y'.repeat(20) }).body)
      expect(created.health).toMatchObject({ quality_rating: 'unknown', checked_at: null, display_phone_number: null })
      const tested = InboxChannelSchema.parse(call('POST', `/api/v1/inbox/channels/${created.id}/test`).body)
      expect(tested.health.checked_at).not.toBeNull()
    })

    it('lists the alert timeline newest first and pages it', () => {
      const alerts = InboxChannelAlertListSchema.parse(call('GET', '/api/v1/inbox/channels/1/alerts').body)
      expect(alerts.total).toBe(3)
      expect(alerts.items.map(item => item.kind)).toEqual(['name_rejected', 'quality_changed', 'messaging_limit_changed'])
      expect(InboxChannelAlertListSchema.parse(call('GET', '/api/v1/inbox/channels/1/alerts?limit=1&offset=1').body).items.map(item => item.id)).toEqual([2])
    })

    it('requests a display name, which waits for review and writes a timeline row', () => {
      expect(call('POST', '/api/v1/inbox/channels/1/display-name', { name: 'ab' }).status).toBe(422)
      expect(InboxChannelSchema.parse(call('POST', '/api/v1/inbox/channels/1/display-name', { name: 'عيادة الأمل الجديدة' }).body).health).toMatchObject({ name_status: 'pending_review', requested_name: 'عيادة الأمل الجديدة' })
      expect(InboxChannelAlertListSchema.parse(call('GET', '/api/v1/inbox/channels/1/alerts').body).items[0]).toMatchObject({ kind: 'name_pending', severity: 'info' })
    })

    it('takes a six-digit PIN once and answers without a body; the PIN is never echoed', () => {
      expect(call('POST', '/api/v1/inbox/channels/1/two-step-pin', { pin: '12345' }).status).toBe(422)
      const done = call('POST', '/api/v1/inbox/channels/1/two-step-pin', { pin: '482910' })
      expect(done.status).toBe(204)
      expect(JSON.stringify(done)).not.toContain('482910')
      expect(call('POST', '/api/v1/inbox/channels/1/register', { pin: 'abcdef' }).status).toBe(422)
      expect(JSON.stringify(call('POST', '/api/v1/inbox/channels/1/register', { pin: '482910' }).body)).not.toContain('482910')
    })

    it('enables template insights once and syncs analytics', () => {
      expect(InboxChannelSchema.parse(call('POST', '/api/v1/inbox/channels/1/template-insights', {}).body).health.template_insights_enabled).toBe(true)
      expect(InboxChannelSchema.parse(call('POST', '/api/v1/inbox/channels/1/analytics/sync', {}).body).health.analytics_error).toBeNull()
    })

    it('reads and patches the profile with Meta\'s limits, and needs the app id for a picture', () => {
      expect(InboxBusinessProfileSchema.parse(call('GET', '/api/v1/inbox/channels/1/profile').body).websites).toHaveLength(1)
      expect(call('PATCH', '/api/v1/inbox/channels/1/profile', { about: '' }).body).toMatchObject({ field: 'about' })
      expect(call('PATCH', '/api/v1/inbox/channels/1/profile', { about: 'x'.repeat(140) }).status).toBe(422)
      expect(call('PATCH', '/api/v1/inbox/channels/1/profile', { websites: ['ftp://x.test'] }).body).toMatchObject({ field: 'websites' })
      const patched = InboxBusinessProfileSchema.parse(call('PATCH', '/api/v1/inbox/channels/1/profile', { about: 'نبذة جديدة', address: '', vertical: 'retail' }).body)
      expect(patched).toMatchObject({ about: 'نبذة جديدة', address: null, vertical: 'retail' })
      const picture = { name: 'a.png', mimetype: 'image/png', data: 'aGVsbG8=' }
      expect(InboxBusinessProfileSchema.parse(call('PUT', '/api/v1/inbox/channels/1/profile/picture', picture).body).picture_url).not.toBeNull()
      expect(call('PUT', '/api/v1/inbox/channels/1/profile/picture', { ...picture, mimetype: 'image/gif' }).status).toBe(422)
      call('PATCH', '/api/v1/inbox/channels/1', { app_id: null })
      expect(call('PUT', '/api/v1/inbox/channels/1/profile/picture', picture).body).toMatchObject({ field: 'app_id' })
    })
  })

  describe('reports', () => {
    const RANGE = 'from=2026-10-01&to=2026-10-30'

    it('serves an overview that is contract-valid, with the previous period, a daily series and consistent buckets', () => {
      const overview = InboxReportOverviewSchema.parse(call('GET', `/api/v1/inbox/reports/overview?${RANGE}`).body)
      expect(overview).toMatchObject({ granularity: 'day', timezone: 'Asia/Riyadh' })
      expect(overview.series).toHaveLength(30)
      const buckets = overview.totals.first_response.buckets
      expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(overview.totals.first_response.count)
      expect(overview.series.reduce((sum, point) => sum + point.messages_in, 0)).toBe(overview.totals.messages_in)
      expect(overview.previous.messages_in).toBeGreaterThan(0)
    })

    it('switches the granularity at 62 and 190 days and refuses a range the server refuses', () => {
      const granularity = (from: string) => InboxReportOverviewSchema.parse(call('GET', `/api/v1/inbox/reports/overview?from=${from}&to=2026-10-30`).body).granularity
      expect(granularity('2026-08-30')).toBe('day')
      expect(granularity('2026-08-29')).toBe('week')
      expect(granularity('2026-04-24')).toBe('week')
      expect(granularity('2026-04-23')).toBe('month')
      expect(call('GET', '/api/v1/inbox/reports/overview?from=2025-10-29&to=2026-10-30').status).toBe(422)
      expect(call('GET', '/api/v1/inbox/reports/overview?from=2026-10-30&to=2026-10-01').status).toBe(422)
      expect(call('GET', '/api/v1/inbox/reports/overview').status).toBe(422)
      expect(call('GET', `/api/v1/inbox/reports/overview?${RANGE}&channel_id=99`).status).toBe(404)
    })

    it('narrows the totals when an agent or a department is chosen', () => {
      const total = (extra: string) => InboxReportOverviewSchema.parse(call('GET', `/api/v1/inbox/reports/overview?${RANGE}${extra}`).body).totals.messages_in
      expect(total('&agent_id=5')).toBeLessThan(total(''))
      expect(total('&department_id=1')).toBeLessThan(total(''))
    })

    it('breaks down by agent, department and channel, with the unattributed row, and refuses the agent filter with by=agent', () => {
      const rows = (by: string) => InboxReportBreakdownSchema.parse(call('GET', `/api/v1/inbox/reports/breakdown?by=${by}&${RANGE}`).body).items
      expect(rows('agent').some(row => row.subject === null)).toBe(true)
      expect(rows('agent').map(row => row.metrics.conversations_resolved)).toEqual([...rows('agent').map(row => row.metrics.conversations_resolved)].sort((a, b) => b - a))
      expect(rows('department').map(row => row.subject?.name)).toEqual(expect.arrayContaining(['الاستقبال', 'المبيعات']))
      expect(rows('channel')).toHaveLength(1)
      expect(call('GET', `/api/v1/inbox/reports/breakdown?by=agent&agent_id=5&${RANGE}`).status).toBe(422)
      expect(call('GET', `/api/v1/inbox/reports/breakdown?by=color&${RANGE}`).status).toBe(422)
    })

    it('exports the breakdown as a UTF-8 CSV with a byte order mark', () => {
      const answer = call('GET', `/api/v1/inbox/reports/export?by=agent&${RANGE}`) as unknown as { file: { filename: string; body: string } }
      expect(answer.file.filename).toBe('inbox-agent.csv')
      expect(answer.file.body.charCodeAt(0)).toBe(0xFEFF)
      expect(answer.file.body.split('\n')[0]).toContain('resolved')
    })

    it('serves costs with the billing currency, the free and paid split and the channel sync state', () => {
      const report = InboxCostReportSchema.parse(call('GET', `/api/v1/inbox/reports/costs?${RANGE}`).body)
      expect(report.currency).toBe('USD')
      expect(report.totals.volume).toBe(report.totals.paid_volume + report.totals.free_volume)
      expect(report.series).toHaveLength(30)
      expect(report.channels).toHaveLength(1)
      expect(call('GET', '/api/v1/inbox/reports/costs?from=2026-10-01&to=2026-10-01&channel_id=99').status).toBe(404)
    })

    it('serves template analytics for a channel within 90 days and one template\'s detail with button clicks', () => {
      const range = 'from=2026-09-01&to=2026-10-30'
      expect(call('GET', `/api/v1/inbox/reports/templates?${range}`).status).toBe(422)
      const list = InboxTemplateAnalyticsListSchema.parse(call('GET', `/api/v1/inbox/reports/templates?channel_id=1&${range}`).body)
      expect(list.items.map(item => item.template.name)).toContain('appointment_reminder')
      expect(call('GET', '/api/v1/inbox/reports/templates?channel_id=1&from=2026-07-01&to=2026-10-30').status).toBe(422)
      const detail = InboxTemplateAnalyticsDetailSchema.parse(call('GET', `/api/v1/inbox/reports/templates/1?${range}`).body)
      expect(detail.series).toHaveLength(60)
      expect(detail.buttons.map(button => button.type)).toEqual(['quick_reply', 'url'])
      expect(call('GET', `/api/v1/inbox/reports/templates/99?${range}`).status).toBe(404)
    })
  })
})

describe('inbox campaigns mock', () => {
  beforeEach(() => resetInboxPreview())
  const csv = (text: string) => Buffer.from(text, 'utf8').toString('base64')
  const body = (path: string) => call('GET', path).body
  const params = [
    { location: 'body', position: 1, source: 'contact_first_name', value: 'عميلنا' },
    { location: 'body', position: 2, source: 'static', value: 'الخميس' },
    { location: 'button', position: 1, source: 'static', value: '4521' },
  ]
  const write = { name: 'جديدة', channel_id: 1, template_id: 1, audience_id: 1, params, header_attachment_id: null, scheduled_at: null, send_within_hours: false, daily_cap: 0 }

  it('serves contract-valid campaign lists, details, recipients and settings', () => {
    const list = InboxCampaignListSchema.parse(body('/api/v1/inbox/campaigns'))
    expect(list.items.map(item => item.state)).toEqual(['draft', 'running', 'done'])
    expect(InboxCampaignListSchema.parse(body('/api/v1/inbox/campaigns?state=done')).total).toBe(1)
    const done = InboxCampaignSchema.parse(body('/api/v1/inbox/campaigns/1'))
    expect(done.stats).toMatchObject({ total: 6, skipped: 1, failed: 2, unsubscribed: 1, replied: 1 })
    const recipients = InboxCampaignRecipientListSchema.parse(body('/api/v1/inbox/campaigns/1/recipients?failure=frequency_capped'))
    expect(recipients.items.map(item => item.can_retry)).toEqual([true])
    expect(InboxCampaignSettingsSchema.parse(body('/api/v1/settings/inbox/campaigns')).consent_policy).toBe('opted_in_only')
  })

  it('moves a running campaign on every read until it is done', () => {
    const before = InboxCampaignSchema.parse(body('/api/v1/inbox/campaigns/2')).stats
    for (let step = 0; step < 6; step += 1) body('/api/v1/inbox/campaigns/2')
    const after = InboxCampaignSchema.parse(body('/api/v1/inbox/campaigns/2'))
    expect(after.stats.pending).toBeLessThan(before.pending)
    expect(after.stats.delivered + after.stats.read).toBeGreaterThan(before.delivered + before.read)
    for (let step = 0; step < 12; step += 1) body('/api/v1/inbox/campaigns/2')
    expect(InboxCampaignSchema.parse(body('/api/v1/inbox/campaigns/2')).state).toBe('done')
  })

  it('creates, launches and pauses a campaign, refusing what the server refuses', () => {
    expect(call('POST', '/api/v1/inbox/campaigns', { ...write, params: params.slice(0, 2) }).status).toBe(422)
    expect(call('POST', '/api/v1/inbox/campaigns', { ...write, template_id: 4 }).status).toBe(422)
    expect(call('POST', '/api/v1/inbox/campaigns', { ...write, scheduled_at: '2020-01-01T00:00:00Z' }).status).toBe(422)
    const created = call('POST', '/api/v1/inbox/campaigns', write)
    expect(created.status).toBe(201)
    const id = InboxCampaignSchema.parse(created.body).id
    expect(call('PATCH', `/api/v1/inbox/campaigns/${id}`, { daily_cap: 5 }).status).toBe(200)
    const launched = InboxCampaignSchema.parse(call('POST', `/api/v1/inbox/campaigns/${id}/launch`).body)
    expect(launched.state).toBe('running')
    expect(launched.stats.total).toBeGreaterThan(0)
    expect(call('DELETE', `/api/v1/inbox/campaigns/${id}`).status).toBe(422)
    expect(call('PATCH', `/api/v1/inbox/campaigns/${id}`, { template_id: 2 }).status).toBe(422)
    expect(InboxCampaignSchema.parse(call('POST', `/api/v1/inbox/campaigns/${id}/pause`).body)).toMatchObject({ state: 'paused', pause_reason: 'manual' })
    expect(call('PATCH', `/api/v1/inbox/campaigns/${id}`, { template_id: 2 }).status).toBe(422)
    expect(call('PATCH', `/api/v1/inbox/campaigns/${id}`, { name: 'اسم آخر' }).status).toBe(200)
    expect(InboxCampaignSchema.parse(call('POST', `/api/v1/inbox/campaigns/${id}/cancel`).body).state).toBe('cancelled')
  })

  it('retries only the frequency-capped recipients old enough', () => {
    expect(InboxCampaignSchema.parse(call('POST', '/api/v1/inbox/campaigns/1/retry').body).state).toBe('running')
    expect(call('POST', '/api/v1/inbox/campaigns/3/retry').status).toBe(422)
  })

  it('renders a preview for a sample contact and lists the placeholders without a value', () => {
    const request = { template_id: 1, params: [{ location: 'body', position: 1, source: 'contact_first_name', value: null }], contact_id: 3 }
    const preview = InboxCampaignPreviewSchema.parse(call('POST', '/api/v1/inbox/campaigns/preview', request).body)
    expect(preview.body).toContain('منى')
    expect(preview.missing.map(item => item.position)).toContain(2)
    expect(call('POST', '/api/v1/inbox/campaigns/preview', { template_id: 99, params: [] }).status).toBe(404)
  })

  it('sends a test only to a contact the consent policy allows', () => {
    expect(InboxCampaignTestResultSchema.parse(call('POST', '/api/v1/inbox/campaigns/3/test', { contact_id: 1 }).body).conversation_id).toBe(1)
    expect(call('POST', '/api/v1/inbox/campaigns/3/test', { contact_id: 4 }).status).toBe(422)
  })

  it('serves audiences with live counts and members, and refuses to delete one a campaign uses', () => {
    const list = InboxAudienceListSchema.parse(body('/api/v1/inbox/audiences'))
    expect(list.items[0]).toMatchObject({ name: 'عملاء الحجز', contact_count: 6 })
    expect(list.items[0]!.reachable_count).toBeLessThan(list.items[0]!.contact_count)
    const members = InboxAudienceMemberListSchema.parse(body('/api/v1/inbox/audiences/1/members?consent=opted_in'))
    expect(members.items.every(item => item.consent === 'opted_in')).toBe(true)
    const created = call('POST', '/api/v1/inbox/audiences', { name: 'جديد', tag_ids: [1], tag_match: 'any', exclude_tag_ids: [], active_within_days: 0 })
    expect(created.status).toBe(201)
    expect(call('POST', '/api/v1/inbox/audiences', { name: 'جديد', tag_ids: [], tag_match: 'any', exclude_tag_ids: [], active_within_days: 0 }).status).toBe(422)
    expect(call('DELETE', '/api/v1/inbox/audiences/1').status).toBe(422)
    expect(call('DELETE', `/api/v1/inbox/audiences/${InboxAudienceSchema.parse(created.body).id}`).status).toBe(204)
  })

  it('records consent with its proof and keeps an opt-out through an import', () => {
    expect(call('PATCH', '/api/v1/inbox/contacts/4/marketing', { consent: { state: 'opted_in', note: ' ' } }).status).toBe(422)
    const optedIn = InboxContactMarketingSchema.parse(call('PATCH', '/api/v1/inbox/contacts/4/marketing', { consent: { state: 'opted_in', note: 'طلب في العيادة' }, tag_ids: [2] }).body)
    expect(optedIn).toMatchObject({ consent: 'opted_in', consent_source: 'agent' })
    expect(optedIn.tags.map(tag => tag.id)).toEqual([2])
    expect(InboxContactMarketingSchema.parse(body('/api/v1/inbox/contacts/2/marketing')).history.map(event => event.state)).toEqual(['opted_out', 'opted_in'])
    const imported = InboxContactImportResultSchema.parse(call('POST', '/api/v1/inbox/contacts/import', {
      name: 'c.csv', data: csv('\uFEFFphone,name\n0500000002,فهد\n0512345678,جديد\nabc,خطأ'), tag_ids: [2], consent: 'opted_in', consent_note: 'قائمة',
    }).body)
    expect(imported).toMatchObject({ created: 1, updated: 1, skipped: 1 })
    expect(imported.errors).toEqual([{ line: 4, message: expect.any(String) }])
    expect(InboxContactMarketingSchema.parse(body('/api/v1/inbox/contacts/2/marketing')).consent).toBe('opted_out')
    expect(call('POST', '/api/v1/inbox/contacts/import', { name: 'c.csv', data: csv('phone\n1'), tag_ids: [], consent: 'opted_in' }).status).toBe(422)
  })

  it('serves channel sending health, switches the API and refreshes from Meta', () => {
    expect(InboxChannelSendingSchema.parse(body('/api/v1/inbox/channels/1/sending'))).toMatchObject({ messaging_limit: 'tier_2k', marketing_api: 'cloud_api' })
    expect(InboxChannelSendingSchema.parse(call('PATCH', '/api/v1/inbox/channels/1/sending', { marketing_api: 'marketing_messages' }).body).marketing_api).toBe('marketing_messages')
    expect(call('PATCH', '/api/v1/inbox/channels/1/sending', { marketing_api: 'x' }).status).toBe(422)
    expect(InboxChannelSendingSchema.parse(call('POST', '/api/v1/inbox/channels/1/sending/refresh').body).checked_at).not.toBeNull()
    expect(call('GET', '/api/v1/inbox/channels/9/sending').status).toBe(404)
  })

  it('uploads a header file and keeps settings edits', () => {
    const upload = call('POST', '/api/v1/inbox/campaigns/uploads', { name: 'a.jpg', mimetype: 'image/jpeg', data: 'QUJD' })
    expect(InboxAttachmentSchema.parse(upload.body).name).toBe('a.jpg')
    expect(InboxCampaignSettingsSchema.parse(call('PATCH', '/api/v1/settings/inbox/campaigns', { consent_policy: 'not_opted_out' }).body).consent_policy).toBe('not_opted_out')
    expect(call('PATCH', '/api/v1/settings/inbox/campaigns', { default_country_code: '0' }).status).toBe(422)
  })
})
