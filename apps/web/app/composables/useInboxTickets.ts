import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ConversationTicketListSchema, ConversationTicketSchema, type ConversationTicketCreate } from '@liwan/contracts'

// The tickets raised from a conversation (the inbox bridge to helpdesk). They are read and raised only while the tenant has
// helpdesk and the user holds both applications' capabilities.

const ticketsKey = (conversationId: number) => ['inbox', 'conversation-tickets', conversationId] as const

export function useInboxTicketsAccess() {
  const { can } = useAccess()
  return {
    read: computed(() => can('inbox.conversations.read') && can('helpdesk.tickets.read')),
    create: computed(() => can('inbox.conversations.read') && can('helpdesk.tickets.write')),
  }
}

/** The caller's visible tickets of the conversation, newest first. */
export function useConversationTickets(conversationId: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ticketsKey(toValue(conversationId))),
    enabled: computed(() => toValue(conversationId) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/tickets`, { signal, schema: ConversationTicketListSchema }),
  })
}

export function useCreateConversationTicket(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ConversationTicketCreate) => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/tickets`, { method: 'POST', body, schema: ConversationTicketSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ticketsKey(toValue(conversationId)) }),
    // A 409 means a ticket is open that the list did not show yet.
    onError: () => qc.invalidateQueries({ queryKey: ticketsKey(toValue(conversationId)) }),
  })
}
