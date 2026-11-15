import { ref } from 'vue'
import type { SalesSettings, SalesSettingsPatch } from '@liwan/contracts'
import { ApiError } from '../useApi'
import { useSettingsForm } from '../settings/useSettingsForm'
import { useSaveSalesSettings } from './useSalesSettings'

type SalesSettingField = keyof Omit<SalesSettingsPatch, 'revision'>

/**
 * The draft of one sales settings card: it holds and saves only `fields`, with the revision the page knows.
 * `refusedField` names the field a 422 refused, so the card shows the refusal at it.
 */
export function useSalesSettingsCard<Field extends SalesSettingField>(fields: readonly Field[], options: { settings: () => SalesSettings; reload: () => Promise<SalesSettings> }) {
  const { mutateAsync: saveSettings } = useSaveSalesSettings()
  const read = (settings: SalesSettings) => Object.fromEntries(fields.map(field => [field, settings[field]])) as Pick<SalesSettings, Field>
  const refusedField = ref<string | null>(null)
  const form = useSettingsForm({
    source: options.settings,
    read,
    save: async (draft, latest) => {
      refusedField.value = null
      try {
        return await saveSettings({ ...draft, revision: latest.revision })
      } catch (error) {
        if (error instanceof ApiError && error.status === 422 && error.field) refusedField.value = error.field
        throw error
      }
    },
    reload: options.reload,
  })
  return { ...form, refusedField }
}
