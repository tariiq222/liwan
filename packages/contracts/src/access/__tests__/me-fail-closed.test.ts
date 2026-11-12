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
  company: { id: 1, name: 'شركة المثال' }, companies: [{ id: 1, name: 'شركة المثال' }], home_company_id: 1,
}

describe('Me access extensions fail closed', () => {
  it('defaults missing roles, capabilities, and policy version without using legacy role authority', () => {
    const parsed = MeSchema.parse(BASE_ME)
    expect(parsed.roles).toEqual([])
    expect(parsed.capabilities).toEqual([])
    expect(parsed.access_policy_version).toBe(0)
  })

  it('carries the holder\'s own mobile number and the mobile gate, and never blocks on a server that omits them', () => {
    expect(MeSchema.parse({ ...BASE_ME, mobile: '+966500000001', mobile_required: false })).toMatchObject({ mobile: '+966500000001', mobile_required: false })
    expect(MeSchema.parse({ ...BASE_ME, mobile: null, mobile_required: true })).toMatchObject({ mobile: null, mobile_required: true })
    expect(MeSchema.parse(BASE_ME)).toMatchObject({ mobile: null, mobile_required: false })
    expect(() => MeSchema.parse({ ...BASE_ME, mobile: '0500000001' })).toThrow()
  })

  it('carries whether the account is read-only and defaults to writable on a server that omits it', () => {
    expect(MeSchema.parse(BASE_ME).read_only).toBe(false)
    expect(MeSchema.parse({ ...BASE_ME, read_only: true }).read_only).toBe(true)
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
