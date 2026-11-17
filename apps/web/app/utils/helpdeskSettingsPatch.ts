import type { HelpdeskSettingsPatch } from '@liwan/contracts'

// The keys a sector preset sets in one step (the server owns the values: PRESET_VALUES in liwan_helpdesk).
const PRESET_BUNDLE = ['visibility', 'default_priority', 'reopen_days', 'first_response_hours', 'resolution_hours'] as const

/**
 * The patch to save. When the preset changed, the bundle keys are left out so the server applies the new preset's
 * values; sending the draft's old values would override them. Every other setting is sent as edited.
 */
export function buildHelpdeskSettingsPatch(
  draft: Omit<HelpdeskSettingsPatch, 'revision'>,
  savedPreset: string | undefined,
  revision: number,
): HelpdeskSettingsPatch {
  const patch: HelpdeskSettingsPatch = { revision, ...draft }
  if (draft.preset !== savedPreset) for (const key of PRESET_BUNDLE) delete patch[key]
  return patch
}
