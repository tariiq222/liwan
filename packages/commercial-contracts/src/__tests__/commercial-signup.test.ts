import { describe, expect, it } from 'vitest'
import {
  signupCompleteSchema, signupResendSchema, signupStartSchema, signupStatusRequestSchema, signupStatusSchema,
  signupVerifySchema, slugCheckResultSchema, slugCheckSchema,
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

describe('signup wire contracts', () => {
  it('accepts the form and normalizes its email, mobile and slug', () => {
    expect(signupStartSchema.parse(form)).toMatchObject({
      email: 'owner@example.test', mobile: '+966555000111', slug: 'example-trading', app_ids: ['crm', 'inbox'],
    })
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
