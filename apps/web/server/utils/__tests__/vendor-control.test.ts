import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertVendorMutationOrigin, forwardVendorRequest, vendorControlBase, vendorEnabled } from '../vendor-control'

afterEach(() => vi.unstubAllGlobals())

describe('vendor BFF boundary', () => {
  it('keeps the server API disabled unless explicitly enabled', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ vendorWorkspaceEnabled: false }))
    vi.stubGlobal('createError', (error: { statusCode: number }) => Object.assign(new Error(), error))
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    expect(vendorEnabled({ vendorWorkspaceEnabled: false })).toBe(false)
    expect(vendorEnabled({ vendorWorkspaceEnabled: 'false' })).toBe(false)
    await expect(forwardVendorRequest({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires JSON and the configured same origin on every mutation', () => {
    const values: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      origin: 'https://example.test',
      'sec-fetch-site': 'same-origin',
    }
    vi.stubGlobal('getHeader', (_event: unknown, key: string) => values[key.toLowerCase()])
    vi.stubGlobal('createError', (error: { statusCode: number; data: unknown }) => Object.assign(new Error(), error))
    const config = { vendorPublicOrigin: 'https://example.test' }
    expect(() => assertVendorMutationOrigin({} as never, config)).not.toThrow()
    values.origin = 'https://evil.test'
    expect(() => assertVendorMutationOrigin({} as never, config)).toThrow()
    values.origin = 'https://example.test'
    values['content-type'] = 'text/plain'
    expect(() => assertVendorMutationOrigin({} as never, config)).toThrow()
  })

  it('allows cleartext control URLs only for loopback hosts', () => {
    vi.stubGlobal('createError', (error: { statusCode: number }) => Object.assign(new Error(), error))
    expect(vendorControlBase({ vendorControlUrl: 'http://127.0.0.1:4100' }).protocol).toBe('http:')
    expect(vendorControlBase({ vendorControlUrl: 'https://custom.example' }).protocol).toBe('https:')
    expect(() => vendorControlBase({ vendorControlUrl: 'http://custom.example' })).toThrow()
  })
  it('validates the company session and preserves the queued status without forwarding its cookie', async () => {
    const config = { vendorWorkspaceEnabled: true, vendorControlUrl: 'http://127.0.0.1:4196', vendorServiceKey: 'a'.repeat(48), vendorInstallationId: 'company', vendorPublicOrigin: 'https://example.test', odooUrl: 'http://127.0.0.1:8196' }
    const body = '{ "type": "health", "reason": "test" }'
    const headers: Record<string, string> = { cookie: 'session_id=test-fixture', origin: config.vendorPublicOrigin, 'content-type': 'application/json' }
    vi.stubGlobal('useRuntimeConfig', () => config)
    vi.stubGlobal('getMethod', () => 'POST')
    vi.stubGlobal('getHeader', (_event: unknown, name: string) => headers[name])
    vi.stubGlobal('getRequestURL', () => new URL('https://example.test/api/vendor/v1/tenants/id/operations'))
    vi.stubGlobal('readRawBody', async () => body)
    const setStatus = vi.fn()
    vi.stubGlobal('setResponseStatus', setStatus)
    const raw = vi.fn().mockResolvedValue({ status: 202, _data: { status: 'queued' } })
    const fetch = Object.assign(vi.fn().mockResolvedValue({ id: 2, name: 'Owner', login: 'owner', email: '', lang: 'ar_001', tz: 'UTC', role: 'employee', company: { id: 1, name: 'Company' } }), { raw })
    vi.stubGlobal('$fetch', fetch)
    const event = {} as never
    expect(await forwardVendorRequest(event)).toEqual({ status: 'queued' })
    expect(setStatus).toHaveBeenCalledWith(event, 202)
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8196/api/v1/me', expect.objectContaining({ headers: { cookie: headers.cookie } }))
    expect(raw).toHaveBeenCalledWith('http://127.0.0.1:4196/v1/tenants/id/operations', expect.objectContaining({ body }))
    expect(raw.mock.calls[0]![1].headers).not.toHaveProperty('cookie')
  })

})
