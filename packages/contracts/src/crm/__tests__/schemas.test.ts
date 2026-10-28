import {
  CrmCapabilityKeySchema,
  CrmLostReasonListSchema,
  CrmOutcomeCreateSchema,
  CrmOutcomeSchema,
  CrmPackageCreateSchema,
  CrmPackageSchema,
  CrmStagePatchSchema,
  CrmStageSchema,
  CrmSettingsPatchSchema,
  CrmSettingsSchema,
} from '../index'

describe('CrmCapabilityKeySchema', () => {
  it('accepts exactly the nine CRM capability keys', () => {
    expect(CrmCapabilityKeySchema.options).toEqual([
      'crm.leads.read',
      'crm.leads.work',
      'crm.leads.assign',
      'crm.leads.import',
      'crm.leads.export',
      'crm.discount.approve',
      'crm.settings.read',
      'crm.settings.manage',
      'crm.audit.read',
    ])
  })

  it('rejects a retired or foreign key', () => {
    expect(() => CrmCapabilityKeySchema.parse('crm.records.read')).toThrow()
    expect(() => CrmCapabilityKeySchema.parse('hr.employees.read')).toThrow()
  })
})

const term = (ar: [string, string], en: [string, string], gender: 'm' | 'f') => ({
  ar: { singular: ar[0], plural: ar[1] },
  en: { singular: en[0], plural: en[1] },
  gender,
})

const settings = {
  values: {
    preset: 'phone_packages',
    followup_attempts: 2,
    followup_interval_hours: 24,
    after_attempts: 'lost',
    recycle_enabled: true,
    recycle_after_days: 30,
    recycle_cycles: 1,
    distribution_mode: 'round_robin',
    distribution_user_ids: [3],
    visibility: 'own',
    view_log_enabled: false,
    discount_allowed: false,
    discount_max_percent: 0,
    terms: {
      customer: term(['عميل', 'عملاء'], ['customer', 'customers'], 'm'),
      opportunity: term(['فرصة', 'فرص'], ['opportunity', 'opportunities'], 'f'),
      package: term(['باقة', 'باقات'], ['plan', 'plans'], 'f'),
    },
  },
  distribution_users: [{ id: 3, name: 'Agent' }],
  options: {
    preset: ['general', 'phone_packages'],
    after_attempts: ['lost', 'manager'],
    distribution_mode: ['round_robin', 'manual', 'on_import'],
    visibility: ['own', 'team', 'all'],
    term_gender: ['m', 'f'],
    followup_attempts: { min: 0, max: 10 },
    followup_interval_hours: { min: 1, max: 720 },
    recycle_after_days: { min: 1, max: 365 },
    recycle_cycles: { min: 0, max: 5 },
    discount_max_percent: { min: 0, max: 100 },
  },
  revision: 0,
}

describe('CrmSettingsSchema', () => {
  it('accepts the default settings payload', () => {
    expect(CrmSettingsSchema.parse(settings)).toEqual(settings)
  })

  it('carries the names of the distribution agents next to the values', () => {
    const { distribution_users: _names, ...withoutNames } = settings
    expect(() => CrmSettingsSchema.parse(withoutNames)).toThrow()
    expect(() => CrmSettingsSchema.parse({ ...settings, distribution_users: [{ id: 3 }] })).toThrow()
  })

  it('rejects an out-of-range value and an unknown enum option', () => {
    expect(() => CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, followup_attempts: 11 } })).toThrow()
    expect(() => CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, visibility: 'everyone' } })).toThrow()
  })

  it('rejects a settings value the contract does not name', () => {
    expect(() => CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, unknown_internal_field: 3 } })).toThrow()
    expect(() => CrmSettingsSchema.parse({ ...settings, options: { ...settings.options, extra: [] } })).toThrow()
    expect(() => CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, terms: { ...settings.values.terms, extra: 1 } } })).toThrow()
  })
})

describe('CrmSettingsPatchSchema', () => {
  it('accepts a partial values patch with partial terms', () => {
    const patch = { revision: 1, values: { visibility: 'team', terms: { package: { en: { plural: 'plans' } } } } }
    expect(CrmSettingsPatchSchema.parse(patch)).toEqual(patch)
  })

  it('accepts a preset patch', () => {
    expect(CrmSettingsPatchSchema.parse({ revision: 0, preset: 'phone_packages' })).toEqual({
      revision: 0,
      preset: 'phone_packages',
    })
  })

  it('rejects preset together with values, an empty patch and a preset inside values', () => {
    expect(() => CrmSettingsPatchSchema.parse({ revision: 0, preset: 'general', values: { visibility: 'all' } })).toThrow()
    expect(() => CrmSettingsPatchSchema.parse({ revision: 0, values: {} })).toThrow()
    expect(() => CrmSettingsPatchSchema.parse({ revision: 0, values: { preset: 'general' } })).toThrow()
    expect(() => CrmSettingsPatchSchema.parse({ revision: 0, values: { followup_attempts: 11 } })).toThrow()
  })
})

describe('CRM configurable lists', () => {
  it('parses the stage, outcome and package shapes the API returns', () => {
    expect(CrmStageSchema.parse({ id: 1, name: 'New', sequence: 10, is_won: false, active: true }).name).toBe('New')
    expect(CrmOutcomeSchema.parse({ id: 2, name: 'Sold', effect: 'won', lost_reason_id: null, active: true }).effect).toBe('won')
    expect(CrmPackageSchema.parse({ id: 3, name: 'Basic', price: 150.5, description: '', active: true }).price).toBe(150.5)
    expect(CrmLostReasonListSchema.parse({ items: [{ id: 4, name: 'x', active: true, protected: true }], total: 1 }).total).toBe(1)
  })

  it('rejects an unknown effect, a negative price and an empty patch', () => {
    expect(() => CrmOutcomeCreateSchema.parse({ name: 'x', effect: 'sold' })).toThrow()
    expect(() => CrmPackageCreateSchema.parse({ name: 'x', price: -1 })).toThrow()
    expect(() => CrmStagePatchSchema.parse({})).toThrow()
    expect(() => CrmStagePatchSchema.parse({ sequence: 3 })).toThrow()
  })

  it('caps a package price at the server maximum', () => {
    expect(CrmPackageCreateSchema.parse({ name: 'x', price: 999_999_999 }).price).toBe(999_999_999)
    expect(() => CrmPackageCreateSchema.parse({ name: 'x', price: 1_000_000_000 })).toThrow()
    expect(() => CrmPackageSchema.parse({ id: 3, name: 'x', price: 1_000_000_000, description: '', active: true })).toThrow()
  })

  it('rejects an unknown key on every list row and envelope', () => {
    expect(() => CrmStageSchema.parse({ id: 1, name: 'New', sequence: 10, is_won: false, active: true, extra: 1 })).toThrow()
    expect(() => CrmOutcomeSchema.parse({ id: 2, name: 'x', effect: 'won', lost_reason_id: null, active: true, extra: 1 })).toThrow()
    expect(() => CrmPackageSchema.parse({ id: 3, name: 'x', price: 1, description: '', active: true, extra: 1 })).toThrow()
    expect(() => CrmLostReasonListSchema.parse({ items: [], total: 0, extra: 1 })).toThrow()
    expect(() => CrmLostReasonListSchema.parse({ items: [{ id: 4, name: 'x', active: true, protected: true, extra: 1 }], total: 1 })).toThrow()
  })
})
