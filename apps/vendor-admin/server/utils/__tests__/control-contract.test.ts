import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import passkeyOptions from '../../api/auth/passkey-options.post'
import stepUpOptions from '../../api/auth/step-up-options.post'
import proxy from '../../api/vendor/v1/[...path]'
import { at, CONTROL, INSTALLATION, KEY, SESSION, cookieHeader, json, send, stubConfig, stubUpstream, type Upstream } from './harness'

const verify = (call: Upstream, extra: Partial<Parameters<typeof verifyServiceRequest>[0]> = {}) => verifyServiceRequest({
  method: call.method, path: `${call.url.pathname}${call.url.search}`, body: call.body ?? '', key: KEY, headers: call.headers, ...extra,
})

describe('BFF to control-plane signing', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  it('signs an anonymous POST that verifies only in anonymous mode', async () => {
    const calls = stubUpstream(() => json(200, { challenge_id: 'c', options: {} }))
    await send(passkeyOptions, '/api/auth/passkey-options', { body: {} })
    const call = at(calls, 0)
    expect(call.url.href).toBe(`${CONTROL}/v1/admin/auth/passkey/options`)
    expect(verify(call, { anonymous: true })).toMatchObject({ actor: 'anonymous', issuer: INSTALLATION })
    expect(verify(call)).toBeNull()
  })

  it('signs a session request as the numeric actor from the cookie, without the anonymous flag', async () => {
    const calls = stubUpstream(() => json(200, { items: [], total: 0 }))
    await send(proxy, '/api/vendor/v1/commercial/customers?q=a', { method: 'GET', headers: cookieHeader() })
    const call = at(calls, 0)
    expect(call.url.pathname + call.url.search).toBe('/v1/commercial/customers?q=a')
    expect(verify(call)).toMatchObject({ actor: 7, issuer: INSTALLATION })
    expect(verify(call, { anonymous: true })).toBeNull()
    expect(call.headers['x-liwan-session']).toBe(SESSION)
  })

  it('signs the session routes under /v1/admin/auth as anonymous and still carries the session', async () => {
    const calls = stubUpstream(() => json(200, { challenge_id: 'c', options: {} }))
    await send(stepUpOptions, '/api/auth/step-up-options', { body: {}, headers: cookieHeader() })
    expect(verify(at(calls, 0), { anonymous: true })).toMatchObject({ actor: 'anonymous' })
    expect(at(calls, 0).headers['x-liwan-session']).toBe(SESSION)
  })

  it('rejects a tampered body, path or actor', async () => {
    const calls = stubUpstream(() => json(200, { items: [], total: 0 }))
    await send(proxy, '/api/vendor/v1/commercial/customers', { method: 'POST', body: { a: 1 }, headers: cookieHeader() })
    const call = at(calls, 0)
    expect(verify(call)).not.toBeNull()
    expect(verify({ ...call, body: '{"a":2}' })).toBeNull()
    expect(verify({ ...call, url: new URL(`${CONTROL}/v1/other`) })).toBeNull()
    expect(verify(call, { actor: 8 })).toBeNull()
    expect(verify({ ...call, headers: { ...call.headers, 'x-liwan-actor': '8' } })).toBeNull()
  })

  it('never forwards the browser cookie or a browser-supplied client address', async () => {
    const calls = stubUpstream(() => json(200, {}))
    await send(proxy, '/api/vendor/v1/context', { method: 'GET', headers: { ...cookieHeader(), 'x-liwan-client-ip': '6.6.6.6', authorization: 'Bearer x', 'x-liwan-actor': '99' } })
    const names = Object.keys(at(calls, 0).headers).map(n => n.toLowerCase())
    expect(names).not.toContain('cookie')
    expect(names).not.toContain('authorization')
    expect(at(calls, 0).headers['x-liwan-client-ip']).not.toBe('6.6.6.6')
    expect(at(calls, 0).headers['x-liwan-actor']).toBe('7')
  })

  it('always sets x-liwan-client-ip to the observed address', async () => {
    const calls = stubUpstream(() => json(200, {}))
    await send(proxy, '/api/vendor/v1/context', { method: 'GET', headers: { ...cookieHeader(), 'x-liwan-client-ip': '6.6.6.6' } })
    expect(at(calls, 0).headers['x-liwan-client-ip']).toBe('127.0.0.1')
    stubConfig({ trustProxy: true })
    await send(proxy, '/api/vendor/v1/context', { method: 'GET', headers: { ...cookieHeader(), 'x-liwan-client-ip': '6.6.6.6', 'x-forwarded-for': '203.0.113.7' } })
    expect(at(calls, 1).headers['x-liwan-client-ip']).toBe('203.0.113.7')
  })

  it('refuses an auth call whose client address is unknown, and a refused address reaches nothing upstream', async () => {
    stubConfig({ trustProxy: true })
    const unknown = stubUpstream(() => json(200, {}))
    expect(await send(passkeyOptions, '/api/auth/passkey-options', { body: {}, headers: { 'x-forwarded-for': 'garbage' } })).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
    expect(unknown).toHaveLength(0)
  })

  it('refuses to run behind an https origin without trustProxy', async () => {
    const calls = stubUpstream(() => json(200, {}))
    stubConfig({ adminOrigin: 'https://admin.example.test', trustProxy: false })
    const result = await send(proxy, '/api/vendor/v1/context', { method: 'GET', headers: cookieHeader() })
    expect(result).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
    expect(calls).toHaveLength(0)
  })
})
