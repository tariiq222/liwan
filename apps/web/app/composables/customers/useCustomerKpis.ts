import { CustomerListSchema } from '@liwan/contracts'
import { useQuery } from '@tanstack/vue-query'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { customerKpiTiles } from '@/utils/customerKpis'
import { customerKeys } from './customerKeys'
import { customerApiQuery, type CustomerListState } from './customerListParams'

/**
 * The three KPI tiles above `/customers` (total, active, archived).
 * Reuses the page's own list `total` for the currently viewed bucket (`active` or `archived`) and fetches
 * only the opposite bucket with `limit: 1` under the `customers` list key root while KPIs are visible.
 */
export function useCustomerKpis(
  state: MaybeRefOrGetter<Pick<CustomerListState, 'q' | 'archived'>>,
  listTotal: MaybeRefOrGetter<number | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { t } = useI18n()

  const oppositeArchived = computed(() => !toValue(state).archived)
  const oppositeQuery = useQuery({
    queryKey: computed(() => customerKeys.list({ kpi: true, q: toValue(state).q, archived: oppositeArchived.value })),
    enabled: computed(() => toValue(enabled) && can('customers.read')),
    queryFn: ({ signal }) => {
      const current = toValue(state)
      return $api('/api/v1/customers', {
        query: { ...customerApiQuery({ q: current.q, archived: !current.archived }), limit: 1, offset: 0 },
        signal,
        schema: CustomerListSchema,
      })
    },
  })

  const tiles = computed(() => {
    const current = toValue(state)
    const active = current.archived ? oppositeQuery.data.value?.total : toValue(listTotal)
    const archived = current.archived ? toValue(listTotal) : oppositeQuery.data.value?.total
    return customerKpiTiles({ active, archived }, { q: current.q }, t)
  })

  const loading = computed(() => toValue(listTotal) === undefined || oppositeQuery.isLoading.value)

  return { tiles, loading }
}
