import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DepartmentTreeNode } from '../../../lib/departmentTree'

const hrRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const treeSource = readFileSync(resolve(hrRoot, 'DepartmentTree.vue'), 'utf8')
const pageSource = readFileSync(resolve(hrRoot, '../../pages/hr/departments/index.vue'), 'utf8')

const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: '#' } },
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
  },
})

const IconStub = defineComponent({
  setup: () => () => h('span', { 'data-icon': 'true' }),
})

function departmentNode(
  id: number,
  name: string,
  depth: number,
  children: DepartmentTreeNode[] = [],
  extra: { manager?: string | null; employee_count?: number } = {},
): DepartmentTreeNode {
  return {
    department: {
      id,
      name,
      parent_id: depth ? id - 1 : null,
      manager: extra.manager ? { id: id + 100, name: extra.manager } : null,
      child_ids: children.map(child => child.department.id),
      employee_count: extra.employee_count ?? 0,
    },
    children,
    depth,
  }
}

function loadTree(displayedNodes: DepartmentTreeNode[], options: {
  selectedId?: number | null
  canManage?: boolean
  canReadEmployees?: boolean
  canReadDocuments?: boolean
  hydrated?: boolean
  isSearching?: boolean
  expandedIds?: number[]
} = {}) {
  const parsed = parse(treeSource, { filename: 'DepartmentTree.vue' })
  if (parsed.errors.length) throw parsed.errors[0]
  if (!parsed.descriptor.template) throw new Error('DepartmentTree.vue has no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename: 'DepartmentTree.vue',
    id: 'department-tree',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  const expanded = new Set(options.expandedIds ?? displayedNodes.filter(node => node.children.length).map(node => node.department.id))
  return defineComponent({
    setup() {
      const selectedId = options.selectedId ?? null
      const canManage = options.canManage ?? true
      const canReadEmployees = options.canReadEmployees ?? true
      const canReadDocuments = options.canReadDocuments ?? true
      const hydrated = options.hydrated ?? true
      const isSearching = options.isSearching ?? false
      const emit = (_event: string, _id: number) => undefined
      const isExpanded = (node: DepartmentTreeNode) => isSearching || expanded.has(node.department.id)
      const toggle = (node: DepartmentTreeNode) => {
        if (!node.children.length) return
        if (expanded.has(node.department.id)) expanded.delete(node.department.id)
        else expanded.add(node.department.id)
      }
      return {
        displayedNodes,
        selectedId,
        canManage,
        canReadEmployees,
        canReadDocuments,
        hydrated,
        isSearching,
        isExpanded,
        toggle,
        emit,
      }
    },
    render,
  })
}

async function renderTree(displayedNodes: DepartmentTreeNode[], options?: Parameters<typeof loadTree>[1]) {
  const app = createSSRApp({ render: () => h(loadTree(displayedNodes, options)) })
  app.config.globalProperties.$t = ((key: string, params?: number | { count?: number }) => {
    const count = typeof params === 'number' ? params : params?.count
    return count === undefined ? key : `${key}:${count}`
  }) as typeof app.config.globalProperties.$t
  app.component('Button', ButtonStub)
  app.component('NuxtLink', NuxtLinkStub)
  app.component('ChevronDown', IconStub)
  app.component('FileText', IconStub)
  app.component('Network', IconStub)
  app.component('Pencil', IconStub)
  app.component('Plus', IconStub)
  app.component('Users', IconStub)
  return renderToString(app)
}

describe('department tree layout and routed actions', () => {
  it('frames the tree, wraps long names, and groups actions on existing routes', async () => {
    expect(treeSource).toContain('nasq-panel min-w-0')
    expect(treeSource).toContain('dept-tree-guide')
    expect(treeSource).toContain('dept-tree-chevron-collapsed')
    expect(treeSource).toContain('rotate(90deg)')
    expect(treeSource).toContain('rotate(-90deg)')
    expect(treeSource).toContain('break-words')
    expect(treeSource).not.toMatch(/truncate font-medium/)
    expect(treeSource).toContain('role="group"')
    expect(treeSource).toContain('max-sm:basis-full')
    expect(treeSource).toContain('--dept-depth')
    expect(treeSource).toContain('/hr?department_id=')
    expect(treeSource).toContain('/hr/documents?department_id=')
    expect(treeSource).toContain('canManage')
    expect(treeSource).toContain('hr.depts.expand')
    expect(treeSource).toContain('hr.depts.collapse')
    expect(treeSource).toContain('filterDepartmentTree')
    expect(treeSource).toMatch(/if \(!query\?\.trim\(\)\) return/)

    expect(pageSource).toContain('role="group"')
    expect(pageSource).toContain('aria-pressed')
    expect(pageSource).toContain('bg-background shadow-sm')
    expect(pageSource).toContain('hr-departments-view-list')
    expect(pageSource).toContain('hr-departments-view-tree')
    expect(pageSource).toContain("view: tree ? 'tree' : undefined")
    expect(pageSource).toContain('@select="openDepartment"')
    expect(pageSource).toContain('@edit="editDepartment"')
    expect(pageSource).toContain('@create-child="createChild"')
    expect(pageSource).toContain("can('hr.departments.manage')")
    expect(pageSource).toContain("can('hr.employees.read')")
    expect(pageSource).toContain("can('hr.documents.read')")

    const longName = 'الإدارة العامة للتخطيط الاستراتيجي والمتابعة المؤسسية في القطاعات التابعة'
    const deep = departmentNode(8, longName, 7, [], { employee_count: 4, manager: 'نورة' })
    const root = departmentNode(1, 'الشركة', 0, [departmentNode(2, 'فرع', 1)], { employee_count: 12 })
    const html = await renderTree([root, deep], { selectedId: 1 })

    expect(html).toContain('data-testid="hr-department-tree"')
    expect(html).toContain('nasq-panel')
    expect(html).toContain('dept-tree-guide')
    expect(html).toContain(longName)
    expect(html).toContain('break-words')
    expect(html).toContain('--dept-depth:7')
    expect(html).toContain('data-depth="7"')
    expect(html).toContain('hr.depts.employeeReason:12')
    expect(html).toContain('hr.depts.childReason:1')
    expect(html).toContain('نورة')
    expect(html).toContain('href="/hr?department_id=1"')
    expect(html).toContain('href="/hr/documents?department_id=8"')
    expect(html).toContain('aria-label="hr.depts.edit"')
    expect(html).toContain('aria-label="hr.depts.newChild"')
    expect(html).toContain(`aria-label="${longName}"`)
    expect(html).toContain('bg-muted/70')
    expect(html).toContain('max-sm:basis-full')
  })

  it('keeps expand disabled while searching and hides writes without manage', async () => {
    const parent = departmentNode(1, 'أصل', 0, [departmentNode(2, 'ابن', 1)])
    const searching = await renderTree([parent], { isSearching: true, canManage: false, canReadEmployees: true, canReadDocuments: false })
    expect(searching).toContain('disabled')
    expect(searching).toContain('aria-expanded="true"')
    expect(searching).toContain('hr.depts.collapse')
    expect(searching).toContain('href="/hr?department_id=1"')
    expect(searching).not.toContain('hr.depts.edit')
    expect(searching).not.toContain('hr.depts.newChild')
    expect(searching).not.toContain('/hr/documents?department_id=')

    const collapsed = await renderTree([parent], { isSearching: false, expandedIds: [], canManage: true })
    expect(collapsed).toContain('aria-expanded="false"')
    expect(collapsed).toContain('hr.depts.expand')
    expect(collapsed).toContain('dept-tree-chevron-collapsed')
  })
})
