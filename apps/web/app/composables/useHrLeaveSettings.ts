import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { HrLeaveSettingsSchema, type HrLeaveSettingsPatch } from '@liwan/contracts'
import { hrLeaveKeys } from './useHrLeave'

export function useHrLeaveSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => [...hrLeaveKeys.all, 'settings', { companyId: me.value?.company?.id, userId: me.value?.id }]),
    enabled: computed(() => toValue(enabled) && !!me.value && can('hr.leave.config')),
    queryFn: () => $api('/api/v1/hr/leave/settings', { schema: HrLeaveSettingsSchema }),
  })
}

export function useSaveHrLeaveSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  const { can } = useAccess()
  return useMutation({
    mutationFn: async (body: HrLeaveSettingsPatch) => {
      const identity = { companyId: me.value?.company?.id, userId: me.value?.id }
      const saved = await $api('/api/v1/hr/leave/settings', { method: 'PATCH', body, schema: HrLeaveSettingsSchema })
      const key = [...hrLeaveKeys.all, 'settings', identity]
      await qc.cancelQueries({ queryKey: key, exact: true })
      if (identity.companyId === me.value?.company?.id && identity.userId === me.value?.id && can('hr.leave.config')) {
        qc.setQueryData(key, saved)
        await qc.invalidateQueries({ queryKey: hrLeaveKeys.all, predicate: query => query.queryKey[2] !== 'settings' })
      }
      return saved
    },
  })
}
