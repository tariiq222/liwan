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

  it('draws a count chip after the label only on the underline variant', async () => {
    const counted = [{ ...items[0]!, count: 12 }, items[1]!]
    const underline = await render({ items: counted, ariaLabel: 'x' })
    expect(underline).toContain('data-slot="route-tab-count"')
    expect(underline).toContain('>12<')
    expect(underline.match(/route-tab-count/g)).toHaveLength(1)
    expect(await render({ items: counted, ariaLabel: 'x', variant: 'pill' })).not.toContain('route-tab-count')
  })

  it('is the 2.5px underline in the application colour, with the strip marked for the page header', async () => {
    const html = await render({ items, ariaLabel: 'x' })
    expect(html).toContain('data-slot="route-tabs"')
    expect(html).toContain('border-b-[2.5px]')
    expect(html).toContain('var(--app-action,var(--primary-solid))')
  })

  it('draws the underline strip by default and the round pill strip for variant pill, with the same links', async () => {
    const underline = await render({ items, ariaLabel: 'x' })
    expect(underline).toContain('border-b border-default')
    expect(underline).not.toContain('rounded-full')
    const pill = await render({ items, ariaLabel: 'x', variant: 'pill' })
    expect(pill).toMatch(/<nav[^>]*rounded-control[^>]*ring-default/)
    expect(pill).toContain('h-8')
    expect(pill).toContain('data-[active=true]:bg-primary/10')
    expect(pill).not.toContain('border-b-2')
    expect(pill.match(/aria-current="page"/g)).toHaveLength(1)
    expect(pill).toContain('data-testid="project-tab-overview"')
  })

  it('never wraps: one scrolling line that fades its edges, for both variants', async () => {
    for (const variant of ['underline', 'pill']) {
      const html = await render({ items, ariaLabel: 'x', variant })
      expect(html, variant).toMatch(/<nav[^>]*flex-nowrap[^>]*overflow-x-auto/)
      expect(html, variant).toMatch(/<nav[^>]*liwan-scroll-fade-x/)
      expect(html, variant).toContain('--tabs-fade-l:0px')
      expect(html, variant).toContain('--tabs-fade-r:0px')
      expect(html, variant).not.toMatch(/flex-wrap/)
    }
    expect(await render({ items, ariaLabel: 'x' })).toContain('shrink-0')
  })

  it('draws the 1px divider on the frame, not on the faded strip, and leaves it out when the header has one', async () => {
    const html = await render({ items, ariaLabel: 'x' })
    expect(html).toMatch(/<div[^>]*data-slot="route-tabs-frame"[^>]*border-b border-default/)
    expect(html).not.toMatch(/<nav[^>]*border-b border-default/)
    expect(await render({ items, ariaLabel: 'x', divider: false })).not.toMatch(/route-tabs-frame[^>]*border-b/)
    expect(await render({ items, ariaLabel: 'x', variant: 'pill' })).not.toMatch(/route-tabs-frame[^>]*border-b/)
  })

  it('draws a separator before an item that asks for one, without making it a link', async () => {
    const html = await render({ items: [items[0]!, { ...items[1]!, separatorBefore: true }], ariaLabel: 'x' })
    expect(html).toMatch(/<span[^>]*role="separator"/)
    expect(html.match(/<a\b/g)).toHaveLength(2)
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf('project-tab-tasks'))
    expect(await render({ items, ariaLabel: 'x' })).not.toContain('role="separator"')
  })
})
