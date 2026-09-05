import { ApiErrorSchema } from '../error'

describe('ApiErrorSchema details', () => {
  it('accepts numeric department-in-use counts', () => {
    const inUse = { code: 'department_in_use', message: 'x', details: { employees: 1, children: 0, documents: 2 } }
    expect(ApiErrorSchema.parse(inUse).details?.documents).toBe(2)
  })

  it('rejects non-numeric details and unknown envelope keys', () => {
    expect(() => ApiErrorSchema.parse({ code: 'x', message: 'x', details: { employees: '1' } })).toThrow()
    expect(() => ApiErrorSchema.parse({ code: 'x', message: 'x', extra: true })).toThrow()
  })
})
