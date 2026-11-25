import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, fakeT } from '@liwan/ui/test/helpers/renderShared'
import * as hrKpis from '../../../utils/hrKpis'

// The payroll runs list's KPI strip: the page's real <script setup> and template rendered to HTML (SSR). The run-list
// composable is a recorder, so the test reads which requests the page enables: the tiles ask nothing while the figures
// are hidden or the viewer cannot read payroll, and the all-runs tile reuses the list total while the list is unfiltered.
interface RunsCall { query: Record<string, unknown>; enabled: () => boolean }

const Stub = (name: string) => Vue.defineComponent({
  name, inheritAttrs: false,
  setup(_, { slots }) { return () => Vue.h('div', { 'data-stub': name }, slots.default?.()) },
})
const ListPage = Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { slots }) { return () => Vue.h('section', [slots.kpis ? Vue.h('div', { 'data-slot': 'kpis' }, slots.kpis()) : null, slots.default?.()]) },
})
const KpiStrip = Vue.defineComponent({
  inheritAttrs: false,
  props: { tiles: { type: Array, required: true } },
  setup(props) { return () => Vue.h('ul', { 'data-testid': 'hr-payroll-kpi-strip' }, (props.tiles as Array<{ id: string; value: unknown }>).map(tile => Vue.h('li', `${tile.id}:${tile.value}`))) },
})

const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@/components/hr/payroll/PayrollRunTable.vue': { __esModule: true, default: Stub('PayrollRunTable') },
  '@liwan/ui/app/utils/safeReturnTo': { returnToQuery: () => ({}) },
  '@/composables/useHrPayrollRuns': {
    HR_PAYROLL_PAGE_SIZE: 25,
    hrPayrollRunsQuery: (input: { year?: number | null; state?: string; limit: number; offset: number }) => ({
      year: input.year ?? undefined, state: input.state === 'all' ? undefined : input.state, limit: input.limit, offset: input.offset,
    }),
  },
  '@/utils/payrollFormat': { currentPayrollMonth: () => '2026-11' },
  '@/utils/hrKpis': hrKpis,
}

function loadPage(globals: Record<string, unknown>): Vue.Component {
  const filename = resolve(import.meta.dirname, '../payroll.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = ts.transpileModule(compileScript(descriptor, { id: 'page', inlineTemplate: true }).content, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const require = (specifier: string) => {
    if (specifier in MODULES) return MODULES[specifier]
    throw new Error(`payroll.vue imports ${specifier}; declare it in MODULES`)
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(require, exports, ...Object.values(globals))
  return exports.default!
}

async function render(options: { shown: boolean; canRead: boolean; query?: Record<string, string> }) {
  const calls: RunsCall[] = []
  const globals = {
    computed: Vue.computed,
    useRoute: () => ({ path: '/hr/payroll', query: options.query ?? {}, hash: '', fullPath: '/hr/payroll' }),
    useRouter: () => ({ replace: () => undefined }),
    useI18n: () => ({ t: fakeT() }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: (capability: string) => capability === 'hr.payroll.read' ? options.canRead : false }),
    useKpiVisibility: () => ({ shown: Vue.ref(options.shown) }),
    useHrPayrollRuns: (query: unknown, enabled: unknown = true) => {
      calls.push({ query: Vue.toValue(query as Record<string, unknown>), enabled: () => Vue.toValue(enabled as boolean) })
      return { data: Vue.ref({ items: [], total: 7 }), isLoading: Vue.ref(false), isFetching: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined }
    },
  }
  const app = Vue.createSSRApp({ render: () => Vue.h(loadPage(globals)) })
  app.config.globalProperties.$t = fakeT() as never
  const tags = { SharedListPage: ListPage, SharedKpiStrip: KpiStrip, NuxtPage: Stub('NuxtPage') }
  for (const name of ['SharedListCard', 'SharedFilterBar', 'SharedFilterField', 'SharedFilterChip', 'SharedPageState', 'SharedEmptyState', 'SharedListFooter', 'USelect']) app.component(name, Stub(name))
  for (const [tag, stub] of Object.entries({ ...DEFAULT_STUBS, ...tags })) app.component(tag, stub)
  const html = await renderToString(app)
  // The first call is the list itself (limit 25); every later call is a tile.
  return { html, list: calls[0]!, tiles: calls.slice(1) }
}

describe('payroll runs KPI strip', () => {
  it('asks one row per state and reuses the list total for all runs while the list is unfiltered', async () => {
    const { html, list, tiles } = await render({ shown: true, canRead: true })
    expect(list.query).toMatchObject({ limit: 25 })
    expect(tiles.map(call => call.query)).toEqual([
      { limit: 1, offset: 0 },
      { state: 'draft', limit: 1, offset: 0 },
      { state: 'computed', limit: 1, offset: 0 },
      { state: 'approved', limit: 1, offset: 0 },
    ])
    expect(tiles.map(call => call.enabled())).toEqual([false, true, true, true])
    expect(html).toContain('data-testid="hr-payroll-kpi-strip"')
    expect(html).toContain('all:7')
  })

  it('asks the all-runs total itself once a filter narrows the list', async () => {
    const { tiles } = await render({ shown: true, canRead: true, query: { state: 'draft' } })
    expect(tiles.map(call => call.enabled())).toEqual([true, true, true, true])
  })

  it('asks nothing while the figures are hidden', async () => {
    const { tiles } = await render({ shown: false, canRead: true, query: { year: '2026' } })
    expect(tiles).toHaveLength(4)
    expect(tiles.map(call => call.enabled())).toEqual([false, false, false, false])
  })

  it('asks nothing and draws no strip without hr.payroll.read', async () => {
    const { html, tiles } = await render({ shown: true, canRead: false, query: { year: '2026' } })
    expect(tiles.map(call => call.enabled())).toEqual([false, false, false, false])
    expect(html).not.toContain('hr-payroll-kpi-strip')
    expect(html).not.toContain('data-slot="kpis"')
  })

  it('shows the list totals as counts of runs only', async () => {
    const { html } = await render({ shown: true, canRead: true })
    expect(html).toContain('<li>all:7</li><li>draft:7</li><li>computed:7</li><li>approved:7</li>')
  })
})
