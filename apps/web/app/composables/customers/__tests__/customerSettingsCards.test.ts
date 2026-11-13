import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { CustomerSettings, CustomerSettingsPatch } from '@liwan/contracts'
import { ApiError } from '../../useApi'

// The shared settings query and a server stand-in whose answer each test chooses.
const settings = ref<CustomerSettings>(undefined as never)
const save = vi.fn<(body: CustomerSettingsPatch) => Promise<CustomerSettings>>()
vi.mock('../useCustomerSettings', () => ({ useSaveCustomerSettings: () => ({ mutateAsync: save }) }))

const { useCustomerSharingCard } = await import('../useCustomerSharingCard')
const { useCustomerFieldsCard } = await import('../useCustomerFieldsCard')
const { useCustomerSettingsCard } = await import('../useCustomerSettingsCard')

const seed = (): CustomerSettings => ({
  sharing: 'branch',
  party_kinds: 'both',
  phone_country: { id: 1, code: 'SA', name: 'السعودية' },
  fields: [{ key: 'city', label: 'المدينة', type: 'char' }, { key: 'vip', label: 'مميز', type: 'boolean' }],
  field_limits: { max_properties: 20, max_options: 50, max_label: 100 },
  can_manage: true,
  revision: 3,
})
const sharing = () => useCustomerSharingCard({ settings: () => settings.value, reload: async () => settings.value })
const fields = () => useCustomerFieldsCard({ settings: () => settings.value, reload: async () => settings.value, removalMessage: kind => `confirm ${kind}` })

beforeEach(() => {
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  settings.value = seed()
  save.mockReset()
})

describe('useCustomerSharingCard', () => {
  it('saves the chosen mode with the revision it was read at', async () => {
    save.mockResolvedValue({ ...settings.value, sharing: 'establishment', revision: 4 })
    const card = sharing()
    card.draft.value.sharing = 'establishment'
    await card.save()
    expect(save).toHaveBeenCalledWith({ revision: 3, sharing: 'establishment' })
    expect(card.transferRequired.value).toBe(false)
  })

  it('keeps the saved value and says so when customers already exist', async () => {
    save.mockRejectedValue(new ApiError(409, 'sharing_transfer_required', 'customers exist', 'sharing'))
    const card = sharing()
    card.draft.value.sharing = 'establishment'
    await card.save()
    expect(card.transferRequired.value).toBe(true)
    expect(card.draft.value.sharing).toBe('branch')
    expect(card.state.value.message).toBe('')
    expect(card.state.value.dirty).toBe(false)
  })

  it('clears the message once the user picks again', async () => {
    save.mockRejectedValue(new ApiError(409, 'sharing_transfer_required', 'customers exist', 'sharing'))
    const card = sharing()
    card.draft.value.sharing = 'establishment'
    await card.save()
    card.draft.value.sharing = 'establishment'
    await nextTick()
    expect(card.transferRequired.value).toBe(false)
  })

  it('shows any other refusal as a save failure, and a stale revision as a conflict', async () => {
    save.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    const card = sharing()
    card.draft.value.sharing = 'establishment'
    await card.save()
    expect(card.transferRequired.value).toBe(false)
    expect(card.state.value.conflict).toBe(true)
  })
})

const removalDetails = { fields: [{ key: 'vip', label: 'مميز', count: 12 }], options: [] }
const withoutVip = (card: ReturnType<typeof fields>) => { card.draft.value.fields = card.draft.value.fields.filter(field => field.key !== 'vip') }

describe('useCustomerFieldsCard', () => {
  it('saves a definition change without a confirmation when no customer holds a removed value', async () => {
    save.mockResolvedValue({ ...settings.value, revision: 4 })
    const card = fields()
    withoutVip(card)
    await card.save()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toEqual({ revision: 3, fields: [{ key: 'city', label: 'المدينة', type: 'char' }] })
    expect(card.removal.value).toBeNull()
  })

  it('stops at the server count, names each field, and keeps the draft', async () => {
    save.mockRejectedValue(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    const card = fields()
    withoutVip(card)
    await card.save()
    expect(card.removal.value).toEqual(removalDetails)
    expect(card.state.value.message).toBe('confirm fields')
    expect(card.draft.value.fields.map(field => field.key)).toEqual(['city'])
  })

  it('stops the same way for an option customers still hold and says it is an option', async () => {
    const optionDetails = { fields: [], options: [{ field_key: 'city', field_label: 'المدينة', key: 'riyadh', label: 'الرياض', count: 4 }] }
    save.mockRejectedValue(new ApiError(409, 'custom_field_values_exist', 'values', undefined, optionDetails))
    const card = fields()
    card.draft.value.fields[0]!.label = 'البلدة'
    await card.save()
    expect(card.removal.value).toEqual(optionDetails)
    expect(card.state.value.message).toBe('confirm options')
  })

  it('repeats the write with confirm_field_removal only after the user confirms', async () => {
    save.mockRejectedValueOnce(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    const card = fields()
    withoutVip(card)
    await card.save()
    expect(save.mock.calls[0]![0]).not.toHaveProperty('confirm_field_removal')
    save.mockResolvedValueOnce({ ...settings.value, fields: [settings.value.fields[0]!], revision: 4 })
    await card.confirmRemoval()
    expect(save.mock.calls[1]![0]).toEqual({ revision: 3, fields: [{ key: 'city', label: 'المدينة', type: 'char' }], confirm_field_removal: true })
    expect(card.removal.value).toBeNull()
  })

  it('drops the confirmation on cancel, on revert and when the definition is edited again', async () => {
    save.mockRejectedValue(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    const card = fields()
    withoutVip(card)
    await card.save()
    card.cancelRemoval()
    expect(card.removal.value).toBeNull()
    await card.save()
    expect(card.removal.value).not.toBeNull()
    card.revert()
    expect(card.removal.value).toBeNull()
    expect(card.draft.value.fields.map(field => field.key)).toEqual(['city', 'vip'])
    withoutVip(card)
    await card.save()
    card.draft.value.fields[0]!.label = 'البلدة'
    await nextTick()
    expect(card.removal.value).toBeNull()
  })

  it('does not carry a confirmation the locked card never used into a later save', async () => {
    save.mockRejectedValueOnce(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    const card = fields()
    withoutVip(card)
    await card.save()
    // A stale revision locks the card: the confirmation press returns early without writing.
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'stale'))
    await card.save()
    expect(card.state.value.conflict).toBe(true)
    const writes = save.mock.calls.length
    await card.confirmRemoval()
    expect(save).toHaveBeenCalledTimes(writes)
    await card.reload()
    card.draft.value.fields = card.draft.value.fields.filter(field => field.key !== 'city')
    save.mockRejectedValueOnce(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    await card.save()
    expect(save.mock.calls.at(-1)![0]).not.toHaveProperty('confirm_field_removal')
  })

  it('never confirms a later write on its own', async () => {
    save.mockRejectedValueOnce(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    const card = fields()
    withoutVip(card)
    await card.save()
    save.mockResolvedValueOnce({ ...settings.value, revision: 4 })
    await card.confirmRemoval()
    save.mockRejectedValueOnce(new ApiError(409, 'custom_field_values_exist', 'values', undefined, removalDetails))
    card.draft.value.fields = [...card.draft.value.fields, { label: 'جديد', type: 'char' }]
    await card.save()
    expect(save.mock.calls.at(-1)![0]).not.toHaveProperty('confirm_field_removal')
  })
})

describe('the phone country card', () => {
  const phoneCountry = () => useCustomerSettingsCard({
    settings: () => settings.value,
    read: ({ phone_country }) => ({ phone_country_id: phone_country?.id ?? null }),
    toPatch: ({ phone_country_id }) => ({ phone_country_id }),
    reload: async () => settings.value,
  })

  it('saves the chosen country with the revision it was read at', async () => {
    save.mockResolvedValue({ ...settings.value, phone_country: { id: 65, code: 'EG', name: 'مصر' }, revision: 4 })
    const card = phoneCountry()
    card.draft.value.phone_country_id = 65
    await card.save()
    expect(save).toHaveBeenCalledWith({ revision: 3, phone_country_id: 65 })
  })

  it('sends null for the main company\'s country', async () => {
    save.mockResolvedValue({ ...settings.value, phone_country: null, revision: 4 })
    const card = phoneCountry()
    card.draft.value.phone_country_id = null
    await card.save()
    expect(save).toHaveBeenCalledWith({ revision: 3, phone_country_id: null })
  })

  it('has nothing to save while the draft is the saved country', async () => {
    const card = phoneCountry()
    await card.save()
    expect(save).not.toHaveBeenCalled()
    expect(card.state.value.dirty).toBe(false)
  })
})
