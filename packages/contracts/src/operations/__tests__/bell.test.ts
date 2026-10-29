import { OperationBellKindSchema, OperationBellRowSchema } from '../index'

const row = { id: 4, kind: 'operations.review_requested', request_id: 9, title: 'Laptop request', created_at: '2026-10-29T09:00:00Z', is_read: false }

describe('OperationBellRowSchema', () => {
  it('accepts the four kinds the server registers', () => {
    expect(OperationBellKindSchema.options).toEqual(['operations.review_requested', 'operations.approved', 'operations.rejected', 'operations.returned'])
    for (const kind of OperationBellKindSchema.options) expect(OperationBellRowSchema.parse({ ...row, kind }).request_id).toBe(9)
  })

  it('rejects a row without its request or with another kind', () => {
    expect(() => OperationBellRowSchema.parse({ ...row, request_id: 0 })).toThrow()
    expect(() => OperationBellRowSchema.parse({ ...row, kind: 'operations.other' })).toThrow()
  })
})
