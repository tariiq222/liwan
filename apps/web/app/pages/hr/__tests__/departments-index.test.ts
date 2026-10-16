import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

const settled = () => new Promise<void>(resolve => setTimeout(resolve, 0))
import { buildDepartmentTree } from '../../../lib/departmentTree'
import { listViewQuery } from '@nasq/ui/app/utils/listView'

// The departments list is the one HR surface with three presentations behind a
// single route. Its real <script setup> is evaluated against a real router, and
// its real template is rendered from that state.
const filename = resolve(import.meta.dirname, '../departments/index.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor

class TestApiError extends Error {
  status: number
  code: string
  constructor(status: number, code = 'http_error', message = 'failed') {
    super(message)
    this.status = status
    this.code = code
  }
}

const DEPARTMENTS = [
  { id: 1, name: 'الإدارة العامة', parent_id: null, manager: { id: 9, name: 'نورة' }, child_ids: [2], employee_count: 12 },
  { id: 2, name: 'التقنية', parent_id: 1, manager: null, child_ids: [], employee_count: 4 },
]

function evaluate(router: Router, options: { can?: (capability: string) => boolean; deleteDepartment?: () => Promise<unknown> } = {}) {
  const compiled = compileScript(descriptor, { id: 'departments-index', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const toasts: unknown[] = []
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params)[0]}` : key) }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: options.can ?? (() => true) }),
    useToast: () => ({ add: (toast: unknown) => toasts.push(toast) }),
    navigateTo: vi.fn(),
    returnToQuery: (value: string) => ({ returnTo: value }),
    ApiError: TestApiError,
    buildDepartmentTree,
    useHrDepartments: () => ({
      data: Vue.ref({ items: DEPARTMENTS, total: DEPARTMENTS.length }),
      isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined,
    }),
    useDeleteHrDepartment: () => ({
      mutateAsync: options.deleteDepartment ?? vi.fn(async () => ({})),
      isPending: Vue.ref(false),
    }),
  }
  // The child components were stripped with the imports but are still named in
  // the compiled output. The template resolves them by name from the app, so a
  // placeholder is enough here; none of them feeds the state under test.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
      const state = component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, any>
      return { state, toasts, navigateTo: bindings.navigateTo as ReturnType<typeof vi.fn> }
    }
    catch (cause) {
      const missing = cause instanceof ReferenceError ? /(\w+) is not defined/.exec(cause.message)?.[1] : undefined
      if (missing && !(missing in bindings)) { bindings[missing] = {}; continue }
      throw cause
    }
  }
  throw new Error('departments/index.vue: too many undefined bindings')
}

async function at(url: string, options?: Parameters<typeof evaluate>[1]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/hr/departments', component: { template: '<div/>' } },
      { path: '/:rest(.*)', component: { template: '<div/>' } },
    ],
  })
  await router.push(url)
  await router.isReady()
  return { router, ...evaluate(router, options) }
}

const Slotted = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, [slots.search?.(), slots.view?.(), slots.active?.(), slots.default?.()])
  },
})
const ListPage = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', { 'data-list-page': '', 'data-views': JSON.stringify(attrs.views) }, [slots.filters?.(), slots.default?.()])
  },
})
const Named = (name: string) => defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) { return () => h('div', { 'data-child': name, ...attrs }) },
})

async function render(url: string, options?: Parameters<typeof evaluate>[1]) {
  const { state } = await at(url, options)
  const template = compileTemplate({
    source: descriptor.template!.content, filename, id: 'departments-index',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (template.errors.length) throw template.errors[0]
  const renderFn = new Function('Vue', ts.transpileModule(template.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText)(Vue) as RenderFunction
  const app = createSSRApp({ render: () => h(defineComponent({ setup: () => ({ ...state }), render: renderFn })) })
  for (const [name, stub] of [
    ['SharedListPage', ListPage], ['FilterBar', Slotted],
    ['SharedPageState', Slotted], ['SharedInlineConfirm', Named('confirm')], ['SharedFilterChip', Named('chip')],
    ['UInput', Named('search')], ['DepartmentTree', Named('tree')], ['DepartmentTable', Named('table')],
    ['DepartmentOrgChart', Named('canvas')],
  ] as const) app.component(name, stub)
  app.component('UButton', defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) { return () => h('button', { type: 'button', ...attrs }) },
  }))
  return renderToString(app)
}

describe('the departments list chooses its presentation from the URL', () => {
  it.each([
    ['', 'table', 'hr-departments-view-list'],
    ['?view=tree', 'tree', 'hr-departments-view-tree'],
    ['?view=canvas', 'canvas', 'hr-departments-view-canvas'],
  ])('%s renders the %s view and presses its own control', async (query, child, pressed) => {
    const html = await render(`/hr/departments${query}`)
    expect(html).toContain(`data-child="${child}"`)
    for (const other of ['table', 'tree', 'canvas'].filter(name => name !== child)) {
      expect(html, other).not.toContain(`data-child="${other}"`)
    }
    const views = JSON.parse(/data-views="([^"]*)"/.exec(html)![1]!.replaceAll('&quot;', '"'))
    expect(views.map((v: { value: string }) => v.value)).toEqual(['list', 'tree', 'canvas'])
    expect(views.map((v: { testId: string }) => v.testId)).toContain(pressed)
  })

  it('switches presentation without losing the filter, and drops the parameter for the default', async () => {
    const list = await at('/hr/departments?q=تقن')
    const views = list.state.views.value
    expect(listViewQuery(list.router.currentRoute.value.query, 'tree', views)).toEqual({ q: 'تقن', view: 'tree' })
    expect(listViewQuery(list.router.currentRoute.value.query, 'canvas', views).view).toBe('canvas')
    const back = listViewQuery({ q: 'تقن', view: 'canvas' }, 'list', views)
    expect(back.view, 'the list is the default, not a value').toBeUndefined()
    expect(back.q).toBe('تقن')
    expect((await at('/hr/departments?view=tree&view=canvas')).state.view.value).toBe('tree')
    expect((await at('/hr/departments?view=gantt')).state.view.value).toBe('list')
  })

  it('filters the table by name or manager and counts the active filter', async () => {
    const empty = await at('/hr/departments')
    expect(empty.state.activeFilterCount.value).toBe(0)
    expect(empty.state.filtered.value).toHaveLength(2)

    const byManager = await at('/hr/departments?q=نورة')
    expect(byManager.state.activeFilterCount.value).toBe(1)
    expect(byManager.state.filtered.value.map((row: { id: number }) => row.id)).toEqual([1])

    const byName = await at('/hr/departments?q=التقنية')
    expect(byName.state.filtered.value.map((row: { id: number }) => row.id)).toEqual([2])

    byName.state.clearFilters()
    await settled()
    expect(byName.router.currentRoute.value.query.q).toBeUndefined()
  })
})

describe('the departments list gates its writes on capabilities', () => {
  it('opens, edits and adds a child through routes that carry the way back', async () => {
    const list = await at('/hr/departments?view=tree&q=تقن')
    list.state.openDepartment(2)
    list.state.editDepartment(2)
    list.state.createChild(1)
    const [open, edit, child] = list.navigateTo.mock.calls.map(call => call[0])
    expect(open).toEqual({ path: '/hr/departments/2', query: { returnTo: '/hr/departments?view=tree&q=تقن' } })
    expect(edit.path).toBe('/hr/departments/2/edit')
    expect(child).toMatchObject({ path: '/hr/departments/new', query: { parent_id: 1 } })
  })

  it('refuses a delete without the manage capability, even once confirmed', async () => {
    const deleteDepartment = vi.fn(async () => ({}))
    const reader = await at('/hr/departments', { can: capability => capability !== 'hr.departments.manage', deleteDepartment })
    reader.state.askDelete(DEPARTMENTS[0])
    await reader.state.confirmDelete()
    expect(deleteDepartment, 'the page is the second gate, after the server').not.toHaveBeenCalled()

    const manager = await at('/hr/departments', { deleteDepartment })
    manager.state.askDelete(DEPARTMENTS[0])
    await manager.state.confirmDelete()
    expect(deleteDepartment).toHaveBeenCalledWith(1)
    expect(manager.state.deleting.value, 'the confirmation closes on success').toBeNull()
    expect(manager.toasts).toHaveLength(1)
  })

  it('keeps the confirmation open and explains a failed delete', async () => {
    const manager = await at('/hr/departments', {
      deleteDepartment: vi.fn(async () => { throw new TestApiError(409, 'conflict', 'الإدارة غير فارغة') }),
    })
    manager.state.askDelete(DEPARTMENTS[0])
    await manager.state.confirmDelete()
    expect(manager.state.deleting.value).not.toBeNull()
    expect(manager.state.deleteError.value?.message).toBe('الإدارة غير فارغة')
    expect(manager.toasts).toHaveLength(0)
  })

  it('hands the tree its own read capabilities rather than one blanket flag', async () => {
    const html = await render('/hr/departments?view=tree', {
      can: capability => capability === 'hr.employees.read',
    })
    expect(html).toContain('data-child="tree"')
    expect(html).toContain('can-read-employees="true"')
    expect(html).not.toContain('can-manage="true"')
    expect(html).not.toContain('can-read-documents="true"')
  })
})
