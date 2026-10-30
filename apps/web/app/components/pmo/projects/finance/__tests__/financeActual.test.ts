import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import * as finance from '../../../../../utils/projectFinance'
import { ApiError } from '../../../../../composables/useApi'

const root = resolve(import.meta.dirname, '../../../../../../../..')
const web = resolve(root, 'apps/web')
const projects = JSON.parse(readFileSync(resolve(web, 'i18n/locales/ar/projects.json'), 'utf8'))
const settings = JSON.parse(readFileSync(resolve(web, 'i18n/locales/ar/settings.json'), 'utf8'))
const lookup = (catalog: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], catalog)
// The Arabic catalogs answer, so a key the components use but the catalog lacks comes back as the key itself.
const t = (key: string) => (lookup(projects, key) ?? lookup(settings, key) ?? key) as string
const currency = { id: 1, name: 'SAR', symbol: 'SAR', decimal_places: 2 }
const summary = {
  project_id: 7, currency, charter_estimate: null, planned: 100, actual: -40, remaining: 140, utilization_percent: 0, over_budget: false,
  budget_count: 1, expense_count: 2, actual_source: 'external', actual_account: { id: 3, name: 'Tower', code: 'CC-3' },
  can_read_actual_lines: true, can_choose_actual_account: true,
} as const

const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
function compile(path: string, bindings: Record<string, unknown>) {
  const file = resolve(web, 'app', path)
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const content = compileScript(descriptor, { id: 'finance-actual' }).content
  // Child components the file imports are inert here: the harness renders one file at a time.
  const children = Object.fromEntries([...content.matchAll(/^import (\w+) from ['"][^'"]+\.vue['"]/gm)].map(match => [match[1], {}]))
  const script = content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const scope = { ...children, ...bindings }
  const component = new Function(...Object.keys(scope), js(script))(...Object.values(scope))
  const template = compileTemplate({ source: descriptor.template!.content, filename: file, id: 'finance-actual', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  return { component, render: new Function('Vue', js(template.code))(Vue) }
}

const passthrough = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])) })
const link = Vue.defineComponent({ props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
// Renders every cell slot of every row, which is what the real table does on a wide screen.
const table = Vue.defineComponent({
  props: ['rows', 'columns', 'emptyText'],
  setup: (props, { slots }) => () => Vue.h('div', (props.rows as unknown[]).flatMap(row => (props.columns as { id: string }[]).map(column => slots[`${column.id}-cell`]?.({ row: { original: row } })))),
})
async function render(compiled: ReturnType<typeof compile>, props: Record<string, unknown>, components: Record<string, unknown> = {}) {
  // The script-setup bindings go out as a plain object, which the template's `with (this)` render reads.
  const root = { ...compiled.component, render: compiled.render, async setup(setupProps: unknown, context: unknown) { return { ...await compiled.component.setup(setupProps, context) } } }
  const app = Vue.createSSRApp({ render: () => Vue.h(root, props) })
  for (const [name, component] of Object.entries({ SharedRecordSection: passthrough, SharedListCard: passthrough, SharedListFooter: passthrough, SharedStatusBadge: passthrough, UFormField: passthrough, USelectMenu: passthrough, NuxtLink: link, SharedDataTable: table, ...components })) app.component(name, component as Vue.Component)
  return renderToString(app)
}

describe('FinanceActualSource', () => {
  const view = () => compile('components/pmo/projects/finance/FinanceActualSource.vue', { _defineComponent: Vue.defineComponent, ...finance, useI18n: () => ({ t }) })
  it('names the source and shows the linked cost center as a tag', async () => {
    const html = await render(view(), { summary })
    expect(html).toContain(t('projects.finance.actualSource.fromAccounts'))
    expect(html).toContain('finance-actual-account')
    expect(html).toContain('CC-3 · Tower')
    expect(html).not.toContain('finance-actual-account-missing')
  })
  it('says no cost center is linked yet when there is none', async () => {
    const html = await render(view(), { summary: { ...summary, actual_account: null } })
    expect(html).toContain('finance-actual-account-missing')
    expect(html).toContain(t('projects.finance.actualSource.noCostCenter'))
  })
})

describe('FinanceActualLines', () => {
  const lines = [
    { id: 1, date: '2026-10-01', label: 'Cement', reference: 'BILL/9', partner: { id: 4, name: 'Acme' }, amount: 25.5, record: { kind: 'finance-bill', id: 9 } },
    { id: 2, date: '2026-10-02', label: 'Refund', reference: 'RF/1', partner: null, amount: -65.5, record: null },
  ]
  function view(opened: string[] = []) {
    return compile('components/pmo/projects/finance/FinanceActualLines.vue', {
      _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, ...finance, formatCalendarDate,
      useI18n: () => ({ t, locale: Vue.ref('ar') }), useHydrated: () => Vue.ref(true),
      useRecordLink: () => (kind: string, id: number) => { opened.push(`${kind}:${id}`); return kind === 'finance-bill' ? `/finance/purchases/bills/${id}` : null },
      useProjectActualLines: () => ({ data: Vue.ref({ items: lines, total: 2 }), isLoading: Vue.ref(false), isFetching: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
    })
  }
  it('lists date, label, reference, partner and the signed amount, linking a line only when its record resolves', async () => {
    const opened: string[] = []
    const html = await render(view(opened), { projectId: 7, summary })
    expect(html).toContain('Cement')
    expect(html).toMatch(/<a href="\/finance\/purchases\/bills\/9"[^>]*>BILL\/9<\/a>/)
    expect(html).toContain('Acme')
    expect(html).toContain('25.50 SAR')
    expect(html).toContain('-65.50 SAR')
    expect(html).not.toContain('href="/finance/purchases/bills/undefined"')
    expect(html).toContain('<span>RF/1</span>')
    expect(opened).toContain('finance-bill:9')
  })
  it('titles the section from the catalog', async () => {
    const html = await render(view(), { projectId: 7, summary })
    expect(html).toContain(t('projects.finance.actualLines.title'))
    expect(t('projects.finance.actualLines.title')).not.toBe('projects.finance.actualLines.title')
  })
})

describe('FinanceActualAccountPicker', () => {
  function picker(options: { available?: boolean, data?: { id: number, name: string }[] } = {}) {
    const mutate = vi.fn()
    const compiled = compile('components/pmo/projects/finance/FinanceActualAccountPicker.vue', {
      _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, ...finance, useI18n: () => ({ t }), useHydrated: () => Vue.ref(true),
      useRecordPicker: () => ({ available: Vue.ref(options.available !== false), query: { data: Vue.ref(options.data ?? [{ id: 3, name: 'CC-3 · Tower' }, { id: 5, name: 'Annex' }]), isLoading: Vue.ref(false), error: Vue.ref(null) } }),
      useSetActualAccount: () => ({ mutate, isPending: Vue.ref(false) }),
    })
    const state = compiled.component.setup({ projectId: 7, summary }, { expose: () => {} })
    return { compiled, state, mutate }
  }
  it('lists a none entry first and keeps the linked cost center selectable when the options lack it', () => {
    const { state } = picker({ data: [{ id: 5, name: 'Annex' }] })
    expect(state.items.value.map((item: { value: string }) => item.value)).toEqual(['none', '3', '5'])
    expect(state.items.value[1].label).toBe('CC-3 · Tower')
    expect(state.selected.value).toBe('3')
  })
  it('saves a chosen cost center or none, and ignores the one already linked', () => {
    const { state, mutate } = picker()
    state.choose('3')
    expect(mutate).not.toHaveBeenCalled()
    state.choose('5')
    expect(mutate).toHaveBeenLastCalledWith({ projectId: 7, accountId: 5 }, expect.any(Object))
    state.choose('none')
    expect(mutate).toHaveBeenLastCalledWith({ projectId: 7, accountId: null }, expect.any(Object))
  })
  it('shows the server refusal next to the field', () => {
    const { state, mutate } = picker()
    state.choose('5')
    mutate.mock.calls[0]![1].onError(new ApiError(409, 'account_linked', 'taken', 'account_id'))
    expect(state.error.value).toBe(t('projects.finance.actualAccount.linked'))
    state.choose('none')
    expect(state.error.value).toBe('')
    mutate.mock.calls[1]![1].onError(new ApiError(422, 'invalid', 'bad', 'account_id'))
    expect(state.error.value).toBe(t('projects.finance.actualAccount.invalid'))
  })
  it('renders nothing for a user who cannot use the cost center picker', async () => {
    const { compiled } = picker({ available: false })
    expect(await render(compiled, { projectId: 7, summary })).not.toContain('finance-actual-account-picker')
    expect(await render(picker().compiled, { projectId: 7, summary })).toContain('finance-actual-account-picker')
  })
})

describe('project finance page with an external actual', () => {
  function page(external: boolean, query: Record<string, string>) {
    const route = { path: '/projects/7/finance', params: { id: '7' }, query, hash: '', fullPath: '/projects/7/finance' }
    const data = Vue.ref({ items: [], total: 0, can_manage: true, summary: { ...summary, actual_source: external ? 'external' : 'manual' } })
    const compiled = compile('pages/projects/[id]/finance.vue', {
      ...finance, _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch, onScopeDispose: Vue.onScopeDispose,
      useRoute: () => route, useRouter: () => ({ currentRoute: Vue.ref(route), resolve: () => ({ fullPath: '/projects/7/finance' }), replace: async () => undefined, afterEach: () => () => {}, onError: () => () => {} }),
      onBeforeRouteLeave: () => {}, onBeforeRouteUpdate: () => {}, refDebounced: (source: unknown) => source, useNuxtApp: () => ({ hook: () => () => {} }),
      useI18n: () => ({ t }), useHydrated: () => Vue.ref(true), useProject: () => ({ data: Vue.ref({ id: 7 }) }), returnToQuery: () => ({}), ApiError,
      useProjectFinanceList: () => ({ data, isFetching: Vue.ref(false), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
    })
    return Vue.effectScope().run(() => compiled.component.setup({}, { expose: () => {} }))
  }
  it('offers only all and budget in the kind filter', () => {
    expect(page(true, {}).kindItems.value.map((item: { value: string }) => item.value)).toEqual(['all', 'budget'])
    expect(page(false, {}).kindItems.value.map((item: { value: string }) => item.value)).toEqual(['all', 'budget', 'expense'])
  })
  it('falls back to every entry when a link still asks for expenses', async () => {
    const external = page(true, { kind: 'expense' })
    await Vue.nextTick()
    expect(external.filters.kind).toBe('all')
    const manual = page(false, { kind: 'expense' })
    await Vue.nextTick()
    expect(manual.filters.kind).toBe('expense')
  })
})
