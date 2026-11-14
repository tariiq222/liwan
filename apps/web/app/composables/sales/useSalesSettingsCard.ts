import type { SalesSettings, SalesSettingsPatch } from '@liwan/contracts'
import { useSettingsForm } from '../settings/useSettingsForm'
import { useSaveSalesSettings } from './useSalesSettings'

type SalesSettingField = keyof Omit<SalesSettingsPatch, 'revision'>

/** The draft of one sales settings card: it holds and saves only `fields`, with the revision the page knows. */
export function useSalesSettingsCard<Field extends SalesSettingField>(fields: readonly Field[], options: { settings: () => SalesSettings; reload: () => Promise<SalesSettings> }) {
  const { mutateAsync: saveSettings } = useSaveSalesSettings()
  const read = (settings: SalesSettings) => Object.fromEntries(fields.map(field => [field, settings[field]])) as Pick<SalesSettings, Field>
  return useSettingsForm({
    source: options.settings,
    read,
    save: (draft, latest) => saveSettings({ ...draft, revision: latest.revision }),
    reload: options.reload,
  })
}
