import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@nasq/commercial-contracts/server'
import passkeyOptions from '../../api/auth/passkey-options.post'
import stepUpOptions from '../../api/auth/step-up-options.post'
import proxy from '../../api/vendor/v1/[...path]'
import { CONTROL, INSTALLATION, KEY, SESSION, cookieHeader, json, send, stubConfig, stubUpstream, type Upstream } from './harness'

const verify = (call: Upstream, extra: Partial<Parameters<typeof verifyServiceRequest>[0]> = {}) => verifyServiceRequest({
  method: call.method, path: `${call.url.pathname}${call.url.search}`, body: call.body ?? '', key: KEY, headers: call.headers, ...extra,
})

describe('BFF to control-plane signing', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  it('signs an anonymous POST that verifies only in anonymous mode', async () => {
    const calls = stubUpstream(() => json(200, { challenge_id: 'c', options: {} }))
    await send(passkeyOptions, '/api/auth/passkey-options', { body: {} })
    const [call] = calls
    expect(call.url.href).toBe(`${CONTROL}/v1/admin/auth/passkey/options`)
    expect(verify(call, { anonymous: true })).toMatchObject({ actor: 'anonymous', issuer: INSTALLATION })
    expect(verify(call)).toBeNull()
  })

  it('signs a session request as the numeric actor from the cookie, without the anonymous flag', async () => {
    const calls = stubUpstream(() => json(200, { items: [], total: 0 }))
    await send(proxy, '/api/vendor/v1/customers?q=a', { method: 'GET', headers: cookieHeader() })
    const [call] = calls
    expect(call.url.pathname + call.url.search).toBe('/v1/customers?q=a')
    expect(verify(call)).toMatchObject({ actor: 7, issuer: INSTALLATION })
    expect(verify(call, { anonymous: true })).toBeNull()
    expect(call.headers['x-nasq-session']).toBe(SESSION)
  })

  it('signs the session routes under /v1/admin/auth as anonymous and still carries the session', async () => {
    const calls = stubUpstream(() => json(200, { challenge_id: 'c', options: {} }))
    await send(stepUpOptions, '/api/auth/step-up-options', { body: {}, headers: cookieHeader() })
    expect(verify(calls[0], { anonymous: true })).toMatchObject({ actor: 'anonymous' })
    expect(calls[0].headers['x-nasq-session']).toBe(SESSION)
  })

  it('rejects a tampered body, path or actor', async () => {
    const calls = stubUpstream(() => json(200, { items: [], total: 0 }))
    await send(proxy, '/api/vendor/v1/customers', { method: 'POST', body: { a: 1 }, headers: cookieHeader() })
    const [call] = calls
    expect(verify(call)).not.toBeNull()
    expect(verify({ ...call, body: '{"a":2}' })).toBeNull()
    expect(verify({ ...call, url: new URL(`${CONTROL}/v1/other`) })).toBeNull()
    expect(verify(call, { actor: 8 })).toBeNull()
    expect(verify({ ...call, headers: { ...call.headers, 'x-nasq-actor': '8' } })).toBeNull()
  })

  it('never forwards the browser cookie or a browser-supplied client address', async () => {
    const calls = stubUpstream(() => json(200, {}))
    await send(proxy, '/api/vendor/v1/context', { method: 'GET', headers: { ...cookieHeader(), 'x-nasq-client-ip': '6.6.6.6', authorization: 'Bearer x', 'x-nasq-actor': '99' } })
    const names = Object.keys(calls[0].headers).map(n => n.toLowerCase())
    expect(names).not.toContain('cookie')
    expect(names).not.toContain('authorization')
    expect(names).not.toContain('x-nasq-client-ip')
    expect(calls[0].headers['x-nasq-actor']).toBe('7')
  })
})
