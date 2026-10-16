import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { paymentAttemptBadge, customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'

async function page(name: string, data: unknown, source?: string) {
  const filename = resolve(import.meta.dirname, '..', name)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'operation-feed' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const request = vi.fn(async () => data)
  const keys: string[] = []
  const messages = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../i18n/locales/en/vendor.json'), 'utf8'))
  const t = (key: string) => key.split('.').reduce((obj: unknown, key) => (obj as Record<string, unknown> | undefined)?.[key], messages) ?? key
  const bindings = {
    formatNasqDateTime,
    invoiceStatusBadge, paymentAttemptBadge, customerDisplayBadge, operationStatusBadge,
    _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, onMounted: () => {}, onBeforeUnmount: () => {},
    definePageMeta: () => {}, useI18n: () => ({ t, locale: Vue.ref('en') }), safeReturnTo, FilterBar: {},
    useRoute: () => ({ params: { id: 'job-id' }, query: { source }, fullPath: '/operations?source=all' }),
    useRouter: () => ({ replace: vi.fn() }), useVendorApi: () => ({ request }), useVendorContext: () => ({ can: () => true }),
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
  return { state, request, keys, captured, html }
}
const operation = { id: 'job-id', tenant_id: 'tenant-id', type: 'provision', source: 'shared', status: 'verified', stage: 'verified', reason: 'shared_execution_verified', request_id: 'request-id', result: null, created_at: '2026-10-01T00:00:00Z', updated_at: null, last_event_at: null, events: [] }

it('opts overview and list into the combined feed and carries source through links', async () => {
  const overview = await page('overview.vue', { tenants: 1, active: 0, pending_operations: 1, failed_operations: 2 })
  expect(overview.request).toHaveBeenCalledWith('overview', { query: { source: 'all' } })
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
  expect(detail.captured.find(c => c.name === 'SharedPropertyRow' && c.props.label === 'Operation')?.props.value).toContain('Set up customer workspace')
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
