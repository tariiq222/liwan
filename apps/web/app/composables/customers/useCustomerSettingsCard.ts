import type { CustomerSettings, CustomerSettingsPatch } from '@liwan/contracts'
import { useSettingsForm } from '../settings/useSettingsForm'
import { useSaveCustomerSettings } from './useCustomerSettings'

interface CardOptions<Draft> {
  settings: () => CustomerSettings
  /** The fields this card owns, copied out of the settings. */
  read: (settings: CustomerSettings) => Draft
  /** The patch that saves exactly those fields (the revision is added here). */
  toPatch: (draft: Draft) => Omit<CustomerSettingsPatch, 'revision'>
  /** Fetches the latest settings after a 409. */
  reload: () => Promise<CustomerSettings>
}

/** One customers settings card: the shared settings form, saving its patch with the latest shared revision. */
export function useCustomerSettingsCard<Draft>(options: CardOptions<Draft>) {
  const { mutateAsync: saveSettings } = useSaveCustomerSettings()
  return useSettingsForm<CustomerSettings, Draft>({
    source: options.settings,
    read: options.read,
    save: (draft, latest) => saveSettings({ revision: latest.revision, ...options.toPatch(draft) }),
    reload: options.reload,
  })
}
