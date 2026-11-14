import type { Ref } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { CustomerPickListSchema } from '@liwan/contracts'
import { customerKeys } from './customerKeys'

export const CUSTOMER_PICK_ENDPOINT = '/api/v1/customers/pick'

const PICK_LIMIT = 50

/** The cache key and request query of one customer search. */
export function customerPickSearch(q: string) {
  return { key: customerKeys.pick(q), query: { q: q || undefined, limit: PICK_LIMIT } }
}

/** The active customers a pick holder may choose from, by name (an empty query lists them all). */
export function useCustomerPick(q: Ref<string>, enabled: Ref<boolean> = ref(true)) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => customerPickSearch(q.value.trim()).key),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
    queryFn: () => $api(CUSTOMER_PICK_ENDPOINT, { query: customerPickSearch(q.value.trim()).query, schema: CustomerPickListSchema }),
  })
}
