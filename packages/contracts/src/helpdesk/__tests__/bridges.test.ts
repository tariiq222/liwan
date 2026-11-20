import { describe, expect, it } from 'vitest'
import { ConversationTicketCreateSchema, ConversationTicketListSchema, ConversationTicketSchema } from '..'

const ticket = { id: 5, number: 'HD00005', subject: 'Printer', stage: { id: 1, name: 'New', closed: false }, created_at: '2026-11-20T08:00:00Z' }

describe('the conversation tickets bridge', () => {
  it('reads a ticket ref and the list envelope', () => {
    expect(ConversationTicketSchema.parse(ticket)).toEqual(ticket)
    expect(ConversationTicketSchema.parse({ ...ticket, created_at: null }).created_at).toBeNull()
    expect(ConversationTicketListSchema.parse({ items: [ticket], total: 1 }).total).toBe(1)
    expect(ConversationTicketListSchema.parse({ items: [], total: 0 }).items).toEqual([])
  })

  it('rejects extra keys and a malformed stage', () => {
    expect(() => ConversationTicketSchema.parse({ ...ticket, team: null })).toThrow()
    expect(() => ConversationTicketSchema.parse({ ...ticket, stage: { id: 1, name: 'New' } })).toThrow()
    expect(() => ConversationTicketListSchema.parse({ items: [], total: 0, extra: 1 })).toThrow()
  })

  it('takes six optional body fields and nothing else', () => {
    expect(ConversationTicketCreateSchema.parse({})).toEqual({})
    const body = { subject: 'S', description: 'D', team_id: 1, priority: 'high', category_id: 2, type_id: 3 }
    expect(ConversationTicketCreateSchema.parse(body)).toEqual(body)
    expect(() => ConversationTicketCreateSchema.parse({ customer_id: 4 })).toThrow()
    expect(() => ConversationTicketCreateSchema.parse({ priority: 'critical' })).toThrow()
    expect(() => ConversationTicketCreateSchema.parse({ team_id: 0 })).toThrow()
  })
})
