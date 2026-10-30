import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import { loadShared, renderShared } from '../../../../test/helpers/renderShared'

const component = resolve(__dirname, '../ShellContextSubList.vue')
const TooltipStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { text: String, disabled: Boolean },
  setup(props, { slots }) { return () => Vue.h('span', { 'data-tooltip': props.disabled ? undefined : props.text }, slots.default?.()) },
})
const CollapsibleStub = Vue.defineComponent({ props: { open: Boolean }, setup(props, { slots }) { return () => Vue.h('div', [slots.default?.(), props.open ? slots.content?.() : null]) } })
const render = (props: Record<string, unknown>) => renderShared(component, { label: 'Settings', collapsed: false, sections: [], ...props }, {}, { stubs: { UTooltip: TooltipStub, UCollapsible: CollapsibleStub }, modules: { '@vueuse/core': { createReusableTemplate }, './ShellQuickRow.vue': { __esModule: true, default: loadShared(resolve(__dirname, '../ShellQuickRow.vue')) } } })

const sections = [
  { id: 'apps-1', title: 'Applications', items: [
    { id: 'apps', label: 'Apps', icon: 'i-lucide-boxes', to: '/settings/apps', active: true, testId: 'context-link-apps' },
    { id: 'billing', label: 'Billing', icon: 'i-lucide-receipt', to: '/settings/billing', count: 120, testId: 'context-link-billing' },
  ] },
  { id: 'brand-2', title: 'Brand', items: [{ id: 'logo', label: 'Logo', icon: 'i-lucide-image', to: '/settings/logo', testId: 'context-link-logo' }] },
]

describe('ShellContextSubList', () => {
  it('renders nothing without sections', async () => {
    expect(await render({})).not.toContain('liwan-quick-views')
  })

  it('renders one titled, named group per section with the rows test ids', async () => {
    const html = await render({ sections })
    expect(html).toContain('data-testid="context-sub-list"')
    expect(html).toContain('aria-label="Applications"')
    expect(html).toContain('aria-label="Brand"')
    expect(html).toContain('>Applications</h3>')
    expect(html).toContain('data-testid="context-link-apps"')
    expect(html).toContain('data-testid="context-link-logo"')
    expect(html.match(/<a\b/g)).toHaveLength(3)
  })

  it('marks the active row once and caps the count', async () => {
    const html = await render({ sections })
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toContain('99+')
  })

  it('follows the collapsed bar and the drawer surface', async () => {
    expect(await render({ sections, collapsed: true })).toContain('data-expanded="false"')
    const drawer = await render({ sections, surface: 'drawer', testIdPrefix: 'mobile-' })
    expect(drawer).toContain('data-surface="drawer"')
    expect(drawer).toContain('data-testid="mobile-context-sub-list"')
  })

  it('renders the routed nested branch while keeping sibling leaves out of the closed subtree', async () => {
    const link = (id: string) => ({ id, label: id, icon: 'i-lucide-folder', to: `/${id}`, testId: id })
    const tree = [{ id: 'team', title: '', items: [{ ...link('team'), children: [{ ...link('users'), children: [link('active-users')] }, { ...link('roles'), children: [link('role-records')] }] }] }]
    const html = await render({ sections: tree, openPath: ['team', 'users'], hydrated: true })
    expect(html).toContain('href="/active-users"')
    expect(html).not.toContain('href="/role-records"')
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2)
    expect(html).toContain('aria-expanded="false"')
  })
})
