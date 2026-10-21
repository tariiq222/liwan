import { describe, expect, it } from 'vitest'
import { RECORD_PAGE_SIZE, recordActiveFilterCount, recordFiltersFromQuery, recordParams } from '../recordParams'

describe('the setup list filters', () => {
  it('read the search, the kind, archived and the page out of the route query', () => {
    const filters = recordFiltersFromQuery({ q: ' rent ', kind: 'sale', archived: 'true', page: '3' }, ['sale', 'purchase'])
    expect(filters).toEqual({ q: 'rent', kind: 'sale', archived: true, page: 3 })
    expect(recordActiveFilterCount(filters)).toBe(3)
  })

  it('drop a kind the list does not know, a bad page and anything but archived=true', () => {
    expect(recordFiltersFromQuery({ kind: 'weird', page: '-2', archived: 'yes' }, ['sale'])).toEqual({ q: '', kind: null, archived: false, page: 1 })
    expect(recordActiveFilterCount(recordFiltersFromQuery({}))).toBe(0)
  })

  it('become the query of the API list: archived is always sent and the page becomes an offset', () => {
    const filters = recordFiltersFromQuery({ q: 'vat', kind: 'sale', page: '2' }, ['sale'])
    expect(recordParams(filters, 'type_tax_use')).toEqual({ q: 'vat', type_tax_use: 'sale', archived: 'false', limit: RECORD_PAGE_SIZE, offset: RECORD_PAGE_SIZE })
  })

  it('leave the search out for a list whose API has none, and the kind out when the list has no kind', () => {
    const filters = recordFiltersFromQuery({ q: 'x', kind: 'bank' }, ['bank'])
    expect(recordParams(filters, 'type', false)).toEqual({ type: 'bank', archived: 'false', limit: RECORD_PAGE_SIZE, offset: 0 })
    expect(recordParams(filters, null)).toEqual({ q: 'x', archived: 'false', limit: RECORD_PAGE_SIZE, offset: 0 })
  })
})
