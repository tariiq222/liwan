import { MeSchema } from '../../common'
import { describe, expect, it } from 'vitest'

const BASE_ME = {
  id: 18,
  name: 'سارة محمد',
  login: 'sara@example.com',
  email: 'sara@example.com',
  lang: 'ar_001',
  tz: 'Asia/Riyadh',
  role: 'admin' as const,
  company: { id: 1, name: 'شركة المثال' },
}

describe('Me access extensions fail closed', () => {
  it('defaults missing roles, capabilities, and policy version without using legacy role authority', () => {
    const parsed = MeSchema.parse(BASE_ME)
    expect(parsed.roles).toEqual([])
    expect(parsed.capabilities).toEqual([])
    expect(parsed.access_policy_version).toBe(0)
  })

  it('rejects malformed capability keys instead of treating them as authority', () => {
    for (const key of ['access.users read', 'ACCESS.users.read', 'access', 'access..read']) {
      expect(() => MeSchema.parse({ ...BASE_ME, capabilities: ['access.users.read', key] })).toThrow()
    }
  })

  it("carries a newer application's capabilities and module verbatim", () => {
    const parsed = MeSchema.parse({
      ...BASE_ME,
      capabilities: ['pmo.tasks.read', 'sales.orders.write'],
      modules: ['liwan_pmo', 'liwan_sales'],
    })
    expect(parsed.capabilities).toEqual(['pmo.tasks.read', 'sales.orders.write'])
    expect(parsed.modules).toEqual(['liwan_pmo', 'liwan_sales'])
  })

  it('preserves exact sorted unique capability data from the server', () => {
    const parsed = MeSchema.parse({
      ...BASE_ME,
      capabilities: ['access.roles.read', 'access.users.read'],
      roles: [{
        id: 2,
        key: 'system_admin',
        name: { ar: 'مدير النظام', en: 'System admin' },
        type: 'built_in',
        protected: true,
        source: 'assignment',
      }],
      access_policy_version: 7,
    })
    expect(parsed.capabilities).toEqual(['access.roles.read', 'access.users.read'])
    expect(parsed.access_policy_version).toBe(7)
  })
})
