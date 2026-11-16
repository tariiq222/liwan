import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../useApi'

// The shared settings form is replaced by the options the card hands it, so the save it wraps can be run directly.
type FormOptions = { save: (draft: object, latest: { revision: number }) => Promise<unknown> }
let formOptions: FormOptions
vi.mock('../../settings/useSettingsForm', () => ({ useSettingsForm: (options: FormOptions) => { formOptions = options; return {} } }))
const saveSettings = vi.fn()
vi.mock('../useSalesSettings', () => ({ useSaveSalesSettings: () => ({ mutateAsync: saveSettings }) }))

const { useSalesSettingsCard } = await import('../useSalesSettingsCard')
const settings = { visibility: 'own', validity_days: 30, discount_limit_percent: 20, default_terms: '', customer_answer: 'accept', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 1, can_manage: true } as const

beforeEach(() => saveSettings.mockReset())

describe('sales settings card', () => {
  it('names the field a 422 refused and clears it on the next save', async () => {
    const card = useSalesSettingsCard(['validity_days'] as const, { settings: () => settings, reload: async () => settings })
    saveSettings.mockRejectedValueOnce(new ApiError(422, 'invalid', 'too long', 'validity_days'))
    await expect(formOptions.save({ validity_days: 4000 }, { revision: 1 })).rejects.toBeInstanceOf(ApiError)
    expect(saveSettings).toHaveBeenCalledWith({ validity_days: 4000, revision: 1 })
    expect(card.refusedField.value).toBe('validity_days')
    saveSettings.mockResolvedValueOnce(settings)
    await formOptions.save({ validity_days: 30 }, { revision: 1 })
    expect(card.refusedField.value).toBeNull()
  })

  it('reads and saves the resend and signing settings with the card', async () => {
    useSalesSettingsCard(['answered_resend', 'signature_methods'] as const, { settings: () => settings, reload: async () => settings })
    saveSettings.mockResolvedValueOnce(settings)
    await formOptions.save({ answered_resend: 'refuse', signature_methods: 'draw' }, { revision: 3 })
    expect(saveSettings).toHaveBeenCalledWith({ answered_resend: 'refuse', signature_methods: 'draw', revision: 3 })
  })

  it('leaves the field empty for a refusal that is not a field error', async () => {
    const card = useSalesSettingsCard(['validity_days'] as const, { settings: () => settings, reload: async () => settings })
    saveSettings.mockRejectedValueOnce(new ApiError(409, 'conflict', 'stale'))
    await expect(formOptions.save({ validity_days: 30 }, { revision: 1 })).rejects.toBeInstanceOf(ApiError)
    expect(card.refusedField.value).toBeNull()
  })
})
