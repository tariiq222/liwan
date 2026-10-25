import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import { DEFAULT_STUBS, loadShared, renderShared } from './helpers/renderShared'
import { createHostNode, findNode, hostRenderer } from './helpers/hostRenderer'
import { useNavigationDisclosure, useNavigationPathDisclosure } from '../app/composables/useNavigationDisclosure'

const component = resolve(__dirname, '../app/components/shell/ShellNavigation.vue')
const item = { id: 'meetings', label: 'Meetings', icon: 'i-lucide-calendar', to: '/meetings', active: true, sections: [{ id: 'links', title: '', items: [] }], views: [], actions: [] }
const wrapper = defineComponent({ props: { open: Boolean, unmountOnHide: { type: Boolean, default: true } }, setup(props, { slots, attrs }) { return () => h('div', attrs, [slots.default?.(), props.open || !props.unmountOnHide ? slots.content?.() : null]) } })
const empty = defineComponent({ setup() { return () => h('div') } })
const options = {
  stubs: { UCollapsible: wrapper, UPopover: wrapper, UTooltip: wrapper },
  modules: {
    '@vueuse/core': { createReusableTemplate },
    '../../composables/useNavigationDisclosure': { useNavigationDisclosure, useNavigationPathDisclosure },
    './ShellContextSubList.vue': { __esModule: true, default: empty },
    './ShellQuickViews.vue': { __esModule: true, default: empty },
    '../shared/layout/BrandWordmark.vue': { __esModule: true, default: empty },
  },
}

describe('shared application navigation', () => {
  it('uses a button for an application submenu and a link for a direct destination', async () => {
    const html = await renderShared(component, {
      items: [{ ...item, id: 'home', label: 'Home', to: '/', sections: [] }, item], activeId: 'meetings', routeKey: '/meetings', expanded: true, hydrated: true, homeTo: '/',
    }, {}, options)
    expect(html).toMatch(/<button[^>]*data-testid="navigation-app-meetings"/)
    expect(html).toMatch(/<a[^>]*data-testid="navigation-app-home"[^>]*href="\/"/)
    expect(html).not.toMatch(/<a[^>]*href="\/meetings"/)
  })
  it('gates application disclosure until hydration', async () => {
    const html = await renderShared(component, { items: [item], activeId: 'meetings', routeKey: '/meetings', expanded: true, hydrated: false, homeTo: '/' }, {}, options)
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="navigation-app-meetings"/)
  })
  it('keeps the context heading static without adding an application disclosure row', async () => {
    const html = await renderShared(component, { items: [item], activeId: 'meetings', routeKey: '/meetings', expanded: true, hydrated: true, homeTo: '/', title: 'Meetings', surface: 'context', hideBrand: true }, {}, options)
    expect(html).toContain('<h2>Meetings</h2>')
    expect(html).not.toContain('data-testid="navigation-app-meetings"')
  })
  it('preserves an active panel and its local search across closing and collapsing', async () => {
    let mounts = 0
    const Panel = defineComponent({ setup() {
      mounts++
      const search = ref('')
      return () => h('input', { 'data-testid': 'panel-search', value: search.value, onInput: (event: { target: { value: string } }) => { search.value = event.target.value } })
    } })
    const props = reactive({ items: [{ ...item, panel: true }], activeId: 'meetings', routeKey: '/meetings', expanded: true, hydrated: true, homeTo: '/', showPanel: true })
    const Navigation = loadShared(component, options)
    const app = hostRenderer.createApp({ render: () => h(Navigation, props, { panel: () => h(Panel) }) })
    for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, ...options.stubs })) app.component(name, stub)
    const host = createHostNode()
    app.mount(host)
    try {
      const input = findNode(host, node => node.props['data-testid'] === 'panel-search')!
      ;(input.props.onInput as (event: { target: { value: string } }) => void)({ target: { value: 'my draft search' } })
      await nextTick()
      const disclosure = findNode(host, node => typeof node.props['onUpdate:open'] === 'function')!
      ;(disclosure.props['onUpdate:open'] as (open: boolean) => void)(false)
      await nextTick()
      ;(disclosure.props['onUpdate:open'] as (open: boolean) => void)(true)
      await nextTick()
      props.expanded = false
      await nextTick()
      const popup = findNode(host, node => typeof node.props['onUpdate:open'] === 'function')!
      ;(popup.props['onUpdate:open'] as (open: boolean) => void)(true)
      await nextTick()
      expect(mounts).toBe(1)
      props.expanded = true
      await nextTick()
      expect(mounts).toBe(1)
      expect(findNode(host, node => node.props['data-testid'] === 'panel-search')?.props.value).toBe('my draft search')
    } finally { app.unmount() }
  })
})
