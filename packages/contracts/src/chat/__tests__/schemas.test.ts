import {
  ChatMessageDeleteResultSchema,
  ChatSettingsPatchSchema,
  ChatSettingsSchema,
  ChatAttachmentListSchema,
  ChatConversationCreateSchema,
  ChatConversationListSchema,
  ChatConversationSchema,
  ChatMemberListSchema,
  ChatMemberSchema,
  ChatMessagePinSchema,
  ChatMessageReactionWriteSchema,
  ChatMessageUpdateSchema,
  ChatMessageListSchema,
  ChatMessageSchema,
  ChatMessageSendSchema,
  ChatReadSchema,
  ChatRecipientListSchema,
  ChatTypingSchema,
} from '../index'

const CONVERSATION = {
  id: 42,
  type: 'direct',
  name: 'Peer',
  unread_count: 1,
  last_message_at: '2026-09-07T10:00:00Z',
  last_message_preview: 'hello',
  member_count: 2,
  muted: false,
  notifications: null,
  peer_seen_message_id: null,
  im_status: 'online',
  can_manage: false,
  can_remove_members: false,
}

const MESSAGE = {
  id: 9,
  conversation_id: 42,
  author: { id: 7, name: 'Sara' },
  body: 'hello <peer>',
  created_at: '2026-09-07T10:00:00Z',
  attachments: [],
  parent: null,
  edited: false,
  deleted: false,
  pinned: false,
  starred: false,
  reactions: [],
  notice: null,
}

describe('ChatConversationSchema', () => {
  it('accepts the serializer conversation shape', () => {
    expect(ChatConversationSchema.parse(CONVERSATION).id).toBe(42)
    expect(ChatConversationListSchema.parse({ items: [CONVERSATION], total: 1 }).total).toBe(1)
  })
  it('rejects extra keys', () => {
    expect(() => ChatConversationSchema.parse({ ...CONVERSATION, pinned: true })).toThrow()
  })
})

describe('ChatMessageSchema', () => {
  it('accepts a plain-text message with attachments', () => {
    const parsed = ChatMessageSchema.parse({
      ...MESSAGE,
      attachments: [{ id: 3, name: 'brief.pdf', mimetype: 'application/pdf', url: '/api/v1/chat/conversations/1/attachments/3/download' }],
    })
    expect(parsed.body).toBe('hello <peer>')
    expect(ChatMessageListSchema.parse({ items: [MESSAGE], total: 1 }).items).toHaveLength(1)
  })
  it('rejects html-only extra fields', () => {
    expect(() => ChatMessageSchema.parse({ ...MESSAGE, body_html: '<p>x</p>' })).toThrow()
  })
})

describe('write payloads', () => {
  it('accepts direct and group creates', () => {
    expect(ChatConversationCreateSchema.parse({ user_ids: [2] }).user_ids).toEqual([2])
    expect(ChatConversationCreateSchema.parse({ user_ids: [2, 3], name: 'Ops' }).name).toBe('Ops')
    expect(ChatConversationCreateSchema.parse({ type: 'channel', name: 'Announcements' }).type).toBe('channel')
  })
  it('accepts send and read bodies', () => {
    expect(ChatMessageSendSchema.parse({ body: 'hi', parent_id: 8, mention_user_ids: [2] }).body).toBe('hi')
    expect(ChatReadSchema.parse({ message_id: 9 }).message_id).toBe(9)
    expect(ChatMessageUpdateSchema.parse({ body: '' }).body).toBe('')
    expect(ChatMessageReactionWriteSchema.parse({ content: '👍', action: 'add' }).action).toBe('add')
    expect(ChatMessagePinSchema.parse({ pinned: true }).pinned).toBe(true)
    expect(ChatTypingSchema.parse({ is_typing: true }).is_typing).toBe(true)
  })
})

describe('member and recipient envelopes', () => {
  it('uses {items,total}', () => {
    const people = { items: [{ id: 2, name: 'Peer' }], total: 1 }
    const members = { items: [{ id: 2, name: 'Peer', im_status: null }], total: 1 }
    expect(ChatRecipientListSchema.parse(people).total).toBe(1)
    expect(ChatMemberListSchema.parse(members).items[0].id).toBe(2)
    expect(ChatMemberSchema.parse(members.items[0]).im_status).toBeNull()
    expect(ChatAttachmentListSchema.parse({ items: [], total: 0 }).items).toEqual([])
  })
})

describe('ChatSettingsSchema', () => {
  const settings = {
    values: { message_delete_mode: 'placeholder' },
    defaults: { message_delete_mode: 'placeholder' },
    options: { message_delete_mode: ['placeholder', 'permanent'] },
    revision: 0,
  }

  it('carries the values, the stated defaults, the options and the revision', () => {
    expect(ChatSettingsSchema.parse(settings)).toEqual(settings)
    expect(() => ChatSettingsSchema.parse({ ...settings, values: { message_delete_mode: 'shred' } })).toThrow()
    expect(() => ChatSettingsSchema.parse({ ...settings, extra: 1 })).toThrow()
  })

  it('patches with the revision it was made from', () => {
    expect(ChatSettingsPatchSchema.parse({ revision: 2, values: { message_delete_mode: 'permanent' } }).revision).toBe(2)
    expect(() => ChatSettingsPatchSchema.parse({ values: { message_delete_mode: 'permanent' } })).toThrow()
    expect(() => ChatSettingsPatchSchema.parse({ revision: -1, values: { message_delete_mode: 'permanent' } })).toThrow()
  })
})

describe('ChatMessageDeleteResultSchema', () => {
  it('returns the cleared row, or nothing once the message is removed', () => {
    expect(ChatMessageDeleteResultSchema.parse({ mode: 'placeholder', message: { ...MESSAGE, body: '', deleted: true } }).mode).toBe('placeholder')
    expect(ChatMessageDeleteResultSchema.parse({ mode: 'permanent', message: null })).toEqual({ mode: 'permanent', message: null })
    expect(() => ChatMessageDeleteResultSchema.parse({ mode: 'permanent', message: MESSAGE })).toThrow()
    expect(() => ChatMessageDeleteResultSchema.parse({ mode: 'placeholder', message: null })).toThrow()
  })
})
