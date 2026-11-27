import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../apps/index.vue')
const components = resolve(import.meta.dirname, '../../components')
const section = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
const SharedEmptyState = Vue.defineComponent({ inheritAttrs: false, props: { title: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('div', attrs, props.title) })
const Row = Vue.defineComponent({
  props: { card: { type: Object, default: () => ({}) }, description: { type: String, default: '' }, pinned: Boolean, pinPending: Boolean },
  emits: ['togglePin'],
  setup: (props, { emit }) => () => Vue.h('article', { 'data-app': (props.card as { id: string }).id, 'data-pinned': String(props.pinned), 'data-disabled': String(props.pinPending), onClick: () => emit('togglePin') }, props.description),
})
const AddonRow = Vue.defineComponent({
  props: { addon: { type: Object, default: () => ({}) }, canManage: Boolean, actionPending: Boolean },
  setup: (props) => () => Vue.h('article', {
    'data-addon': (props.addon as { bundleId: string }).bundleId,
    'data-can-manage': String(props.canManage),
    'data-pending': String(props.actionPending),
  }, (props.addon as { nameAr?: string }).nameAr ?? ''),
})
const messages = {
  'nav.apps': 'التطبيقات', 'home.empty': 'لا توجد مساحات عمل', 'launcher.title': 'كل التطبيقات', 'launcher.subtitle': 'ثبّت التطبيقات التي تريدها لتظهر في قائمتك الجانبية.',
  'launcher.included.title': 'الأساسية', 'launcher.included.subtitle': 'مشمولة مع منصة ليوان.', 'launcher.addon.title': 'الإضافية', 'launcher.addon.subtitle': 'تطبيقات متخصصة لشغلك.',
  'launcher.available.title': 'متاحة للإضافة', 'launcher.available.subtitle': 'تطبيقات إضافية يمكنك إضافتها إلى اشتراكك.',
  'launcher.apps.tasks.description': 'مهامك الشخصية',
}
const t = (key: string, params: Record<string, unknown> = {}) => (messages[key as keyof typeof messages] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
const te = (key: string) => key in messages
const card = (id: string, plan: 'included' | 'addon', pinnable = true) => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, pinnable, category: 'team', plan, surface: 'lav', figures: [] })
const sampleAddon = (bundleId: string, appId: string, nameAr: string) => ({
  bundleId, appId, icon: 'i-lucide-users', labelKey: `nav.${appId}`, descriptionKey: null, nameAr, nameEn: appId, fallbackDescription: '',
  primaryPrice: { cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 10000 } }, secondaryPrice: null,
})

function setup({
  cards = [card('ai', 'included', false), card('tasks', 'included'), card('crm', 'addon')],
  pins = ['tasks'],
  hydrated = true,
  addons = [] as Array<ReturnType<typeof sampleAddon>>,
  planOverrides = new Map<string, 'included' | 'addon'>(),
  canManage = false,
} = {}) {
  const toggle = vi.fn()
  const useRailPins = vi.fn(() => ({ pins: Vue.ref(pins), toggle }))
  const usePageHeader = vi.fn()
  const opts = {
    messages,
    stubs: { ...DEFAULT_STUBS, SharedPageContainer: section('main'), SharedEmptyState },
    globals: { useI18n: () => ({ t, te }), useHydrated: () => Vue.ref(hydrated), usePageHeader, ref: Vue.ref, computed: Vue.computed },
    modules: {
      '@/components/home/HomeHello.vue': { __esModule: true, default: loadShared(resolve(components, 'home/HomeHello.vue'), { messages }) },
      '@/components/home/HomeSection.vue': { __esModule: true, default: loadShared(resolve(components, 'home/HomeSection.vue'), { messages }) },
      '@/components/launcher/LauncherRow.vue': { __esModule: true, default: Row },
      '@/components/launcher/LauncherAddonRow.vue': { __esModule: true, default: AddonRow },
      '@/composables/useAppCards': { useAppCards: () => ({ cards: Vue.computed(() => cards) }) },
      '@/composables/useAvailableAddons': {
        useAvailableAddons: () => ({
          addons: Vue.computed(() => addons),
          planOverrides: Vue.computed(() => planOverrides),
          canManage: Vue.computed(() => canManage),
          loading: Vue.computed(() => false),
        }),
      },
      '@/composables/useRailPins': { useRailPins },
    },
  }
  return { opts, toggle, useRailPins, usePageHeader }
}
const rows = (html: string) => [...html.matchAll(/data-app="([^"]+)"/g)].map(match => match[1])

describe('apps page', () => {
  it('has the large heading with the pin line, and the two groups in order with the assistant first', async () => {
    const { opts } = setup()
    const html = await renderShared(file, {}, {}, opts)
    expect(html).toContain('data-testid="apps-page"')
    expect(html).toContain('>كل التطبيقات</h1>')
    expect(html).toContain('ثبّت التطبيقات التي تريدها لتظهر في قائمتك الجانبية.')
    expect(html.indexOf('الأساسية')).toBeLessThan(html.indexOf('الإضافية'))
    expect(rows(html)).toEqual(['ai', 'tasks', 'crm'])
    expect(html).toContain('مهامك الشخصية')
    expect(html.indexOf('data-app="tasks"')).toBeLessThan(html.indexOf('الإضافية'))
    expect(html.indexOf('data-app="crm"')).toBeGreaterThan(html.indexOf('الإضافية'))
  })

  it('leaves out a group that has no application, and says so when there is none at all', async () => {
    const onlyAddons = await renderShared(file, {}, {}, setup({ cards: [card('crm', 'addon')] }).opts)
    expect(onlyAddons).not.toContain('apps-included')
    expect(onlyAddons).toContain('apps-addon')
    const none = await renderShared(file, {}, {}, setup({ cards: [] }).opts)
    expect(none).toContain('data-testid="apps-empty"')
    expect(none).not.toContain('apps-included')
  })

  it('pins only the applications the sidebar does not always show, and marks the pinned ones and never disables a pin once hydrated', async () => {
    const { opts, useRailPins } = setup({ pins: ['tasks'] })
    const html = await renderShared(file, {}, {}, opts)
    expect((useRailPins.mock.calls[0] as unknown as [() => string[]])[0]()).toEqual(['tasks', 'crm'])
    expect(html).toMatch(/data-app="tasks" data-pinned="true" data-disabled="false"/)
    expect(html).toMatch(/data-app="crm" data-pinned="false" data-disabled="false"/)
  })

  it('keeps pins disabled until the page is hydrated', async () => {
    const html = await renderShared(file, {}, {}, setup({ hydrated: false }).opts)
    expect(html).toMatch(/data-app="tasks" data-pinned="true" data-disabled="true"/)
  })

  it('registers its title', async () => {
    const { opts, usePageHeader } = setup()
    await renderShared(file, {}, {}, opts)
    expect((usePageHeader.mock.calls[0] as unknown as [() => string])[0]()).toBe('كل التطبيقات')
  })

  it('renders available add-ons with manage state and hydration gating, and hides the section when empty', async () => {
    const withoutAddons = await renderShared(file, {}, {}, setup({ addons: [] }).opts)
    expect(withoutAddons).not.toContain('data-testid="apps-available"')

    const withAddons = await renderShared(file, {}, {}, setup({
      addons: [sampleAddon('b-hr', 'hr', 'الموارد البشرية')],
      canManage: true,
      hydrated: false,
    }).opts)
    expect(withAddons).toContain('data-testid="apps-available"')
    expect(withAddons).toContain('متاحة للإضافة')
    expect(withAddons).toContain('data-addon="b-hr" data-can-manage="true" data-pending="true"')
  })

  it('reclassifies active cards from live catalog plan overrides', async () => {
    const html = await renderShared(file, {}, {}, setup({
      cards: [card('tasks', 'included'), card('crm', 'addon')],
      planOverrides: new Map([['crm', 'included']]),
    }).opts)
    expect(html).toContain('data-testid="apps-included"')
    expect(html).not.toContain('data-testid="apps-addon"')
    expect(rows(html)).toEqual(['tasks', 'crm'])
  })

  it('does not show the empty state when available add-ons exist even if active cards are empty', async () => {
    const html = await renderShared(file, {}, {}, setup({
      cards: [],
      addons: [sampleAddon('b-hr', 'hr', 'الموارد البشرية')],
    }).opts)
    expect(html).not.toContain('data-testid="apps-empty"')
    expect(html).toContain('data-testid="apps-available"')
  })
})
