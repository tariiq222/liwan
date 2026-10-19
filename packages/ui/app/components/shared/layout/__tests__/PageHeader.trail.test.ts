import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// The trail under the page title (DESIGN.md §3): the shell publishes the ancestors of the current
// route and the page header draws them, with the page's own back target as the nearest step.
function options(ancestors: { label: string; to?: string }[] = []): SharedRenderOptions {
  return {
    globals: {
      usePageHeader: vi.fn(),
      useEscapeBack: vi.fn(),
      useFrameOwnsHeading: () => Vue.ref(false),
      usePageTrail: () => Vue.readonly(Vue.ref(ancestors)),
    },
  }
}
// SSR marks slot boundaries with comments; the assertions read the markup without them.
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedPageHeader trail', () => {
  it('draws the published ancestors under the title, never above it', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'السجل', description: 'مخاطر المشروع' }, {}, options([{ label: 'المشاريع', to: '/projects' }, { label: 'الحوكمة', to: '/projects/7/governance' }])))
    expect(html).toContain('data-testid="page-header-trail"')
    expect(html.indexOf('السجل')).toBeLessThan(html.indexOf('data-testid="page-header-trail"'))
    expect(html).toContain('href="/projects"')
    expect(html).toContain('href="/projects/7/governance"')
  })

  it('drops the current page from the trail: the title above already names it', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'المشاريع' }, {}, options([{ label: 'المشاريع', to: '/projects' }, { label: 'المشاريع' }])))
    expect(html).not.toContain('data-testid="page-header-trail"')
  })

  it('adds the page back target as the nearest step', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'تعديل', backTo: '/projects/7/register', backLabel: 'سجل المخاطر' }, {}, options([{ label: 'المشاريع', to: '/projects' }])))
    expect(html).toContain('href="/projects"')
    expect(html).toContain('href="/projects/7/register"')
    expect(html.indexOf('href="/projects"')).toBeLessThan(html.indexOf('href="/projects/7/register"'))
  })

  it('lets the page back target carry its own filters where it names the nearest ancestor', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'مشروع', backTo: '/projects?q=active', backLabel: 'المشاريع' }, {}, options([{ label: 'المشاريع', to: '/projects' }])))
    expect(html).toContain('href="/projects?q=active"')
    expect(html).not.toContain('href="/projects"')
  })

  it('drops a step that links to the page the reader is already on', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'المشاريع' }, {}, { ...options([{ label: 'المشاريع', to: '/projects' }]), routePath: '/projects' }))
    expect(html).not.toContain('data-testid="page-header-trail"')
  })

  it('draws no trail without ancestors and without a back target', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'مهامي' }, {}, options()))
    expect(html).not.toContain('data-testid="page-header-trail"')
  })
})
