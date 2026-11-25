import * as Vue from 'vue'
import { h, type VNode } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as listView from '../../../../utils/listView'
import { loadShared, renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const views = [
  { value: 'table', label: 'Table view', icon: 'i-lucide-list' },
  { value: 'board', label: 'Board view', icon: 'i-lucide-layout-grid' },
]
const slot = <P>(render: (props: P) => VNode) => render as (...args: unknown[]) => VNode
const TooltipStub = Vue.defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) })

function options(query: Record<string, string> = {}, patch: SharedRenderOptions = {}): SharedRenderOptions {
  const base: SharedRenderOptions = {
    ...patch,
    modules: { '../../../utils/listView': listView, ...patch.modules },
    globals: {
      useRoute: () => ({ path: '/tasks', query }),
      usePageArea: () => () => ({ plain: false, record: false }),
      useRouter: () => ({ replace: vi.fn() }),
      usePageHeader: () => undefined,
      useEscapeBack: () => undefined,
      useFrameOwnsHeading: () => Vue.ref(false),
      useFrameOwnsActions: () => Vue.ref(false),
      useKpiVisibility: () => ({ shown: Vue.ref(true), toggle: vi.fn() }),
      ...patch.globals,
    },
  }
  return {
    ...base,
    stubs: { UTooltip: TooltipStub, SharedKpiToggle: loadShared('KpiToggle', base), ...patch.stubs },
  }
}
const showView = { default: slot<{ view?: string }>(({ view }) => h('p', `view:${view}`)) }

describe('SharedListPage', () => {
  it('passes backTo and backLabel to the header for a back link', async () => {
    const html = await renderShared('ListPage', { title: 'أرشيف', backTo: '/tasks', backLabel: 'عودة' }, {}, options())
    expect(html).toContain('href="/tasks"')
    expect(html).toContain('عودة')
  })
  it('marks its create button for C and keeps it disabled until hydration', async () => {
    const props = { title: 'Tasks', createTo: '/tasks/new', createLabel: 'Create task' }
    const html = await renderShared('ListPage', props, {}, options())
    expect(html).toContain('<h1')
    expect(html).toMatch(/<a[^>]*data-shortcut-create[^>]*aria-keyshortcuts="c"[^>]*href="\/tasks\/new"[^>]*>Create task<\/a>/)
    expect(html).not.toMatch(/<a[^>]*data-shortcut-create[^>]*disabled/)
    const early = await renderShared('ListPage', props, {}, options({}, { hydrated: false }))
    expect(early).toMatch(/<a[^>]*data-shortcut-create[^>]*disabled/)
  })

  it('renders no create button without createTo, and keeps the caller actions', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks' }, { actions: () => h('button', 'Archived') }, options())
    expect(html).not.toContain('data-shortcut-create')
    expect(html).toContain('Archived')
  })

  it('draws no create button and no KPI toggle when the frame owns the primary action', async () => {
    const framed = options({}, { globals: { useFrameOwnsActions: () => Vue.ref(true) } })
    const props = { title: 'Tasks', hideHeader: true, createTo: '/tasks/new', kpiToggle: true }
    const html = await renderShared('ListPage', props, {}, framed)
    expect(html).not.toContain('data-shortcut-create')
    expect(html).not.toContain('kpi-toggle')
    expect(html).not.toContain('page-header')
    // A page with its own header keeps its button even inside a frame that draws actions.
    const own = await renderShared('ListPage', { title: 'Tasks', createTo: '/tasks/new' }, {}, framed)
    expect(own).toContain('data-shortcut-create')
  })

  it('reads the view from the route query and hands it to the list', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', views }, showView, options({ view: 'board' }))
    expect(html).toContain('view:board')
    expect(html).toMatch(/<button(?=[^>]*label="Board view")[^>]*aria-pressed="true"/)
    expect(html).toMatch(/<button(?=[^>]*label="Table view")[^>]*aria-pressed="false"/)
  })

  it('viewsInFilters leaves the switch to the embedded filter bar', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', views, viewsInFilters: true }, showView, options({ view: 'board' }))
    expect(html).toContain('view:board')
    expect(html).not.toContain('aria-label="Board view"')
    expect(html).not.toContain('list-page-toolbar')
  })

  it('falls back to the first view for a query value the list does not offer', async () => {
    expect(await renderShared('ListPage', { title: 'Tasks', views }, showView, options({ view: 'gantt' }))).toContain('view:table')
  })

  it('renders no switch and no view without views', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks' }, showView, options({ view: 'board' }))
    expect(html).toContain('view:undefined')
    expect(html).not.toContain('role="group"')
  })

  it('passes a create test id to the create button', async () => {
    const html = await renderShared('ListPage', { title: 'Projects', createTo: '/projects/new', createTestId: 'project-new' }, {}, options())
    expect(html).toMatch(/<a(?=[^>]*data-testid="project-new")(?=[^>]*data-shortcut-create)[^>]*>/)
  })

  it('hideHeader draws no heading but keeps the create button and the actions', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', hideHeader: true, createTo: '/projects/1/tasks/new' }, { actions: () => h('button', 'Archived') }, options())
    expect(html).not.toMatch(/<h[12]/)
    expect(html).toContain('data-slot="page-header"')
    expect(html).toContain('data-shortcut-create')
    expect(html).toContain('Archived')
  })

  it('hideHeader with no create button and no actions renders no page header', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', hideHeader: true }, showView, options())
    expect(html).not.toContain('data-slot="page-header"')
    expect(html).not.toMatch(/<h[12]/)
  })

  it('renders #kpis after the header and before the toolbar with one automatic kpi-toggle', async () => {
    const html = await renderShared(
      'ListPage',
      { title: 'Meetings' },
      {
        kpis: () => h('div', { 'data-testid': 'kpi-content' }, 'KPI strip'),
        filters: () => h('div', 'Filters'),
        default: () => h('div', 'Rows'),
      },
      options(),
    )
    expect(html).toContain('data-slot="list-page-kpis"')
    expect(html).toContain('data-testid="kpi-content"')
    expect(html.match(/data-testid="kpi-toggle"/g)).toHaveLength(1)
    const headerIndex = html.indexOf('data-slot="page-header"')
    const kpisIndex = html.indexOf('data-slot="list-page-kpis"')
    const toolbarIndex = html.indexOf('data-slot="list-page-toolbar"')
    expect(headerIndex).toBeGreaterThan(-1)
    expect(kpisIndex).toBeGreaterThan(headerIndex)
    expect(toolbarIndex).toBeGreaterThan(kpisIndex)
  })

  it('keeps #kpis content without a kpi-toggle when the frame owns actions and hides the header', async () => {
    const framed = options({}, { globals: { useFrameOwnsActions: () => Vue.ref(true) } })
    const html = await renderShared(
      'ListPage',
      { title: 'Meetings', hideHeader: true },
      { kpis: () => h('div', { 'data-testid': 'kpi-content' }, 'KPI strip') },
      framed,
    )
    expect(html).toContain('data-slot="list-page-kpis"')
    expect(html).toContain('data-testid="kpi-content"')
    expect(html).not.toContain('data-testid="kpi-toggle"')
  })

  it('renders no kpi-toggle without #kpis or kpiToggle, and exactly one with kpiToggle alone', async () => {
    const plain = await renderShared('ListPage', { title: 'Meetings' }, {}, options())
    expect(plain).not.toContain('data-testid="kpi-toggle"')
    expect(plain).not.toContain('data-slot="list-page-kpis"')

    const propOnly = await renderShared('ListPage', { title: 'Meetings', kpiToggle: true }, {}, options())
    expect(propOnly.match(/data-testid="kpi-toggle"/g)).toHaveLength(1)
    expect(propOnly).not.toContain('data-slot="list-page-kpis"')
  })
})

describe('SharedViewSwitch', () => {
  it('labels each option with its icon and text, marks the current one and waits for hydration', async () => {
    const html = await renderShared('ViewSwitch', { modelValue: 'table', options: views }, {}, { hydrated: false, stubs: { UTooltip: TooltipStub } })
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="states.view"')
    expect(html).toMatch(/<button(?=[^>]*label="Table view")[^>]*aria-pressed="true"[^>]*disabled[^>]*data-value="table"/)
    expect(html).toMatch(/<button(?=[^>]*label="Board view")[^>]*aria-pressed="false"[^>]*disabled[^>]*data-value="board"/)
  })

  it('puts an option test id on its button only when the option has one', async () => {
    const withIds = [{ ...views[0]!, testId: 'projects-view-table' }, views[1]!]
    const html = await renderShared('ViewSwitch', { modelValue: 'table', options: withIds }, {}, { stubs: { UTooltip: TooltipStub } })
    expect(html).toMatch(/<button(?=[^>]*data-value="table")(?=[^>]*data-testid="projects-view-table")[^>]*>/)
    expect(html.match(/data-testid=/g)).toHaveLength(1)
  })
})

describe('the injected list view context', () => {
  it('reads its options through a getter, so a view that resolves after the page loads reaches the toolbar', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(import.meta.dirname, '../ListPage.vue'), 'utf8')
    expect(source).toMatch(/provide\(LIST_VIEW_KEY, \{ view, get options\(\) \{ return props\.views \?\? \[\] \}, setView \}\)/)
  })
})
