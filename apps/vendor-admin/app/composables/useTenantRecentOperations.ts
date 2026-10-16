import type { MaybeRefOrGetter } from 'vue'
import type { OperationFeed } from '@nasq/commercial-contracts'

const RECENT_OPERATIONS = 5

/** The latest operations of one workspace (none for an empty id). Calls with the same id share the data, so a tab and the summary read one copy. */
export function useTenantRecentOperations(id: MaybeRefOrGetter<string>) {
  const { request } = useVendorApi()
  return useAsyncData(
    () => `vendor:tenant-operations:${toValue(id)}`,
    async () => (toValue(id) ? (await request<{ items: OperationFeed[]; total: number }>('operations', { query: { source: 'all', tenant_id: toValue(id) } })).items.slice(0, RECENT_OPERATIONS) : []),
  )
}
