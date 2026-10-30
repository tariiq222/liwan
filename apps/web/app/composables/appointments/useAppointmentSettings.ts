import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AppointmentSettingsSchema, type AppointmentSettingsPatch } from '@liwan/contracts'

/** The settings belong to the current company, so each company keeps its own cache entry. */
export const appointmentSettingsKeys = {
  company: (companyId: number | undefined) => ['appointments', 'settings', { companyId }] as const,
}

export function useAppointmentSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => appointmentSettingsKeys.company(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/appointments/settings', { schema: AppointmentSettingsSchema }),
    retry: false,
  })
}

/** One PATCH with the revision the card read; the answer replaces the cached settings so every card follows. */
export function useSaveAppointmentSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: AppointmentSettingsPatch) => {
      const key = appointmentSettingsKeys.company(me.value?.company?.id)
      const saved = await $api('/api/v1/appointments/settings', { method: 'PATCH', body, schema: AppointmentSettingsSchema })
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, saved)
      return saved
    },
  })
}
