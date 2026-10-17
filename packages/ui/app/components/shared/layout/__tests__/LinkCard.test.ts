import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

describe('SharedLinkCard', () => {
  it('is one link: a 40px round icon chip, the title and the description', async () => {
    const html = await renderShared('LinkCard', { to: '/projects', icon: 'i-lucide-folder-kanban', title: 'PROJECTS', description: 'DESC' })
    expect(html).toMatch(/^<a[^>]*href="\/projects"[^>]*data-slot="link-card"/)
    expect(html).toContain('size-10')
    expect(html).toContain('rounded-full')
    expect(html).toContain('PROJECTS')
    expect(html).toContain('DESC')
    expect(html).toContain('hover:-translate-y-px')
    expect(html).toContain('hover:ring-primary')
    expect(html).toContain('focus-visible:ring-2')
  })

  it('omits the description line when there is none, and tone picks the chip colour', async () => {
    const html = await renderShared('LinkCard', { to: '/x', icon: 'i-lucide-bell', title: 'T', tone: 'warning' })
    expect(html).not.toContain('text-xs text-muted')
    expect(html).toContain('bg-status-warning-soft')
    expect(html).toContain('data-tone="warning"')
  })
})
