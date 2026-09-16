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
})
