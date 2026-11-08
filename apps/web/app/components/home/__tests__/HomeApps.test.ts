import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNode, findNodes, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import { filterAppCards, presentCategories } from '../../../composables/useAppCards'

const file = resolve(import.meta.dirname, '../HomeApps.vue')
const dir = (name: string) => resolve(import.meta.dirname, '..', name)
const Card = Vue.defineComponent({ props: { card: { type: Object, default: () => ({}) }, description: { type: String, default: '' } }, setup: props => () => Vue.h('article', { 'data-app': (props.card as { id: string }).id }, props.description) })
const messages = {
  'home.apps': 'تطبيقاتك', 'home.appsSubtitle': 'كل تطبيق بأرقامه الحية', 'home.filter.label': 'تصفية التطبيقات', 'home.filter.all': 'الكل', 'home.filter.sales': 'المبيعات والعملاء', 'home.filter.team': 'الفريق والتشغيل',
  'launcher.apps.tasks.description': 'مهامك الشخصية',
}
const t = (key: string) => messages[key as keyof typeof messages] ?? key
const te = (key: string) => key in messages
const card = (id: string, category: 'sales' | 'team') => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, pinnable: true, category, plan: 'addon', surface: 'lav', figures: [] })
const cards = [card('crm', 'sales'), card('tasks', 'team'), card('chat', 'team')]

function options() {
  return {
    messages,
    globals: { useI18n: () => ({ t, te }), ref: Vue.ref, computed: Vue.computed },
    stubs: { ...DEFAULT_STUBS },
    modules: {
      '@/components/home/HomeAppCard.vue': { __esModule: true, default: Card },
      '@/components/home/HomeRail.vue': { __esModule: true, default: loadShared(dir('HomeRail.vue'), { globals: { ref: Vue.ref } }) },
      '@/components/home/HomeSection.vue': { __esModule: true, default: loadShared(dir('HomeSection.vue'), { messages }) },
      '@/composables/useAppCards': { filterAppCards, presentCategories },
    },
  }
}
const render = (list: unknown[] = cards) => renderShared(file, { cards: list }, {}, options())
const apps = (html: string) => [...html.matchAll(/data-app="([^"]+)"/g)].map(match => match[1])

function mount() {
  const app = hostRenderer.createApp(Vue.defineComponent({ render: () => Vue.h(loadShared(file, options()), { cards }) }))
  const host = createHostNode()
  const opts = options()
  for (const [name, component] of Object.entries(opts.stubs)) app.component(name, component as Vue.Component)
  app.mount(host)
  return { host, unmount: () => app.unmount() }
}
const names = (host: HostNode) => findNodes(host, node => node.props['data-app'] !== undefined).map(node => node.props['data-app'])

describe('HomeApps', () => {
  it('shows «تطبيقاتك» as a labelled rail with one card per application and its tagline', async () => {
    const html = await render()
    expect(html).toContain('data-testid="home-apps"')
    expect(html).toContain('تطبيقاتك')
    expect(html).toContain('role="region"')
    expect(apps(html)).toEqual(['crm', 'tasks', 'chat'])
    expect(html).toContain('مهامك الشخصية')
  })

  it('offers the chips «الكل» then each present category, with «الكل» pressed', async () => {
    const html = await render()
    expect(html.match(/<button[^>]*>/g)).toHaveLength(3)
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="home-apps-filter-all"|data-testid="home-apps-filter-all"[^>]*aria-pressed="true"/)
    expect(html.indexOf('الكل')).toBeLessThan(html.indexOf('المبيعات والعملاء'))
    expect(html.indexOf('المبيعات والعملاء')).toBeLessThan(html.indexOf('الفريق والتشغيل'))
  })

  it('offers no chips when only one category is present', async () => {
    const html = await render([card('tasks', 'team'), card('chat', 'team')])
    expect(html).not.toContain('home-apps-filter')
  })

  it('keeps only the cards of the chip that is pressed, and all again on «الكل»', async () => {
    const view = mount()
    try {
      const press = (option: string) => (findNode(view.host, node => node.props['data-testid'] === `home-apps-filter-${option}`)!.props.onClick as () => void)()
      expect(names(view.host)).toEqual(['crm', 'tasks', 'chat'])
      press('team')
      await Vue.nextTick()
      expect(names(view.host)).toEqual(['tasks', 'chat'])
      press('sales')
      await Vue.nextTick()
      expect(names(view.host)).toEqual(['crm'])
      press('all')
      await Vue.nextTick()
      expect(names(view.host)).toEqual(['crm', 'tasks', 'chat'])
    } finally {
      view.unmount()
    }
  })

  it('renders nothing at all without an application', async () => {
    const html = await render([])
    expect(html).not.toContain('data-testid="home-apps"')
    expect(html).not.toContain('تطبيقاتك')
  })
})
