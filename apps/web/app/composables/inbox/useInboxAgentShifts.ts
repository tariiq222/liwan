import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { MaybeRefOrGetter } from 'vue'
import { InboxAgentShiftsSchema, type InboxAgentShifts } from '@liwan/contracts'
import { inboxKeys } from './useInbox'

const shiftsKey = (userId: number) => [...inboxKeys.agents, 'shifts', userId] as const

/** An agent's weekly shift ranges (inbox.settings.manage); no ranges means the agent is always in shift. */
export function useInboxAgentShifts(userId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => shiftsKey(toValue(userId))),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/inbox/agents/${toValue(userId)}/shifts`, { signal, schema: InboxAgentShiftsSchema }),
  })
}

export function useSaveInboxAgentShifts(userId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxAgentShifts) => $api(`/api/v1/inbox/agents/${toValue(userId)}/shifts`, { method: 'PUT', body, schema: InboxAgentShiftsSchema }),
    onSuccess: async (shifts) => {
      // A new shift changes who is in shift now, so the agent list is read again.
      await qc.invalidateQueries({ queryKey: inboxKeys.agents })
      qc.setQueryData(shiftsKey(toValue(userId)), shifts)
    },
  })
}
