import {
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
  pinned: false,
  starred: false,
  reactions: [],
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
