import { QueryClient } from '@tanstack/vue-query'
import { describe, expect, it } from 'vitest'
import type { HrDocument } from '@/composables/useHrDocuments'
import {
  documentListQueryKey,
  invalidateDocumentLists,
  replaceDocumentDetail,
} from '../documentListCache'

const document = (overrides: Partial<HrDocument> = {}): HrDocument => ({
  id: 7,
  name: 'Handbook',
  department: { id: 3, name: 'People' },
  body: '<p>Updated</p>',
  attachment_ids: [],
  write_date: '2026-09-05T00:00:00Z',
  ...overrides,
})

describe('document list cache', () => {
  it('keeps search, department, limit, and offset in distinct query keys', () => {
    expect(documentListQueryKey({ q: 'hand', department_id: 3, limit: 20, offset: 40 })).toEqual([
      'hr',
      'documents',
      { q: 'hand', department_id: 3, limit: 20, offset: 40 },
    ])
    expect(documentListQueryKey({ q: 'hand', department_id: 3, limit: 20, offset: 60 })).not.toEqual(
      documentListQueryKey({ q: 'hand', department_id: 3, limit: 20, offset: 40 }),
    )
  })

  it('replaces the selected document detail with the server response', () => {
    const client = new QueryClient()
    replaceDocumentDetail(client, document())

    expect(client.getQueryData(['hr', 'document', 7])).toEqual(document())
  })

  it('keeps filtered list data scoped while invalidating every list variant', async () => {
    const client = new QueryClient()
    const allKey = documentListQueryKey({ limit: 20, offset: 0 })
    const departmentKey = documentListQueryKey({ department_id: 3, limit: 20, offset: 0 })
    const searchKey = documentListQueryKey({ q: 'hand', limit: 20, offset: 0 })
    const pageKey = documentListQueryKey({ q: 'hand', department_id: 3, limit: 20, offset: 20 })
    const allData = { items: [document()], total: 1 }
    const departmentData = { items: [document({ id: 8, department: { id: 3, name: 'People' } })], total: 1 }
    const searchData = { items: [document({ id: 9, name: 'Handbook: Search' })], total: 1 }
    const pageData = { items: [], total: 21 }

    client.setQueryData(allKey, allData)
    client.setQueryData(departmentKey, departmentData)
    client.setQueryData(searchKey, searchData)
    client.setQueryData(pageKey, pageData)

    await invalidateDocumentLists(client)

    expect(client.getQueryData(allKey)).toEqual(allData)
    expect(client.getQueryData(departmentKey)).toEqual(departmentData)
    expect(client.getQueryData(searchKey)).toEqual(searchData)
    expect(client.getQueryData(pageKey)).toEqual(pageData)
    expect(client.getQueryState(allKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(departmentKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(searchKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(pageKey)?.isInvalidated).toBe(true)
  })
})
