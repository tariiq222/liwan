import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DepartmentTreeNode } from '../../../lib/departmentTree'
import { layoutDepartmentOrgChart, nextOrgScale } from '../../../lib/departmentOrgChart'

// The layout itself is proven in lib/__tests__/departmentOrgChart.test.ts; what
// is rendered from it is proven here — the canvas is the one HR surface with no
// Playwright coverage.
const filename = resolve(import.meta.dirname, '../DepartmentOrgChart.vue')

// Declaring a prop here would swallow the attribute under test, so the stub
// takes nothing and forwards everything the component set.
const Button = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h('button', { type: 'button', ...attrs })
  },
})
const Link = defineComponent({
  props: { to: { type: [String, Object], default: '#' } },
  setup(props, { slots, attrs }) {
    const to = props.to as { path?: string }
    return () => h('a', { href: typeof props.to === 'string' ? props.to : to.path ?? '#', ...attrs }, slots.default?.())
  },
})

function node(id: number, name: string, depth: number, children: DepartmentTreeNode[] = [], manager: string | null = null): DepartmentTreeNode {
  return {
    department: {
      id, name, parent_id: depth ? id - 1 : null,
      manager: manager ? { id: id + 100, name: manager } : null,
      child_ids: children.map(child => child.department.id),
      employee_count: depth ? 2 : 5,
    },
    children,
    depth,
  }
}

function loadChart(roots: DepartmentTreeNode[], options: { hydrated?: boolean; fullscreen?: boolean; query?: string } = {}) {
  const parsed = parse(readFileSync(filename, 'utf8'), { filename })
  if (!parsed.descriptor.template) throw new Error('DepartmentOrgChart.vue has no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'department-org-chart',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const render = new Function('Vue', ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText)(Vue) as RenderFunction

  const hydrated = options.hydrated ?? true
  // The real layout, so the rendered nodes are the ones the algorithm places.
  const layout = layoutDepartmentOrgChart(roots, { rtl: true })
  return defineComponent({
    setup: () => ({
      layout, hydrated, rtl: true, scale: 1, fullscreen: options.fullscreen ?? false,
      returnTo: '/hr/departments?view=canvas',
      viewport: ref(null), chartSection: ref(null),
      nextOrgScale,
      returnToQuery: (value: string) => ({ returnTo: value }),
      nodeLabel: (box: { name: string }) => box.name,
      nodeStyle: (box: { depth: number }) => ({ '--depth': String(box.depth) }),
      fit: () => {}, zoomBy: () => {}, toggleFullscreen: () => {},
      onWheel: () => {}, onPointerDown: () => {}, onPointerMove: () => {},
      endDrag: () => {}, onKeydown: () => {},
    }),
    render,
  })
}

async function renderChart(roots: DepartmentTreeNode[], options?: Parameters<typeof loadChart>[1]) {
  const app = createSSRApp({ render: () => h(loadChart(roots, options)) })
  app.config.globalProperties.$t = ((key: string, params?: { count?: number }) => (
    params?.count === undefined ? key : `${key}:${params.count}`
  )) as typeof app.config.globalProperties.$t
  app.component('UButton', Button)
  app.component('UIcon', defineComponent({ setup: () => () => h('span') }))
  app.component('NuxtLink', Link)
  return renderToString(app)
}

const FOREST = [node(1, 'الشركة', 0, [node(2, 'فرع', 1)], 'نورة')]

describe('department org chart canvas', () => {
  it('renders one reachable card per department, carrying the way back', async () => {
    const html = await renderChart(FOREST)
    expect(html).toContain('data-testid="hr-department-org-chart"')
    expect(html).toContain('data-testid="hr-org-node-1"')
    expect(html).toContain('data-testid="hr-org-node-2"')
    expect(html).toContain('الشركة')
    expect(html).toContain('نورة')
    // Every node is a real link to its department, not a click handler.
    expect(html).toContain('href="/hr/departments/1"')
    expect(html).toContain('hr.depts.employeeReason:5')
    // A department with no manager still says so rather than showing a gap.
    expect(html).toContain('hr.depts.noManager')
  })

  it('offers the zoom and fullscreen controls as one labelled group', async () => {
    const html = await renderChart(FOREST)
    expect(html).toContain('role="group"')
    for (const control of ['hr-org-zoom-in', 'hr-org-zoom-out', 'hr-org-zoom-fit', 'hr-org-fullscreen']) {
      expect(html, control).toContain(`data-testid="${control}"`)
    }
    expect(html).toContain('aria-label="hr.depts.fullscreen"')
    const expanded = await renderChart(FOREST, { fullscreen: true })
    expect(expanded).toContain('hr-org-chart-expanded')
    expect(expanded).toContain('aria-label="hr.depts.fullscreenExit"')
  })

  it('keeps the canvas inert until hydration so a first click is never lost', async () => {
    const html = await renderChart(FOREST, { hydrated: false })
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="hr-org-zoom-fit"/)
  })

  it('shows an empty canvas rather than blank space when nothing matches', async () => {
    const html = await renderChart([])
    expect(html).toContain('hr.depts.empty')
    expect(html).not.toContain('data-testid="hr-org-zoom-in"')
  })
})
