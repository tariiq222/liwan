import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isProspectRequest } from '../prospectHost'

const TOKEN = 'p'.repeat(40)
const config = { customerCommercialEnabled: true, customerCommercialPublicOrigin: 'https://app.liwan.example' }
const request = (over: Partial<{ host: string; proxyToken: string; pathname: string }> = {}) => ({ host: 'app.liwan.example', proxyToken: TOKEN, pathname: '/payment-done', ...over })
const saved = { mode: process.env.LIWAN_TENANCY_MODE, token: process.env.LIWAN_SHARED_PROXY_TOKEN }
beforeEach(() => { process.env.LIWAN_TENANCY_MODE = 'shared'; process.env.LIWAN_SHARED_PROXY_TOKEN = TOKEN })
afterEach(() => {
  for (const [name, value] of [['LIWAN_TENANCY_MODE', saved.mode], ['LIWAN_SHARED_PROXY_TOKEN', saved.token]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
})

describe('LiwanOS public host admission', () => {
  it.each(['/payment-done', '/payment-done/', '/api/commercial/payment-callback', '/_nuxt/entry.js'])('serves %s without a tenant', pathname => {
    expect(isProspectRequest(request({ pathname }), config)).toBe(true)
  })
  it.each(['/api/v1/me', '/api/commercial/v1/subscription', '/subscription', '/login', '/payment-done/../api/v1/me', '/x/_nuxt/a.js'])('leaves %s to the tenant boundary', pathname => {
    expect(isProspectRequest(request({ pathname }), config)).toBe(false)
  })
  it('compares the host exactly and ignores case', () => {
    expect(isProspectRequest(request({ host: 'APP.liwan.example' }), config)).toBe(true)
    for (const host of ['acme.liwan.example', 'app.liwan.example.evil.com', 'evil-app.liwan.example', undefined]) expect(isProspectRequest(request({ host }), config)).toBe(false)
  })
  it('needs the shared proxy token', () => {
    for (const proxyToken of [undefined, '', 'x'.repeat(40), TOKEN.slice(1)]) expect(isProspectRequest(request({ proxyToken }), config)).toBe(false)
    process.env.LIWAN_SHARED_PROXY_TOKEN = 'short'
    expect(isProspectRequest(request({ proxyToken: 'short' }), config)).toBe(false)
  })
  it('exists only in shared mode with the customer commercial service on and an origin configured', () => {
    process.env.LIWAN_TENANCY_MODE = 'dedicated'
    expect(isProspectRequest(request(), config)).toBe(false)
    process.env.LIWAN_TENANCY_MODE = 'shared'
    expect(isProspectRequest(request(), { ...config, customerCommercialEnabled: false })).toBe(false)
    expect(isProspectRequest(request(), { ...config, customerCommercialEnabled: 'true' })).toBe(true)
    for (const customerCommercialPublicOrigin of ['', 'not a url', undefined]) expect(isProspectRequest(request(), { ...config, customerCommercialPublicOrigin })).toBe(false)
  })
})
