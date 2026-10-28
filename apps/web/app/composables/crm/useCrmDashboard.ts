import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { CrmDashboardSchema } from '@webvue/contracts'
import { crmKeys } from './crmKeys'

/** The agent block for everyone and the manager block when the server sends one; per company like the data it counts. */
export function useCrmDashboard() {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => crmKeys.dashboard(me.value?.company?.id)),
    enabled: computed(() => !!me.value && can('crm.leads.read')),
    queryFn: () => $api('/api/v1/crm/dashboard', { schema: CrmDashboardSchema }),
  })
}
