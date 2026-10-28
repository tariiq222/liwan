import {
  CrmCapabilityKeySchema,
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
    preset: 'general',
    followup_attempts: 2,
    followup_interval_hours: 24,
    after_attempts: 'lost',
    recycle_enabled: true,
    recycle_after_days: 30,
    recycle_cycles: 1,
    distribution_mode: 'round_robin',
    distribution_user_ids: [],
    visibility: 'own',
    view_log_enabled: false,
    discount_allowed: false,
    discount_max_percent: 0,
    terms: {
      customer: term(['عميل', 'عملاء'], ['customer', 'customers'], 'm'),
      opportunity: term(['فرصة', 'فرص'], ['opportunity', 'opportunities'], 'f'),
      package: term(['باقة', 'باقات'], ['package', 'packages'], 'f'),
    },
  },
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

  it('rejects an out-of-range value and an unknown enum option', () => {
    expect(() => CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, followup_attempts: 11 } })).toThrow()
    expect(() => CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, visibility: 'everyone' } })).toThrow()
  })

  it('does not carry the internal rotation cursor', () => {
    const parsed = CrmSettingsSchema.parse({ ...settings, values: { ...settings.values, round_robin_index: 3 } })
    expect(parsed.values).not.toHaveProperty('round_robin_index')
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
