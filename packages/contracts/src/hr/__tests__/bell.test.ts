import { HrLeaveBellKindSchema, HrLeaveBellRowSchema } from '../index'

const row = { id: 4, kind: 'hr.leave_approved', leave_id: 9, title: '2026-11-02 - 2026-11-03', created_at: '2026-10-29T09:00:00Z', is_read: false }

describe('HrLeaveBellRowSchema', () => {
  it('accepts both decision kinds', () => {
    expect(HrLeaveBellKindSchema.options).toEqual(['hr.leave_approved', 'hr.leave_refused'])
    for (const kind of HrLeaveBellKindSchema.options) expect(HrLeaveBellRowSchema.parse({ ...row, kind }).leave_id).toBe(9)
  })

  it('rejects a row without its leave or with another kind', () => {
    expect(() => HrLeaveBellRowSchema.parse({ ...row, leave_id: undefined })).toThrow()
    expect(() => HrLeaveBellRowSchema.parse({ ...row, kind: 'hr.leave_other' })).toThrow()
  })
})
