import { type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { IntegrationConnectionListSchema } from '@liwan/contracts'

export function useIntegrationConnections(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: ['integrations', 'connections'],
    enabled,
    queryFn: () => $api('/api/v1/integrations/connections', { schema: IntegrationConnectionListSchema }),
    retry: false,
  })
}
