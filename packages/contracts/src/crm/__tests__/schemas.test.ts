import { CrmCapabilityKeySchema } from '../index'

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
