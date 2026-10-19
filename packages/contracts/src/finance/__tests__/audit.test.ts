import { describe, expect, it } from 'vitest'
import { FinanceAuditActionSchema, FinanceAuditEventListSchema, FinanceAuditEventSchema } from '..'

const EVENT = {
  id: 4,
  action: 'company_written',
  actor: { id: 2, name: 'Finance Manager' },
  created_at: '2026-10-19T08:00:00Z',
  res_model: 'res.company',
  res_id: 1,
  fields_written: ['city', 'vat'],
  outcome: null,
}

describe('finance audit contracts', () => {
  it('accepts an event and the list envelope', () => {
    expect(FinanceAuditEventSchema.parse(EVENT)).toEqual(EVENT)
    const page = { items: [EVENT], total: 1 }
    expect(FinanceAuditEventListSchema.parse(page)).toEqual(page)
  })

  it('refuses an unknown action, a stray key such as a value, and a missing actor', () => {
    expect(() => FinanceAuditActionSchema.parse('company_deleted')).toThrow()
    expect(() => FinanceAuditEventSchema.parse({ ...EVENT, values: { vat: '1' } })).toThrow()
    expect(() => FinanceAuditEventSchema.parse({ ...EVENT, created_at: '2026-10-19 08:00:00' })).toThrow()
    const { actor: _actor, ...withoutActor } = EVENT
    expect(() => FinanceAuditEventSchema.parse(withoutActor)).toThrow()
  })
})
