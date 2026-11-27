import { describe, expect, it } from 'vitest'
import {
  signupAppSchema, signupAppsSchema, signupCompleteSchema, signupOfferSchema, signupResendSchema, signupStartSchema,
  signupStatusRequestSchema, signupStatusSchema, signupVerifySchema, slugCheckResultSchema, slugCheckSchema,
} from '../commercial/signup.js'

const signup_id = 'ba91699b-c25b-4a01-8c84-b2d39dc4b873'
const form = {
  offer_revision: signup_id,
  app_ids: ['crm', 'inbox'],
  company_name: 'Example Trading',
  admin_name: 'Administrator',
  email: 'Owner@Example.test',
  mobile: '0555 000 111',
  slug: ' Example-Trading ',
  accept_terms: true,
  terms_version: '2026-11',
  human_token: 'turnstile-token',
}

const offer = {
  offer_revision: signup_id,
  plan_name: 'Liwan Starter',
  trial_days: 14,
  currency: 'SAR',
  currency_exponent: 2,
  base_monthly_minor: 0,
  tax: { kind: 'none' as const },
  included_users: 3,
  included_storage_mb: 20480,
  included_extra_branches: 1,
  included_apps: [{ id: 'projects', name_ar: 'المشاريع', name_en: 'Projects', limits: { 'projects.max_projects': null } }],
  apps: [
    { id: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', monthly_minor: 9900, limits: {} },
    { id: 'people', name_ar: 'الموارد البشرية', name_en: 'People', monthly_minor: 0, limits: {} },
  ],
}

describe('signup wire contracts', () => {
  it('accepts the form and normalizes its email, mobile and slug', () => {
    expect(signupStartSchema.parse(form)).toMatchObject({
      email: 'owner@example.test', mobile: '+966555000111', slug: 'example-trading', app_ids: ['crm', 'inbox'],
    })
  })
  it('accepts dynamic app ids including empty selection and rejects malformed or duplicate ids', () => {
    expect(signupAppSchema.parse('projects')).toBe('projects')
    expect(signupAppSchema.parse('people')).toBe('people')
    expect(signupAppSchema.parse('custom_app_2')).toBe('custom_app_2')
    for (const bad of ['', 'CRM', '1app', 'bad-app', 'a'.repeat(65)]) {
      expect(signupAppSchema.safeParse(bad).success, bad).toBe(false)
    }
    expect(signupAppsSchema.parse([])).toEqual([])
    expect(signupAppsSchema.parse(['crm', 'projects', 'people'])).toEqual(['crm', 'projects', 'people'])
    expect(signupAppsSchema.safeParse(['crm', 'crm']).success).toBe(false)
  })
  it('validates dynamic signup offers with base price, included apps, optional apps and tax', () => {
    expect(signupOfferSchema.parse(offer)).toEqual(offer)
    expect(signupOfferSchema.parse({
      ...offer,
      trial_days: 30,
      currency: 'USD',
      currency_exponent: 2,
      base_monthly_minor: 19900,
      tax: { kind: 'vat_exclusive', rate_bps: 1500 },
    })).toMatchObject({ trial_days: 30, currency: 'USD', base_monthly_minor: 19900, tax: { kind: 'vat_exclusive', rate_bps: 1500 } })
    expect(signupOfferSchema.safeParse({ ...offer, trial_days: 0 }).success).toBe(false)
    expect(signupOfferSchema.safeParse({ ...offer, currency: 'sar' }).success).toBe(false)
    expect(signupOfferSchema.safeParse({ ...offer, extra_field: true }).success).toBe(false)
  })
  it('requires a slug the workspace may use', () => {
    const { slug, ...withoutSlug } = form
    expect(signupStartSchema.safeParse(withoutSlug).success).toBe(false)
    for (const value of ['ab', 'acme-', 'api', 'gov-x', '12345', 'XN--ACME']) {
      expect(signupStartSchema.safeParse({ ...form, slug: value }).success, value).toBe(false)
    }
  })
  it('requires the channel enum to resend or verify a code', () => {
    expect(signupResendSchema.parse({ signup_id, channel: 'sms' }).channel).toBe('sms')
    expect(signupResendSchema.parse({ signup_id, channel: 'email' }).channel).toBe('email')
    for (const channel of [undefined, 'whatsapp', 'SMS']) {
      expect(signupResendSchema.safeParse({ signup_id, channel }).success, String(channel)).toBe(false)
      expect(signupVerifySchema.safeParse({ signup_id, channel, code: '123456' }).success, String(channel)).toBe(false)
    }
    expect(signupVerifySchema.parse({ signup_id, channel: 'email', code: '123456' })).toEqual({ signup_id, channel: 'email', code: '123456' })
  })
  it('takes a six-digit code and nothing else for a verification', () => {
    for (const code of ['12345', '1234567', 'abcdef']) {
      expect(signupVerifySchema.safeParse({ signup_id, channel: 'sms', code }).success, code).toBe(false)
    }
    expect(signupVerifySchema.safeParse({ signup_id, channel: 'sms', code: '123456', extra: true }).success).toBe(false)
  })
  it('identifies the signup to complete and to poll', () => {
    expect(signupCompleteSchema.parse({ signup_id })).toEqual({ signup_id })
    expect(signupCompleteSchema.safeParse({ signup_id: 'not-a-uuid' }).success).toBe(false)
    expect(signupStatusRequestSchema.parse({ signup_id })).toEqual({ signup_id })
  })
  it('normalizes the slug candidate and reports an unusable one as an answer, not a refusal', () => {
    expect(slugCheckSchema.parse({ slug: ' ACME ' })).toEqual({ slug: 'acme' })
    expect(slugCheckSchema.parse({ slug: 'a--b' })).toEqual({ slug: 'a--b' })
    expect(slugCheckSchema.safeParse({ slug: 'a'.repeat(61) }).success).toBe(false)
    for (const result of ['available', 'unavailable', 'invalid']) expect(slugCheckResultSchema.parse(result)).toBe(result)
    expect(slugCheckResultSchema.safeParse('taken').success).toBe(false)
  })
  it('reports the provisioning wait with an optional handoff link', () => {
    expect(signupStatusSchema.parse({ state: 'preparing' })).toEqual({ state: 'preparing' })
    expect(signupStatusSchema.parse({ state: 'ready', handoff_url: 'https://acme.liwan.example/login' }).handoff_url)
      .toBe('https://acme.liwan.example/login')
    expect(signupStatusSchema.safeParse({ state: 'queued' }).success).toBe(false)
    expect(signupStatusSchema.safeParse({ state: 'ready', handoff_url: 'acme' }).success).toBe(false)
  })
})
