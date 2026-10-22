import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import * as startModel from '../../composables/nav/servicesStartModel'
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
  ServicesGroups: Vue.defineComponent({ props: { groups: { type: Array, default: () => [] } }, setup: props => () => Vue.h('div', { 'data-testid': 'groups' }, String(props.groups.length)) }),
  AppsStartContent: Vue.defineComponent({ props: { attention: { type: Array, default: () => [] }, cards: { type: Array, default: () => [] } }, setup: props => () => Vue.h('div', { 'data-testid': 'content' }, `${props.attention.length}/${props.cards.length}`) }),
}
const messages = { 'services.title': 'خدماتي', 'services.description': 'الإجازات والقسائم والعهد والطلبات في مدخل واحد', 'services.empty': 'لا خدمات متاحة لك الآن', 'services.browseApps': 'التطبيقات', 'appStart.open': 'فتح التطبيق', 'nav.sales': 'المبيعات' }

const sales: AppManifest = {
  id: 'sales', feature: 'sales.enabled', routePrefixes: ['/sales'],
  rail: [{ id: 'sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', to: '/sales', order: 90 }],
  nav: [{ to: '/sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', shortcut: '', capability: 'sales.orders.read' }],
}
const identity = (capabilities: string[]) => ({ role: 'employee', capabilities: ['webvue.internal', ...capabilities] })

function renderServices(capabilities: string[]) {
  return renderShared(resolve(import.meta.dirname, '../services.vue'), {}, {}, {
    messages, stubs, globals: { useMe: () => ({ me: Vue.ref(identity(capabilities)) }) },
    modules: { '@/composables/nav/servicesStartModel': startModel },
  })
}
function renderStart(id: string, capabilities: string[]) {
  const attention: unknown[] = []
  const asked: unknown[] = []
  return withManifests([sales], async () => {
    const html = await renderShared(resolve(import.meta.dirname, '../apps/[id].vue'), {}, {}, {
      messages, stubs,
      globals: { useMe: () => ({ me: Vue.ref(identity(capabilities)) }), useRoute: () => ({ path: `/apps/${id}`, params: { id } }) },
      modules: {
        '@/composables/nav/servicesStartModel': startModel,
        '@/composables/useAttention': { useAttention: (scope: () => string | null, options: unknown) => { asked.push([scope(), options]); return { rows: Vue.ref(attention) } } },
      },
    })
    return { html, asked }
  })
}

describe('pages/services.vue', () => {
  it('lists the services of the applications the user may use', async () => {
    const html = await renderServices(['hr.leave.request'])
    expect(html).toContain('خدماتي')
    expect(html).toContain('الإجازات والقسائم والعهد والطلبات في مدخل واحد')
    expect(html).toContain('data-testid="groups">1<')
    expect(html).not.toContain('data-testid="empty"')
  })

  it('shows the empty state with a link to the apps when no service is allowed', async () => {
    const html = await renderServices([])
    expect(html).toContain('لا خدمات متاحة لك الآن')
    expect(html).toContain('href="/apps"')
    expect(html).not.toContain('data-testid="groups"')
  })
})

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
