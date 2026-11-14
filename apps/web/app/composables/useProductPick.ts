import type { Ref } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { ProductPickListSchema } from '@liwan/contracts'

export const PRODUCT_PICK_ENDPOINT = '/api/v1/products/pick'

const PICK_LIMIT = 50

/** The cache key and request query of one product search. */
export function productPickSearch(q: string) {
  return { key: ['products', 'pick', q] as const, query: { q: q || undefined, limit: PICK_LIMIT } }
}

/** The active products of the products service a pick holder may choose from, by name (an empty query lists them all). */
export function useProductPick(q: Ref<string>, enabled: Ref<boolean> = ref(true)) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => productPickSearch(q.value.trim()).key),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
    queryFn: () => $api(PRODUCT_PICK_ENDPOINT, { query: productPickSearch(q.value.trim()).query, schema: ProductPickListSchema }),
  })
}
