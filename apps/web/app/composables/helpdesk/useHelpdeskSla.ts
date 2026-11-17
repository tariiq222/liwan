import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { HelpdeskSlaListSchema, HelpdeskSlaPolicySchema, type HelpdeskSlaSave } from '@liwan/contracts'
import { helpdeskKeys } from './helpdeskKeys'

// The service levels of the working company: the policies a tenant shapes, and the commands that save or archive one.
export function useHelpdeskSla(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.sla(me.value?.company.id)),
    enabled: computed(() => Boolean(toValue(enabled))),
    queryFn: () => $api('/api/v1/helpdesk/sla', { schema: HelpdeskSlaListSchema }),
  })
}

export function useSaveHelpdeskSla() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: HelpdeskSlaSave) => $api('/api/v1/helpdesk/sla', {
      method: 'POST', body, schema: HelpdeskSlaPolicySchema,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: helpdeskKeys.all })
    },
  })
}

export function useArchiveHelpdeskSla() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: number; active: boolean }) => $api(`/api/v1/helpdesk/sla/${args.id}/active`, {
      method: 'POST', body: { active: args.active }, schema: HelpdeskSlaPolicySchema,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: helpdeskKeys.all })
    },
  })
}
