import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../index.vue')
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.label) })
const section = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
const SharedEmptyState = Vue.defineComponent({ inheritAttrs: false, props: { title: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('div', attrs, [props.title, slots.action?.()]) })
const Marker = (testid: string) => Vue.defineComponent({ props: { cards: { type: Array, default: undefined } }, setup: props => () => Vue.h('div', { 'data-testid': testid }, props.cards ? String(props.cards.length) : undefined) })
const messages = { 'nav.home': 'يومي', 'home.empty': 'لا توجد مساحات عمل', 'nav.account': 'الخدمة الذاتية' }

async function render({ cards = [{ id: 'tasks' }] as Array<{ id: string }>, capabilities = ['x'] as unknown } = {}) {
  const navigateTo = vi.fn()
  const usePageHeader = vi.fn()
  const html = await renderShared(file, {}, {}, {
    messages,
    stubs: { ...DEFAULT_STUBS, UButton, SharedPageContainer: section('main'), SharedEmptyState },
    globals: { useMe: () => ({ me: Vue.ref({ name: 'سارة', capabilities }), ready: Promise.resolve() }), navigateTo, usePageHeader },
    modules: {
      '@/components/home/HomeGreeting.vue': { __esModule: true, default: Marker('greeting') },
      '@/components/home/HomeAssistantBanner.vue': { __esModule: true, default: Marker('banner') },
      '@/components/home/HomeIndicators.vue': { __esModule: true, default: Marker('indicators') },
      '@/components/home/HomeFocus.vue': { __esModule: true, default: Marker('focus') },
      '@/components/home/HomeApps.vue': { __esModule: true, default: Marker('home-apps') },
      '@/composables/useAppCards': { useAppCards: () => ({ cards: Vue.computed(() => cards) }) },
      '@/utils/accessPolicy': { postLoginPath: () => '/login' },
    },
  })
  return { html, navigateTo, usePageHeader }
}
const at = (html: string, testid: string) => html.indexOf(`data-testid="${testid}"`)

describe('home page', () => {
  it('is «يومي»: the greeting, the assistant banner, the indicators, what to start with, then the applications', async () => {
    const { html } = await render()
    expect(html).toContain('data-testid="foundation-home"')
    const order = ['greeting', 'banner', 'indicators', 'focus', 'home-apps'].map(testid => at(html, testid))
    expect(order.every(position => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(html).not.toContain('home-empty-')
  })

  it('hands the applications it may show to the applications section, and registers its title', async () => {
    const { html, usePageHeader } = await render({ cards: [{ id: 'tasks' }, { id: 'crm' }] })
    expect(html).toMatch(/data-testid="home-apps">2</)
    expect((usePageHeader.mock.calls[0] as unknown as [() => string])[0]()).toBe('يومي')
  })

  it('has no quick-action pills, no suggestions card and no separate applications link', async () => {
    const { html } = await render()
    for (const gone of ['home-quick-actions', 'home-services', 'home-assistant-suggestions', 'home-all-apps', 'href="/apps"']) expect(html).not.toContain(gone)
  })

  it('with no reachable application, explains it and links to the account page', async () => {
    const { html } = await render({ cards: [] })
    expect(html).toMatch(/data-testid="home-empty-no-apps"[^>]*>لا توجد مساحات عمل/)
    expect(html).toMatch(/href="\/account"[^>]*>الخدمة الذاتية</)
    expect(html).not.toContain('data-testid="home-apps"')
  })

  it('sends someone whose identity has no capability list on to their landing page', async () => {
    expect((await render({ capabilities: null })).navigateTo).toHaveBeenCalledWith('/login')
    expect((await render()).navigateTo).not.toHaveBeenCalled()
  })
})
