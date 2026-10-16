import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enrollComplete from '../../api/auth/enroll/complete.post'
import enrollInvitation from '../../api/auth/enroll/invitation.post'
import enrollPasskeyOptions from '../../api/auth/enroll/passkey-options.post'
import enrollPasskeyVerify from '../../api/auth/enroll/passkey-verify.post'
import enrollTotp from '../../api/auth/enroll/totp.post'
import fallback from '../../api/auth/fallback.post'
import logout from '../../api/auth/logout.post'
import passkeyOptions from '../../api/auth/passkey-options.post'
import passkeyVerify from '../../api/auth/passkey-verify.post'
import recovery from '../../api/auth/recovery.post'
import session from '../../api/auth/session.get'
import stepUpOptions from '../../api/auth/step-up-options.post'
import stepUpVerify from '../../api/auth/step-up-verify.post'
import { SESSION, TOKEN, cookieHeader, json, send, stubConfig, stubUpstream } from './harness'

const CHALLENGE = 'c'.repeat(36)
const signedIn = { session: SESSION, expires_at: '2099-01-01T00:00:00.000Z', idle_expires_at: '2099-01-01T00:00:00.000Z' }

type Case = { name: string; handler: typeof logout; path: string; upstream: string; body: unknown; sessionCookie?: boolean }
const cases: Case[] = [
  { name: 'passkey-options', handler: passkeyOptions, path: '/api/auth/passkey-options', upstream: '/v1/admin/auth/passkey/options', body: {} },
  { name: 'passkey-verify', handler: passkeyVerify, path: '/api/auth/passkey-verify', upstream: '/v1/admin/auth/passkey/verify', body: { challenge_id: CHALLENGE, response: { id: 'x' } } },
  { name: 'fallback', handler: fallback, path: '/api/auth/fallback', upstream: '/v1/admin/auth/fallback', body: { email: 'a@example.test', password: 'p', totp_code: '123456' } },
  { name: 'recovery', handler: recovery, path: '/api/auth/recovery', upstream: '/v1/admin/auth/recovery', body: { email: 'a@example.test', password: 'p', recovery_code: 'abcd-efgh-ijkl' } },
  { name: 'step-up-options', handler: stepUpOptions, path: '/api/auth/step-up-options', upstream: '/v1/admin/auth/step-up/options', body: {}, sessionCookie: true },
  { name: 'step-up-verify', handler: stepUpVerify, path: '/api/auth/step-up-verify', upstream: '/v1/admin/auth/step-up/verify', body: { challenge_id: CHALLENGE, response: { id: 'x' } }, sessionCookie: true },
  { name: 'enroll-invitation', handler: enrollInvitation, path: '/api/auth/enroll/invitation', upstream: '/v1/admin/auth/invitation', body: { token: TOKEN } },
  { name: 'enroll-passkey-options', handler: enrollPasskeyOptions, path: '/api/auth/enroll/passkey-options', upstream: '/v1/admin/auth/enroll/passkey/options', body: { token: TOKEN } },
  { name: 'enroll-passkey-verify', handler: enrollPasskeyVerify, path: '/api/auth/enroll/passkey-verify', upstream: '/v1/admin/auth/enroll/passkey/verify', body: { token: TOKEN, challenge_id: CHALLENGE, response: { id: 'x' }, label: 'Laptop' } },
  { name: 'enroll-totp', handler: enrollTotp, path: '/api/auth/enroll/totp', upstream: '/v1/admin/auth/enroll/totp', body: { token: TOKEN } },
  { name: 'enroll-complete', handler: enrollComplete, path: '/api/auth/enroll/complete', upstream: '/v1/admin/auth/enroll/complete', body: { token: TOKEN, password: 'p', totp_code: '123456', totp_box: 'QUJD' } },
]

describe('auth routes', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  it.each(cases)('$name relays to the control plane path and body', async ({ handler, path, upstream, body, sessionCookie }) => {
    const calls = stubUpstream(() => json(200, { ok: true, ...signedIn }))
    const headers = sessionCookie ? cookieHeader() : undefined
    const result = await send(handler, path, { body, headers })
    expect(calls[0].url.pathname).toBe(upstream)
    expect(JSON.parse(calls[0].body as string)).toEqual(body)
    expect(result.status).toBe(200)
  })

  it.each(cases)('$name answers 503 when not configured', async ({ handler, path, body }) => {
    stubConfig({ serviceKey: 'short' })
    expect(await send(handler, path, { body })).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
  })

  it.each(cases)('$name rejects cross-site and non-JSON requests', async ({ handler, path, body }) => {
    const calls = stubUpstream(() => json(200))
    expect((await send(handler, path, { body, headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await send(handler, path, { body, headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect(calls).toHaveLength(0)
  })

  it.each(cases)('$name rejects an unknown field and a non-object body with 422 invalid', async ({ handler, path, body }) => {
    const calls = stubUpstream(() => json(200))
    expect(await send(handler, path, { body: { ...(body as object), extra: 1 } })).toMatchObject({ status: 422, body: { code: 'invalid' } })
    expect(await send(handler, path, { rawBody: '[]' })).toMatchObject({ status: 422, body: { code: 'invalid' } })
    expect(calls).toHaveLength(0)
  })

  it.each(['passkey-options'].map(() => cases[0]))('passes control-plane failure codes through', async ({ handler, path, body }) => {
    for (const [status, code] of [[401, 'auth_failed'], [429, 'rate_limited'], [422, 'invalid'], [503, 'admin_unavailable'], [404, 'not_found']] as const) {
      stubUpstream(() => json(status, { code }))
      const result = await send(handler, path, { body })
      // a 5xx from the control plane is a vendor outage for the browser
      expect(result.status).toBe(status === 503 ? 503 : status)
      expect(result.body.code).toBe(status === 503 ? 'vendor_unavailable' : code)
    }
  })

  it('step-up routes need the session cookie', async () => {
    const calls = stubUpstream(() => json(200))
    expect(await send(stepUpOptions, '/api/auth/step-up-options', { body: {} })).toMatchObject({ status: 401, body: { code: 'auth_failed' } })
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['passkey-verify', passkeyVerify, '/api/auth/passkey-verify', cases[1].body],
    ['fallback', fallback, '/api/auth/fallback', cases[2].body],
    ['recovery', recovery, '/api/auth/recovery', cases[3].body],
  ] as const)('%s sets the cookie and returns only the expiry', async (_name, handler, path, body) => {
    stubUpstream(() => json(200, signedIn))
    const result = await send(handler, path, { body })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ expires_at: signedIn.expires_at, idle_expires_at: signedIn.idle_expires_at })
    expect(result.text).not.toContain(SESSION)
    expect(result.headers.get('set-cookie')).toContain(`nasq_admin=${SESSION}`)
  })

  it('enroll-complete also returns the recovery codes once', async () => {
    stubUpstream(() => json(200, { ...signedIn, recovery_codes: ['aaaa-bbbb-cccc'] }))
    const result = await send(enrollComplete, '/api/auth/enroll/complete', { body: cases[10].body })
    expect(result.body).toEqual({ expires_at: signedIn.expires_at, idle_expires_at: signedIn.idle_expires_at, recovery_codes: ['aaaa-bbbb-cccc'] })
    expect(result.text).not.toContain(SESSION)
  })

  it('a sign-in answer without a valid session string is a vendor outage and sets no cookie', async () => {
    stubUpstream(() => json(200, { ...signedIn, session: 'not-a-session' }))
    const result = await send(passkeyVerify, '/api/auth/passkey-verify', { body: cases[1].body })
    expect(result).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
    expect(result.headers.get('set-cookie')).toBeNull()
    stubUpstream(() => json(200, { expires_at: 'x' }))
    expect((await send(passkeyVerify, '/api/auth/passkey-verify', { body: cases[1].body })).status).toBe(503)
  })

  it('a failed sign-in sets no cookie', async () => {
    stubUpstream(() => json(401, { code: 'auth_failed' }))
    const result = await send(fallback, '/api/auth/fallback', { body: cases[2].body })
    expect(result).toMatchObject({ status: 401, body: { code: 'auth_failed' } })
    expect(result.headers.get('set-cookie')).toBeNull()
  })
})

describe('GET /api/auth/session', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  const me = { id: 7, email: 'a@example.test', display_name: 'A', roles: ['owner'], capabilities: ['vendor.read'] }

  it('is 401 auth_failed without a cookie', async () => {
    const calls = stubUpstream(() => json(200, me))
    expect(await send(session, '/api/auth/session', { method: 'GET' })).toMatchObject({ status: 401, body: { code: 'auth_failed' } })
    expect(calls).toHaveLength(0)
  })

  it('returns the profile for a valid session', async () => {
    const calls = stubUpstream(() => json(200, me))
    const result = await send(session, '/api/auth/session', { method: 'GET', headers: cookieHeader() })
    expect(result).toMatchObject({ status: 200, body: me })
    expect(calls[0].url.pathname).toBe('/v1/admin/me')
    expect(calls[0].method).toBe('GET')
  })

  it('is 401 auth_failed and clears the cookie when the control plane rejects the session', async () => {
    stubUpstream(() => json(401, { code: 'unauthorized' }))
    const result = await send(session, '/api/auth/session', { method: 'GET', headers: cookieHeader() })
    expect(result).toMatchObject({ status: 401, body: { code: 'auth_failed' } })
    expect(result.headers.get('set-cookie')).toMatch(/nasq_admin=;/)
  })

  it('is 503 vendor_unavailable when not configured, even without a cookie', async () => {
    stubConfig({ controlUrl: '' })
    expect(await send(session, '/api/auth/session', { method: 'GET' })).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
  })
})

describe('POST /api/auth/logout', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  it('revokes upstream and clears the cookie', async () => {
    const calls = stubUpstream(() => json(204))
    const result = await send(logout, '/api/auth/logout', { body: {}, headers: cookieHeader() })
    expect(result.status).toBe(204)
    expect(result.headers.get('set-cookie')).toMatch(/nasq_admin=;/)
    expect(calls[0].url.pathname).toBe('/v1/admin/auth/logout')
    expect(calls[0].headers['x-nasq-session']).toBe(SESSION)
  })

  it('still clears the cookie when the session is already invalid or the control plane is down', async () => {
    stubUpstream(() => json(401, { code: 'auth_failed' }))
    const expired = await send(logout, '/api/auth/logout', { body: {}, headers: cookieHeader() })
    expect(expired.status).toBe(204)
    expect(expired.headers.get('set-cookie')).toMatch(/nasq_admin=;/)
    stubUpstream(() => json(500))
    const down = await send(logout, '/api/auth/logout', { body: {}, headers: cookieHeader() })
    expect(down.status).toBe(503)
    expect(down.headers.get('set-cookie')).toMatch(/nasq_admin=;/)
  })

  it('is a no-op without a cookie', async () => {
    const calls = stubUpstream(() => json(204))
    expect((await send(logout, '/api/auth/logout', { body: {} })).status).toBe(204)
    expect(calls).toHaveLength(0)
  })
})
