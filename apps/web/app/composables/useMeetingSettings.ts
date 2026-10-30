import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { MeetingSettingsSchema, type MeetingSettingsPatch } from '@liwan/contracts'

/** The settings belong to the current company, so each company keeps its own cache entry. */
export const meetingSettingsKeys = {
  company: (companyId: number | undefined) => ['meetings', 'settings', { companyId }] as const,
}

export function useMeetingSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => meetingSettingsKeys.company(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/meetings/settings', { schema: MeetingSettingsSchema }),
    retry: false,
  })
}

/** One PATCH with the revision the draft was made from; a stale revision answers 409 and the caller reloads. */
export function useSaveMeetingSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: MeetingSettingsPatch) => {
      const key = meetingSettingsKeys.company(me.value?.company?.id)
      const saved = await $api('/api/v1/meetings/settings', { method: 'PATCH', body, schema: MeetingSettingsSchema })
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, saved)
      return saved
    },
  })
}
