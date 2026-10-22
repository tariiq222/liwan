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

async function render(capabilities: string[], query = '') {
  const messages = {
    ...names, 'launcher.title': 'التطبيقات', 'launcher.description': 'تطبيقاتك وأهم إجراءاتك في مكان واحد', 'launcher.search': 'ابحث في التطبيقات',
    'launcher.noResults': 'لا يوجد تطبيق بهذا الاسم.', 'launcher.empty': 'لا توجد تطبيقات',
    'launcher.open': 'فتح التطبيق', 'launcher.actions': 'إجراءات سريعة',
    'launcher.apps.tasks.description': 'مهامك الشخصية',
  }
  const me = Vue.ref(identity(capabilities))
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
    },
  }))
  return html
}

const cards = (html: string) => [...html.matchAll(/data-app="([^"]+)"/g)].map(match => match[1])

describe('launcher page', () => {
  it('shows all reachable applications in manifest order with search and descriptions', async () => {
    const html = await render(['tasks.read', 'finance.read', 'chat.read', 'ai.use'])
    expect(html).toContain('تطبيقاتك وأهم إجراءاتك في مكان واحد')
    expect(cards(html)).toEqual(['tasks', 'finance', 'chat', 'ai'])
    expect(html).toContain('data-testid="launcher-search"')
    expect(html).not.toContain('launcher-pin')
    expect(html).not.toContain('launcher-move')
  })
  it('keeps applications permission-scoped', async () => {
    expect(cards(await render(['chat.read']))).toEqual(['chat'])
    expect(await render([])).toContain('لا توجد تطبيقات')
  })
  it('filters by translated name and keeps the empty-search state', async () => {
    expect(cards(await render(['tasks.read', 'finance.read'], 'مال'))).toEqual(['finance'])
    expect(await render(['tasks.read'], 'zzz')).toContain('لا يوجد تطبيق بهذا الاسم.')
  })
})
