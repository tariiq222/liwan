import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '../../../../test/helpers/renderShared'

const component = resolve(__dirname, '../ShellQuickViews.vue')
const TooltipStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { text: String, disabled: Boolean },
  setup(props, { slots }) { return () => Vue.h('span', { 'data-tooltip': props.disabled ? undefined : props.text }, slots.default?.()) },
})
const render = (props: Record<string, unknown>) => renderShared(component, { label: 'Quick', collapsed: false, views: [], actions: [], ...props }, {}, { stubs: { UTooltip: TooltipStub } })

const views = [
  { id: 'today', label: 'Today', icon: 'i-lucide-sun', to: '/tasks?deadline=today', active: true },
  { id: 'overdue', label: 'Overdue', icon: 'i-lucide-circle-alert', to: '/tasks?deadline=overdue', active: false, count: 120 },
]
const actions = [
  { id: 'new-task', label: 'New task', icon: 'i-lucide-plus', to: '/tasks/new', primary: true },
  { id: 'archived', label: 'Archived', icon: 'i-lucide-archive', to: '/tasks?scope=archived' },
]

describe('ShellQuickViews', () => {
  it('renders nothing when there is nothing to list', async () => {
    expect(await render({})).not.toContain('webvue-quick-views')
  })

  it('renders the views, a divider, then the actions as links with their test ids', async () => {
    const html = await render({ views, actions })
    expect(html).toContain('data-testid="quick-views"')
    expect(html).toContain('data-testid="quick-view-today"')
    expect(html).toContain('data-testid="quick-action-new-task"')
    expect(html.indexOf('quick-view-overdue')).toBeLessThan(html.indexOf('quick-views-divider'))
    expect(html.indexOf('quick-views-divider')).toBeLessThan(html.indexOf('quick-action-new-task'))
    expect(html.match(/<a\b/g)).toHaveLength(4)
  })

  it('marks the active view once and the primary action', async () => {
    const html = await render({ views, actions })
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toMatch(/<a[^>]*data-primary="true"[^>]*data-testid="quick-action-new-task"|<a[^>]*data-testid="quick-action-new-task"[^>]*data-primary="true"/)
  })

  it('caps a large count and leaves out the divider and group that have no rows', async () => {
    const html = await render({ views, actions: [] })
    expect(html).toContain('99+')
    expect(html).not.toContain('quick-views-divider')
    expect(html).not.toContain('quick-actions-list')
  })

  it('reports the collapsed state and gives each row a tooltip only then', async () => {
    const expanded = await render({ views, actions })
    expect(expanded).toContain('data-expanded="true"')
    expect(expanded).not.toContain('data-tooltip')
    const collapsed = await render({ views, actions, collapsed: true })
    expect(collapsed).toContain('data-expanded="false"')
    expect(collapsed.match(/data-tooltip="/g)).toHaveLength(4)
  })

  it('prefixes the test ids for the drawer copy', async () => {
    const html = await render({ views, actions, surface: 'drawer', testIdPrefix: 'mobile-' })
    expect(html).toContain('data-testid="mobile-quick-view-today"')
    expect(html).toContain('data-surface="drawer"')
  })
})
