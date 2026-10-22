import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { loadShared, renderShared } from '@webvue/ui/test/helpers/renderShared'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'
import * as launcherModel from '../../composables/nav/launcherModel'
import * as shellModules from '../../composables/nav/shellModules'

const page = resolve(__dirname, '../apps/index.vue')
const cardFile = resolve(__dirname, '../../components/launcher/LauncherCard.vue')

const app = (id: string, order: number, capability: string, utility = false): AppManifest => ({
  id, feature: `${id}.enabled`, routePrefixes: [`/${id}`],
  rail: [{ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, order, ...(utility ? { utility } : {}) }],
  nav: [{ to: `/${id}`, labelKey: `nav.${id}`, icon: 'i-lucide-circle', shortcut: '', capability }],
})
const manifests = [app('tasks', 10, 'tasks.read'), app('finance', 20, 'finance.read'), app('chat', 30, 'chat.read'), app('ai', 40, 'ai.use', true)]
const names = { 'nav.tasks': 'المهام', 'nav.finance': 'المالية', 'nav.chat': 'المحادثات', 'nav.ai': 'المساعد' }

function identity(capabilities: string[]) {
  const features = ['tasks.enabled', 'finance.enabled', 'chat.enabled', 'ai.enabled']
  return { id: 1, capabilities, platform: { state: 'active', read_only: false, readable_features: features, writable_features: features } }
}

async function render(capabilities: string[], pinned: string[], query = '') {
  const messages = {
    ...names, 'launcher.title': 'التطبيقات', 'launcher.description': 'افتح تطبيقك أو ثبّته في الشريط', 'launcher.search': 'ابحث في التطبيقات',
    'launcher.noResults': 'لا يوجد تطبيق بهذا الاسم.', 'launcher.empty': 'لا توجد تطبيقات', 'launcher.pin': 'تثبيت في الشريط',
    'launcher.pinned': 'مثبّت', 'launcher.open': 'فتح التطبيق', 'launcher.overview': 'نظرة عامة', 'launcher.order': 'ترتيب',
    'launcher.apps.tasks.description': 'مهامك الشخصية',
  }
  const me = Vue.ref(identity(capabilities))
  const calls: string[] = []
  const Stub = (tag: string, text?: (props: Record<string, string>) => string) => Vue.defineComponent({ inheritAttrs: false, props: { title: String }, setup(props, { attrs, slots }) { return () => Vue.h(tag, attrs, [text ? text(props as Record<string, string>) : '', slots.default?.()]) } })
  const html = await withManifests(manifests, () => renderShared(page, {}, {}, {
    messages,
    stubs: {
      SharedPageContainer: Stub('div'),
      SharedPageHeader: Stub('h1', props => props.title ?? ''),
      SharedEmptyState: Stub('div', props => props.title ?? ''),
      UInput: Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('input', { ...attrs, value: query }) } }),
    },
    globals: {
      useI18n: () => ({ t: (key: string) => (messages as Record<string, string>)[key] ?? key, te: (key: string) => key in messages }),
      useMe: () => ({ me, ready: Promise.resolve() }),
      ref: (value: unknown) => (typeof value === 'string' && query ? Vue.ref(query) : Vue.ref(value)),
    },
    modules: {
      '@webvue/ui/app/components/shared/data/FilterBar.vue': { __esModule: true, default: Vue.defineComponent({ setup(_, { slots }) { return () => Vue.h('div', slots.search?.()) } }) },
      '@/components/launcher/LauncherCard.vue': { __esModule: true, default: loadShared(cardFile, { messages, stubs: {} }) },
      '@/composables/nav/launcherModel': launcherModel,
      '@/composables/nav/shellModules': shellModules,
      '@/composables/useAppPins': { useAppPins: () => ({ pinned: Vue.ref(pinned), toggle: (id: string) => calls.push(`toggle:${id}`), move: (id: string, delta: number) => calls.push(`move:${id}:${delta}`) }) },
    },
  }))
  return html
}

const cards = (html: string) => [...html.matchAll(/data-app="([^"]+)"/g)].map(match => match[1])

describe('launcher page', () => {
  it('shows the title, the description, a search field and one card per reachable application', async () => {
    const html = await render(['tasks.read', 'finance.read', 'chat.read', 'ai.use'], ['finance'])
    expect(html).toMatch(/<h1>التطبيقات/)
    expect(html).toContain('افتح تطبيقك أو ثبّته في الشريط')
    expect(html).toContain('data-testid="launcher-search"')
    expect(cards(html)).toEqual(['finance', 'tasks', 'chat', 'ai'])
    expect(html).toContain('>مهامك الشخصية</p>')
  })

  it('has a polite live region for the new place of a moved card, empty until a move', async () => {
    const html = await render(['tasks.read', 'finance.read'], ['finance', 'tasks'])
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"[^>]*data-testid="launcher-announcement"><\/p>|aria-live="polite"[^>]*role="status"[^>]*data-testid="launcher-announcement"><\/p>/)
  })

  it('shows only the applications the user may reach', async () => {
    const html = await render(['chat.read'], ['chat'])
    expect(cards(html)).toEqual(['chat'])
  })

  it('marks the pinned ones with the pill and the pressed toggle', async () => {
    const html = await render(['tasks.read', 'finance.read'], ['finance'])
    expect(html.match(/launcher-pinned-pill/g)).toHaveLength(1)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1)
  })

  it('filters by name and shows the empty-search state', async () => {
    const found = await render(['tasks.read', 'finance.read'], [], 'مال')
    expect(cards(found)).toEqual(['finance'])
    const none = await render(['tasks.read', 'finance.read'], [], 'zzz')
    expect(cards(none)).toEqual([])
    expect(none).toContain('لا يوجد تطبيق بهذا الاسم.')
  })

  it('shows the empty state when no application is reachable', async () => {
    expect(await render([], [])).toContain('لا توجد تطبيقات')
  })
})
