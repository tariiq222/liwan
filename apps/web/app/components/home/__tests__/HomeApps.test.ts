import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNodes, hostRenderer } from '@liwan/ui/test/helpers/hostRenderer'
import * as launcherModel from '../../../composables/nav/launcherModel'
import * as shellModules from '../../../composables/nav/shellModules'
import { withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'

const file = resolve(import.meta.dirname, '../HomeApps.vue')
const cardFile = resolve(import.meta.dirname, '../../launcher/LauncherCard.vue')

const app = (id: string, order: number, capability: string, top = false): AppManifest => ({
  id, feature: `${id}.enabled`, routePrefixes: [`/${id}`],
  rail: [{ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, order, ...(top ? { fixed: 'top' as const } : {}) }],
  nav: [{ to: `/${id}`, labelKey: `nav.${id}`, icon: 'i-lucide-circle', shortcut: '', capability }],
})
const manifests = [app('tasks', 10, 'tasks.read'), app('finance', 20, 'finance.read'), app('chat', 30, 'chat.read'), app('ai', 40, 'ai.use', true)]
const capabilities = ['tasks.read', 'finance.read', 'chat.read', 'ai.use']
const messages = {
  'home.apps': 'تطبيقاتك', 'nav.tasks': 'المهام', 'nav.finance': 'المالية', 'nav.chat': 'المحادثات', 'nav.ai': 'Liwan AI',
  'launcher.apps.tasks.description': 'مهامك الشخصية',
  'launcher.open': 'فتح التطبيق', 'launcher.pin': 'تثبيت', 'launcher.unpin': 'إزالة', 'launcher.pinLimit': 'الحد', 'launcher.actions': 'إجراءات سريعة',
}
const t = (key: string) => messages[key as keyof typeof messages] ?? key
const te = (key: string) => key in messages

function identity(grants: string[] = capabilities) {
  const features = manifests.map(manifest => manifest.feature)
  return { id: 1, capabilities: grants, platform: { state: 'active', read_only: false, readable_features: features, writable_features: features } }
}

const UTooltip = Vue.defineComponent({
  props: { text: { type: String, default: '' } },
  setup(_, { slots }) { return () => Vue.h('span', slots.default?.()) },
})

function options(grants: string[], pins: string[], atLimit: boolean, toggle: (id: string) => void, hydrated = true) {
  return {
    messages, hydrated,
    globals: {
      useI18n: () => ({ t, te }),
      useMe: () => ({ me: Vue.ref(identity(grants)) }),
      useShellModel: () => ({ railPins: { pins: Vue.ref(pins), atLimit: Vue.ref(atLimit), toggle } }),
    },
    modules: {
      '@/components/launcher/LauncherCard.vue': { __esModule: true, default: loadShared(cardFile, { messages, stubs: { UTooltip } }) },
      '@/composables/nav/launcherModel': launcherModel,
      '@/composables/nav/shellModules': shellModules,
    },
    stubs: { ...DEFAULT_STUBS, UTooltip },
  }
}

const render = (grants = capabilities, pins = ['tasks'], atLimit = false) =>
  withManifests(manifests, () => renderShared(file, {}, {}, options(grants, pins, atLimit, () => undefined)))

const cards = (html: string) => [...html.matchAll(/data-app="([^"]+)"/g)].map(match => match[1])

function mount(grants = capabilities, pins = ['tasks'], atLimit = false) {
  const toggle = vi.fn()
  return withManifests(manifests, () => {
    const app = hostRenderer.createApp(loadShared(file, options(grants, pins, atLimit, toggle)))
    for (const [name, component] of Object.entries({ ...DEFAULT_STUBS, UTooltip })) app.component(name, component as Vue.Component)
    const host = createHostNode()
    app.mount(host)
    return { host, toggle, unmount: () => app.unmount() }
  })
}

describe('HomeApps', () => {
  it('shows the applications section with one card per application and its description', async () => {
    const html = await render()
    expect(html).toContain('data-testid="home-apps"')
    expect(html).toContain('تطبيقاتك')
    expect(cards(html)).toEqual(['tasks', 'finance', 'chat'])
    expect(html).toContain('مهامك الشخصية')
  })

  it('never makes the assistant (fixed at the top of the rail) a card, even when the user may use it', async () => {
    expect(capabilities).toContain('ai.use')
    expect(cards(await render())).not.toContain('ai')
  })

  it('renders nothing at all without a reachable application', async () => {
    const html = await render([])
    expect(html).not.toContain('data-testid="home-apps"')
    expect(html).not.toContain('تطبيقاتك')
  })

  it('toggles the pin of the card it belongs to', () => {
    const view = mount()
    try {
      const pin = findNodes(view.host, node => node.props['data-testid'] === 'launcher-pin' && node.props['aria-label'] === 'إزالة: المهام')[0]
      ;(pin!.props.onClick as () => void)()
      expect(view.toggle).toHaveBeenCalledExactlyOnceWith('tasks')
    } finally {
      view.unmount()
    }
  })

  it('disables the pin of an unpinned card at the pin limit, and keeps a pinned card usable', () => {
    const view = mount(capabilities, ['tasks', 'finance', 'hr', 'meetings', 'documents', 'crm'], true)
    try {
      const pin = (id: string) => findNodes(view.host, node => node.props['data-testid'] === 'launcher-pin' && String(node.props['aria-label']).endsWith(`: ${t(`nav.${id}`)}`))[0]
      expect(pin('tasks')?.props.disabled).toBe(false)
      expect(pin('chat')?.props.disabled).toBe(true)
    } finally {
      view.unmount()
    }
  })
})
