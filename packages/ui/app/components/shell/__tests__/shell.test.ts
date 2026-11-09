import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { dropDuplicatedDescription } from '../../../utils/tooltipDescription'
import { loadShared, renderShared } from '../../../../test/helpers/renderShared'

const file = (name: string) => resolve(import.meta.dirname, `../${name}.vue`)
const passthrough = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h(tag, attrs, slots.default?.()) } })
const slotOnly = Vue.defineComponent({ setup(_, { slots }) { return () => slots.default?.() } })
const stubs = { ShellAppTile: passthrough('span'), ShellTip: slotOnly }
// The real ShellTip over a UTooltip stand-in that draws its tooltip text (role=tooltip) only while the tooltip is enabled.
const tooltipStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { text: String, disabled: Boolean, delayDuration: Number, content: Object },
  setup(props, { slots }) {
    return () => [slots.default?.(), props.disabled ? null : Vue.h('span', { role: 'tooltip', 'data-side': props.content?.side, 'data-delay': props.delayDuration }, props.text)]
  },
})
const tipOptions = (collapsed: boolean, dir = 'rtl') => ({ globals: { useSidebarCollapsed: () => Vue.ref(collapsed), useI18n: () => ({ localeProperties: Vue.ref({ dir }) }) } })
const tipStubs = (collapsed: boolean, dir = 'rtl') => ({ ...stubs, UTooltip: tooltipStub, ShellTip: loadShared(resolve(import.meta.dirname, '../ShellTip.vue'), tipOptions(collapsed, dir)) })
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, icon: 'i-lucide-circle', to: `/${id}`, active: false, testId: `row-${id}`, ...extra })

describe('ShellNavRow', () => {
  const render = (item: Record<string, unknown>) => renderShared(file('ShellNavRow'), { item, testId: 'hook' }, {}, { stubs })

  it('marks the open page with aria-current and the active flag', async () => {
    const html = await render(row('tasks', { active: true }))
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('data-active="true"')
    expect(await render(row('tasks'))).not.toContain('aria-current')
  })

  it('names the link by its label and no longer relies on a native title', async () => {
    const html = await render(row('tasks', { label: 'مهامي' }))
    expect(html).toContain('aria-label="مهامي"')
    expect(html).not.toContain('title=')
    expect(html).toContain('data-testid="hook"')
  })

  describe('name tooltip of the icon-only strip', () => {
    const renderTip = (collapsed: boolean, dir?: string) => renderShared(file('ShellNavRow'), { item: row('tasks', { label: 'مهامي' }) }, {}, { stubs: tipStubs(collapsed, dir) })

    it('shows the label as a tooltip when the sidebar is collapsed, 300ms after hover, on the inline-end side', async () => {
      const html = await renderTip(true)
      expect(html).toContain('role="tooltip"')
      expect(html).toContain('>مهامي</span>')
      expect(html).toContain('data-delay="300"')
      expect(html).toContain('data-side="left"')
      expect(await renderTip(true, 'ltr')).toContain('data-side="right"')
    })

    it('leaves no aria-describedby on the labelled row, and the helper drops Reka\'s link only from labelled triggers', async () => {
      expect(await renderTip(true)).not.toContain('aria-describedby')
      const el = (attrs: Record<string, string>) => {
        const store = { ...attrs }
        return { store, getAttribute: (n: string) => store[n] ?? null, removeAttribute: (n: string) => { delete store[n] } } as unknown as Element & { store: Record<string, string> }
      }
      const labelled = el({ 'aria-describedby': 'tip', 'aria-label': 'مهامي' })
      const unlabelled = el({ 'aria-describedby': 'tip' })
      const tip = { getAttribute: (n: string) => (n === 'role' ? 'tooltip' : null) } as unknown as Element
      dropDuplicatedDescription({ querySelectorAll: () => [labelled], getElementById: () => tip })
      expect(labelled.store['aria-describedby']).toBeUndefined()
      dropDuplicatedDescription({ querySelectorAll: () => [unlabelled], getElementById: () => ({ getAttribute: () => 'note' } as unknown as Element) })
      expect(unlabelled.store['aria-describedby']).toBe('tip')
    })

    it('draws no tooltip when the sidebar is expanded, so the label is never shown twice', async () => {
      expect(await renderTip(false)).not.toContain('role="tooltip"')
    })
  })

  it('draws a bare icon unless the row belongs to an application', async () => {
    expect(await render(row('home'))).toContain('liwan-shell-icon')
    expect(await render(row('crm', { app: 'crm' }))).not.toContain('liwan-shell-icon')
  })

  it('caps the count at 99+ and marks the create action', async () => {
    expect(await render(row('inbox', { count: 4 }))).toContain('>4<')
    expect(await render(row('inbox', { count: 250 }))).toContain('>99+<')
    expect(await render(row('new', { primary: true }))).toContain('data-primary="true"')
  })
})

describe('ShellNavSection', () => {
  const branch = row('planning', { children: [row('all'), row('mine', { active: true })] })
  const render = (items: unknown[], extra: Record<string, unknown> = {}) => renderShared(file('ShellNavSection'), { label: 'المشاريع', items, ...extra }, {}, { stubs: { ...stubs, ShellNavRow: passthrough('a') } })

  it('lists flat rows under a heading with an optional edit link', async () => {
    const html = await render([row('a'), row('b')], { title: 'تطبيقاتي', action: { label: 'تعديل', to: '/apps' } })
    expect(html).toContain('role="group"')
    expect(html).toContain('<h3>تطبيقاتي</h3>')
    expect(html).toContain('تعديل')
  })

  it('opens the branch that holds the current page and shows its children', async () => {
    const html = await render([branch])
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('liwan-side-branch')
    expect(html).toContain('data-testid="submenu-planning"')
  })

  it('keeps a branch closed when the current page is elsewhere', async () => {
    const closed = row('planning', { children: [row('all'), row('mine')] })
    const html = await render([closed])
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('liwan-side-branch')
  })

  it('disables a branch button until hydration', async () => {
    expect(await render([branch], { hydrated: false })).toMatch(/<button[^>]*disabled/)
  })
})

describe('ShellCoreApps', () => {
  const items = [row('home', { label: 'يومي', active: true }), row('tasks', { label: 'مهامي', count: 4 }), row('chat', { label: 'المحادثات', count: 250 })]
  const render = (props: Record<string, unknown> = {}, stubOptions = { stubs: { ...stubs, NuxtLink: passthrough('a') } }) =>
    renderShared(file('ShellCoreApps'), { label: 'التطبيقات الأساسية', items, ...props }, {}, stubOptions)

  it('is a named group with one link per core application to its own page, in the order given', async () => {
    const html = await render()
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="التطبيقات الأساسية"')
    expect(html).toContain('data-testid="core-apps"')
    expect([...html.matchAll(/data-testid="core-app-(\w+)"/g)].map(match => match[1])).toEqual(['home', 'tasks', 'chat'])
    expect(html).toContain('to="/tasks"')
  })

  it('names each tile by its label, with the count in the name, and draws no visible label', async () => {
    const html = await render()
    expect(html).toContain('aria-label="يومي"')
    expect(html).toContain('aria-label="مهامي (4)"')
    expect(html).toContain('aria-label="المحادثات (99+)"')
    expect(html).not.toContain('data-slot="label"')
  })

  it('marks the open application with aria-current and the active flag, and no other', async () => {
    const html = await render()
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/data-active="true"[^>]*data-testid="core-app-home"|data-testid="core-app-home"[^>]*data-active="true"/)
  })

  it('draws the badge only for an item with a count, capped at 99+', async () => {
    const html = await render()
    expect(html.match(/data-slot="badge"/g)).toHaveLength(2)
    expect(html).toContain('>4</span>')
    expect(html).toContain('>99+</span>')
  })

  it('prefixes the test ids for the drawer copy and draws nothing for an empty row', async () => {
    expect(await render({ testIdPrefix: 'mobile-' })).toContain('data-testid="mobile-core-app-tasks"')
    expect(await render({ items: [] })).not.toContain('liwan-side-core')
  })

  it('always shows the name tooltip, below the tile while the sidebar is expanded and on the inline-end side in the strip', async () => {
    const withTips = (collapsed: boolean) => ({ stubs: { ...stubs, NuxtLink: passthrough('a'), UTooltip: tooltipStub, ShellTip: loadShared(resolve(import.meta.dirname, '../ShellTip.vue'), tipOptions(collapsed)) } }) as never
    const expanded = await render({}, withTips(false))
    expect(expanded).toContain('role="tooltip"')
    expect(expanded).toContain('data-side="bottom"')
    expect(expanded).toContain('>مهامي</span>')
    const strip = await render({}, withTips(true))
    expect(strip).toContain('data-side="left"')
  })
})

describe('ShellTabBar', () => {
  const items = [
    { id: 'home', label: 'يومي', icon: 'i-lucide-house', to: '/', active: true },
    { id: 'more', label: 'المزيد', icon: 'i-lucide-layout-grid', active: false, testId: 'mobile-navigation-trigger' },
  ]
  const render = (extra: Record<string, unknown> = {}) => renderShared(file('ShellTabBar'), { items, label: 'التنقل السريع', ...extra })

  it('renders link tabs and a button tab, the open one with aria-current', async () => {
    const html = await render()
    expect(html).toContain('aria-label="التنقل السريع"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('<button')
    expect(html).toContain('data-testid="mobile-navigation-trigger"')
  })

  it('disables the button tab until hydration', async () => {
    expect(await render({ disabled: true })).toMatch(/<button[^>]*disabled/)
  })
})

describe('ShellSlideOver', () => {
  const render = (extra: Record<string, unknown> = {}) => renderShared(file('ShellSlideOver'), { open: true, id: 'slide-over-tasks', title: 'مهامي', closeLabel: 'إغلاق', ...extra }, { default: () => Vue.h('p', 'جسم') }, { modules: { '../../composables/useEscapeBack': { overlayOwnsEscape: () => false } } })

  it('is a non-modal dialog named by its title, with the body and a close button', async () => {
    const html = await render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain('aria-label="مهامي"')
    expect(html).toContain('<h2 class="liwan-slideover-title">مهامي</h2>')
    expect(html).toContain('جسم')
    expect(html).toContain('aria-label="إغلاق"')
  })

  it('links to the full page only when it has one', async () => {
    expect(await render({ allTo: '/my-tasks', allLabel: 'افتح الكل' })).toContain('افتح الكل')
    expect(await render()).not.toContain('liwan-slideover-all')
  })

  it('is hidden, not removed, while closed', async () => {
    expect(await render({ open: false })).toContain('display:none')
  })
})

describe('ShellToolButton', () => {
  const render = (props: Record<string, unknown>) => renderShared(file('ShellToolButton'), { icon: 'i-lucide-bell', label: 'الإشعارات', ...props })

  it('puts the count in the badge and in the accessible name', async () => {
    const html = await render({ badge: 3 })
    expect(html).toContain('aria-label="الإشعارات (3)"')
    expect(html).toContain('>3<')
  })

  it('draws a dot without a number, and nothing for zero', async () => {
    expect(await render({ badge: 'dot' })).toContain('data-dot="true"')
    expect(await render({ badge: 0 })).not.toContain('liwan-tool-badge')
  })

  it('reports the open panel through aria-expanded and aria-controls', async () => {
    const html = await render({ controls: 'slide-over-notifications', open: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="slide-over-notifications"')
  })
})

describe('ShellSidebar motion', () => {
  const render = (props: Record<string, unknown>, slots: Record<string, () => unknown>) => renderShared(file('ShellSidebar'), { label: 'التنقل', homeTo: '/', brandName: 'ليوان', ...props }, { default: () => Vue.h('p', 'صفوف'), ...slots }, { stubs: { NuxtLink: passthrough('a') }, modules: { '../shared/layout/BrandWordmark.vue': { __esModule: true, default: passthrough('span') } } })

  it('keys the body on the mode so switching it swaps the body and never the sidebar', async () => {
    const global = await render({ mode: 'global' }, {})
    const app = await render({ mode: 'app' }, {})
    expect(global).toContain('class="liwan-side-swap" data-mode="global"')
    expect(app).toContain('class="liwan-side-swap" data-mode="app"')
    expect(global).toContain('صفوف')
  })

  it('draws the core icon row in both modes, between the organisation and the body', async () => {
    for (const mode of ['global', 'app']) {
      const html = await render({ mode }, { org: () => Vue.h('div', 'المنشأة'), core: () => Vue.h('div', { class: 'row' }, 'الأيقونات') })
      expect(html.indexOf('المنشأة')).toBeLessThan(html.indexOf('الأيقونات'))
      expect(html.indexOf('الأيقونات')).toBeLessThan(html.indexOf('liwan-side-body'))
    }
    expect(await render({}, {})).not.toContain('الأيقونات')
  })

  it('keeps the brand and the organisation card at the top in either mode, never swapped with the body', async () => {
    for (const mode of ['global', 'app']) {
      const html = await render({ mode }, { org: () => Vue.h('div', 'المنشأة') })
      expect(html.indexOf('liwan-side-brand')).toBeLessThan(html.indexOf('المنشأة'))
      expect(html.indexOf('المنشأة')).toBeLessThan(html.indexOf('liwan-side-swap'))
    }
  })
})

describe('ShellPanelStatus', () => {
  const render = (props: Record<string, unknown>) => renderShared(file('ShellPanelStatus'), { message: 'جارٍ التحميل', ...props })

  it('loads as placeholder rows shaped like panel rows, keeping the message for assistive technology', async () => {
    const html = await render({ kind: 'loading' })
    expect(html).toContain('liwan-panel-loading')
    expect(html.match(/liwan-panel-loading-row/g)).toHaveLength(4)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('<span class="sr-only">جارٍ التحميل</span>')
  })

  it('keeps empty and error as one centred line', async () => {
    expect(await render({ kind: 'empty', message: 'لا شيء' })).toContain('liwan-panel-empty')
    expect(await render({ kind: 'error', message: 'تعذر', retryLabel: 'أعد' })).toContain('role="alert"')
  })
})
