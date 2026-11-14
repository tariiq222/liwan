import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SalesSettingsSchema, type SalesSettingsPatch } from '@liwan/contracts'
import { salesKeys } from './salesKeys'

/** The settings are read by holders of `sales.read` and of `sales.settings.manage`. */
export function useSalesSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => salesKeys.settings(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/sales/settings', { schema: SalesSettingsSchema }),
  })
}

/** One PATCH with the revision the draft was made from; a stale revision answers 409 and the card reloads. */
export function useSaveSalesSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: SalesSettingsPatch) => {
      const saved = await $api('/api/v1/sales/settings', { method: 'PATCH', body, schema: SalesSettingsSchema })
      qc.setQueryData(salesKeys.settings(me.value?.company?.id), saved)
      return saved
    },
  })
}
