import { beforeEach, describe, expect, it } from 'vitest'
import {
  InboxAttachmentSchema, InboxCannedReplyListSchema, InboxChannelListSchema, InboxChannelSchema, InboxConversationDetailSchema, InboxConversationListSchema,
  InboxDepartmentListSchema, InboxMessageListSchema, InboxMessageSchema, InboxRefSchema, InboxSettingsSchema, InboxTagListSchema, InboxTemplateListSchema, InboxTemplateSchema,
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
})
