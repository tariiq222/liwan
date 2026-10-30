import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CrmSettingsSchema, type CrmSettingsPatch } from '@liwan/contracts'
import { crmKeys } from './crmKeys'

export function useCrmSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => crmKeys.settings(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value && can('crm.settings.read')),
    queryFn: () => $api('/api/v1/crm/settings', { schema: CrmSettingsSchema }),
  })
}

/** One PATCH with the revision the draft was made from; a stale revision answers 409 and the caller reloads. */
export function useSaveCrmSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: CrmSettingsPatch) => {
      const companyId = me.value?.company?.id
      const saved = await $api('/api/v1/crm/settings', { method: 'PATCH', body, schema: CrmSettingsSchema })
      qc.setQueryData(crmKeys.settings(companyId), saved)
      await qc.invalidateQueries({ queryKey: crmKeys.terms(companyId) })
      return saved
    },
  })
}
