import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { CrmAccessSchema } from '@liwan/contracts'
import { crmKeys } from './crmKeys'

/**
 * Whether the user may create opportunities: the server must allow it (it depends on the company's distribution
 * mode, so the capability list alone cannot say) and the user must hold a write capability on a writable CRM (the
 * access route needs read only). Nothing is guessed while it loads or when it cannot be read.
 */
export function useCrmCreateAccess() {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  const query = useQuery({
    queryKey: computed(() => crmKeys.access(me.value?.company?.id)),
    enabled: computed(() => !!me.value && can('crm.leads.read')),
    queryFn: ({ signal }) => $api('/api/v1/crm/access', { signal, schema: CrmAccessSchema }),
    staleTime: 60_000,
  })
  const canWrite = () => can('crm.leads.work') || can('crm.leads.assign')
  const canCreate = computed(() => query.data.value?.can_create === true && canWrite())
  return {
    canCreate,
    /** The server answered "no" to a user who holds crm.leads.work: only manual distribution refuses such a user. */
    manualOnly: computed(() => query.data.value?.can_create === false && can('crm.leads.work')),
    /** True until the server has answered or failed. */
    pending: computed(() => query.isPending.value && query.fetchStatus.value !== 'idle'),
  }
}
