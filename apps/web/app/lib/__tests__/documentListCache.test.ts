import { QueryClient } from '@tanstack/vue-query'
import { describe, expect, it } from 'vitest'
import type { DocumentDetail } from '@liwan/contracts'
import { documentKeys } from '../documentKeys'
import {
  invalidateDocumentLists,
  replaceDocumentDetail,
} from '../documentListCache'

const document = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: 7,
  name: 'Handbook',
  visibility: 'restricted', active: true, revision: 1, file_count: 0, tags: [], context: { kind: 'hr.department', id: 3, label: 'People', href: null },
  allowed_actions: { update: true, archive: true, restore: false, upload_file: true, manage_access: true },
  body: '<p>Updated</p>',
  expiry_date: null,
  write_date: '2026-09-05T00:00:00Z',
  ...overrides,
})

describe('document list cache', () => {
  it('keeps search, department, limit, and offset in distinct query keys', () => {
    expect(documentKeys.list(1, { q: 'hand', context_id: 3, limit: 20, offset: 40 })).toEqual([
      'documents',
      1,
      'list',
      { q: 'hand', context_id: 3, limit: 20, offset: 40 },
    ])
    expect(documentKeys.list(1, { q: 'hand', context_id: 3, limit: 20, offset: 60 })).not.toEqual(
      documentKeys.list(1, { q: 'hand', context_id: 3, limit: 20, offset: 40 }),
    )
  })

  it('replaces the selected document detail with the server response', () => {
    const client = new QueryClient()
    replaceDocumentDetail(client, 1, document())

    expect(client.getQueryData(['documents', 1, 'detail', 7])).toEqual(document())
  })

  it('keeps filtered list data scoped while invalidating every list variant', async () => {
    const client = new QueryClient()
    const allKey = documentKeys.list(1, { limit: 20, offset: 0 })
    const departmentKey = documentKeys.list(1, { context_id: 3, limit: 20, offset: 0 })
    const searchKey = documentKeys.list(1, { q: 'hand', limit: 20, offset: 0 })
    const pageKey = documentKeys.list(1, { q: 'hand', context_id: 3, limit: 20, offset: 20 })
    const allData = { items: [document()], total: 1 }
    const departmentData = { items: [document({ id: 8, context: { kind: 'hr.department', id: 3, label: 'People', href: null } })], total: 1 }
    const searchData = { items: [document({ id: 9, name: 'Handbook: Search' })], total: 1 }
    const pageData = { items: [], total: 21 }

    client.setQueryData(allKey, allData)
    client.setQueryData(departmentKey, departmentData)
    client.setQueryData(searchKey, searchData)
    client.setQueryData(pageKey, pageData)

    await invalidateDocumentLists(client, 1)

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

it('keeps the highest full-detail revision within one company and record', () => {
  const client = new QueryClient()
  const newer = document({ revision: 5, body: 'New content' })
  replaceDocumentDetail(client, 1, newer)
  replaceDocumentDetail(client, 1, document({ revision: 3, body: 'Stale content' }))
  expect(client.getQueryData(documentKeys.detail(1, 7))).toEqual(newer)
  replaceDocumentDetail(client, 2, document({ revision: 1, body: 'Other company content' }))
  expect(client.getQueryData(documentKeys.detail(2, 7))).toMatchObject({ body: 'Other company content', revision: 1 })
})

it('accepts refreshed permissions at the same revision without losing monotonic content revisions', () => {
  const client = new QueryClient()
  replaceDocumentDetail(client, 1, document({ revision: 5 }))
  replaceDocumentDetail(client, 1, document({ revision: 5, allowed_actions: { update: false, archive: false, restore: false, upload_file: false, manage_access: false } }))
  expect(client.getQueryData(documentKeys.detail(1, 7))).toMatchObject({ revision: 5, allowed_actions: { update: false, manage_access: false } })
})
