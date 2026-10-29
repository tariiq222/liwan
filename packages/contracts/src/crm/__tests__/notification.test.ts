import { CrmBellKindSchema, CrmBellRowSchema } from '../index'

const row = {
  id: 5,
  kind: 'crm.assigned',
  opportunity_id: 9,
  title: 'Mona',
  count: 2,
  term: { ar: { singular: 'فرصة', plural: 'فرص' }, en: { singular: 'opportunity', plural: 'opportunities' }, gender: 'f' },
  created_at: '2026-10-28T09:00:00Z',
  is_read: false,
}

describe('CrmBellRowSchema', () => {
  it('accepts the three kinds the server registers', () => {
    expect(CrmBellKindSchema.options).toEqual(['crm.assigned', 'crm.followup_due', 'crm.needs_manager'])
    for (const kind of CrmBellKindSchema.options) expect(CrmBellRowSchema.parse({ ...row, kind }).kind).toBe(kind)
  })

  it('rejects a row without the machine details or with an unknown kind', () => {
    expect(() => CrmBellRowSchema.parse({ ...row, count: 0 })).toThrow()
    expect(() => CrmBellRowSchema.parse({ ...row, term: undefined })).toThrow()
    expect(() => CrmBellRowSchema.parse({ ...row, kind: 'crm.other' })).toThrow()
  })
})
