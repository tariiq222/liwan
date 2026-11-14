import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { legalFromEnv, signupFromEnv } from './http.js'

const legal = { LIWAN_SIGNUP_LEGAL_BASE_URL: 'https://liwanos.com/', LIWAN_SIGNUP_TERMS_VERSION: '2026-11-01' }
const complete = {
  LIWAN_PUBLIC_SIGNUP: 'true', LIWAN_TENANCY_MODE: 'shared', LIWAN_SIGNUP_PLAN_REVISION_ID: '6f1c3d8e-0000-4000-8000-000000000001',
  LIWAN_SIGNUP_AUTHENTICA_KEY: 'key', LIWAN_SIGNUP_AUTHENTICA_TEMPLATE_ID: '7', LIWAN_MAIL_MODE: 'disabled', ...legal,
}
const secret = 's'.repeat(32)

describe('sign-up legal configuration', () => {
  it('reads the base URL without a trailing slash and the terms version', () => {
    expect(legalFromEnv(legal)).toEqual({ baseUrl: 'https://liwanos.com', termsVersion: '2026-11-01' })
  })

  it('refuses a missing, non-https or malformed configuration', () => {
    const bad: Array<Record<string, string | undefined>> = [
      {}, { LIWAN_SIGNUP_LEGAL_BASE_URL: legal.LIWAN_SIGNUP_LEGAL_BASE_URL }, { LIWAN_SIGNUP_TERMS_VERSION: legal.LIWAN_SIGNUP_TERMS_VERSION },
      { ...legal, LIWAN_SIGNUP_LEGAL_BASE_URL: 'http://liwanos.com' }, { ...legal, LIWAN_SIGNUP_LEGAL_BASE_URL: 'not a url' },
      { ...legal, LIWAN_SIGNUP_LEGAL_BASE_URL: 'https://liwanos.com/?x=1' }, { ...legal, LIWAN_SIGNUP_TERMS_VERSION: ' ' },
      { ...legal, LIWAN_SIGNUP_TERMS_VERSION: 'v'.repeat(41) },
    ]
    for (const env of bad) expect(() => legalFromEnv(env), JSON.stringify(env)).toThrow('signup_configuration_invalid')
  })

  it('leaves public sign-up unconfigured when the legal pages are missing', () => {
    const { LIWAN_SIGNUP_TERMS_VERSION: _version, ...withoutVersion } = complete
    const { LIWAN_SIGNUP_LEGAL_BASE_URL: _base, ...withoutBase } = complete
    for (const env of [withoutVersion, withoutBase]) expect(() => signupFromEnv({} as Pool, secret, env)).toThrow('signup_configuration_invalid')
  })
})
