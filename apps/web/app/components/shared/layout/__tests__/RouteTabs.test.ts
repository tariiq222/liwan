import { describe, expect, it } from 'vitest'
import * as sectionTabs from '../../../../utils/sectionTabs'
import { renderShared } from '../../__tests__/helpers/renderShared'

const items = [
  { key: 'project-tab-overview', label: 'Overview', to: '/projects/1', active: false, icon: 'i-lucide-house' },
  { key: 'project-tab-tasks', label: 'Tasks', to: '/projects/1/tasks', active: true },
]
const render = (props: Record<string, unknown>, attrs: Record<string, unknown> = {}) =>
  renderShared('RouteTabs', { ...props, ...attrs }, {}, { modules: { '@/utils/sectionTabs': sectionTabs } })

describe('RouteTabs', () => {
  it('renders a named nav of links with the current one marked once', async () => {
    const html = await render({ items, ariaLabel: 'Project sections' })
    expect(html).toMatch(/<nav[^>]*aria-label="Project sections"/)
    expect(html.match(/<a\b/g)).toHaveLength(2)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/<a[^>]*href="\/projects\/1\/tasks"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/projects\/1\/tasks"/)
  })

  it('keeps each item key as its test id and the root attributes', async () => {
    const html = await render({ items, ariaLabel: 'x' }, { 'data-testid': 'project-workspace-tabs' })
    expect(html).toContain('data-testid="project-workspace-tabs"')
    expect(html).toContain('data-testid="project-tab-overview"')
    expect(html).toContain('data-testid="project-tab-tasks"')
  })

  it('renders an icon only when the item has one, and nothing for no items', async () => {
    expect((await render({ items, ariaLabel: 'x' })).match(/i-lucide-house/g)).toHaveLength(1)
    expect(await render({ items: [], ariaLabel: 'x' })).not.toContain('<nav')
  })
})
