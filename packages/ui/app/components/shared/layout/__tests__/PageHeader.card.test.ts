import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// The open header (DESIGN.md §3): no card, the 64px tile comes from the application the shell published, the tags follow the title,
// the tagline sits under it, the actions close the row on the inline end and the tabs sit on the divider.
function options(app: { icon: string; id?: string; tagline?: string } | null = null): SharedRenderOptions {
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

describe('SharedPageHeader open header', () => {
  it('draws the published application as an app tile before the title', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'الاجتماعات' }, {}, options({ icon: 'i-lucide-calendar-days', id: 'meetings' })))
    expect(html).toContain('data-slot="page-header-chip"')
    expect(html).toContain('liwan-app-tile liwan-app-tile-lg')
    expect(html).toContain('data-app="meetings"')
    expect(html).not.toContain('bg-primary/10')
    expect(html.indexOf('page-header-chip')).toBeLessThan(html.indexOf('الاجتماعات'))
  })

  it('draws no chip outside a shell, and lets `icon` replace the published icon', async () => {
    expect(clean(await renderShared('PageHeader', { title: 'خطط' }, {}, options()))).not.toContain('page-header-chip')
    const html = clean(await renderShared('PageHeader', { title: 'خطط', icon: 'i-lucide-star' }, {}, options()))
    expect(html).toContain('page-header-chip')
    expect(html).toContain('liwan-app-tile')
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

describe('SharedPageHeader open frame', () => {
  it('is a divided open block, with no card, ring or sticky slot', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'العملاء' }, {}, options({ icon: 'i-lucide-handshake', id: 'crm' })))
    expect(html).toContain('border-b border-default')
    for (const gone of ['ring-default', 'bg-default', 'rounded-card', 'data-sticky']) expect(html, gone).not.toContain(gone)
    expect(html).toMatch(/<h1[^>]*font-display[^>]*font-bold[^>]*>العملاء<\/h1>/)
  })

  it('draws the tagline: the description prop wins over the shell tagline, and none without both', async () => {
    const app = { icon: 'i-lucide-handshake', id: 'crm', tagline: 'لا تضيع صفقة بعد اليوم' }
    expect(clean(await renderShared('PageHeader', { title: 'العملاء' }, {}, options(app)))).toMatch(/data-slot="page-header-tagline"[^>]*>لا تضيع صفقة بعد اليوم</)
    expect(clean(await renderShared('PageHeader', { title: 'العملاء', description: 'الفرص المفتوحة' }, {}, options(app)))).toContain('>الفرص المفتوحة</p>')
    expect(clean(await renderShared('PageHeader', { title: 'العملاء' }, {}, options()))).not.toContain('page-header-tagline')
  })

  it('puts the actions at the inline end and the tabs row last, on the divider', async () => {
    const slots = { actions: () => Vue.h('button', { id: 'act' }, 'x'), tabs: () => Vue.h('nav', { id: 'tabs' }) }
    const html = clean(await renderShared('PageHeader', { title: 'العملاء' }, slots, options()))
    expect(html).toContain('ms-auto')
    expect(html).toContain('data-slot="page-header-tabs"')
    expect(html.indexOf('id="act"')).toBeLessThan(html.indexOf('id="tabs"'))
    expect(html).toContain('pb-0')
    expect(clean(await renderShared('PageHeader', { title: 'العملاء' }, {}, options()))).not.toContain('page-header-tabs')
  })

  it('draws the actions and the tabs row alone when the frame owns the heading', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'خطط', hideTitle: true }, { tabs: () => Vue.h('nav', { id: 'tabs' }) }, options()))
    expect(html).toContain('id="tabs"')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('border-b')
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
