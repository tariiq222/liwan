import { expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { ref, nextTick } from 'vue'
import manifest from '../../../modules/documents/manifest'
import { load, documentFixture } from './helpers'

it('loads summary exclusively from own employment documents and links canonical own details', async () => {
  const entry = manifest.personal?.find(item => item.section === 'documents')
  expect(entry).toBeDefined()
  const api = vi.fn(async (path: string) => path === '/api/v1/hr/me' ? { id: 3 } : { items: [documentFixture], total: 6 })
  const summary = await entry!.summary!.load(api as never, key => key)
  expect(api).toHaveBeenCalledWith('/api/v1/documents/employee/me', expect.objectContaining({ query: { limit: 3 } }))
  expect(summary.value).toBe('6')
  expect(summary.rows).toEqual([{ id: 8, label: 'Policy', to: '/account/documents/8' }])
})
it('renders personal record links without leaving self-service', async () => {
  const view = await load('app/components/documents/DocumentList.vue', { documents: [documentFixture], recordBase: '/account/documents', returnTo: '/account/documents?offset=25' })
  expect(view.state.target(documentFixture)).toEqual({ path: '/account/documents/8', query: { returnTo: '/account/documents?offset=25' } })
  view.stop()
})
it('uses the own detail and gates files until that detail exists, without management actions or HR context jumps', async () => {
  const data = ref<any>(undefined)
  const query = { data, refetch: vi.fn(), error: ref(null), isLoading: ref(false), isFetching: ref(false) }
  const fileCalls: any[] = []; const generic = vi.fn()
  const view = await load('app/pages/documents/self/[documentId].vue', {}, true, { path: '/account/documents/8', bindings: {
    useEmployeeDocument: () => query, useDocument: generic,
    useDocumentFiles: (id: any, _params: any, _revision: any, _conflict: any, options: any) => { fileCalls.push({ id, options }); return { ...query, isRecovering: ref(false) } },
  } })
  expect(fileCalls[0].id.value).toBeNull()
  data.value = { ...documentFixture, context: { kind: 'hr.employee', id: 9, label: 'Employee', href: '/hr/9' } }
  await nextTick()
  expect(fileCalls[0].id.value).toBe(8)
  expect(fileCalls[0].options).toEqual({ personal: true })
  const nodes = await view.rendered()
  expect(generic).not.toHaveBeenCalled()
  expect(nodes.some(node => node.name === 'UButton' || node.name === 'SharedRowActions' || node.name === 'NuxtLink')).toBe(false)
  expect(nodes.find(node => node.name === 'DocumentFiles')?.props.readonly).toBe(true)
  view.stop()
})

it('pages the employee list through its canonical URL without offering create actions', async () => {
  const params: any[] = []; const enabled: any[] = []
  const data = ref({ items: [documentFixture], total: 51 })
  const query = { data, error: ref(null), isLoading: ref(false), isFetching: ref(false), refetch: vi.fn() }
  const view = await load('app/pages/documents/self/index.vue', {}, true, { path: '/account/documents?offset=25', bindings: {
    useEmployeeDocuments: (filters: any, permitted: any) => { params.push(filters); enabled.push(permitted); return query },
  } })
  expect(params[0].value).toEqual({ limit: 25, offset: 25 })
  expect(enabled[0].value).toBe(true)
  const nodes = await view.rendered()
  expect(nodes.find(node => node.name === 'SharedListPage')?.props.createTo).toBeUndefined()
  expect(nodes.find(node => node.name === 'DocumentList')?.props['record-base']).toBe('/account/documents')
  view.state.setPage(3)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(view.router.currentRoute.value.fullPath).toBe('/account/documents?offset=50')
  view.stop()
})
it('blocks personal list requests when either required capability is missing', async () => {
  const enabled: any[] = []
  const query = { data: ref(undefined), error: ref(null), isLoading: ref(false), isFetching: ref(false), refetch: vi.fn() }
  const view = await load('app/pages/documents/self/index.vue', {}, false, { path: '/account/documents', bindings: {
    useEmployeeDocuments: (_filters: any, permitted: any) => { enabled.push(permitted); return query },
  } })
  expect(enabled[0].value).toBe(false)
  expect((await view.rendered()).some(node => node.name === 'SharedForbiddenState')).toBe(true)
  view.stop()
})

it('hides cached own content and stops file reads when revalidation denies access', async () => {
  const error = ref<any>(null)
  const query = { data: ref(documentFixture), refetch: vi.fn(), error, isLoading: ref(false), isFetching: ref(false) }
  const files: any[] = []
  const view = await load('app/pages/documents/self/[documentId].vue', {}, true, { path: '/account/documents/8', bindings: {
    useEmployeeDocument: () => query,
    useDocumentFiles: (id: any) => { files.push(id); return { ...query, isRecovering: ref(false) } },
  } })
  expect(files[0].value).toBe(8)
  error.value = new ApiError(404, 'not_found', 'Not found'); await nextTick()
  expect(files[0].value).toBeNull()
  expect((await view.rendered()).some(node => node.name === 'DocumentReader' || node.name === 'DocumentFiles')).toBe(false)
  view.stop()
})
it('normalizes a stale personal list page after the result count shrinks', async () => {
  const data = ref({ items: [], total: 51 })
  const query = { data, error: ref(null), isLoading: ref(false), isFetching: ref(false), refetch: vi.fn() }
  const view = await load('app/pages/documents/self/index.vue', {}, true, { path: '/account/documents?offset=50', bindings: { useEmployeeDocuments: () => query } })
  data.value = { items: [], total: 1 }; await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(view.router.currentRoute.value.fullPath).toBe('/account/documents')
  view.stop()
})

it('explains missing employee linkage in the overview without asking for documents or inventing a zero count', async () => {
  const entry = manifest.personal!.find(item => item.section === 'documents')!
  const api = vi.fn(async (path: string) => path === '/api/v1/hr/me' ? null : { items: [], total: 0 })
  const summary = await entry.summary!.load(api as never, key => key)
  expect(api.mock.calls.map(call => call[0])).toEqual(['/api/v1/hr/me'])
  expect(summary).toEqual({ caption: 'documents.personal.noEmployee' })
})
it('distinguishes missing employee linkage from an empty personal document list and stops the list request', async () => {
  const linked = { data: ref<any>(null), error: ref<any>(null), isLoading: ref(false), refetch: vi.fn() }
  let enabled: any
  const query = { data: ref({ items: [], total: 0 }), error: ref(null), isLoading: ref(false), isFetching: ref(false), refetch: vi.fn() }
  const view = await load('app/pages/documents/self/index.vue', {}, true, { path: '/account/documents', bindings: {
    useEmployeeDocumentLink: () => linked,
    useEmployeeDocuments: (_params: any, permitted: any) => { enabled = permitted; return query },
  } })
  expect(enabled.value).toBe(false)
  expect((await view.rendered()).find(node => node.name === 'SharedEmptyState')?.props.title).toBe('documents.personal.noEmployee')
  linked.data.value = { id: 3 }; await nextTick()
  expect(enabled.value).toBe(true)
  expect((await view.rendered()).find(node => node.name === 'SharedEmptyState')?.props.title).toBe('documents.personal.empty')
  view.stop()
})
it('does not show cached personal detail or request it when no employee is linked', async () => {
  const query = { data: ref(documentFixture), error: ref(null), isLoading: ref(false), isFetching: ref(false), refetch: vi.fn() }
  let enabled: any; let fileId: any
  const view = await load('app/pages/documents/self/[documentId].vue', {}, true, { path: '/account/documents/8', bindings: {
    useEmployeeDocumentLink: () => ({ data: ref(null), error: ref(null), isLoading: ref(false), refetch: vi.fn() }),
    useEmployeeDocument: (_id: any, permitted: any) => { enabled = permitted; return query },
    useDocumentFiles: (id: any) => { fileId = id; return { ...query, isRecovering: ref(false) } },
  } })
  expect(enabled.value).toBe(false)
  expect(fileId.value).toBeNull()
  const nodes = await view.rendered()
  expect(nodes.find(node => node.name === 'SharedEmptyState')?.props.title).toBe('documents.personal.noEmployee')
  expect(nodes.some(node => node.name === 'DocumentReader')).toBe(false)
  view.stop()
})

it('keeps failed employee-link checks distinct from an unlinked account and blocks document loading', async () => {
  const failure = new ApiError(500, 'server_error', 'Employee lookup failed')
  const linked = { data: ref({ id: 3 }), error: ref(failure), isLoading: ref(false), refetch: vi.fn() }
  let enabled: any
  const query = { data: ref({ items: [], total: 0 }), error: ref(null), isLoading: ref(false), isFetching: ref(false), refetch: vi.fn() }
  const view = await load('app/pages/documents/self/index.vue', {}, true, { path: '/account/documents', bindings: {
    useEmployeeDocumentLink: () => linked,
    useEmployeeDocuments: (_params: any, permitted: any) => { enabled = permitted; return query },
  } })
  expect(enabled.value).toBe(false)
  const nodes = await view.rendered()
  expect(nodes.find(node => node.name === 'SharedPageState')?.props.error).toBe(failure)
  expect(nodes.some(node => node.name === 'SharedEmptyState' && node.props.title === 'documents.personal.noEmployee')).toBe(false)
  view.stop()
})
