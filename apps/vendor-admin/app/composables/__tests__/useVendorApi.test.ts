import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVendorApi } from '../useVendorApi'

afterEach(() => vi.unstubAllGlobals())

describe('useVendorApi', () => {
  it('delegates to the admin api with a rooted path and the given options', async () => {
    const request = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('useAdminApi', () => ({ request }))
    vi.stubGlobal('useRequestHeaders', () => ({ cookie: 'c=1' }))

    await expect(useVendorApi().request('//tenants', { method: 'POST', body: { a: 1 }, query: { q: 'x' } })).resolves.toEqual({ ok: true })

    expect(request).toHaveBeenCalledWith('/tenants', expect.objectContaining({ method: 'POST', body: { a: 1 }, query: { q: 'x' } }))
  })
})
