import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { ProductTaxChoiceListSchema } from '@liwan/contracts'
import { productKeys } from './productKeys'

/**
 * The sale taxes a product of this session may carry (`products.manage`). An establishment that is not registered for
 * VAT gets none, so no tax field is offered. A refusal (the product belongs to another company) is not retried: the form
 * then shows the product's own taxes read-only.
 */
export function useProductTaxChoices(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => productKeys.taxes(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    retry: false,
    queryFn: () => $api('/api/v1/products/taxes', { schema: ProductTaxChoiceListSchema }),
  })
}
