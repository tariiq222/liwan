import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { migrate } from '../db.js'
import { url } from '../__tests__/commercial-helpers.js'
import { signupHttp } from './http.js'
import type { SignupService } from './service.js'

describe.skipIf(!url)('signed public signup ingress', () => {
  const pool = new Pool({ connectionString: url })
  const service = { start: async () => ({ signup_id: 'synthetic-id' }), terms: () => ({ legal_base_url: 'https://liwanos.com', terms_version: '2026-11-01' }) } as unknown as SignupService
  const config = { issuer: 'signup-test', key: 'scratch-key'.repeat(5) }
  const path = '/v1/customer/signup/start'
  const raw = '{"company_name":"Test","admin_name":"Admin","email":"admin@example.test","mobile":"0555555555"}'
  const ip = '192.0.2.4'
  const request = () => ({ method: 'POST', path, raw, headers: {
    ...signServiceRequest({ method: 'POST', path, body: `liwan-signup:${ip}\n${raw}`, actor: 'anonymous', anonymous: true, ...config }),
    'x-liwan-signup-client': ip,
  } })
  beforeAll(() => migrate(pool))
  afterAll(() => pool.end())

  it('rejects unsigned requests and a signed request with a forged client address or body', async () => {
    await expect(signupHttp(pool, config, { ...request(), headers: {} }, service)).rejects.toMatchObject({ status: 401 })
    const signed = request()
    await expect(signupHttp(pool, config, { ...signed, headers: { ...signed.headers, 'x-liwan-signup-client': '192.0.2.5' } }, service))
      .rejects.toMatchObject({ status: 401 })
    await expect(signupHttp(pool, config, { ...signed, raw: raw.replace('Test', 'Other') }, service)).rejects.toMatchObject({ status: 401 })
  })

  it('consumes a signed request once and refuses enrollment when disabled', async () => {
    const signed = request()
    await expect(signupHttp(pool, config, signed, undefined)).rejects.toMatchObject({ status: 404 })
    await expect(signupHttp(pool, config, signed, service)).resolves.toEqual({ status: 201, data: { signup_id: 'synthetic-id' } })
    await expect(signupHttp(pool, config, signed, service)).rejects.toMatchObject({ status: 401 })
  })

  it('answers the terms request with the legal pages and version, and refuses a body', async () => {
    const termsPath = '/v1/customer/signup/terms'
    const signedTerms = (body: string) => ({ method: 'POST', path: termsPath, raw: body, headers: {
      ...signServiceRequest({ method: 'POST', path: termsPath, body: `liwan-signup:${ip}\n${body}`, actor: 'anonymous', anonymous: true, ...config }),
      'x-liwan-signup-client': ip,
    } })
    await expect(signupHttp(pool, config, signedTerms('{}'), service)).resolves.toEqual({ status: 200, data: { legal_base_url: 'https://liwanos.com', terms_version: '2026-11-01' } })
    await expect(signupHttp(pool, config, signedTerms('{"x":1}'), service)).rejects.toMatchObject({ status: 422 })
  })
})
