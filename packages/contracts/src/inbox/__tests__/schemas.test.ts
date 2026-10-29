import {
  InboxChannelSchema,
  InboxConversationListSchema,
  InboxConversationPatchSchema,
  InboxInteractiveSchema,
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

describe('InboxInteractiveSchema', () => {
  const base = { body: 'اختر', header: null, footer: null }
  it('accepts up to three reply buttons and rejects a fourth or a long title', () => {
    const buttons = [1, 2, 3].map(id => ({ id: `b${id}`, title: `زر ${id}` }))
    expect(InboxInteractiveSchema.parse({ type: 'buttons', ...base, buttons }).type).toBe('buttons')
    expect(() => InboxInteractiveSchema.parse({ type: 'buttons', ...base, buttons: [...buttons, { id: 'b4', title: 'x' }] })).toThrow()
    expect(() => InboxInteractiveSchema.parse({ type: 'buttons', ...base, buttons: [{ id: 'b', title: 'x'.repeat(21) }] })).toThrow()
  })

  it('caps a list at ten rows across its sections', () => {
    const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, title: `خيار ${i}`, description: null }))
    expect(InboxInteractiveSchema.parse({ type: 'list', ...base, button: 'القائمة', sections: [{ title: 'أ', rows: rows(6) }, { title: 'ب', rows: rows(4) }] }).type).toBe('list')
    expect(() => InboxInteractiveSchema.parse({ type: 'list', ...base, button: 'القائمة', sections: [{ title: 'أ', rows: rows(6) }, { title: 'ب', rows: rows(5) }] })).toThrow()
  })

  it('takes only an https call-to-action URL', () => {
    expect(InboxInteractiveSchema.parse({ type: 'cta_url', ...base, display_text: 'افتح', url: 'https://example.com/a' }).type).toBe('cta_url')
    expect(() => InboxInteractiveSchema.parse({ type: 'cta_url', ...base, display_text: 'افتح', url: 'http://example.com' })).toThrow()
  })
})

describe('InboxReplyCreateSchema free-form kinds', () => {
  it('accepts a file, a location and an interactive reply, each with an optional reply_to_id', () => {
    expect(InboxReplyCreateSchema.parse({ attachment_id: 3, caption: 'تقرير', reply_to_id: 9 })).toEqual({ attachment_id: 3, caption: 'تقرير', reply_to_id: 9 })
    expect(InboxReplyCreateSchema.parse({ location: { latitude: 24.7, longitude: 46.7, name: null, address: null } })).toBeTruthy()
    expect(() => InboxReplyCreateSchema.parse({ attachment_id: 3, template_id: 1, params: [] })).toThrow()
    expect(() => InboxReplyCreateSchema.parse({ location: { latitude: 91, longitude: 0, name: null, address: null } })).toThrow()
  })
})
