import { afterEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { assertSameOriginWrite } from '../same-site'
import { forwardAuthCookies } from '../authCookies'

afterEach(() => vi.unstubAllEnvs())

const event = (method: string, headers: Record<string, string> = {}) => ({ method, node: { req: { headers: { host: 'alpha.example.test', ...headers } } } }) as unknown as H3Event
const refused = { statusCode: 403, data: { code: 'cross_site_request' } }
const thrown = (run: () => void) => { try { run() } catch (error) { return error } return undefined }
const tasks = '/api/v1/finance/invoices/5/post'

describe('assertSameOriginWrite', () => {
  it.each([
    ['a plain cross-site form post with no fetch metadata and no Origin', {}],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site: same-site (a sibling subdomain)', { 'sec-fetch-site': 'same-site' }],
    ['Sec-Fetch-Site: none (a typed address is never a write)', { 'sec-fetch-site': 'none' }],
    ['a foreign Origin', { origin: 'https://evil.example.test' }],
    ['a sibling-subdomain Origin', { origin: 'https://beta.example.test' }],
    ['a null Origin', { origin: 'null' }],
    ['the right host over the wrong scheme', { origin: 'http://alpha.example.test', 'x-forwarded-proto': 'https' }],
    ['a same-origin Origin overridden by a cross-site Sec-Fetch-Site', { origin: 'https://alpha.example.test', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'cross-site' }],
  ])('refuses a POST with %s', (_label, headers) => {
    expect(thrown(() => assertSameOriginWrite(event('POST', headers), tasks, {}))).toMatchObject(refused)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('accepts a same-origin %s', method => {
    expect(() => assertSameOriginWrite(event(method, { 'sec-fetch-site': 'same-origin' }), tasks, {})).not.toThrow()
  })

  it('accepts an exact Origin when the browser sends no Sec-Fetch-Site', () => {
    expect(() => assertSameOriginWrite(event('POST', { origin: 'https://alpha.example.test', 'x-forwarded-proto': 'https' }), tasks, {})).not.toThrow()
    expect(() => assertSameOriginWrite(event('POST', { origin: 'https://alpha.example.test' }), tasks, { 'x-liwan-client-proto': 'https' })).not.toThrow()
    expect(() => assertSameOriginWrite(event('POST', { origin: 'http://alpha.example.test' }), tasks, {})).not.toThrow()
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not touch a %s', method => {
    expect(() => assertSameOriginWrite(event(method, { 'sec-fetch-site': 'cross-site' }), tasks, {})).not.toThrow()
  })

  it.each([
    '/api/v1/public/payments/invoices/7',
    '/api/v1/public/appointments/book',
    '/api/v1/inbox/hooks/whatsapp',
    '/api/v1/inbox/hooks/tiktok',
  ])('lets %s be called from anywhere', path => {
    expect(() => assertSameOriginWrite(event('POST', { 'sec-fetch-site': 'cross-site' }), path, {})).not.toThrow()
    expect(() => assertSameOriginWrite(event('POST'), path, {})).not.toThrow()
  })

  it.each(['/api/v1/inbox/hooks/other', '/api/v1/inbox/hooks/whatsapp/x', '/api/v1/auth/verify', '/api/v1/publicity', '/api/v1/inbox/messages'])('does not exempt %s', path => {
    expect(thrown(() => assertSameOriginWrite(event('POST', { 'sec-fetch-site': 'cross-site' }), path, {}))).toMatchObject(refused)
  })
})

describe('forwardAuthCookies', () => {
  const forward = (cookie: string, secure = false) => {
    const sent: string[] = []
    const target = { node: { res: { getHeader: () => sent.slice(), setHeader: (_: string, value: string | string[]) => { sent.splice(0, sent.length, ...[value].flat()) } } } } as unknown as H3Event
    forwardAuthCookies(target, new Headers([['set-cookie', cookie]]), secure)
    return sent
  }

  it('adds SameSite=Lax to an Odoo session cookie that has none', () => {
    expect(forward('session_id=abc; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=604800; HttpOnly; Path=/')).toEqual(['session_id=abc; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=604800; HttpOnly; Path=/; SameSite=Lax'])
    expect(forward('session_id=abc; HttpOnly; Path=/', true)).toEqual(['session_id=abc; HttpOnly; Path=/; Secure; SameSite=Lax'])
  })

  it('never weakens or duplicates an attribute that is already there', () => {
    expect(forward('session_id=abc; HttpOnly; SameSite=Strict; Path=/')).toEqual(['session_id=abc; HttpOnly; SameSite=Strict; Path=/'])
    expect(forward('session_id=abc; samesite=none; Secure; Path=/', true)).toEqual(['session_id=abc; samesite=none; Secure; Path=/'])
  })
})
