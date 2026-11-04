import { describe, expect, it } from 'vitest'
import {
  CustomFieldDefinitionPatchItemSchema,
  CustomFieldDefinitionSchema,
  CustomFieldLimitsSchema,
  CustomFieldOptionSchema,
  CustomFieldTypeSchema,
  CustomFieldValuesSchema,
  CustomFieldValueSchema,
  CustomFieldWithValueSchema,
} from '../customFields'

const selection = {
  key: 'sector',
  label: 'القطاع',
  type: 'selection',
  options: [{ key: 'retail', label: 'تجزئة' }, { key: 'services', label: 'خدمات' }],
}

describe('CustomFieldTypeSchema', () => {
  it('lists the nine types of the engine', () => {
    expect(CustomFieldTypeSchema.options).toEqual([
      'char', 'text', 'integer', 'float', 'boolean', 'date', 'datetime', 'selection', 'tags',
    ])
  })

  it('refuses a foreign type', () => {
    expect(() => CustomFieldTypeSchema.parse('money')).toThrow()
  })
})

describe('CustomFieldDefinitionSchema', () => {
  it('accepts a field of each type, with options on the two that carry them', () => {
    for (const type of ['char', 'text', 'integer', 'float', 'boolean', 'date', 'datetime']) {
      expect(CustomFieldDefinitionSchema.parse({ key: 'k', label: 'حقل', type }).type).toBe(type)
    }
    expect(CustomFieldDefinitionSchema.parse(selection).options).toHaveLength(2)
    expect(CustomFieldDefinitionSchema.parse({ ...selection, type: 'tags' }).type).toBe('tags')
  })

  it('needs a key, a label and its options on a selection or tags field', () => {
    for (const field of [
      { ...selection, key: '' },
      { ...selection, label: '' },
      { ...selection, options: [] },
      { ...selection, options: undefined },
      { ...selection, type: 'tags', options: undefined },
    ]) {
      expect(() => CustomFieldDefinitionSchema.parse(field)).toThrow()
    }
  })

  it('refuses options on a field of another type, and any unknown key', () => {
    expect(() => CustomFieldDefinitionSchema.parse({ key: 'k', label: 'حقل', type: 'char', options: [{ key: 'a', label: 'أ' }] })).toThrow()
    expect(() => CustomFieldDefinitionSchema.parse({ ...selection, required: true })).toThrow()
    expect(() => CustomFieldDefinitionSchema.parse({ ...selection, options: [{ key: 'a', label: 'أ', extra: 1 }] })).toThrow()
  })

  it('refuses a lone option without a key or a label', () => {
    expect(() => CustomFieldOptionSchema.parse({ key: '', label: 'أ' })).toThrow()
    expect(() => CustomFieldOptionSchema.parse({ label: 'أ' })).toThrow()
  })
})

describe('CustomFieldDefinitionPatchItemSchema', () => {
  it('accepts a new field, and a new option, without their server keys', () => {
    expect(CustomFieldDefinitionPatchItemSchema.parse({ label: 'المدينة', type: 'char' }).key).toBeUndefined()
    const patch = { key: 'sector', label: 'القطاع', type: 'selection', options: [{ label: 'تعليم' }] }
    expect(CustomFieldDefinitionPatchItemSchema.parse(patch).options?.[0]?.key).toBeUndefined()
  })

  it('keeps the options rule of the type', () => {
    expect(() => CustomFieldDefinitionPatchItemSchema.parse({ label: 'القطاع', type: 'selection' })).toThrow()
    expect(() => CustomFieldDefinitionPatchItemSchema.parse({ label: 'اسم', type: 'char', options: [{ label: 'أ' }] })).toThrow()
  })
})

describe('CustomFieldValuesSchema', () => {
  it('accepts every wire value of a field', () => {
    const values = { name: 'عميل', count: 3, total: 12.5, flagged: true, due: '2026-11-05', at: '2026-11-05T09:00:00Z', tags: ['a', 'b'], empty: null }
    expect(CustomFieldValuesSchema.parse(values)).toEqual(values)
  })

  it('refuses a nested object, an unknown value shape and an empty key', () => {
    expect(() => CustomFieldValueSchema.parse({ a: 1 })).toThrow()
    expect(() => CustomFieldValuesSchema.parse({ key: [1, 2] })).toThrow()
    expect(() => CustomFieldValuesSchema.parse({ '': null })).toThrow()
  })
})

describe('CustomFieldWithValueSchema', () => {
  it('carries the definition of the field next to the value of the record', () => {
    const parsed = CustomFieldWithValueSchema.parse({ ...selection, value: ['retail'] })
    expect(parsed).toMatchObject({ key: 'sector', type: 'selection', value: ['retail'] })
    expect(CustomFieldWithValueSchema.parse({ key: 'k', label: 'اسم', type: 'char', value: null }).value).toBeNull()
  })

  it('keeps the options rule and refuses a record field with no value', () => {
    expect(() => CustomFieldWithValueSchema.parse({ ...selection, options: [], value: null })).toThrow()
    expect(() => CustomFieldWithValueSchema.parse({ ...selection, value: undefined })).toThrow()
    expect(() => CustomFieldWithValueSchema.parse({ key: 'k', label: 'اسم', type: 'char', value: null, extra: 1 })).toThrow()
  })
})

describe('CustomFieldLimitsSchema', () => {
  it('needs three positive whole numbers', () => {
    expect(CustomFieldLimitsSchema.parse({ max_properties: 50, max_options: 100, max_label: 64 }).max_label).toBe(64)
    expect(() => CustomFieldLimitsSchema.parse({ max_properties: 0, max_options: 100, max_label: 64 })).toThrow()
    expect(() => CustomFieldLimitsSchema.parse({ max_properties: 50, max_options: 1.5, max_label: 64 })).toThrow()
    expect(() => CustomFieldLimitsSchema.parse({ max_properties: 50, max_options: 100 })).toThrow()
  })
})
