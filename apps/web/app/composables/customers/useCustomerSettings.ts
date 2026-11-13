import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CustomerSettingsSchema, type CustomerSettingsPatch } from '@liwan/contracts'
import { customerKeys } from './customerKeys'

/** The settings are read by holders of `customers.read` (the forms follow them) and of `customers.settings.manage`. */
export function useCustomerSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => customerKeys.settings(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/customers/settings', { schema: CustomerSettingsSchema }),
  })
}

/** One PATCH with the revision the draft was made from; a stale revision answers 409 and the caller reloads. */
export function useSaveCustomerSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: CustomerSettingsPatch) => {
      const saved = await $api('/api/v1/customers/settings', { method: 'PATCH', body, schema: CustomerSettingsSchema })
      qc.setQueryData(customerKeys.settings(me.value?.company?.id), saved)
      // The fields a customer carries follow the definition, so cached customers are stale after a save.
      await qc.invalidateQueries({ queryKey: customerKeys.all })
      return saved
    },
  })
}
