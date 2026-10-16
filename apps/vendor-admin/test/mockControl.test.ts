import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { createMockControl } from '../e2e/mock-control.mjs'
import { ADMIN_PASSWORD, INSTALLATION_ID, OWNER_EMAIL, SERVICE_KEY, TOTP_CODE } from '../e2e/mock-settings.mjs'

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

describe('mock account routes', () => {
  async function signed(path: string, method: string, body: object | undefined, session: string, options: { anonymous?: boolean } = {}) {
    const raw = method === 'GET' ? undefined : JSON.stringify(body ?? {})
    const headers = signServiceRequest({ method, path, body: raw, issuer: INSTALLATION_ID, key: SERVICE_KEY, ...(options.anonymous ? { actor: 'anonymous', anonymous: true as const } : { actor: 1 }) })
    const response = await fetch(`${base}${path}`, { method, body: raw, headers: { ...headers, 'x-nasq-session': session, 'x-nasq-client-ip': '127.0.0.1' } })
    return { status: response.status, body: response.status === 204 ? null : await response.json() as Record<string, unknown> }
  }
  async function ownerSession() {
    await fetch(`${base}/__mock/reset`, { method: 'POST', body: '{}' })
    const login = await signed('/v1/admin/auth/fallback', 'POST', { email: OWNER_EMAIL, password: ADMIN_PASSWORD, totp_code: TOTP_CODE }, '', { anonymous: true })
    return String(login.body!.session)
  }
  const invite = { email: 'new@example.test', display_name: 'New', roles: ['finance'], reason: 'hiring' }

  it('lists the accounts, invites with a token and refuses a duplicate email', async () => {
    const session = await ownerSession()
    expect((await signed('/v1/admin/accounts', 'GET', undefined, session)).body).toMatchObject({ total: 2, items: [{ email: OWNER_EMAIL, status: 'active', roles: ['owner'] }, { roles: ['support'] }] })
    const created = await signed('/v1/admin/accounts', 'POST', invite, session)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ id: 3, invitation_token: expect.any(String) })
    expect((await signed('/v1/admin/accounts', 'POST', invite, session)).body).toEqual({ code: 'conflict' })
    expect((await signed('/v1/admin/accounts', 'POST', { ...invite, email: 'other@example.test', reason: 'ab' }, session)).body).toEqual({ code: 'invalid' })
    expect((await signed('/v1/admin/accounts', 'GET', undefined, session)).body).toMatchObject({ total: 3, items: [{}, {}, { status: 'enrolling' }] })
  })

  it('refuses to remove or disable the last active owner', async () => {
    const session = await ownerSession()
    expect((await signed('/v1/admin/accounts/1/roles', 'POST', { roles: ['support'], reason: 'demote' }, session)).body).toEqual({ code: 'last_owner' })
    expect((await signed('/v1/admin/accounts/1/disable', 'POST', { reason: 'cleanup' }, session)).body).toEqual({ code: 'last_owner' })
  })

  it('lets the only owner edit own roles while keeping owner', async () => {
    const session = await ownerSession()
    expect((await signed('/v1/admin/accounts/1/roles', 'POST', { roles: ['owner', 'finance'], reason: 'add finance' }, session)).status).toBe(204)
  })

  it('asks for a step-up on a mutation when it is due', async () => {
    const session = await ownerSession()
    await fetch(`${base}/__mock/config`, { method: 'POST', body: JSON.stringify({ stepUpRequired: true }) })
    await fetch(`${base}/__mock/age-step-up`, { method: 'POST', body: '{}' })
    expect((await signed('/v1/admin/accounts', 'POST', invite, session)).body).toEqual({ code: 'step_up_required' })
    expect((await signed('/v1/admin/accounts', 'GET', undefined, session)).status).toBe(200)
  })
})
