import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// The compact card (DESIGN.md §3): the chip comes from the application the shell published, the tags follow the title.
function options(accent: { icon: string; accent: string } | null = null): SharedRenderOptions {
  return {
    globals: {
      usePageHeader: vi.fn(),
      useEscapeBack: vi.fn(),
      useFrameOwnsHeading: () => Vue.ref(false),
      usePageAccent: () => Vue.readonly(Vue.ref(accent)),
    },
  }
}
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedPageHeader card', () => {
  it('draws the published application as a tinted chip before the title', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'الاجتماعات' }, {}, options({ icon: 'i-lucide-calendar-days', accent: 'violet' })))
    expect(html).toContain('data-slot="page-header-chip"')
    expect(html).toContain('--accent-violet-bg')
    expect(html.indexOf('page-header-chip')).toBeLessThan(html.indexOf('الاجتماعات'))
  })

  it('draws no chip outside a shell, and lets `icon` replace the published icon', async () => {
    expect(clean(await renderShared('PageHeader', { title: 'خطط' }, {}, options()))).not.toContain('page-header-chip')
    const html = clean(await renderShared('PageHeader', { title: 'خطط', icon: 'i-lucide-star' }, {}, options()))
    expect(html).toContain('page-header-chip')
    expect(html).toContain('--accent-slate-bg')
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

describe('SharedPageHeader KPI toggle', () => {
  // SharedKpiToggle is auto-imported in the app (and tested on its own); here it is a marker element.
  const stubs = { SharedKpiToggle: Vue.defineComponent({ setup: () => () => Vue.h('i', { 'data-kpi-toggle': '' }) }) }
  const actions = { actions: () => Vue.h('button', { id: 'act' }, 'x') }

  it('draws the toggle before the actions only with kpiToggle', async () => {
    const off = clean(await renderShared('PageHeader', { title: 'خطط' }, actions, { ...options(), stubs }))
    expect(off).not.toContain('data-kpi-toggle')
    const html = clean(await renderShared('PageHeader', { title: 'خطط', kpiToggle: true }, actions, { ...options(), stubs }))
    expect(html.indexOf('data-kpi-toggle')).toBeGreaterThan(-1)
    expect(html.indexOf('data-kpi-toggle')).toBeLessThan(html.indexOf('id="act"'))
  })

  it('keeps the toggle when the frame owns the heading (hideTitle)', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'خطط', kpiToggle: true, hideTitle: true }, {}, { ...options(), stubs }))
    expect(html).toContain('data-kpi-toggle')
    expect(html).not.toContain('<h1')
  })
})
