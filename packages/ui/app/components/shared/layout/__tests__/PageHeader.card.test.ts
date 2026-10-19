import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// The compact card (DESIGN.md §3): the chip comes from the application the shell published, in the brand colour, the tags follow the title.
function options(app: { icon: string } | null = null): SharedRenderOptions {
  return {
    globals: {
      usePageHeader: vi.fn(),
      useEscapeBack: vi.fn(),
      useFrameOwnsHeading: () => Vue.ref(false),
      usePageApp: () => Vue.readonly(Vue.ref(app)),
    },
  }
}
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedPageHeader card', () => {
  it('draws the published application as a tinted chip before the title', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'الاجتماعات' }, {}, options({ icon: 'i-lucide-calendar-days' })))
    expect(html).toContain('data-slot="page-header-chip"')
    expect(html).toContain('bg-primary/10 text-primary')
    expect(html.indexOf('page-header-chip')).toBeLessThan(html.indexOf('الاجتماعات'))
  })

  it('draws no chip outside a shell, and lets `icon` replace the published icon', async () => {
    expect(clean(await renderShared('PageHeader', { title: 'خطط' }, {}, options()))).not.toContain('page-header-chip')
    const html = clean(await renderShared('PageHeader', { title: 'خطط', icon: 'i-lucide-star' }, {}, options()))
    expect(html).toContain('page-header-chip')
    expect(html).toContain('bg-primary/10 text-primary')
  })

  it('draws tags after the title, a link when the tag has a target, with its test id', async () => {
    const tags = [{ label: 'مؤكد', tone: 'info', testId: 'state-tag' }, { label: 'المشروع', to: '/projects/1' }]
    const html = clean(await renderShared('PageHeader', { title: 'اجتماع', tags }, {}, options()))
    expect(html).toContain('data-testid="state-tag"')
    expect(html).toContain('to="/projects/1"')
    expect(html.indexOf('اجتماع')).toBeLessThan(html.indexOf('مؤكد'))
    expect(html).toMatch(/<h1[^>]*>اجتماع<\/h1>/)
  })
})
