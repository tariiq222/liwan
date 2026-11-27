import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVendorCatalogVersions } from '../useVendorCatalogVersions'

const items = [{ id: 'v1', version: '1.0', status: 'published' }]

function stub() {
  const request = vi.fn(async () => ({ items, total: 1 }))
  const useAsyncData = vi.fn(async (_key: string, fetch: () => Promise<unknown>) => ({ data: await fetch() }))
  vi.stubGlobal('useVendorApi', () => ({ request }))
  vi.stubGlobal('useAsyncData', useAsyncData)
  return { request, useAsyncData }
}
afterEach(() => vi.unstubAllGlobals())

describe('useVendorCatalogVersions.load', () => {
  it('reads the catalog under the one shared key', async () => {
    const { request, useAsyncData } = stub()
    expect((await useVendorCatalogVersions().load()).data).toEqual(items)
    expect(request).toHaveBeenCalledWith('catalog')
    expect(useAsyncData.mock.calls[0]![0]).toBe('vendor:catalog-versions')
  })

  it('reads nothing when the page does not need the versions, under the same key', async () => {
    const { request, useAsyncData } = stub()
    expect((await useVendorCatalogVersions().load(false)).data).toEqual([])
    expect(request).not.toHaveBeenCalled()
    expect(useAsyncData.mock.calls[0]![0]).toBe('vendor:catalog-versions')
  })
})
