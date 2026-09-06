import {
  ChatAttachmentListSchema,
  ChatConversationCreateSchema,
  ChatConversationListSchema,
  ChatConversationSchema,
  ChatMemberListSchema,
  ChatMessageListSchema,
  ChatMessageSchema,
  ChatMessageSendSchema,
  ChatReadSchema,
  ChatRecipientListSchema,
} from '../index'

const CONVERSATION = {
  id: 42,
  type: 'direct',
  name: 'Peer',
  unread_count: 1,
  last_message_at: '2026-09-07T10:00:00Z',
  last_message_preview: 'hello',
  member_count: 2,
}

const MESSAGE = {
  id: 9,
  conversation_id: 42,
  author: { id: 7, name: 'Sara' },
  body: 'hello <peer>',
  created_at: '2026-09-07T10:00:00Z',
  attachments: [],
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
      attachments: [{ id: 3, name: 'brief.pdf', mimetype: 'application/pdf', url: '/web/content/3?download=true' }],
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
  })
  it('accepts send and read bodies', () => {
    expect(ChatMessageSendSchema.parse({ body: 'hi' }).body).toBe('hi')
    expect(ChatReadSchema.parse({ message_id: 9 }).message_id).toBe(9)
  })
})

describe('member and recipient envelopes', () => {
  it('uses {items,total}', () => {
    const people = { items: [{ id: 2, name: 'Peer' }], total: 1 }
    expect(ChatRecipientListSchema.parse(people).total).toBe(1)
    expect(ChatMemberListSchema.parse(people).items[0].id).toBe(2)
    expect(ChatAttachmentListSchema.parse({ items: [], total: 0 }).items).toEqual([])
  })
})
