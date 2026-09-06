import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  CHARTER_CATALOG_PAGE_SIZE,
  catalogCollectionPath,
  catalogItemPath,
  charterCatalogKeys,
  isCharterCatalogResource,
  mergeCatalogItems,
  useCharterCatalogSearch,
} from '../useProjectCharterCatalogs'

describe('isCharterCatalogResource', () => {
  it('accepts only the two PMO catalogs', () => {
    expect(isCharterCatalogResource('types')).toBe(true)
    expect(isCharterCatalogResource('owning-units')).toBe(true)
    expect(isCharterCatalogResource('departments')).toBe(false)
    expect(isCharterCatalogResource('hr')).toBe(false)
  })
})

describe('charter catalog paths and keys', () => {
  it('pages pickers in bounded slices so no hidden first-page cap remains', () => {
    expect(CHARTER_CATALOG_PAGE_SIZE).toBe(50)
    expect(catalogCollectionPath('types')).toBe('/api/v1/project-charter/catalogs/types')
    expect(catalogItemPath('owning-units', 8)).toBe('/api/v1/project-charter/catalogs/owning-units/8')
    expect(charterCatalogKeys.list('types', { q: 'تقني', active: '1', offset: 50 })).toEqual([
      'project-charter', 'catalogs', 'types', { q: 'تقني', active: '1', offset: 50 },
    ])
  })
})

describe('mergeCatalogItems', () => {
  it('appends later pages without duplicating ids', () => {
    const first = [{ id: 1, name: 'تقني', sequence: 10, active: true }]
    const second = [
      { id: 1, name: 'تقني', sequence: 10, active: true },
      { id: 2, name: 'تشغيلي', sequence: 20, active: true },
    ]
    expect(mergeCatalogItems(first, second).map((item) => item.id)).toEqual([1, 2])
  })
})

describe('useCharterCatalogSearch', () => {
  it('ignores a deferred response from an older query', async () => {
    vi.useFakeTimers()
    const requests: Array<{ promise: Promise<unknown>; resolve: (value: unknown) => void }> = []
    const fetch = vi.fn(() => {
      let resolve!: (value: unknown) => void
      const promise = new Promise<unknown>((next) => { resolve = next })
      requests.push({ promise, resolve })
      return promise
    })
    vi.stubGlobal('useApi', () => ({ $api: fetch }))
    const scope = effectScope()
    try {
      const search = scope.run(() => useCharterCatalogSearch('types'))!
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

      search.q.value = 'new'
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

      requests[1]!.resolve({ items: [{ id: 2, name: 'new', sequence: 1, active: true }], total: 2 })
      await vi.waitFor(() => expect(search.items.value.map(item => item.name)).toEqual(['new']))

      requests[0]!.resolve({ items: [{ id: 1, name: 'old', sequence: 1, active: true }], total: 1 })
      await Promise.resolve()
      expect(search.items.value.map(item => item.name)).toEqual(['new'])
      expect(search.total.value).toBe(2)
      expect(search.pending.value).toBe(false)

      search.loadMore()
      expect(fetch).toHaveBeenCalledTimes(3)
      search.q.value = 'latest'
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))

      // A page from the preceding query must not merge into the new query or
      // clear its pending state while the newest first page is unresolved.
      requests[2]!.resolve({ items: [{ id: 4, name: 'old page', sequence: 1, active: true }], total: 2 })
      await Promise.resolve()
      expect(search.items.value).toEqual([])
      expect(search.pending.value).toBe(true)

      requests[3]!.resolve({ items: [{ id: 3, name: 'latest', sequence: 1, active: true }], total: 1 })
      await vi.waitFor(() => expect(search.items.value.map(item => item.name)).toEqual(['latest']))
      expect(search.pending.value).toBe(false)
    }
    finally {
      scope.stop()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
