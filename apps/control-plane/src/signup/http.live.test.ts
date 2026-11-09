import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { migrate } from '../db.js'
import { url } from '../__tests__/commercial-helpers.js'
import { signupHttp } from './http.js'
import type { SignupService } from './service.js'

describe.skipIf(!url)('signed public signup ingress', () => {
  const pool = new Pool({ connectionString: url })
  const service = { start: async () => ({ signup_id: 'synthetic-id' }) } as unknown as SignupService
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
})
