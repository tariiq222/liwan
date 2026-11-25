import { SalesOrderListSchema } from '@liwan/contracts'
import { useQuery } from '@tanstack/vue-query'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { salesKpiTiles, type SalesKpiStage } from '@/utils/salesKpis'
import { salesKeys } from './salesKeys'
import { salesApiQuery, type SalesListState } from './salesListParams'

/**
 * The three KPI tiles above `/sales` (quotations, orders, cancelled).
 * Reuses `listTotal` whenever the active list `stage` matches a tile, and fetches the remaining stages
 * with `limit: 1` under the `sales` list key root while KPIs are visible.
 */
export function useSalesListKpis(
  state: MaybeRefOrGetter<Pick<SalesListState, 'q' | 'stage' | 'source' | 'mine'>>,
  listTotal: MaybeRefOrGetter<number | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { t } = useI18n()

  const stageQuery = (stage: SalesKpiStage) => useQuery({
    queryKey: computed(() => {
      const current = toValue(state)
      return salesKeys.list({ kpi: true, q: current.q, source: current.source, mine: current.mine, stage })
    }),
    enabled: computed(() => toValue(enabled) && can('sales.read') && toValue(state).stage !== stage),
    queryFn: ({ signal }) => {
      const current = toValue(state)
      return $api('/api/v1/sales/orders', {
        query: { ...salesApiQuery({ q: current.q, stage, source: current.source, mine: current.mine, page: 1 }), limit: 1, offset: 0 },
        signal,
        schema: SalesOrderListSchema,
      })
    },
  })

  const queries = {
    quotations: stageQuery('quotations'),
    orders: stageQuery('orders'),
    cancelled: stageQuery('cancelled'),
  }

  const countFor = (stage: SalesKpiStage) => (toValue(state).stage === stage ? toValue(listTotal) : queries[stage].data.value?.total)

  const tiles = computed(() => {
    const current = toValue(state)
    return salesKpiTiles({
      quotations: countFor('quotations'),
      orders: countFor('orders'),
      cancelled: countFor('cancelled'),
    }, { q: current.q, source: current.source, mine: current.mine }, t)
  })

  const loading = computed(() =>
    (toValue(state).stage !== 'all' && toValue(listTotal) === undefined)
    || Object.values(queries).some(query => query.isLoading.value),
  )

  return { tiles, loading }
}
