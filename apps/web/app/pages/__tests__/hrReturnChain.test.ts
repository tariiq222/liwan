import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { createMemoryHistory, createRouter, type RouteLocationRaw } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { layerFile } from '@webvue/ui/test/helpers/layerFile'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { fitOrgChart, layoutDepartmentOrgChart, nextOrgScale } from '../../lib/departmentOrgChart'
import { buildDepartmentTree, filterDepartmentTree } from '../../lib/departmentTree'
import { FORM_ACTIONS_HOST } from '@webvue/ui/app/utils/formActions'
import * as recordNavigation from './helpers/recordNavigation'
import * as navigation from '../../utils/hrReturnTo'

const root = resolve(import.meta.dirname, '../..')
const departmentPage = 'pages/hr/departments/[departmentId].vue'
const editPage = 'pages/hr/departments/[departmentId]/edit.vue'
const department = { id: 4, name: 'team', employee_count: 1, parent_id: null, manager: null }
const query = (data: unknown) => ({ data: Vue.ref(data), error: Vue.ref(null), isLoading: Vue.ref(false), isFetching: Vue.ref(false), refetch: vi.fn() })

async function load(file: string, url: RouteLocationRaw, props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    ...['/hr/departments/:departmentId/documents/:documentId/edit','/hr/departments/:departmentId/documents/new','/hr/departments/:departmentId/documents/:documentId','/hr/departments/:departmentId/edit','/hr/departments/:departmentId','/:pathMatch(.*)*'].map(path => ({ path, component: {} })),
  ] })
  await router.push(url)
  const filename = resolve(root, file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'hr-return' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const navigate = vi.fn(async (to: RouteLocationRaw) => router.push(to))
  const bindings = {
    _defineComponent: Vue.defineComponent, onMounted: () => {}, onUnmounted: () => {}, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, nextTick: Vue.nextTick, useId: Vue.useId,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en'), localeProperties: Vue.ref({ dir: 'rtl' }) }),
    useHydrated: () => Vue.ref(true), useAccess: () => ({ can: () => true }), useToast: () => ({ add: vi.fn() }), usePageHeader: () => {},
    useHrDepartment: () => query(department), useHrDepartments: () => query({ items: [department] }), useHrEmployees: () => query({ items: [] }),
    useDeleteHrDepartment: () => ({ mutateAsync: vi.fn(), isPending: Vue.ref(false) }),
    useSsrQuerySeed: () => {}, navigateTo: navigate, returnToQuery, buildDepartmentTree, filterDepartmentTree, fitOrgChart, layoutDepartmentOrgChart, nextOrgScale,
    refDebounced: (value: unknown) => value, hasPendingHrSearch: () => false, hrCommittedListParams: () => ({ q: '', offset: 0 }),
    formatCalendarDate: () => '', ApiError: class extends Error {},
    DocumentList: {}, DocumentReader: {}, DocumentEditor: {}, DocumentCreateForm: {}, DepartmentForm: {}, DepartmentOrgChart: {}, DepartmentTree: {}, DepartmentTable: {}, departmentKpiTiles: () => [], FilterBar: {}, RecordNumber: {},
    ...navigation, ...recordNavigation, provide: Vue.provide, useSlots: () => ({}), FORM_ACTIONS_HOST,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  const emitted = vi.fn()
  const state = scope.run(() => component.setup(props, { expose: () => {}, emit: emitted }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'hr-return', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  async function rendered() {
    const captured: { name: string, props: Record<string, any> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...props, ...Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))) }), render }))
    app.config.globalProperties.$t = (key: string) => key
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.filters?.(), slots.header?.({ close: () => {} }), slots.actions?.(), slots.view?.()]) }
    } }))
    await renderToString(app)
    return captured
  }
  return { state, router, navigate, rendered, emitted, stop: () => scope.stop() }
}
async function prop(page: Awaited<ReturnType<typeof load>>, name: string, predicate = (_props: Record<string, any>) => true) { return (await page.rendered()).find(node => node.name === name && predicate(node.props))!.props }
function target(page: Awaited<ReturnType<typeof load>>) { return page.router.resolve(page.state.backTo.value) }

describe('HR producer to consumer return chain', () => {
  it.each(['canvas','tree','table'])('returns through department detail/edit with %s list state and bounded repeated cycles', async view => {
    const origin = `/hr/departments?view=${view}&q=team&offset=25#position`
    const list = await load('pages/hr/departments/index.vue', origin)
    let selected: RouteLocationRaw
    if (view === 'canvas') {
      const props = await prop(list, 'DepartmentOrgChart')
      const chart = await load('components/hr/DepartmentOrgChart.vue', origin, { roots: props.roots, query: props.query, hydrated: true, returnTo: props['return-to'] })
      selected = (await prop(chart, 'NuxtLink')).to
      chart.stop()
    } else if (view === 'table') {
      const table = await load('components/hr/DepartmentTable.vue', origin, { departments: [department], canManage: true })
      selected = table.state.departmentTo(4)
      table.stop()
    } else {
      list.state.openDepartment(4)
      selected = list.navigate.mock.calls[0]![0]
    }
    const detail = await load(departmentPage, selected)
    expect(target(detail).fullPath).toBe(origin)
    let location: RouteLocationRaw = (await prop(detail, 'UButton', props => props.label === 'hr.depts.edit')).to
    for (let n = 0; n < 5; n++) {
      const edit = await load(editPage, location)
      expect(target(edit).path).toBe('/hr/departments/4')
      expect((await prop(edit, 'DepartmentForm'))['back-to']).toEqual(edit.state.backTo.value)
      edit.state.saved()
      const record = await load(departmentPage, edit.navigate.mock.calls[0]![0])
      expect(target(record).fullPath).toBe(origin)
      const next = (await prop(record, 'UButton', props => props.label === 'hr.depts.edit')).to
      expect(record.router.resolve(next).fullPath).toBe(record.router.resolve(location).fullPath)
      location = next; edit.stop(); record.stop()
    }
    const table = await load('components/hr/DepartmentTable.vue', origin, { departments: [department], canManage: true })
    const directEdit = await load(editPage, table.state.actionsFor(department)[0].to)
    expect(target(directEdit).query.returnTo).toBe(origin)
    for (const page of [list, detail, table, directEdit]) page.stop()
  })
  it('removes nested/invalid list referrers and accepts only exact owning lists', async () => {
    const origin = '/hr/departments?view=tree&returnTo=%2Fsettings%2Fusers#tree'
    const record = await load(departmentPage, { path: '/hr/departments/4', query: { returnTo: origin } })
    expect(target(record).fullPath).toBe('/hr/departments?view=tree#tree')
    const invalid = await load(departmentPage, { path: '/hr/departments/4', query: { returnTo: '/hr/departments/5', view: 'canvas', q: 'legacy' } })
    expect(target(invalid).query).toEqual({ view: 'canvas', q: 'legacy' })
    for (const page of [record, invalid]) page.stop()
  })
})
