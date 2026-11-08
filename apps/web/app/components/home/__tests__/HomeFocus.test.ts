import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer } from '@liwan/ui/test/helpers/hostRenderer'

const file = resolve(import.meta.dirname, '../HomeFocus.vue')
const dir = (name: string) => resolve(import.meta.dirname, '..', name)
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h(props.to ? 'a' : 'button', { ...attrs, href: props.to || undefined }, props.label) })
const UBadge = Vue.defineComponent({ inheritAttrs: false, props: { label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('span', attrs, props.label) })
const SharedLoadingSkeleton = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'skeleton' }) })
const messages = {
  'home.focus': 'ابدأ بالأهم', 'home.focusSubtitle': 'مرتبة حسب الاستعجال', 'home.viewAll': 'عرض الكل', 'home.focusEmpty': 'لا شيء عاجل الآن.',
  'home.rail.previous': 'السابق', 'home.rail.next': 'التالي', 'nav.myTasks': 'مهامي',
}
const row = (id: number, tone: 'urgent' | 'normal' = 'normal') => ({ id: `r${id}`, label: `بند ${id}`, to: `/x/${id}`, tone, module: 'tasks', work: 'execute' })
const ErrorState = (retry: (callback: () => void) => void) => Vue.defineComponent({ emits: ['retry'], setup: (_, { attrs, emit }) => { retry(() => emit('retry')); return () => Vue.h('div', { ...attrs, role: 'alert' }, 'error') } })

function options({ available = true, pending = false, failed = false, refetch = vi.fn(), retry = (_callback: () => void) => {}, rows = [] as ReturnType<typeof row>[] } = {}) {
  const stubs = { ...DEFAULT_STUBS, NuxtLink, UButton, UBadge, SharedLoadingSkeleton, SharedErrorState: ErrorState(retry) }
  const load = (name: string) => ({ __esModule: true, default: loadShared(dir(name), { messages, stubs, globals: { ref: Vue.ref } }) })
  return {
    messages, stubs,
    modules: {
      '@/components/home/HomeFocusCard.vue': load('HomeFocusCard.vue'),
      '@/components/home/HomeRail.vue': load('HomeRail.vue'),
      '@/components/home/HomeSection.vue': load('HomeSection.vue'),
      '@/composables/nav/shellModules': { shellModuleList: () => [{ id: 'tasks', labelKey: 'nav.myTasks', icon: 'i-lucide-check-square' }] },
      '@/composables/useMyWork': { useMyWork: () => ({ available: Vue.computed(() => available), pending: Vue.computed(() => pending), failed: Vue.computed(() => failed), refetch, rows: Vue.computed(() => rows) }) },
    },
  }
}
const render = (setup = {}) => renderShared(file, {}, {}, options(setup))

describe('HomeFocus', () => {
  it('shows failure instead of an empty success and retries the work providers', async () => {
    const refetch = vi.fn()
    let retry!: () => void
    const html = await render({ failed: true, refetch, retry: (callback: () => void) => { retry = callback } })
    expect(html).toContain('home-focus-error')
    expect(html).not.toContain('home-focus-empty')
    retry()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('draws a card per row in the order it gets them, on a labelled rail, with a link to the whole work page', async () => {
    const html = await render({ rows: [row(1, 'urgent'), row(2), row(3), row(4)] })
    expect(html).toContain('ابدأ بالأهم')
    expect(html).toContain('مرتبة حسب الاستعجال')
    expect(html.match(/data-testid="home-focus-card"/g)).toHaveLength(4)
    expect(html.indexOf('بند 1')).toBeLessThan(html.indexOf('بند 2'))
    expect(html).toContain('>مهامي</small>')
    expect(html).toContain('role="region"')
    expect(html).toMatch(/href="\/work"[^>]*>عرض الكل</)
  })

  it('caps the rail at twelve cards', async () => {
    const html = await render({ rows: Array.from({ length: 20 }, (_, index) => row(index + 1)) })
    expect(html.match(/data-testid="home-focus-card"/g)).toHaveLength(12)
  })

  it('has labelled previous and next arrows', async () => {
    const html = await render({ rows: [row(1)] })
    expect(html).toMatch(/aria-label="السابق"/)
    expect(html).toMatch(/aria-label="التالي"/)
  })

  it('scrolls the rail one way for next and the other for previous', () => {
    const calls: number[] = []
    const opts = options({ rows: [row(1)] })
    opts.modules['@/components/home/HomeRail.vue'] = {
      __esModule: true,
      default: Vue.defineComponent({ setup: (_, { expose, slots }) => { expose({ scrollCards: (direction: number) => calls.push(direction) }); return () => Vue.h('div', slots.default?.()) } }),
    }
    const app = hostRenderer.createApp(loadShared(file, { ...opts, globals: { ref: Vue.ref } }))
    for (const [name, component] of Object.entries(opts.stubs)) app.component(name, component as Vue.Component)
    const host = createHostNode()
    app.mount(host)
    try {
      ;(findNode(host, node => node.props['data-testid'] === 'home-focus-next')!.props.onClick as () => void)()
      ;(findNode(host, node => node.props['data-testid'] === 'home-focus-previous')!.props.onClick as () => void)()
      expect(calls).toEqual([1, -1])
    } finally {
      app.unmount()
    }
  })

  it('says so when there is nothing to start with, and shows a skeleton while loading', async () => {
    expect(await render({ rows: [] })).toContain('لا شيء عاجل الآن.')
    const loading = await render({ pending: true })
    expect(loading).toContain('skeleton')
    expect(loading).not.toContain('home-focus-empty')
  })

  it('is hidden when the user has no work page', async () => {
    expect(await render({ available: false, rows: [row(1)] })).not.toContain('home-focus')
  })
})
