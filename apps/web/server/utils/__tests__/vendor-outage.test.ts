import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('ordinary API proxy independence from vendor control availability', () => {
  it('continues proxying ordinary Odoo API requests when vendor control is unavailable', async () => {
    const event = { path: '/api/v1/projects', context: { params: { path: 'projects' } } }
    const runtimeConfig = { odooUrl: 'https://nasq.local', vendorWorkspaceEnabled: true, vendorControlUrl: 'https://custom.example' }
    const proxyRequest = vi.fn().mockResolvedValue({ items: [], total: 0 })
    const fetch = vi.fn().mockRejectedValue(new Error('vendor control service unavailable'))

    vi.stubGlobal('defineEventHandler', (handler: (event: unknown) => unknown) => handler)
    vi.stubGlobal('useRuntimeConfig', (receivedEvent: unknown) => {
      expect(receivedEvent).toBe(event)
      return runtimeConfig
    })
    vi.stubGlobal('proxyRequest', proxyRequest)
    vi.stubGlobal('$fetch', fetch)

    const { default: ordinaryApiHandler } = await import('../../routes/api/v1/[...path]')
    await expect(ordinaryApiHandler(event as never)).resolves.toEqual({ items: [], total: 0 })

    expect(proxyRequest).toHaveBeenCalledWith(event, 'https://nasq.local/api/v1/projects')
    expect(fetch).not.toHaveBeenCalled()
  })
})
