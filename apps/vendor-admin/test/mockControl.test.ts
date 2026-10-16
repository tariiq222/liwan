import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { createMockControl } from '../e2e/mock-control.mjs'
import { INSTALLATION_ID, SERVICE_KEY } from '../e2e/mock-settings.mjs'

// The mock must refuse what the real control plane refuses, or the e2e checks prove nothing.
const server = createMockControl()
let base = ''
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })

async function call(path: string, options: { method?: string, body?: object, anonymous?: boolean, actor?: number, session?: string, key?: string, nonce?: string, unsigned?: boolean } = {}) {
  const method = options.method ?? 'POST'
  const raw = method === 'GET' ? undefined : JSON.stringify(options.body ?? {})
  const signed = options.unsigned ? {} : signServiceRequest({
    method, path, body: raw, issuer: INSTALLATION_ID, key: options.key ?? SERVICE_KEY, nonce: options.nonce,
    ...(options.anonymous ? { actor: 'anonymous', anonymous: true as const } : { actor: options.actor ?? 1 }),
  })
  const response = await fetch(`${base}${path}`, { method, body: raw, headers: { ...signed, ...(options.session ? { 'x-nasq-session': options.session } : {}), 'x-nasq-client-ip': '127.0.0.1' } })
  return response.status
}

describe('mock control service signature checks', () => {
  it('accepts an anonymous-signed auth request and refuses everything else on that path', async () => {
    expect(await call('/v1/admin/auth/invitation', { anonymous: true, body: { token: 'x' } })).toBe(401)
    const stats = await (await fetch(`${base}/__mock/stats`)).json() as { anonymous: number, rejected: number }
    expect(stats.anonymous).toBe(1)
    expect(stats.rejected).toBe(0)
    expect(await call('/v1/admin/auth/invitation', { unsigned: true })).toBe(401)
    expect(await call('/v1/admin/auth/invitation', { actor: 1 })).toBe(401)
    expect(await call('/v1/admin/auth/invitation', { anonymous: true, key: 'another-service-key-another-service-key' })).toBe(401)
    expect((await (await fetch(`${base}/__mock/stats`)).json() as { rejected: number }).rejected).toBe(3)
  })

  it('refuses a replayed nonce', async () => {
    const nonce = 'replay-nonce-1'
    await call('/v1/admin/auth/invitation', { anonymous: true, nonce })
    const before = (await (await fetch(`${base}/__mock/stats`)).json() as { rejected: number }).rejected
    await call('/v1/admin/auth/invitation', { anonymous: true, nonce })
    expect((await (await fetch(`${base}/__mock/stats`)).json() as { rejected: number }).rejected).toBe(before + 1)
  })

  it('requires a numeric actor that matches the session cookie on API routes', async () => {
    expect(await call('/v1/admin/me', { method: 'GET', anonymous: true, session: `1.${'a'.repeat(43)}` })).toBe(401)
    expect(await call('/v1/admin/me', { method: 'GET', actor: 2, session: `1.${'a'.repeat(43)}` })).toBe(401)
    expect(await call('/v1/admin/me', { method: 'GET', actor: 1, session: `1.${'a'.repeat(43)}` })).toBe(401)
  })
})
