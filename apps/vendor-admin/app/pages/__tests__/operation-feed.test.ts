import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { paymentAttemptBadge, customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { OPERATION_STATUS_FILTERS, operationFilterLabelKey, operationStatusFilter, operationTargetTo } from '../../utils/vendorOperations'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'
import * as clients from '../../utils/vendorClients'
import { isNotAvailable } from '../../utils/vendorSubscriptions'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'

async function page(name: string, data: unknown, source?: string, query: Record<string, string> = {}) {
  const filename = resolve(import.meta.dirname, '..', name)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'operation-feed' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const tenants = { items: [{ id: 'tenant-id', name: 'Acme' }], total: 1 }
  const request = vi.fn(async (path: string, _options?: unknown) => (path === 'tenants' && name === 'operations/index.vue' ? tenants : data))
  const replace = vi.fn()
  const keys: string[] = []
  const messages = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../i18n/locales/en/vendor.json'), 'utf8'))
  const t = (key: string) => key.split('.').reduce((obj: unknown, key) => (obj as Record<string, unknown> | undefined)?.[key], messages) ?? key
  const bindings = {
    formatNasqDateTime, ...clients, isNotAvailable,
    useVendorSubscriptions: () => ({ listClients: (query: Record<string, unknown>) => request('commercial/clients', { query }) }),
    invoiceStatusBadge, paymentAttemptBadge, customerDisplayBadge, operationStatusBadge,
    _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, onMounted: () => {}, onBeforeUnmount: () => {},
    definePageMeta: () => {}, useI18n: () => ({ t, locale: Vue.ref('en') }), safeReturnTo, OPERATION_STATUS_FILTERS, operationFilterLabelKey, operationStatusFilter, operationTargetTo,
    useRoute: () => ({ params: { id: 'job-id' }, query: { source, ...query }, fullPath: '/operations?source=all' }),
    useRouter: () => ({ replace }), useHydrated: () => Vue.ref(true), useVendorApi: () => ({ request }), useVendorContext: () => ({ can: () => true }),
    useAsyncData: async (key: string | (() => string), fn: () => Promise<unknown>) => {
      keys.push(typeof key === 'function' ? key() : key)
      return { data: Vue.ref(await fn()), pending: Vue.ref(false), error: Vue.ref(null), refresh: vi.fn() }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'operation-feed', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  const captured: { name: string, props: Record<string, unknown> }[] = []
  const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
    return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', [name === 'SharedPageState' && attrs.empty ? 'Empty' : slots.default?.(), slots.header?.(), slots.actions?.(), name === 'SharedRecordPage' ? slots.aside?.() : null, slots.search?.()]) }
  } }))
  const html = await renderToString(app)
  scope.stop()
  return { state, request, replace, keys, captured, html }
}
const operation = { id: 'job-id', tenant_id: 'tenant-id', type: 'provision', source: 'shared', status: 'verified', stage: 'verified', reason: 'shared_execution_verified', request_id: 'request-id', result: null, created_at: '2026-10-01T00:00:00Z', updated_at: null, last_event_at: null, events: [] }

it('opts overview and list into the combined feed and carries source through links', async () => {
  expect(readFileSync(resolve(import.meta.dirname, '../overview.vue'), 'utf8')).toContain("request<{ tenants: number, active: number, pending_operations: number, failed_operations: number, last_health_at: string | null }>('overview', { query: { source: 'all' } })")
  const list = await page('operations/index.vue', { items: [operation], total: 1 })
  expect(list.request).toHaveBeenCalledWith('operations', expect.objectContaining({ query: expect.objectContaining({ source: 'all' }) }))
  expect(list.keys[0]).toContain(':all:')
  expect(list.state.operationTo(operation).query).toMatchObject({ source: 'shared', returnTo: '/operations?source=all' })
  expect(list.state.operationTime(operation)).toContain('Created'); expect(list.state.operationTime(operation)).not.toContain('Invalid Date')
})
it.each(['verified','needs_intervention'])('loads shared %s detail explicitly, translates safe reason, and offers no retry or polling', async status => {
  const detail = await page('operations/[id].vue', { ...operation, status, stage: status }, 'shared')
  expect(detail.request).toHaveBeenCalledWith('operations/job-id', { query: { source: 'shared' } })
  expect(detail.keys[0]).toBe('vendor:operation:shared:job-id')
  expect(detail.state.canRetry.value).toBe(false); expect(detail.state.isActive.value).toBe(false)
  expect(detail.html).not.toContain('shared_execution_verified'); expect(detail.html).not.toContain('Retry operation')
  expect(detail.captured.find(c => c.name === 'SharedRecordPage')?.props.title).toContain('Set up customer workspace')
  expect(detail.captured.find(node => node.name === 'UAlert' && String(node.props.description).includes('readiness'))).toBeDefined()
})
it('preserves legacy failed read-operation retry and active polling', async () => {
  const legacy = await page('operations/[id].vue', { ...operation, source: undefined, type: 'health', status: 'failed' })
  expect(legacy.state.canRetry.value).toBe(true)
  const active = await page('operations/[id].vue', { ...operation, status: 'running' }, 'shared')
  expect(active.state.isActive.value).toBe(true)
})

it('keeps navigation available when a combined-feed page is empty but has earlier records', async () => {
  const list = await page('operations/index.vue', { items: [], total: 28 })
  expect(list.captured.find(node => node.name === 'SharedDataTable')?.props.pages).toBe(2)
})

const lastQuery = (list: { replace: ReturnType<typeof vi.fn> }) => list.replace.mock.calls.at(-1)![0]

it('filters the operation list by status and installation from the URL and shows installation names', async () => {
  const list = await page('operations/index.vue', { items: [operation], total: 1 }, undefined, { tenant_id: 'tenant-id', status: 'attention', page: '2' })
  expect(list.request).toHaveBeenCalledWith('operations', { query: { source: 'all', tenant_id: 'tenant-id', status: 'attention', page: 2 } })
  expect(list.keys[0]).toBe('vendor:operations:all:tenant-id:attention:2')
  expect(list.state.tenantName('tenant-id')).toBe('Acme'); expect(list.state.tenantName('other-id')).toBe('other-id')
  expect(list.state.tenantItems.value.map((item: { value: string }) => item.value)).toEqual(['all', 'tenant-id'])
  expect(list.state.filtered.value).toBe(true)
  expect(list.state.statusItems.value.map((item: { value: string }) => item.value)).toEqual(['all', 'pending', 'attention', 'succeeded', 'verified'])
})

it('keeps an unknown installation id selectable and ignores an invalid status', async () => {
  const list = await page('operations/index.vue', { items: [], total: 0 }, undefined, { tenant_id: 'gone-id', status: 'bogus' })
  expect(list.request).toHaveBeenCalledWith('operations', { query: { source: 'all', tenant_id: 'gone-id', status: undefined, page: undefined } })
  expect(list.state.tenantItems.value.map((item: { value: string }) => item.value)).toEqual(['all', 'gone-id', 'tenant-id'])
  expect(list.state.status.value).toBe('all')
})

it('writes operation filters to the URL and resets the page', async () => {
  const list = await page('operations/index.vue', { items: [], total: 0 }, undefined, { tenant_id: 'tenant-id', page: '3' })
  list.state.patch({ status: 'pending' })
  expect(lastQuery(list)).toEqual({ path: '/operations', query: { source: undefined, tenant_id: 'tenant-id', page: undefined, status: 'pending' } })
})

it('keeps client search, state and page in the URL and queries the unified list', async () => {
  const list = await page('customers/index.vue', { items: [], total: 60 }, undefined, { q: 'acme', state: 'active', page: '2' })
  expect(list.request).toHaveBeenCalledWith('commercial/clients', { query: { q: 'acme', state: 'active', page: 2 } })
  expect(list.keys[0]).toBe('vendor:clients:acme:active:2')
  expect(list.state.q.value).toBe('acme'); expect(list.state.state.value).toBe('active')
  expect(list.captured.find(node => node.name === 'SharedDataTable')?.props.pages).toBe(3)
  list.state.patch({ state: undefined })
  expect(lastQuery(list)).toMatchObject({ path: '/customers', query: { q: 'acme', page: undefined, state: undefined } })
  const invalid = await page('customers/index.vue', { items: [], total: 0 }, undefined, { state: 'bogus' })
  expect(invalid.state.state.value).toBe('all')
  expect(invalid.request).toHaveBeenCalledWith('commercial/clients', { query: { q: undefined, state: undefined, page: undefined } })
})
it('opens a client on its customer page, or on its workspace page when it has no commercial record', async () => {
  const list = await page('customers/index.vue', { items: [], total: 0 })
  expect(list.state.to({ customer_id: 'cust 1', tenant_id: null })).toEqual({ path: '/customers/cust%201', query: { returnTo: '/operations?source=all' } })
  expect(list.state.to({ customer_id: 'cust-1', tenant_id: 'tenant-1' }).path).toBe('/customers/cust-1')
  expect(list.state.to({ customer_id: null, tenant_id: 'tenant-1' }).path).toBe('/tenants/tenant-1')
  expect(list.state.rowKey({ customer_id: null, tenant_id: 'tenant-1' })).toBe('tenant-1')
})
it('offers the create action to tenant managers only', async () => {
  const list = await page('customers/index.vue', { items: [], total: 0 })
  expect(list.captured.find(node => node.name === 'SharedListPage')?.props['create-to']).toEqual({ path: '/customers/new', query: { returnTo: '/operations?source=all' } })
})

it('links an operation to its customer, else to the workspace page, and shows the workspace name', async () => {
  const owned = { ...operation, tenant_name: 'Acme Workspace', customer_id: 'cust-1' }
  const list = await page('operations/index.vue', { items: [owned, { ...operation, id: 'job-2', tenant_name: null, customer_id: null }], total: 2 })
  expect(list.state.targetName(owned)).toBe('Acme Workspace'); expect(list.state.targetName({ ...operation, tenant_name: null })).toBe('Acme')
  expect(operationTargetTo(owned)).toEqual({ path: '/customers/cust-1', query: { tab: 'operations' } })
  expect(operationTargetTo({ tenant_id: 'tenant id', customer_id: null })).toEqual({ path: '/tenants/tenant%20id' })
  const detail = await page('operations/[id].vue', owned, 'shared')
  expect(detail.state.targetTo.value).toEqual({ path: '/customers/cust-1', query: { tab: 'operations' } })
  expect(detail.html).toContain('Acme Workspace'); expect(detail.html).not.toContain('open="')
})
