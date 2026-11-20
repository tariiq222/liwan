import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mutation = { onSuccess: () => unknown; onError: () => unknown }
const options: Mutation[] = []
const invalidate = vi.fn()
const held = new Set<string>()
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (config: unknown) => config,
  useMutation: (config: Mutation) => { options.push(config); return config },
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
vi.stubGlobal('useAccess', () => ({ can: (capability: string) => held.has(capability) }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { useInboxTicketsAccess, useConversationTickets, useCreateConversationTicket } = await import('../useInboxTickets')

beforeEach(() => {
  options.length = 0
  held.clear()
  invalidate.mockClear()
})

describe('conversation tickets access', () => {
  it('reads with both read capabilities and creates with the helpdesk write capability', () => {
    held.add('inbox.conversations.read')
    expect(useInboxTicketsAccess().read.value).toBe(false)
    held.add('helpdesk.tickets.read')
    expect(useInboxTicketsAccess().read.value).toBe(true)
    expect(useInboxTicketsAccess().create.value).toBe(false)
    held.add('helpdesk.tickets.write')
    expect(useInboxTicketsAccess().create.value).toBe(true)
  })

  it('cannot create without the inbox read capability', () => {
    held.add('helpdesk.tickets.write')
    expect(useInboxTicketsAccess().create.value).toBe(false)
  })
})

describe('conversation tickets queries', () => {
  it('reads only when enabled and a conversation is given', () => {
    const query = useConversationTickets(3, false) as unknown as { enabled: { value: boolean } }
    expect(query.enabled.value).toBe(false)
    expect((useConversationTickets(0, true) as unknown as { enabled: { value: boolean } }).enabled.value).toBe(false)
    expect((useConversationTickets(3, true) as unknown as { enabled: { value: boolean } }).enabled.value).toBe(true)
  })

  it('refreshes the list after a ticket is raised and after a refused raise', () => {
    useCreateConversationTicket(3)
    options[0]!.onSuccess()
    options[0]!.onError()
    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey)
    expect(keys).toEqual([['inbox', 'conversation-tickets', 3], ['inbox', 'conversation-tickets', 3]])
  })
})
