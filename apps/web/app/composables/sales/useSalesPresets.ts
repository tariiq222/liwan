import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SalesSettingsPresetListSchema, type SalesSettings, type SalesSettingsPreset } from '@liwan/contracts'
import { salesKeys } from './salesKeys'
import { salesPresetPatch } from './salesPresetPreview'
import { useSaveSalesSettings } from './useSalesSettings'

/**
 * The sector presets of the Sales settings: structured values the settings page previews against the current settings and
 * applies with its ordinary settings write. Read by the holder of `sales.settings.manage`.
 */
export function useSalesPresets(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => salesKeys.presets(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/sales/settings/presets', { schema: SalesSettingsPresetListSchema }),
  })
}

/**
 * Applies a preset with the ordinary settings write (`PATCH /sales/settings`, the same capability and validation) and
 * refreshes the presets, whose `matches` follow the settings.
 */
export function useApplySalesPreset() {
  const save = useSaveSalesSettings()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (args: { preset: SalesSettingsPreset; settings: SalesSettings }) => {
      const saved = await save.mutateAsync(salesPresetPatch(args.preset, args.settings))
      await qc.invalidateQueries({ queryKey: salesKeys.presets(me.value?.company?.id) })
      return saved
    },
  })
}
