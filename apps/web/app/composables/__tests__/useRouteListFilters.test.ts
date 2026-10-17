import { describe, expect, it } from 'vitest'
import { listFilterQuery, listPageNumber } from '../useRouteListFilters'

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
