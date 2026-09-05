import { ApiErrorSchema } from '../error'

describe('ApiErrorSchema details', () => {
  it('accepts numeric department-in-use counts', () => {
    const inUse = { code: 'department_in_use', message: 'x', details: { employees: 1, children: 0, documents: 2 } }
    expect(ApiErrorSchema.parse(inUse).details?.documents).toBe(2)
  })

  it('accepts structured access details but rejects unknown envelope keys', () => {
    expect(ApiErrorSchema.parse({ code: 'missing_dependency', message: 'x', details: { permission: 'pmo.tasks.write', missing: ['pmo.tasks.read'] } }).details?.permission).toBe('pmo.tasks.write')
    expect(() => ApiErrorSchema.parse({ code: 'x', message: 'x', extra: true })).toThrow()
  })
})
