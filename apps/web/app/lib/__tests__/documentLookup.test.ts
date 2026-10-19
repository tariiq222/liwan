import { expect, it } from 'vitest'
import { documentLookupItems } from '../documentLookup'
it('keeps selected metadata labels beyond the first page and deduplicates page entries', () => {
  const page = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Choice ${i + 1}` }))
  const items = documentLookupItems([205, 1], [{ id: 205, name: 'Selected after 200' }], page)
  expect(items[0]).toEqual({ value: 205, label: 'Selected after 200' })
  expect(items.filter(item => item.value === 1)).toEqual([{ value: 1, label: 'Choice 1' }])
  expect(items).toHaveLength(51)
  expect(documentLookupItems([205], [{ id: 205, name: 'Selected after 200' }], [{ id: 99, name: 'Search result' }])).toEqual([{ value: 205, label: 'Selected after 200' }, { value: 99, label: 'Search result' }])
})
