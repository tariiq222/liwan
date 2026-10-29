import type { CrmPreset, CrmSettings, CrmSettingsValues, CrmSettingsValuesPatch } from '@webvue/contracts'
import { useSettingsForm } from '../settings/useSettingsForm'
import { useSaveCrmSettings } from './useCrmSettings'

/** What a card saves: some of the values, or a preset (which sets several values at once). */
export type CrmCardPatch = { values: CrmSettingsValuesPatch } | { preset: CrmPreset }

interface CardOptions<Draft> {
  settings: () => CrmSettings
  /** The fields this card owns, copied out of the settings values. */
  read: (values: CrmSettingsValues) => Draft
  /** The patch that saves exactly those fields. */
  toPatch: (draft: Draft) => CrmCardPatch
  /** Fetches the latest settings after a 409. */
  reload: () => Promise<CrmSettings>
}

/** One CRM settings card: the shared settings form, saving its patch with the latest shared revision. */
export function useCrmSettingsCard<Draft>(options: CardOptions<Draft>) {
  const { mutateAsync: saveSettings } = useSaveCrmSettings()
  return useSettingsForm<CrmSettings, Draft>({
    source: options.settings,
    read: settings => options.read(settings.values),
    save: (draft, latest) => saveSettings({ revision: latest.revision, ...options.toPatch(draft) }),
    reload: options.reload,
  })
}
