import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import * as startModel from '../../composables/nav/appStartModel'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'

const slot = (tag: string, testid?: string) => Vue.defineComponent({
  inheritAttrs: false,
  props: { title: { type: String, default: '' } },
  setup: (props, { attrs, slots }) => () => Vue.h(tag, { ...attrs, ...(testid ? { 'data-testid': testid } : {}) }, [props.title, slots.default?.(), slots.actions?.(), slots.action?.()]),
})
const stubs = {
  ...DEFAULT_STUBS,
  SharedPageContainer: slot('div'),
  SharedPageHeader: slot('header'),
  SharedEmptyState: slot('div', 'empty'),
  SharedForbiddenState: slot('div', 'forbidden'),
  SharedNotFoundState: slot('div', 'not-found'),
  AppsStartContent: Vue.defineComponent({ props: { attention: { type: Array, default: () => [] }, cards: { type: Array, default: () => [] } }, setup: props => () => Vue.h('div', { 'data-testid': 'content' }, `${props.attention.length}/${props.cards.length}`) }),
}
const messages = { 'services.title': 'خدماتي', 'services.description': 'الإجازات والقسائم والعهد والطلبات في مدخل واحد', 'services.empty': 'لا خدمات متاحة لك الآن', 'nav.apps': 'التطبيقات', 'appStart.open': 'فتح التطبيق', 'nav.sales': 'المبيعات' }

const sales: AppManifest = {
  id: 'sales', feature: 'sales.enabled', routePrefixes: ['/sales'],
  rail: [{ id: 'sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', to: '/sales', order: 90 }],
  nav: [{ to: '/sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', shortcut: '', capability: 'sales.orders.read' }],
}
const identity = (capabilities: string[]) => ({ role: 'employee', capabilities: ['webvue.internal', ...capabilities] })

function renderStart(id: string, capabilities: string[]) {
  const attention: unknown[] = []
  const asked: unknown[] = []
  return withManifests([sales], async () => {
    const html = await renderShared(resolve(import.meta.dirname, '../apps/[id].vue'), {}, {}, {
      messages, stubs,
      globals: { useMe: () => ({ me: Vue.ref(identity(capabilities)) }), useRoute: () => ({ path: `/apps/${id}`, params: { id } }) },
      modules: {
        '@/composables/nav/appStartModel': startModel,
        '@/composables/useAttention': { useAttention: (scope: () => string | null, options: unknown) => { asked.push([scope(), options]); return { rows: Vue.ref(attention) } } },
      },
    })
    return { html, asked }
  })
}

describe('pages/apps/[id].vue', () => {
  it('shows the not-found state for an unknown application', async () => {
    const { html, asked } = await renderStart('nope', ['sales.orders.read'])
    expect(html).toContain('data-testid="not-found"')
    expect(html).not.toContain('data-testid="content"')
    expect(asked).toEqual([[null, { limit: 10 }]])
  })

  it('shows the forbidden state for an application the user cannot reach', async () => {
    const { html, asked } = await renderStart('sales', ['pmo.tasks.read'])
    expect(html).toContain('data-testid="forbidden"')
    expect(html).not.toContain('data-testid="content"')
    expect(asked).toEqual([[null, { limit: 10 }]])
  })

  it('shows the header, the open button and the content for a reachable application', async () => {
    const { html, asked } = await renderStart('sales', ['sales.orders.read'])
    expect(html).toContain('المبيعات')
    expect(html).toMatch(/href="\/sales"[^>]*data-testid="app-start-open"|data-testid="app-start-open"[^>]*href="\/sales"/)
    expect(html).toContain('فتح التطبيق')
    expect(html).toContain('data-testid="content">0/1<')
    expect(asked).toEqual([['sales', { limit: 10 }]])
  })
})
