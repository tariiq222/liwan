import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChatSettingsSchema, type ChatSettingsPatch } from '@liwan/contracts'

/** The settings belong to the current company, so each company keeps its own cache entry. */
export const chatSettingsKeys = {
  company: (companyId: number | undefined) => ['chat', 'settings', { companyId }] as const,
}

export function useChatSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => chatSettingsKeys.company(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/chat/settings', { schema: ChatSettingsSchema }),
    retry: false,
  })
}

/** One PATCH with the revision the draft was made from; a stale revision answers 409 and the caller reloads. */
export function useSaveChatSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: ChatSettingsPatch) => {
      const key = chatSettingsKeys.company(me.value?.company?.id)
      const saved = await $api('/api/v1/chat/settings', { method: 'PATCH', body, schema: ChatSettingsSchema })
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, saved)
      return saved
    },
  })
}
