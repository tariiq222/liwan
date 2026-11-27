import { describe, expect, it } from 'vitest'
import { publicContactSchema, publicPricingSchema } from '../commercial/public-site.js'

const pricing = {
  schema_version: 1, currency: 'SAR', tax: 'none' as const, trial_days: 14,
  base: { monthly: 0, annual: 0 },
  free: { users: 3, storage_gb: 20, branches: 1, apps: ['tasks', 'chat'] },
  apps: [{ key: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', monthly: 99, annual: 990 }],
  extra_user: { monthly: 29, annual: 290, max_users: 100 },
  extra_storage: { per_gb_monthly: 1, block_gb: 10, block_monthly: 10, step_gb: 10, step_gb_after: 100, step_gb_large: 100 },
  onboarding: { one_time: 499 }, refund_days: 14,
}
const contact = { name: 'Sara', email: 'Sara@Acme.com.sa', message: 'Hello', consent: true, turnstile_token: 'token' }

describe('public pricing contract', () => {
  it('accepts the shape the marketing site reads', () => {
    expect(publicPricingSchema.parse(pricing)).toEqual(pricing)
  })
  it('accepts dynamic currencies, vat_exclusive with tax_rate_bps, trial_days 0 and monthly-only plans', () => {
    const dynamic = {
      ...pricing,
      currency: 'USD',
      tax: 'vat_exclusive' as const,
      tax_rate_bps: 1500,
      trial_days: 0,
      base: { monthly: 49, annual: null },
      apps: [{ key: 'projects', name_ar: 'المشاريع', name_en: 'Projects', monthly: 39, annual: null }],
      extra_user: { monthly: 12, annual: null, max_users: 100 },
    }
    expect(publicPricingSchema.parse(dynamic)).toEqual(dynamic)
  })
  it('refuses an unknown field, so internal data cannot leak through it', () => {
    expect(publicPricingSchema.safeParse({ ...pricing, offer_revision: 'x' }).success).toBe(false)
    expect(publicPricingSchema.safeParse({ ...pricing, apps: [{ ...pricing.apps[0], monthly_minor: 9900 }] }).success).toBe(false)
  })
  it('enforces schema version, ISO currency, trial bounds and tax_rate_bps pairing', () => {
    for (const patch of [
      { schema_version: 2 },
      { currency: 'sar' },
      { currency: 'US' },
      { tax: 'vat' },
      { tax: 'none', tax_rate_bps: 1500 },
      { tax: 'vat_exclusive' },
      { trial_days: -1 },
      { trial_days: 3651 },
    ]) {
      expect(publicPricingSchema.safeParse({ ...pricing, ...patch }).success, JSON.stringify(patch)).toBe(false)
    }
  })
})

describe('public contact contract', () => {
  it('normalizes the address and treats empty optional text as absent', () => {
    const parsed = publicContactSchema.parse({ ...contact, company: '  ', mobile: '', users: undefined, lang: undefined })
    expect(parsed).toMatchObject({ email: 'sara@acme.com.sa', lang: 'ar' })
    expect(parsed.company).toBeUndefined()
    expect(parsed.mobile).toBeUndefined()
  })
  it('keeps the optional fields the site sends', () => {
    const parsed = publicContactSchema.parse({ ...contact, company: 'Acme', mobile: '+966555000111', users: 12, lang: 'en', utm_source: 'ad', ignored: 1 })
    expect(parsed).toMatchObject({ company: 'Acme', mobile: '+966555000111', users: 12, lang: 'en', utm_source: 'ad' })
    expect('ignored' in parsed).toBe(false)
  })
  it.each([
    ['name', { name: '' }], ['name', { name: 'x'.repeat(121) }], ['email', { email: 'not-an-email' }], ['mobile', { mobile: '0555000111' }],
    ['message', { message: '' }], ['message', { message: 'x'.repeat(2001) }], ['consent', { consent: false }], ['consent', { consent: undefined }],
    ['turnstile_token', { turnstile_token: undefined }], ['users', { users: 0 }],
  ])('refuses a bad %s', (field, patch) => {
    const result = publicContactSchema.safeParse({ ...contact, ...patch })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path[0]).toBe(field)
  })
})
