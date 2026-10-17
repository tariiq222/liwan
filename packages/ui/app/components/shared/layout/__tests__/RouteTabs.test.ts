import { describe, expect, it } from 'vitest'
import * as sectionTabs from '../../../../utils/sectionTabs'
import { renderShared } from '../../../../../test/helpers/renderShared'

const items = [
  { key: 'project-tab-overview', label: 'Overview', to: '/projects/1', active: false, icon: 'i-lucide-house' },
  { key: 'project-tab-tasks', label: 'Tasks', to: '/projects/1/tasks', active: true },
]
const render = (props: Record<string, unknown>, attrs: Record<string, unknown> = {}) =>
  renderShared('RouteTabs', { ...props, ...attrs }, {}, { modules: { '../../../utils/sectionTabs': sectionTabs } })

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

  it('draws the underline strip by default and the round pill strip for variant pill, with the same links', async () => {
    const underline = await render({ items, ariaLabel: 'x' })
    expect(underline).toContain('border-b border-default')
    expect(underline).not.toContain('rounded-full')
    const pill = await render({ items, ariaLabel: 'x', variant: 'pill' })
    expect(pill).toMatch(/<nav[^>]*rounded-full[^>]*ring-default/)
    expect(pill).toContain('h-8')
    expect(pill).toContain('data-[active=true]:bg-primary/10')
    expect(pill).not.toContain('border-b-2')
    expect(pill.match(/aria-current="page"/g)).toHaveLength(1)
    expect(pill).toContain('data-testid="project-tab-overview"')
  })
})
