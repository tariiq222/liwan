import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { HOME_QUICK_LIMIT, homeQuickActions } from '../../composables/nav/homeQuickActions'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../index.vue')
const UButton = Vue.defineComponent({
  inheritAttrs: false,
  props: { to: { type: [String, Object], default: '' }, label: { type: String, default: '' } },
  setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: typeof props.to === 'string' ? props.to : `${(props.to as { path: string }).path}?returnTo=${(props.to as { query: { returnTo: string } }).query.returnTo}` }, [props.label, slots.default?.()]),
})
const section = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
const SharedPageHeader = Vue.defineComponent({ props: { title: { type: String, default: '' } }, setup: (props) => () => Vue.h('h1', props.title) })
const SharedEmptyState = Vue.defineComponent({ inheritAttrs: false, props: { title: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('div', attrs, [props.title, slots.action?.()]) })
const Marker = (testid: string) => Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': testid }) })
const messages = { 'nav.home': 'يومي', 'home.greeting': 'أهلًا {name}', 'home.quick': 'الوصول السريع', 'home.allApps': 'كل التطبيقات', 'home.empty': 'لا توجد مساحات عمل', 'home.openApps': 'التطبيقات', 'home.nothingToday': 'لا شيء لك اليوم', 'nav.account': 'الخدمة الذاتية', 'nav.newTask': 'مهمة جديدة', 'services.title': 'خدماتي' }

async function render({ apps = true, services = false, work = true, commands = [] as Array<{ id: string; to: string; labelKey: string }>, name = 'سارة العتيبي' } = {}) {
  return renderShared(file, {}, {}, {
    messages,
    stubs: {
      ...DEFAULT_STUBS, UButton, SharedPageContainer: section('main'), SharedPageHeader, SharedEmptyState,
      HomeAssistantSuggestions: Marker('suggestions'),
    },
    globals: {
      useMe: () => ({ me: Vue.ref({ name, capabilities: ['x'] }), ready: Promise.resolve() }),
      navigateTo: vi.fn(), onMounted: Vue.onMounted,
    },
    modules: {
      '@/components/home/HomeFocus.vue': { __esModule: true, default: Marker('focus') },
      '@/components/home/HomeIndicators.vue': { __esModule: true, default: Marker('indicators') },
      '@/composables/nav/shellModules': { visibleShellModules: () => [{ id: 'home' }, ...(apps ? [{ id: 'tasks' }] : []), { id: 'settings' }] },
      '@/composables/nav/launcherModel': { reachableApplications: (modules: Array<{ id: string }>) => modules.filter(module => module.id !== 'home' && module.id !== 'settings') },
      '@/composables/nav/homeQuickActions': { HOME_QUICK_LIMIT, homeQuickActions },
      '@/composables/nav/paletteModel': { visibleCommands: () => commands },
      '@/composables/useMyWork': { useMyWork: () => ({ available: Vue.computed(() => work) }) },
      '@/composables/nav/personalModel': { personalEntries: () => (services ? [{ id: 'hr' }] : []) },
      '@/utils/accessPolicy': { postLoginPath: () => '/' },
    },
  })
}

describe('home page', () => {
  it('is «يومي» with the greeting, the indicators, the focus card and the assistant suggestions, and no grid of destinations', async () => {
    const html = await render({ commands: [{ id: 'task', to: '/my-tasks/new', labelKey: 'nav.newTask' }] })
    expect(html).toContain('data-testid="foundation-home"')
    expect(html).toContain('<h1>يومي</h1>')
    expect(html).toContain('أهلًا سارة')
    expect(html).not.toContain('العتيبي')
    for (const part of ['indicators', 'focus', 'suggestions']) expect(html).toContain(`data-testid="${part}"`)
    expect(html).not.toContain('link-card')
    expect(html).not.toContain('home-empty-')
    expect(html).not.toContain('لا شيء لك اليوم')
    expect(html).not.toContain('لا توجد مساحات عمل')
  })

  it('offers the commands the user may run as quick actions that come back home', async () => {
    const html = await render({ commands: [{ id: 'task', to: '/my-tasks/new', labelKey: 'nav.newTask' }] })
    expect(html).toContain('الوصول السريع')
    expect(html).toMatch(/href="\/my-tasks\/new\?returnTo=\/"/)
    expect(html).toContain('مهمة جديدة')
  })

  it('puts the indicators and the focus before the quick actions, and the suggestions after them', async () => {
    const html = await render({ commands: [{ id: 'pmo.task', to: '/tasks/new', labelKey: 'nav.newTask' }] })
    const at = (testid: string) => html.indexOf(`data-testid="${testid}"`)
    expect(at('home-greeting')).toBeLessThan(at('indicators'))
    expect(at('indicators')).toBeLessThan(at('focus'))
    expect(at('focus')).toBeLessThan(at('home-quick-actions'))
    expect(at('home-quick-actions')).toBeLessThan(at('suggestions'))
  })

  it('shows five actions at most, the services link included, and one quiet link to every application', async () => {
    const commands = Array.from({ length: 12 }, (_, index) => ({ id: `app${index}.new`, to: `/app${index}/new`, labelKey: `app${index}` }))
    const html = await render({ commands, services: true })
    expect((html.match(/returnTo=\//g) ?? [])).toHaveLength(4)
    expect(html).toContain('data-testid="home-services"')
    expect(html).toMatch(/href="\/apps"[^>]*data-testid="home-all-apps"|data-testid="home-all-apps"[^>]*href="\/apps"/)
    expect((await render({ commands, services: false }).then(page => page.match(/returnTo=\//g) ?? []))).toHaveLength(5)
  })

  it('links «الخدمة الذاتية» only when the user can see a service', async () => {
    expect(await render({ services: true })).toMatch(/href="\/account"[^>]*>الخدمة الذاتية</)
    expect(await render({ services: false })).not.toContain('home-services')
  })

  it('has no quick-actions section without commands', async () => {
    expect(await render({ commands: [] })).not.toContain('home-quick-actions')
  })

  it('with reachable applications but nothing to show, says there is nothing for today and links to the applications page', async () => {
    const html = await render({ work: false })
    expect(html).toMatch(/data-testid="home-empty-today"[^>]*>لا شيء لك اليوم/)
    expect(html).toMatch(/href="\/apps"[^>]*>التطبيقات</)
    expect(html).not.toContain('لا توجد مساحات عمل')
  })

  it('with no reachable application, explains it and links to the account page', async () => {
    const html = await render({ work: false, apps: false })
    expect(html).toMatch(/data-testid="home-empty-no-apps"[^>]*>لا توجد مساحات عمل/)
    expect(html).toMatch(/href="\/account"[^>]*>الخدمة الذاتية</)
    expect(html).not.toContain('لا شيء لك اليوم')
  })

  it('says there is nothing for today when the only thing on the page is the standing services link', async () => {
    const html = await render({ work: false, services: true })
    expect(html).toContain('data-testid="home-services"')
    expect(html).toMatch(/data-testid="home-empty-today"[^>]*>لا شيء لك اليوم/)
  })

  it('does not show an empty state when only the quick actions exist', async () => {
    const html = await render({ work: false, commands: [{ id: 'task', to: '/my-tasks/new', labelKey: 'nav.newTask' }] })
    expect(html).not.toContain('home-empty-')
  })
})
