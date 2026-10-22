import { afterEach, expect, it, vi } from 'vitest'
import { createSSRApp, effectScope, nextTick, ref, type EffectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { useDocument, useDocuments, useDocumentAccess, useDocumentContexts, useDocumentContextOptions, useDocumentTags, useUpdateDocument, useUpdateDocumentAccess, useCreateDocumentTag } from '../useDocuments'
import * as documents from '../useDocuments'
import { documentKeys } from '../../lib/documentKeys'
import { replaceDocumentDetail } from '../../lib/documentListCache'
import { documentFixture } from '../../pages/documents/__tests__/helpers'
const scopes: EffectScope[] = []
const clients: QueryClient[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function harness(api: (path: string, options?: any) => Promise<any>) {
  const me = ref<{ id: number; company: { id: number; name: string } } | null>({ id: 7, company: { id: 1, name: 'First company' } })
  vi.stubGlobal('useMe', () => ({ me })); vi.stubGlobal('useApi', () => ({ $api: api }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client)
  const app = createSSRApp({ render: () => null }); app.use(VueQueryPlugin, { queryClient: client })
  function use<T>(fn: () => T): T { const scope = effectScope(); scopes.push(scope); return app.runWithContext(() => scope.run(fn)!) }
  return { me, client, use }
}
it('switches the same document id to a distinct company cache before delayed old-company content arrives', async () => {
  const old = deferred<typeof documentFixture>(); const second = { ...documentFixture, name: 'Second company content', revision: 1 }
  let request = 0
  const view = harness(async () => ++request === 1 ? old.promise : second)
  const query = view.use(() => useDocument(8))
  await expect.poll(() => request).toBe(1)
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }; await nextTick()
  await expect.poll(() => query.data.value?.name).toBe('Second company content')
  old.resolve({ ...documentFixture, name: 'Old company content' }); await nextTick(); await Promise.resolve()
  expect(query.data.value?.name).toBe('Second company content')
  expect(view.client.getQueryData(documentKeys.detail(2, 8))).toEqual(second)
})
it('binds a delayed mutation response to the company at request start', async () => {
  const response = deferred<typeof documentFixture>()
  const view = harness(async () => response.promise)
  const mutation = view.use(useUpdateDocument)
  const saving = mutation.mutateAsync({ id: 8, patch: { expected_revision: 3, body: 'Saved for first company' } })
  await expect.poll(() => mutation.isPending.value).toBe(true)
  await Promise.resolve(); view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }
  const second = { ...documentFixture, name: 'Second company original', revision: 1 }
  replaceDocumentDetail(view.client, 2, second)
  const saved = { ...documentFixture, revision: 4, body: 'Saved for first company' }; response.resolve(saved)
  await saving
  expect(view.client.getQueryData(documentKeys.detail(1, 8))).toEqual(saved)
  expect(view.client.getMutationCache().getAll()[0]?.options.mutationKey).toEqual(['documents', 1, 'write'])
  expect(view.client.getQueryData(documentKeys.detail(2, 8))).toEqual(second)
})
it('keeps a newer mutation detail when an older in-flight GET finishes later', async () => {
  const response = deferred<typeof documentFixture>()
  const view = harness(async () => response.promise)
  const query = view.use(() => useDocument(8))
  await expect.poll(() => query.isFetching.value).toBe(true)
  const saved = { ...documentFixture, revision: 5, body: 'New saved content' }
  replaceDocumentDetail(view.client, 1, saved)
  response.resolve({ ...documentFixture, revision: 3, body: 'Old GET content' })
  await expect.poll(() => query.isFetching.value).toBe(false)
  expect(query.data.value).toEqual(saved)
})
it('scopes list, access, contexts, options and tags to the current company', async () => {
  const view = harness(async (path) => path.endsWith('/access') ? { revision: 3, visibility: 'restricted', grants: [] } : { items: [], total: 0 })
  view.use(() => useDocuments({ q: 'Policy' })); view.use(() => useDocumentAccess(8, true)); view.use(() => useDocumentContexts()); view.use(() => useDocumentContextOptions('hr.department')); view.use(useDocumentTags)
  await nextTick(); await Promise.resolve()
  const keys = view.client.getQueryCache().getAll().map(query => query.queryKey)
  expect(keys).toEqual(expect.arrayContaining([
    ['documents', 1, 'list', { q: 'Policy' }], ['documents', 1, 'access', 8], ['documents', 1, 'contexts'], ['documents', 1, 'context-options', 'hr.department', {}], ['documents', 1, 'tags', {}],
  ]))
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }; await nextTick()
  expect(view.client.getQueryCache().getAll().filter(query => query.queryKey[1] === 2)).toHaveLength(5)
})
it('keeps delayed access and tag mutation cache effects in their original company', async () => {
  const access = deferred<any>(); const tag = deferred<any>(); const started: string[] = []
  const view = harness(async path => { started.push(path); return path.endsWith('/access') ? access.promise : tag.promise })
  const accessMutation = view.use(useUpdateDocumentAccess)
  const tagMutation = view.use(useCreateDocumentTag)
  const firstAccess = accessMutation.mutateAsync({ id: 8, body: { expected_revision: 3, visibility: 'company', grants: [{ user_id: 7, access: 'editor' }] } })
  await expect.poll(() => started.length).toBe(1)
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }; await nextTick()
  view.client.setQueryData(documentKeys.access(2, 8), { revision: 1, visibility: 'restricted', grants: [] })
  access.resolve({ revision: 4, visibility: 'company', grants: [{ user: { id: 7, name: 'Editor' }, access: 'editor' }] }); await firstAccess
  expect(view.client.getQueryData(documentKeys.access(1, 8))).toMatchObject({ revision: 4, visibility: 'company' })
  expect(view.client.getQueryData(documentKeys.access(2, 8))).toMatchObject({ revision: 1, visibility: 'restricted' })
  view.me.value = { id: 7, company: { id: 1, name: 'First company' } }; await nextTick()
  view.client.setQueryData(documentKeys.tags(1), { items: [], total: 0 }); view.client.setQueryData(documentKeys.tags(2), { items: [], total: 0 })
  const creating = tagMutation.mutateAsync('Policy'); await expect.poll(() => started.length).toBe(2)
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }; await nextTick()
  tag.resolve({ id: 10, name: 'Policy' }); await creating
  expect(view.client.getQueryState(documentKeys.tags(1))?.isInvalidated).toBe(true)
  expect(view.client.getQueryState(documentKeys.tags(2))?.isInvalidated).toBe(false)
})
it('captures the record id and payload before an async mutation can observe caller edits', async () => {
  const requests: Array<{ path: string; body: unknown }> = []
  const view = harness(async (path, options) => { requests.push({ path, body: options.body }); return { ...documentFixture, revision: 4 } })
  const mutation = view.use(useUpdateDocument)
  const value = { id: 8, patch: { expected_revision: 3, body: 'First content' } }
  const saving = mutation.mutateAsync(value); value.id = 9; value.patch.body = 'Later edit'
  await saving
  expect(requests).toEqual([{ path: '/api/v1/documents/8', body: { expected_revision: 3, body: 'First content' } }])
})
it('blocks a stale-company query refetch rather than fetching the new company under the old key', async () => {
  const requests: string[] = []
  const view = harness(async path => { requests.push(path); return documentFixture })
  const query = view.use(() => useDocument(8)); await expect.poll(() => query.data.value?.id).toBe(8)
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }
  // Before Vue flushes the new query key, a mutation invalidation can still reach the previous observer.
  await view.client.invalidateQueries({ queryKey: documentKeys.detail(1, 8) })
  await nextTick()
  await expect.poll(() => query.data.value?.id).toBe(8)
  expect(requests).toHaveLength(2)
})
it('rejects an old-company queued mutation before it can send under the new session company', async () => {
  const firstResponse = deferred<typeof documentFixture>(); const requests: string[] = []
  const view = harness(async path => { requests.push(path); return firstResponse.promise })
  const first = view.use(useUpdateDocument); const second = view.use(useUpdateDocument)
  const saving = first.mutateAsync({ id: 8, patch: { expected_revision: 3, body: 'First' } })
  await expect.poll(() => requests.length).toBe(1)
  const queued = second.mutateAsync({ id: 9, patch: { expected_revision: 1, body: 'Queued' } }).then(() => null, error => error)
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }; await nextTick()
  firstResponse.resolve({ ...documentFixture, revision: 4 }); await saving
  expect(await queued).toMatchObject({ status: 409, code: 'company_changed' })
  expect(requests).toEqual(['/api/v1/documents/8'])
})
it('keeps newer access grants when an older access GET completes after a cache update', async () => {
  const old = deferred<any>(); const view = harness(async () => old.promise)
  const query = view.use(() => useDocumentAccess(8, true)); await expect.poll(() => query.isFetching.value).toBe(true)
  const newer = { revision: 5, visibility: 'restricted', grants: [{ user: { id: 7, name: 'Editor' }, access: 'editor' }] }
  view.client.setQueryData(documentKeys.access(1, 8), newer)
  old.resolve({ revision: 3, visibility: 'company', grants: [] })
  await expect.poll(() => query.isFetching.value).toBe(false)
  expect(query.data.value).toEqual(newer)
})
it('loads file pages separately and rejects delayed results after a document revision or company change', async () => {
  const { useDocumentFiles } = await import('../useDocuments')
  const old = deferred<any>(); const requests: any[] = []
  const view = harness(async (path, options) => { requests.push({ path, query: options.query }); return requests.length === 1 ? old.promise : { items: [{ id: requests.length }], total: 205 } })
  const params = ref({ limit: 50, offset: 0 }); const revision = ref(1)
  const query = view.use(() => useDocumentFiles(8, params, revision))
  await expect.poll(() => requests.length).toBe(1)
  params.value = { limit: 50, offset: 200 }
  await expect.poll(() => query.data.value?.items[0]?.id).toBe(2)
  expect(requests[1]).toEqual({ path: '/api/v1/documents/8/files', query: { limit: 50, offset: 200, revision: 1 } })
  revision.value = 2; await expect.poll(() => requests.length).toBe(3)
  view.me.value = { id: 7, company: { id: 2, name: 'Second company' } }; await expect.poll(() => requests.length).toBe(4)
  old.resolve({ items: [{ id: 1 }], total: 205 }); await nextTick(); await Promise.resolve()
  expect(query.data.value?.items[0]?.id).toBe(4)
})
it('searches and pages through more than 200 metadata choices with isolated query caches', async () => {
  const requests: any[] = []; const choices = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, name: `Choice ${String(i + 1).padStart(3, '0')}` }))
  const view = harness(async (path, options) => {
    requests.push({ path, query: options.query }); const { q = '', limit = 50, offset = 0, id } = options.query
    const found = choices.filter(item => (!id || item.id === id) && item.name.includes(q))
    return { items: found.slice(offset, offset + limit), total: found.length }
  })
  const params = ref({ q: '', offset: 0, limit: 50 })
  const query = view.use(() => useDocumentTags(params))
  await expect.poll(() => query.data.value?.items.length).toBe(50)
  params.value = { q: '', offset: 200, limit: 50 }
  await expect.poll(() => query.data.value?.items[0]?.id).toBe(201)
  params.value = { q: '205', offset: 0, limit: 50 }
  await expect.poll(() => query.data.value?.items[0]?.id).toBe(205)
  const selected = view.use(() => useDocumentContextOptions('hr.department', { id: 205, limit: 1 }))
  await expect.poll(() => selected.data.value?.items[0]?.id).toBe(205)
  expect(requests.at(-1)).toEqual({ path: '/api/v1/documents/contexts/hr.department/options', query: { id: 205, limit: 1 } })
})
it('restarts a conflicted file page at the refreshed revision without retrying the stale revision', async () => {
  const { useDocumentFiles } = await import('../useDocuments'); const { ApiError } = await import('../useApi')
  const requests: any[] = []; const params = ref({ limit: 50, offset: 200 }); const revision = ref(3)
  const view = harness(async (_path, options) => {
    requests.push(options.query)
    if (options.query.revision === 3) throw new ApiError(409, 'conflict', 'document was changed')
    return { items: [{ id: 205 }], total: 1, revision: 4 }
  })
  const refresh = deferred<void>()
  const restart = vi.fn(async () => { params.value = { limit: 50, offset: 0 }; await refresh.promise; revision.value = 4 })
  const query = view.use(() => useDocumentFiles(8, params, revision, restart))
  await expect.poll(() => restart.mock.calls.length).toBe(1)
  await nextTick(); expect(requests).toHaveLength(1); expect(query.isRecovering.value).toBe(true)
  refresh.resolve()
  await expect.poll(() => query.data.value?.revision).toBe(4)
  expect(restart).toHaveBeenCalledOnce()
  expect(requests).toEqual([{ limit: 50, offset: 200, revision: 3 }, { limit: 50, offset: 0, revision: 4 }])
})

it('uses employee-only list/detail endpoints and isolates pagination and identity from general documents', async () => {
  const requests: any[] = []
  const view = harness(async (path, options) => {
    requests.push({ path, query: options.query })
    return path.endsWith('/8') ? documentFixture : { items: [], total: 51 }
  })
  const params = ref({ limit: 25, offset: 0 })
  const list = view.use(() => documents.useEmployeeDocuments(params))
  const detail = view.use(() => documents.useEmployeeDocument(8))
  await expect.poll(() => detail.data.value?.id).toBe(8)
  params.value = { limit: 25, offset: 50 }
  await expect.poll(() => requests.length).toBe(3)
  expect(requests).toEqual([
    { path: '/api/v1/documents/employee/me', query: { limit: 25, offset: 0 } },
    { path: '/api/v1/documents/employee/me/8', query: undefined },
    { path: '/api/v1/documents/employee/me', query: { limit: 25, offset: 50 } },
  ])
  expect(list.data.value?.total).toBe(51)
  expect(view.client.getQueryData(documentKeys.detail(1, 8))).toBeUndefined()
  view.me.value = { id: 9, company: { id: 1, name: 'First company' } }
  await expect.poll(() => requests.length).toBe(5)
  expect(view.client.getQueryCache().getAll().filter(query => query.queryKey.includes('employee'))).toHaveLength(5)
})
it('does not request personal documents without identity, permission or a valid personal detail id', async () => {
  const api = vi.fn(async () => documentFixture); const view = harness(api)
  view.me.value = null
  view.use(() => documents.useEmployeeDocuments({ limit: 3 }))
  view.use(() => documents.useEmployeeDocument(8))
  await nextTick(); await Promise.resolve(); expect(api).not.toHaveBeenCalled()
  view.me.value = { id: 7, company: { id: 1, name: 'First company' } }
  const allowed = ref(false)
  const gated = view.use(() => documents.useEmployeeDocument(9, allowed))
  view.use(() => documents.useEmployeeDocument(null))
  await expect.poll(() => api.mock.calls.length).toBe(2)
  expect(gated.data.value).toBeUndefined()
  allowed.value = true
  await expect.poll(() => api.mock.calls.length).toBe(3)
})
it('does not retain another user personal detail when identity changes or signs out', async () => {
  const old = deferred<typeof documentFixture>(); let count = 0
  const view = harness(async () => ++count === 1 ? old.promise : { ...documentFixture, name: 'Second employee' })
  const query = view.use(() => documents.useEmployeeDocument(8))
  await expect.poll(() => count).toBe(1)
  view.me.value = { id: 9, company: { id: 1, name: 'First company' } }
  await expect.poll(() => query.data.value?.name).toBe('Second employee')
  old.resolve(documentFixture); await nextTick(); await Promise.resolve()
  expect(query.data.value?.name).toBe('Second employee')
  view.me.value = null; await nextTick()
  expect(query.data.value).toBeUndefined()
})

it('waits for the own detail before requesting files and isolates the file cache by user', async () => {
  const first = deferred<typeof documentFixture>(); const requests: string[] = []
  const view = harness(async path => {
    requests.push(path)
    if (path.endsWith('/files')) return { items: [], total: 0, revision: 3 }
    return requests.length === 1 ? first.promise : documentFixture
  })
  const detail = view.use(() => documents.useEmployeeDocument(8))
  view.use(() => documents.useDocumentFiles(() => detail.data.value?.id ?? null, { limit: 50 }, () => detail.data.value?.revision ?? 0, undefined, { personal: true }))
  await expect.poll(() => requests.length).toBe(1)
  expect(requests).toEqual(['/api/v1/documents/employee/me/8'])
  first.resolve(documentFixture)
  await expect.poll(() => requests.length).toBe(2)
  view.me.value = { id: 9, company: { id: 1, name: 'First company' } }
  await expect.poll(() => requests.length).toBe(4)
  expect(requests).toEqual(['/api/v1/documents/employee/me/8', '/api/v1/documents/8/files', '/api/v1/documents/employee/me/8', '/api/v1/documents/8/files'])
  const files = view.client.getQueryCache().getAll().filter(query => query.queryKey[2] === 'files' && query.queryKey[3] === 8)
  expect(files.map(query => query.queryKey[7])).toEqual([7, 9])
})

it('checks the caller employee link through the nullable own HR contract and isolates identities', async () => {
  const requests: string[] = []
  const view = harness(async path => { requests.push(path); return null })
  const query = view.use(() => documents.useEmployeeDocumentLink())
  await expect.poll(() => query.data.value).toBeNull()
  expect(requests).toEqual(['/api/v1/hr/me'])
  view.me.value = { id: 9, company: { id: 1, name: 'First company' } }
  await expect.poll(() => requests.length).toBe(2)
  expect(view.client.getQueryCache().getAll().map(query => query.queryKey)).toEqual([
    ['documents', 1, 'employee', 7, 'link'], ['documents', 1, 'employee', 9, 'link'],
  ])
})
