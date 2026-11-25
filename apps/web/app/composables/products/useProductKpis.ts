import { ProductListSchema, type ProductType } from '@liwan/contracts'
import { useQuery } from '@tanstack/vue-query'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { productKpiTiles } from '@/utils/productKpis'
import { productKeys } from './productKeys'
import { productApiQuery, type ProductListState } from './productListParams'

/**
 * The three KPI tiles above `/products` (total, goods, services).
 * Reuses `listTotal` for whichever bucket matches the current `type` filter (`null` = total, `'goods'`, `'service'`),
 * and fetches the other two buckets with `limit: 1` under the `products` list key root while KPIs are visible.
 */
export function useProductListKpis(
  state: MaybeRefOrGetter<Pick<ProductListState, 'q' | 'type' | 'archived'>>,
  listTotal: MaybeRefOrGetter<number | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { t } = useI18n()

  const typeQuery = (type: ProductType | null) => useQuery({
    queryKey: computed(() => {
      const current = toValue(state)
      return productKeys.list({ kpi: true, q: current.q, archived: current.archived, type })
    }),
    enabled: computed(() => toValue(enabled) && can('products.read') && toValue(state).type !== type),
    queryFn: ({ signal }) => {
      const current = toValue(state)
      return $api('/api/v1/products', {
        query: { ...productApiQuery({ q: current.q, type, archived: current.archived, page: 1 }), limit: 1, offset: 0 },
        signal,
        schema: ProductListSchema,
      })
    },
  })

  const queries = {
    total: typeQuery(null),
    goods: typeQuery('goods'),
    services: typeQuery('service'),
  }

  const countFor = (type: ProductType | null, key: keyof typeof queries) =>
    (toValue(state).type === type ? toValue(listTotal) : queries[key].data.value?.total)

  const tiles = computed(() => {
    const current = toValue(state)
    return productKpiTiles({
      total: countFor(null, 'total'),
      goods: countFor('goods', 'goods'),
      services: countFor('service', 'services'),
    }, { q: current.q, archived: current.archived }, t)
  })

  const loading = computed(() =>
    toValue(listTotal) === undefined
    || Object.values(queries).some(query => query.isLoading.value),
  )

  return { tiles, loading }
}
