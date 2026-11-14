import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProductSettingsSchema, type ProductSettingsPatch } from '@liwan/contracts'
import { productKeys } from './productKeys'

/** The settings are read by holders of `products.read` and of `products.settings.manage`. */
export function useProductSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => productKeys.settings(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/products/settings', { schema: ProductSettingsSchema }),
  })
}

/** One PATCH with the revision the draft was made from; a stale revision answers 409 and the caller reloads. */
export function useSaveProductSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: ProductSettingsPatch) => {
      const saved = await $api('/api/v1/products/settings', { method: 'PATCH', body, schema: ProductSettingsSchema })
      qc.setQueryData(productKeys.settings(me.value?.company?.id), saved)
      return saved
    },
  })
}
