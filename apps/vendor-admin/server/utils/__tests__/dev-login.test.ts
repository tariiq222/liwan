import { defineEventHandler, type EventHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import devLogin from '../../api/auth/dev-login.post'
import devStepUp from '../../api/auth/dev-step-up.post'
import { devLoginAllowed } from '../loopback'
import { SESSION, at, cookieHeader, json, send, stubConfig, stubUpstream } from './harness'

const signedIn = { session: SESSION, expires_at: '2099-01-01T00:00:00.000Z', idle_expires_at: '2099-01-01T00:00:00.000Z' }

describe('devLoginAllowed', () => {
  const allowed = { devLogin: true, adminOrigin: 'http://localhost:3100' }

  it('needs the setting, and a loopback http origin', () => {
    expect(devLoginAllowed(allowed)).toBe(true)
    expect(devLoginAllowed({ ...allowed, adminOrigin: 'http://127.0.0.1:3100' })).toBe(true)
    expect(devLoginAllowed({ ...allowed, adminOrigin: 'http://[::1]:3100' })).toBe(true)
  })

  it.each([
    ['the setting is off', { devLogin: false }],
    ['the setting is a string, not the parsed boolean', { devLogin: 'true' }],
    ['the origin is https', { adminOrigin: 'https://localhost:3100' }],
    ['the origin is not loopback', { adminOrigin: 'http://admin.example.com' }],
    ['the origin is missing', { adminOrigin: undefined }],
    ['the origin is not a URL', { adminOrigin: 'localhost' }],
  ])('is off when %s', (_name, override) => {
    expect(devLoginAllowed({ ...allowed, ...override })).toBe(false)
  })
})

/** Runs a handler as if the socket peer were `address` (the test server itself is always on 127.0.0.1). */
const from = (address: string, handler: EventHandler): EventHandler => defineEventHandler((event) => {
  Object.defineProperty(event.node.req.socket, 'remoteAddress', { value: address, configurable: true })
  return handler(event)
})

describe('developer sign-in routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['the setting is off', {}],
    ['the origin is https', { public: { devLogin: true }, adminOrigin: 'https://admin.example.com', trustProxy: true }],
    ['the origin is not loopback', { public: { devLogin: true }, adminOrigin: 'http://admin.example.com' }],
  ])('answer 404 and send nothing upstream when %s', async (_name, config) => {
    stubConfig(config)
    const calls = stubUpstream(() => json(200, signedIn))
    expect(await send(devLogin, '/api/auth/dev-login', { body: {} })).toMatchObject({ status: 404, body: { code: 'not_found' } })
    expect(await send(devStepUp, '/api/auth/dev-step-up', { body: {}, headers: cookieHeader() })).toMatchObject({ status: 404, body: { code: 'not_found' } })
    expect(calls).toHaveLength(0)
  })

  describe('when enabled', () => {
    beforeEach(() => stubConfig({ public: { devLogin: true } }))

    it.each(['203.0.113.7', '192.168.1.20', '2001:db8::1', '::ffff:192.168.1.20'])('answer 404 for a peer on the network (%s), even with a forged origin', async (peer) => {
      const calls = stubUpstream(() => json(200, signedIn))
      expect(await send(from(peer, devLogin), '/api/auth/dev-login', { body: {} })).toMatchObject({ status: 404, body: { code: 'not_found' } })
      expect(await send(from(peer, devStepUp), '/api/auth/dev-step-up', { body: {}, headers: cookieHeader() })).toMatchObject({ status: 404, body: { code: 'not_found' } })
      expect(calls).toHaveLength(0)
    })

    it('ignores a spoofed x-forwarded-for from a network peer, also behind a trusted proxy setting', async () => {
      stubConfig({ public: { devLogin: true }, trustProxy: true })
      const calls = stubUpstream(() => json(200, signedIn))
      const result = await send(from('203.0.113.7', devLogin), '/api/auth/dev-login', { body: {}, headers: { 'x-forwarded-for': '127.0.0.1' } })
      expect(result).toMatchObject({ status: 404, body: { code: 'not_found' } })
      expect(calls).toHaveLength(0)
    })

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts the loopback peer %s', async (peer) => {
      stubUpstream(() => json(200, signedIn))
      expect((await send(from(peer, devLogin), '/api/auth/dev-login', { body: {} })).status).toBe(200)
    })

    it('accepts a loopback caller behind the nuxt dev proxy, which hides the socket peer', async () => {
      stubUpstream(() => json(200, signedIn))
      const proxied = defineEventHandler((event) => {
        Object.defineProperty(event.node.req.socket, 'remoteAddress', { value: undefined, configurable: true })
        return devLogin(event)
      })
      const forwarded = { 'x-nuxt-dev-request-id': 'req-1', 'x-forwarded-for': '::1' }
      expect((await send(proxied, '/api/auth/dev-login', { body: {}, headers: forwarded })).status).toBe(200)
      expect((await send(proxied, '/api/auth/dev-login', { body: {}, headers: { ...forwarded, 'x-forwarded-for': '203.0.113.7' } })).status).toBe(404)
    })

    it('dev-login signs the anonymous request, sets the cookie and returns only the expiry', async () => {
      const calls = stubUpstream(() => json(200, signedIn))
      const result = await send(devLogin, '/api/auth/dev-login', { body: {} })
      expect(at(calls, 0).url.pathname).toBe('/v1/admin/auth/dev-login')
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ expires_at: signedIn.expires_at, idle_expires_at: signedIn.idle_expires_at })
      expect(result.headers.get('set-cookie')).toContain(`liwan_admin=${SESSION}`)
    })

    it('dev-step-up forwards the cookie session and answers 204', async () => {
      const calls = stubUpstream(() => json(204))
      const result = await send(devStepUp, '/api/auth/dev-step-up', { body: {}, headers: cookieHeader() })
      expect(at(calls, 0).url.pathname).toBe('/v1/admin/auth/dev-step-up')
      expect(at(calls, 0).headers['x-liwan-session']).toBe(SESSION)
      expect(result.status).toBe(204)
    })

    it('dev-step-up needs the session cookie', async () => {
      const calls = stubUpstream(() => json(204))
      expect(await send(devStepUp, '/api/auth/dev-step-up', { body: {} })).toMatchObject({ status: 401, body: { code: 'auth_failed' } })
      expect(calls).toHaveLength(0)
    })

    it('relays a control plane refusal', async () => {
      stubUpstream(() => json(404, { code: 'not_found' }))
      expect(await send(devLogin, '/api/auth/dev-login', { body: {} })).toMatchObject({ status: 404, body: { code: 'not_found' } })
    })
  })
})
