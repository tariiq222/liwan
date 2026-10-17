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
const createPage = 'pages/hr/departments/[departmentId]/documents/new.vue'
const documentPage = 'pages/hr/departments/[departmentId]/documents/[documentId].vue'
const documentEditPage = 'pages/hr/departments/[departmentId]/documents/[documentId]/edit.vue'
const department = { id: 4, name: 'team', employee_count: 1, parent_id: null, manager: null }
const document = { id: 9, name: 'Document', body: '', department, attachment_ids: [] }
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
    useHrDocument: () => query(document), useHrDocuments: () => query({ items: [document], total: 1 }),
    useDeleteHrDepartment: () => ({ mutateAsync: vi.fn(), isPending: Vue.ref(false) }),
    useUpdateDocument: () => ({ mutateAsync: vi.fn(async () => document), isPending: Vue.ref(false) }),
    useUploadDocumentAttachment: () => ({ mutateAsync: vi.fn(), isPending: Vue.ref(false) }),
    useCreateDocument: () => ({ mutateAsync: vi.fn(async () => document), isPending: Vue.ref(false) }),
    useSsrQuerySeed: () => {}, navigateTo: navigate, returnToQuery, buildDepartmentTree, filterDepartmentTree, fitOrgChart, layoutDepartmentOrgChart, nextOrgScale,
    refDebounced: (value: unknown) => value, hasPendingHrSearch: () => false, hrCommittedListParams: () => ({ q: '', offset: 0 }),
    formatCalendarDate: () => '', ApiError: class extends Error {},
    DocumentList: {}, DocumentReader: {}, DocumentEditor: {}, DocumentCreateForm: {}, HrIdentityCard: {}, DepartmentForm: {}, DepartmentOrgChart: {}, DepartmentTree: {}, DepartmentTable: {}, HrIdentityCard: {}, FilterBar: {}, RecordNumber: {},
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
      return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.header?.({ close: () => {} }), slots.actions?.(), slots.view?.()]) }
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
    let location: RouteLocationRaw = (await prop(detail, 'UButton')).to
    for (let n = 0; n < 5; n++) {
      const edit = await load(editPage, location)
      expect(target(edit).path).toBe('/hr/departments/4')
      expect((await prop(edit, 'DepartmentForm'))['back-to']).toEqual(edit.state.backTo.value)
      edit.state.saved()
      const record = await load(departmentPage, edit.navigate.mock.calls[0]![0])
      expect(target(record).fullPath).toBe(origin)
      const next = (await prop(record, 'UButton')).to
      expect(record.router.resolve(next).fullPath).toBe(record.router.resolve(location).fullPath)
      location = next; edit.stop(); record.stop()
    }
    const table = await load('components/hr/DepartmentTable.vue', origin, { departments: [department], canManage: true })
    const directEdit = await load(editPage, table.state.actionsFor(department)[0].to)
    expect(target(directEdit).query.returnTo).toBe(origin)
    for (const page of [list, detail, table, directEdit]) page.stop()
  })
  it('keeps document create cancel/panel close and successful create/edit attached to the owning department', async () => {
    const origin = '/hr/departments?view=canvas&q=team&offset=25#canvas'
    const dept = { path: '/hr/departments/4', query: { returnTo: origin, q: 'document', offset: '50' }, hash: '#documents' }
    const producer = await load('components/hr/DocumentList.vue', dept, { departmentId: 4, canWrite: true, embedded: true })
    const create = await load(createPage, (await prop(producer, 'UButton', p => p.label === 'hr.docs.new')).to)
    expect(target(create).fullPath).toBe(producer.router.currentRoute.value.fullPath)
    const formProps = (await prop(create, 'DocumentCreateForm'))
    const form = await load('components/hr/DocumentCreateForm.vue', create.router.currentRoute.value.fullPath, { departmentId: 4, backTo: formProps['back-to'] })
    expect((await prop(form, 'UButton', p => p.label === 'app.cancel')).to).toEqual(create.state.backTo.value)
    const panel = await load(layerFile('app/components/shared/layout/CreatePanel.vue'), create.router.currentRoute.value.fullPath, { title: 'New', backTo: (await prop(create, 'SharedCreatePanel'))['back-to'] })
    await panel.state.onOpenUpdate(false)
    expect(panel.router.currentRoute.value.fullPath).toBe(producer.router.currentRoute.value.fullPath)
    form.state.name.value = 'Created'
    await form.state.submit()
    expect(form.state.dirty.value).toBe(false)
    create.state.saved(form.emitted.mock.calls[0]![1])
    let location = create.navigate.mock.calls[0]![0]
    for (let n = 0; n < 5; n++) {
      const record = await load(documentPage, location)
      expect(target(record).fullPath).toBe(producer.router.currentRoute.value.fullPath)
      const edit = await load(documentEditPage, (await prop(record, 'UButton')).to)
      expect(target(edit).path).toBe('/hr/departments/4/documents/9')
      await edit.state.save()
      expect(edit.state.dirty.value).toBe(false)
      const next = edit.navigate.mock.calls[0]![0]
      expect(edit.router.resolve(next).fullPath).toBe(edit.router.resolve(location).fullPath)
      location = next; record.stop(); edit.stop()
    }
    const record = await load(documentPage, location)
    const returnedDepartment = await load(departmentPage, record.state.backTo.value)
    expect(target(returnedDepartment).fullPath).toBe(origin)
    for (const page of [producer, create, form, panel, record, returnedDepartment]) page.stop()
  })
  it.each(['https://evil.test/hr/departments/4','//evil.test/hr/departments/4','/\\evil.test/hr/departments/4',['/hr/departments/4', '/hr/departments/4'],'/hr/departments/5','/hr/departments/4/edit','/settings/users'].map(returnTo => ({ returnTo })))('rejects foreign/invalid document origin $returnTo while retaining legacy direct query', async ({ returnTo }) => {
    const create = await load(createPage, { path: '/hr/departments/4/documents/new', query: { returnTo, q: 'legacy' }, hash: '#old' })
    expect(target(create).path).toBe('/hr/documents'); expect(target(create).query).toEqual({ q: 'legacy' }); expect(target(create).hash).toBe('#old')
    const edit = await load(documentEditPage, { path: '/hr/departments/4/documents/9/edit', query: { returnTo, q: 'legacy' } })
    expect(target(edit).path).toBe('/hr/departments/4/documents/9'); expect(target(edit).query).toEqual({ q: 'legacy' })
    create.stop(); edit.stop()
  })
  it('removes nested/invalid list referrers and accepts only exact owning lists', async () => {
    const origin = '/hr/departments?view=tree&returnTo=%2Fsettings%2Fusers#tree'
    const record = await load(departmentPage, { path: '/hr/departments/4', query: { returnTo: origin } })
    expect(target(record).fullPath).toBe('/hr/departments?view=tree#tree')
    const invalid = await load(departmentPage, { path: '/hr/departments/4', query: { returnTo: '/hr/departments/5', view: 'canvas', q: 'legacy' } })
    expect(target(invalid).query).toEqual({ view: 'canvas', q: 'legacy' })
    const global = await load(createPage, { path: '/hr/departments/4/documents/new', query: { returnTo: '/hr/documents?q=global&returnTo=%2Fsettings%2Fusers#docs' } })
    expect(target(global).fullPath).toBe('/hr/documents?q=global#docs')
    for (const page of [record, invalid, global]) page.stop()
  })
  it('global document create cancel keeps list filters and its fragment', async () => {
    const create = await load('pages/hr/documents/new.vue', '/hr/documents/new?department_id=4&q=document&offset=50#documents')
    expect(target(create).fullPath).toBe('/hr/documents?department_id=4&q=document&offset=50#documents')
    create.stop()
  })
  it('global document create attaches its saved record to the filtered list', async () => {
    const create = await load('pages/hr/documents/new.vue', '/hr/documents/new?department_id=4&q=document&offset=50#documents')
    create.state.saved(9)
    const record = await load(documentPage, create.navigate.mock.calls[0]![0])
    expect(target(record).fullPath).toBe('/hr/documents?department_id=4&q=document&offset=50#documents')
    create.stop(); record.stop()
  })

})
