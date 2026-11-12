import { BrandingSchema, KNOWN_LIWAN_MODULE_IDS, MeAppearancePatchSchema, MeCompanyInputSchema, MeSchema } from '../index'

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
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' }, companies: [{ id: 1, name: 'Erada' }], home_company_id: 1,
    })
    expect(me.role).toBe('employee')
  })
  it('carries the personal appearance and validates its patch', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' }, companies: [{ id: 1, name: 'Erada' }], home_company_id: 1,
      appearance: { mode: 'dark', font_size: 'large' },
    })
    expect(me.appearance).toEqual({ mode: 'dark', font_size: 'large' })
    expect(() => MeSchema.parse({ ...me, appearance: { mode: 'sepia', font_size: 'small' } })).toThrow()
    expect(MeAppearancePatchSchema.parse({ mode: 'cream' })).toEqual({ mode: 'cream' })
    expect(() => MeAppearancePatchSchema.parse({})).toThrow()
    expect(() => MeAppearancePatchSchema.parse({ font_size: 'huge' })).toThrow()
  })
  it('carries the working company, the companies it may switch to and the home company', () => {
    const base = {
      id: 2, name: 'Sara', login: 'emp', email: '', lang: 'ar_001', tz: '', role: 'employee',
      company: { id: 2, name: 'Branch B' },
    }
    const me = MeSchema.parse({
      ...base, home_company_id: 1, companies: [{ id: 1, name: 'Branch A' }, { id: 2, name: 'Branch B' }],
    })
    expect(me.home_company_id).toBe(1)
    expect(me.companies.map(company => company.id)).toEqual([1, 2])
    expect(() => MeSchema.parse(base)).toThrow()
    expect(() => MeSchema.parse({ ...base, home_company_id: 1 })).toThrow()
    expect(() => MeSchema.parse({ ...base, companies: [] })).toThrow()
    expect(() => MeSchema.parse({ ...base, companies: [{ id: 0, name: 'x' }] })).toThrow()
    expect(() => MeSchema.parse({ ...base, home_company_id: 'one' })).toThrow()
  })
  it('validates the body that switches the working company', () => {
    expect(MeCompanyInputSchema.parse({ company_id: 2 })).toEqual({ company_id: 2 })
    for (const body of [{}, { company_id: 0 }, { company_id: '2' }, { company_id: 2, other: 1 }]) {
      expect(MeCompanyInputSchema.safeParse(body).success).toBe(false)
    }
    expect(() => MeSchema.parse({
      id: 2, name: 'x', login: 'x', email: '', lang: 'ar_001', tz: '', role: 'employee',
      company: { id: 1, name: 'c', extra: 1 }, companies: [], home_company_id: 1,
    })).toThrow()
  })
  it('rejects unknown roles', () => {
    expect(() => MeSchema.parse({
      id: 2, name: 'x', login: 'x', email: '', lang: 'ar_001', tz: '', role: 'root', company: { id: 1, name: 'c' }, companies: [{ id: 1, name: 'c' }], home_company_id: 1,
    })).toThrow()
  })
  it('accepts tenant modules, entitlements, and platform state', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' }, companies: [{ id: 1, name: 'Erada' }], home_company_id: 1,
      modules: ['liwan_pmo', 'liwan_meetings', 'liwan_hr'],
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
    expect(me.modules).toEqual(['liwan_pmo', 'liwan_meetings', 'liwan_hr'])
  })
  it("accepts a newer application's module id and rejects malformed ones", () => {
    const base = {
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' }, companies: [{ id: 1, name: 'Erada' }], home_company_id: 1,
    }
    expect(MeSchema.parse({ ...base, modules: ['liwan_sales', 'customer_acme_reports'] }).modules)
      .toEqual(['liwan_sales', 'customer_acme_reports'])
    expect(KNOWN_LIWAN_MODULE_IDS).toEqual(['liwan_chat', 'liwan_hr', 'liwan_meetings', 'liwan_pmo'])
    for (const id of ['sales', 'liwan_', 'LIWAN_SALES', 'liwan-sales', 'odoo_sales']) {
      expect(() => MeSchema.parse({ ...base, modules: [id] })).toThrow()
    }
  })
})
