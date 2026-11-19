import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ConversationOpportunityAnswerSchema, CrmOpportunityListSchema } from '@liwan/contracts'
import { crmKeys } from './crm/crmKeys'
import { useCrmCreateAccess } from './crm/useCrmAccess'
import { opportunityConversationsKey } from './opportunityConversationsKey'
import { inboxKeys } from './inbox/useInbox'

// The opportunity a conversation is linked to (the inbox bridge to CRM). It is read and written only while the tenant has
// CRM and the user holds both applications' capabilities.

/** Rows the opportunity picker asks for. */
export const OPPORTUNITY_PICK_LIMIT = 20

export function useInboxOpportunityAccess() {
  const { can } = useAccess()
  const create = useCrmCreateAccess()
  return {
    read: computed(() => can('crm.leads.read') && can('inbox.conversations.read')),
    write: computed(() => can('crm.leads.work') && can('inbox.conversations.reply')),
    // Creating also needs the server's say: manual distribution lets only the holders of crm.leads.assign create.
    create: create.canCreate,
    createManualOnly: create.manualOnly,
    createPending: create.pending,
  }
}

/** The linked opportunity, or null when none is linked or the caller may not read it. */
export function useConversationOpportunity(conversationId: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.opportunity(toValue(conversationId))),
    enabled: computed(() => toValue(conversationId) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/opportunity`, { signal, schema: ConversationOpportunityAnswerSchema }),
  })
}

export function useCreateConversationOpportunity() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/conversations/${id}/opportunity`, {
      method: 'POST', body: {}, schema: ConversationOpportunityAnswerSchema,
    }),
    onSuccess: (created, id) => {
      qc.setQueryData(inboxKeys.opportunity(id), created)
      void qc.invalidateQueries({ queryKey: [...crmKeys.opportunities, 'list'] })
      void qc.invalidateQueries({ queryKey: crmKeys.dashboardAll })
    },
    onError: (_, id) => qc.invalidateQueries({ queryKey: inboxKeys.opportunity(id) }),
  })
}

export function useLinkConversationOpportunity(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (opportunityId: number) => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/opportunity`, { method: 'PUT', body: { opportunity_id: opportunityId }, schema: ConversationOpportunityAnswerSchema }),
    onSuccess: (ref, opportunityId) => {
      const cacheKey = inboxKeys.opportunity(toValue(conversationId))
      const previous = qc.getQueryData<{ id: number } | null>(cacheKey)?.id
      qc.setQueryData(cacheKey, ref)
      // The conversations section of the new opportunity gains this conversation and that of the old one loses it.
      for (const id of new Set([opportunityId, previous])) if (id) qc.invalidateQueries({ queryKey: opportunityConversationsKey(id) })
    },
    // 409/403/404: what the server holds now may differ from what the card shows.
    onError: () => qc.invalidateQueries({ queryKey: inboxKeys.opportunity(toValue(conversationId)) }),
  })
}

/** Unlinking answers 204, also when nothing was linked. */
export function useUnlinkConversationOpportunity(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => $api(`/api/v1/inbox/conversations/${toValue(conversationId)}/opportunity`, { method: 'DELETE' }),
    onSuccess: () => {
      const cacheKey = inboxKeys.opportunity(toValue(conversationId))
      const previous = qc.getQueryData<{ id: number } | null>(cacheKey)?.id
      qc.setQueryData(cacheKey, null)
      if (previous) qc.invalidateQueries({ queryKey: opportunityConversationsKey(previous) })
    },
    onError: () => qc.invalidateQueries({ queryKey: inboxKeys.opportunity(toValue(conversationId)) }),
  })
}

/** Open opportunities matching a name or a phone, through the CRM list route's `q` filter; the contact's own phone finds its opportunities first. */
export function useOpportunityPick(q: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['inbox', 'opportunity-pick', toValue(q).trim()] as const),
    enabled: computed(() => toValue(enabled) && toValue(q).trim() !== ''),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => $api('/api/v1/crm/opportunities', { query: { q: toValue(q).trim(), status: 'open', limit: OPPORTUNITY_PICK_LIMIT, offset: 0 }, signal, schema: CrmOpportunityListSchema }),
  })
}
