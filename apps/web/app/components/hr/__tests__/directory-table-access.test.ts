import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, fakeT } from '@webvue/ui/test/helpers/renderShared'
import { hrAccessBadge } from '../../../utils/hrAccessBadge'

// The server fills an employee's `access` only for a caller holding
// hr.employees.access_status.read. The directory's real <script setup> and template are
// rendered to HTML; SharedDataTable is a stand-in that prints the column ids it receives
// and calls the page's own cell and mobile-row slots for every row.
const filename = resolve(import.meta.dirname, '../DirectoryTable.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const code = ts.transpileModule(compileScript(descriptor, { id: 'directory', inlineTemplate: true }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

const EMPLOYEES = [
  { id: 1, name: 'نورة', job_title: 'محللة', department: { id: 2, name: 'التقنية' }, manager: null, active: true, access: { status: 'active' } },
  { id: 2, name: 'سالم', job_title: null, department: null, manager: null, active: true },
]

const Stub = (name: string) => Vue.defineComponent({ name, inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('div', { 'data-stub': name }, slots.default?.()) } })
const DataTable = Vue.defineComponent({
  props: { rows: { type: Array, required: true }, columns: { type: Array, required: true } },
  setup(props, { slots }) {
    return () => Vue.h('table', [
      Vue.h('thead', (props.columns as { id: string }[]).map(column => Vue.h('th', { 'data-column': column.id }))),
      ...(props.rows as Record<string, unknown>[]).map(row => Vue.h('tr', [
        ...(props.columns as { id: string }[]).map(column => Vue.h('td', { 'data-cell': column.id }, slots[`${column.id}-cell`]?.({ row: { original: row } }))),
        Vue.h('td', { 'data-mobile': '' }, slots['mobile-row']?.({ row })),
      ])),
    ])
  },
})

function load(can: (capability: string) => boolean): Vue.Component {
  const route = { path: '/hr', fullPath: '/hr', query: {}, hash: '' }
  const query = (data: unknown) => ({ data: Vue.ref(data), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined })
  const mutation = () => ({ mutateAsync: async () => undefined, isPending: Vue.ref(false) })
  const modules: Record<string, unknown> = {
    'vue': Vue,
    '@/utils/hrAccessBadge': { hrAccessBadge },
    '@webvue/ui/app/components/shared/data/FilterBar.vue': { __esModule: true, default: Stub('FilterBar') },
    '@/composables/useHrDepartments': { useHrDepartments: () => query({ items: [], total: 0 }) },
    '@/composables/useHrEmployees': { useHrEmployees: () => query({ items: EMPLOYEES, total: EMPLOYEES.length }), useArchiveHrEmployee: mutation, useUnarchiveHrEmployee: mutation },
    '@webvue/ui/app/utils/safeReturnTo': { returnToQuery: (value: string) => ({ returnTo: value }) },
    '@/composables/useHrSearch': { hasPendingHrSearch: () => false, hrCommittedListParams: () => ({ offset: 0 }) },
    '@vueuse/core': { refDebounced: (value: unknown) => value },
  }
  const require = (specifier: string) => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`DirectoryTable.vue imports ${specifier}; add it to the test modules`)
  }
  const globals: Record<string, unknown> = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: fakeT() }), useAccess: () => ({ can }), useHydrated: () => Vue.ref(true),
    useRoute: () => route, useRouter: () => ({ replace: () => undefined }),
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(require, exports, ...Object.values(globals))
  return exports.default!
}

async function render(capabilities: string[]) {
  const app = Vue.createSSRApp({ render: () => Vue.h(load(capability => capabilities.includes(capability))) })
  app.config.globalProperties.$t = fakeT() as never
  app.config.warnHandler = () => undefined
  const slotted = Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('div', [slots.filters?.(), slots.default?.(), slots.footer?.()]) } })
  const badge = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('span', { 'data-testid': attrs['data-testid'], 'data-label': attrs.label }) } })
  for (const [tag, component] of Object.entries({
    ...DEFAULT_STUBS, SharedListCard: slotted, SharedDataTable: DataTable, SharedStatusBadge: badge,
    SharedPersonAvatar: Stub('avatar'), SharedRowActions: Stub('actions'), SharedListFooter: Stub('footer'), SharedEmptyState: Stub('empty'), SharedInlineConfirm: Stub('confirm'),
  })) app.component(tag, component)
  return renderToString(app)
}

describe('the directory account column follows hr.employees.access_status.read', () => {
  it('hides the column, its cells and the mobile badge without the capability', async () => {
    const html = await render(['hr.employees.read'])
    expect(html).toContain('data-column="name"')
    expect(html).toContain('data-column="status"')
    expect(html).not.toContain('data-column="access"')
    expect(html).not.toContain('data-cell="access"')
    expect(html).not.toContain('data-testid="hr-access-badge"')
    expect(html).not.toContain('hr.directory.columns.account')
  })

  it('shows the column and one badge per row in each presentation with the capability', async () => {
    const html = await render(['hr.employees.read', 'hr.employees.access_status.read'])
    expect(html).toContain('data-column="access"')
    expect(html.match(/data-cell="access"/g)).toHaveLength(EMPLOYEES.length)
    // One badge in the table cell and one in the mobile row, for every employee.
    expect(html.match(/data-testid="hr-access-badge"/g)).toHaveLength(EMPLOYEES.length * 2)
  })
})
