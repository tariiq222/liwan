import { BrandingSchema, MeAppearancePatchSchema, MeSchema } from '../index'

describe('BrandingSchema', () => {
  it('accepts the shape served by GET /api/v1/branding', () => {
    const parsed = BrandingSchema.parse({
      name: 'Erada', logo_url: '/web/binary/company_logo?company=1',
      primary_color: '#0055ff', font: 'IBM_Plex_Sans_Arabic',
    })
    expect(parsed.primary_color).toBe('#0055ff')
  })
  it('rejects a non-hex primary_color', () => {
    expect(() => BrandingSchema.parse({ name: 'x', logo_url: '/l', primary_color: 'blue', font: 'Lato' })).toThrow()
  })
})

describe('MeSchema', () => {
  it('accepts the shape served by GET /api/v1/me', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
    })
    expect(me.role).toBe('employee')
  })
  it('carries the personal appearance and validates its patch', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
      appearance: { mode: 'dark', font_size: 'large' },
    })
    expect(me.appearance).toEqual({ mode: 'dark', font_size: 'large' })
    expect(() => MeSchema.parse({ ...me, appearance: { mode: 'sepia', font_size: 'small' } })).toThrow()
    expect(MeAppearancePatchSchema.parse({ mode: 'cream' })).toEqual({ mode: 'cream' })
    expect(() => MeAppearancePatchSchema.parse({})).toThrow()
    expect(() => MeAppearancePatchSchema.parse({ font_size: 'huge' })).toThrow()
  })
  it('rejects unknown roles', () => {
    expect(() => MeSchema.parse({
      id: 2, name: 'x', login: 'x', email: '', lang: 'ar_001', tz: '', role: 'root', company: { id: 1, name: 'c' },
    })).toThrow()
  })
  it('accepts tenant modules, entitlements, and platform state', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
      modules: ['nasq_pmo', 'nasq_meetings', 'nasq_hr'],
      entitlements: { 'pmo.enabled': true, 'users.limit': null, 'projects.max_projects': 12 },
      platform: {
        schema_version: 1, policy_revision: 3, state: 'expired', valid_until: '2026-01-01',
        read_only: true, readable_features: ['pmo.enabled'], writable_features: [],
      },
      terminology: { ar: { project: 'مبادرة' }, en: { project: 'Initiative' } },
    })
    expect(me.platform?.state).toBe('expired')
    expect(me.entitlements['projects.max_projects']).toBe(12)
    expect(me.terminology.ar.project).toBe('مبادرة')
    expect(me.modules).toEqual(['nasq_pmo', 'nasq_meetings', 'nasq_hr'])
  })
  it('rejects an unknown module id', () => {
    expect(() => MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
      modules: ['nasq_unknown'],
    })).toThrow()
  })
})
