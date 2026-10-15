import * as Vue from 'vue'
import { h, type VNode } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as listView from '../../../../utils/listView'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const views = [
  { value: 'table', label: 'Table view', icon: 'i-lucide-list' },
  { value: 'board', label: 'Board view', icon: 'i-lucide-layout-grid' },
]
const slot = <P>(render: (props: P) => VNode) => render as (...args: unknown[]) => VNode
const TooltipStub = Vue.defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) })

function options(query: Record<string, string> = {}, patch: SharedRenderOptions = {}): SharedRenderOptions {
  return {
    modules: { '../../../utils/listView': listView },
    globals: {
      useRoute: () => ({ path: '/tasks', query }),
      usePageArea: () => () => ({ plain: false, area: false, record: false }),
      useRouter: () => ({ replace: vi.fn() }),
      usePageHeader: () => undefined,
      useEscapeBack: () => undefined,
      useFrameOwnsHeading: () => Vue.ref(false),
    },
    stubs: { UTooltip: TooltipStub },
    ...patch,
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

  it('reads the view from the route query and hands it to the list', async () => {
    const html = await renderShared('ListPage', { title: 'Tasks', views }, showView, options({ view: 'board' }))
    expect(html).toContain('view:board')
    expect(html).toMatch(/<button[^>]*aria-label="Board view"[^>]*aria-pressed="true"/)
    expect(html).toMatch(/<button[^>]*aria-label="Table view"[^>]*aria-pressed="false"/)
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
})

describe('SharedViewSwitch', () => {
  it('labels each icon-only option, marks the current one and waits for hydration', async () => {
    const html = await renderShared('ViewSwitch', { modelValue: 'table', options: views }, {}, { hydrated: false, stubs: { UTooltip: TooltipStub } })
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="states.view"')
    expect(html).toMatch(/<button[^>]*aria-label="Table view"[^>]*aria-pressed="true"[^>]*disabled[^>]*data-view="table"/)
    expect(html).toMatch(/<button[^>]*aria-label="Board view"[^>]*aria-pressed="false"[^>]*disabled[^>]*data-view="board"/)
  })

  it('puts an option test id on its button only when the option has one', async () => {
    const withIds = [{ ...views[0]!, testId: 'projects-view-table' }, views[1]!]
    const html = await renderShared('ViewSwitch', { modelValue: 'table', options: withIds }, {}, { stubs: { UTooltip: TooltipStub } })
    expect(html).toMatch(/<button(?=[^>]*data-view="table")(?=[^>]*data-testid="projects-view-table")[^>]*>/)
    expect(html.match(/data-testid=/g)).toHaveLength(1)
  })
})
