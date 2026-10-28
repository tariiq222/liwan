import {
  InboxChannelSchema,
  InboxConversationListSchema,
  InboxConversationPatchSchema,
  InboxReplyCreateSchema,
  InboxSettingsPatchSchema,
} from '../index'

const CONVERSATION = {
  id: 1,
  contact: { id: 2, name: 'Sara', phone: '+966500000000', email: null },
  channel: { id: 3, name: 'Main WhatsApp', kind: 'whatsapp' },
  department: null,
  assignee: { id: 4, name: 'Agent' },
  state: 'open',
  priority: 'normal',
  tags: [],
  last_message_at: '2026-10-28T09:00:00Z',
  last_message_preview: 'Hello',
  unread: true,
  reply_window_ends_at: '2026-10-29T09:00:00Z',
}

describe('InboxConversationListSchema', () => {
  it('accepts the list envelope and rejects extra keys', () => {
    expect(InboxConversationListSchema.parse({ items: [CONVERSATION], total: 1 }).items[0]).toEqual(CONVERSATION)
    expect(() => InboxConversationListSchema.parse({ items: [{ ...CONVERSATION, secret: 1 }], total: 1 })).toThrow()
  })

  it('requires UTC timestamps', () => {
    expect(() => InboxConversationListSchema.parse({ items: [{ ...CONVERSATION, last_message_at: '2026-10-28 09:00' }], total: 1 })).toThrow()
  })
})

describe('InboxReplyCreateSchema', () => {
  it('takes either free text or a template with params, never both', () => {
    expect(InboxReplyCreateSchema.parse({ body: 'hi' })).toEqual({ body: 'hi' })
    expect(InboxReplyCreateSchema.parse({ template_id: 5, params: ['Sara'] })).toEqual({ template_id: 5, params: ['Sara'] })
    expect(() => InboxReplyCreateSchema.parse({ body: 'hi', template_id: 5, params: [] })).toThrow()
    expect(() => InboxReplyCreateSchema.parse({ body: '' })).toThrow()
  })
})

describe('InboxConversationPatchSchema', () => {
  it('allows clearing the assignee and rejects unknown fields', () => {
    expect(InboxConversationPatchSchema.parse({ assignee_id: null })).toEqual({ assignee_id: null })
    expect(() => InboxConversationPatchSchema.parse({ contact_id: 1 })).toThrow()
  })
})

describe('InboxSettingsPatchSchema', () => {
  it('bounds the numeric policies', () => {
    expect(InboxSettingsPatchSchema.parse({ retention_months: 24 })).toEqual({ retention_months: 24 })
    expect(() => InboxSettingsPatchSchema.parse({ retention_months: 0 })).toThrow()
    expect(() => InboxSettingsPatchSchema.parse({ visibility_policy: 'everyone' })).toThrow()
  })
})

describe('InboxChannelSchema', () => {
  it('never carries a secret value', () => {
    const keys = Object.keys(InboxChannelSchema.shape)
    expect(keys).not.toContain('access_token')
    expect(keys).not.toContain('app_secret')
    expect(keys).toContain('has_access_token')
  })
})
