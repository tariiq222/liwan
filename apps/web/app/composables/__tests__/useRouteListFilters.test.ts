import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { listFilterQuery, listLocation, listPageNumber, pageBeyondLast, safeListReturnTo, singleQueryValue, useLastPageClamp } from '../useRouteListFilters'

const safe = (value: unknown, fallback: string) => (typeof value === 'string' && value.startsWith('/operations') ? value : fallback)

describe('list filter query', () => {
  it('reads the route query of a normal list', () => {
    const query = { q: 'a', returnTo: '/operations?q=b' }
    expect(listFilterQuery(query, false, '/operations', safe)).toBe(query)
  })
  it('reads the returnTo query behind a create panel', () => {
    expect(listFilterQuery({ returnTo: '/operations?q=b&page=2#x' }, true, '/operations', safe)).toEqual({ q: 'b', page: '2' })
  })
  it('falls back when the returnTo is not a list of this module', () => {
    expect(listFilterQuery({ returnTo: 'https://evil.test/?q=b' }, true, '/operations', safe)).toEqual({})
  })
  it('clamps the page to a positive integer', () => {
    expect([listPageNumber('3'), listPageNumber('0'), listPageNumber('x'), listPageNumber(undefined), listPageNumber('1.5')]).toEqual([3, 1, 1, 1, 1])
  })
})

describe('list address helpers', () => {
  it('reads the first string of a query entry and nothing else', () => {
    expect([singleQueryValue('a'), singleQueryValue(['b', 'c']), singleQueryValue([1]), singleQueryValue(undefined), singleQueryValue(null)]).toEqual(['a', 'b', '', '', ''])
  })
  it('builds a list location from the list keys only, encoded, with the hash', () => {
    expect(listLocation('/things', ['q', 'page'], { q: 'منى', page: ['2', '3'], returnTo: '/x', view: 'board' }, '#top')).toBe('/things?q=%D9%85%D9%86%D9%89&page=2#top')
    expect(listLocation('/things', ['q'], { q: '' })).toBe('/things')
  })
  it('accepts a return address only under the list path, else answers the list path', () => {
    expect([
      safeListReturnTo('/things', '/things'),
      safeListReturnTo('/things', '/things?q=a'),
      safeListReturnTo('/things', '/things#top'),
      safeListReturnTo('/things', '/things/4'),
      safeListReturnTo('/things', '/thingsx'),
      safeListReturnTo('/things', '//evil.example/things'),
      safeListReturnTo('/things', 'https://evil.test/things'),
      safeListReturnTo('/things', undefined),
    ]).toEqual(['/things', '/things?q=a', '/things#top', '/things', '/things', '/things', '/things', '/things'])
  })
})

describe('a page past the last one', () => {
  it('names the last page, never an empty one', () => {
    expect([pageBeyondLast(99, 30, 50), pageBeyondLast(2, 30, 50), pageBeyondLast(1, 0, 50), pageBeyondLast(3, 120, 50), pageBeyondLast(4, 120, 50), pageBeyondLast(2, 100, 50)]).toEqual([1, 1, null, null, 3, null])
  })

  it('replaces the route with the last page and keeps the other query parameters', async () => {
    const replace = vi.fn()
    const route = Vue.reactive({ path: '/list', hash: '#x', query: { status: 'approved', page: '99' } as Record<string, string | undefined> })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('watch', Vue.watch)
    const total = Vue.ref<number | undefined>(undefined)
    useLastPageClamp({ page: () => listPageNumber(route.query.page), total: () => total.value, pageSize: 50 })
    expect(replace).not.toHaveBeenCalled()
    total.value = 120
    await Vue.nextTick()
    expect(replace).toHaveBeenLastCalledWith({ path: '/list', query: { status: 'approved', page: '3' }, hash: '#x' })
    total.value = 30
    await Vue.nextTick()
    expect(replace).toHaveBeenLastCalledWith({ path: '/list', query: { status: 'approved', page: undefined }, hash: '#x' })
    vi.unstubAllGlobals()
  })
})
