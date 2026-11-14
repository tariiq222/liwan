import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { Customer, CustomFieldWithValue } from '@liwan/contracts'
import { ApiError } from '../../useApi'
import { shouldResetCustomerDraft, topAlertVisible, useCustomerFormFields, useShownCustomerFields } from '../customerFormState'

const customer: Customer = { id: 4, name: 'منى', erased: false, phone: null, email: null, is_company: false, parent: null, active: true, company: null, properties: [] }

describe('shouldResetCustomerDraft', () => {
  it('keeps what the user typed when a refetch hands the form the same customer again', () => {
    expect(shouldResetCustomerDraft(customer, { ...customer, name: 'منى (من الخادم)' }, true)).toBe(false)
  })

  it('follows the server while nothing was typed', () => {
    expect(shouldResetCustomerDraft(customer, { ...customer, name: 'منى (من الخادم)' }, false)).toBe(true)
  })

  it('resets for another customer, even over typed input, and for the first one', () => {
    expect(shouldResetCustomerDraft(customer, { ...customer, id: 5 }, true)).toBe(true)
    expect(shouldResetCustomerDraft(undefined, customer, true)).toBe(true)
  })
})

describe('topAlertVisible', () => {
  const none = { kind: false, parent: false }
  const refusal = (field: string) => new ApiError(422, 'invalid', 'x', field)

  it('shows an unrelated refusal, and none while there is no error', () => {
    expect(topAlertVisible(refusal('name'), none, false)).toBe(true)
    expect(topAlertVisible(null, none, false)).toBe(false)
  })

  it('leaves a phone refusal to the phone field, which is always on the form', () => {
    expect(topAlertVisible(new ApiError(422, 'invalid_phone', 'x', 'phone'), none, false)).toBe(false)
  })

  it('shows a party kind or parent refusal at the top when its field is not on the form', () => {
    expect(topAlertVisible(refusal('is_company'), none, false)).toBe(true)
    expect(topAlertVisible(refusal('parent_id'), none, false)).toBe(true)
  })

  it('leaves them to their field when it is rendered', () => {
    expect(topAlertVisible(refusal('is_company'), { kind: true, parent: false }, false)).toBe(false)
    expect(topAlertVisible(refusal('parent_id'), { kind: false, parent: true }, false)).toBe(false)
  })

  it('leaves a custom field refusal to its row', () => {
    expect(topAlertVisible(refusal('properties.city'), none, true)).toBe(false)
  })
})

describe('useCustomerFormFields', () => {
  const city: CustomFieldWithValue = { key: 'city', label: 'المدينة', type: 'char', value: null }
  const vip: CustomFieldWithValue = { key: 'vip', label: 'مميز', type: 'boolean', value: false }

  it('collects the changed values and clears the refusals when one changes', () => {
    const fields = useCustomerFormFields(() => [city])
    fields.errors.value = { city: 'x' }
    fields.change({ city: 'الرياض' })
    expect(fields.changed.value).toEqual({ city: 'الرياض' })
    expect(fields.errors.value).toEqual({})
  })

  it('forgets the changed values when the definition changes, so they are not sent', async () => {
    const definition = ref([city])
    const fields = useCustomerFormFields(() => definition.value)
    fields.change({ city: 'الرياض' })
    fields.dirty.value = true
    definition.value = [vip]
    await nextTick()
    expect(fields.changed.value).toEqual({})
    expect(fields.dirty.value).toBe(false)
  })
})

describe('useShownCustomerFields', () => {
  const city = (value: string | null): CustomFieldWithValue => ({ key: 'city', label: 'المدينة', type: 'char', value })
  function setup(dirty: boolean) {
    const source = ref<CustomFieldWithValue[]>([city('الرياض')])
    const record = ref<number | undefined>(4)
    const isDirty = ref(dirty)
    const shown = useShownCustomerFields(() => source.value, () => record.value, () => isDirty.value)
    return { source, record, isDirty, shown }
  }

  it('keeps the fields under unsaved input when a refetch only changes a value', async () => {
    const { source, shown } = setup(true)
    source.value = [city('جدة')]
    await nextTick()
    expect(shown.value[0]?.value).toBe('الرياض')
  })

  it('follows the server while the form is clean', async () => {
    const { source, shown } = setup(false)
    source.value = [city('جدة')]
    await nextTick()
    expect(shown.value[0]?.value).toBe('جدة')
  })

  it('follows another record and a changed definition even over unsaved input', async () => {
    const other = setup(true)
    other.record.value = 5
    other.source.value = [city('جدة')]
    await nextTick()
    expect(other.shown.value[0]?.value).toBe('جدة')
    const redefined = setup(true)
    redefined.source.value = [{ ...city('الرياض'), label: 'البلدة', type: 'text' }]
    await nextTick()
    expect(redefined.shown.value[0]?.type).toBe('text')
  })
})
