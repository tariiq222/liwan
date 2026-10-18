import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { IntegrationConnectionListSchema } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
import { DEFAULT_STUBS, fakeT, loadShared } from '@webvue/ui/test/helpers/renderShared'
import { canReachPath } from '../../utils/accessPolicy'
import { integrationStateBadge } from '../../utils/integrationStateBadge'
import { useNav } from '../../composables/nav/shellModules'
import ar from '../../../i18n/locales/ar/integrations.json'
import en from '../../../i18n/locales/en/integrations.json'

const page = resolve(import.meta.dirname, '../settings/integrations.vue')
const ZATCA = { id: 1, kind: 'zatca', provider: 'ZATCA', state: 'not_configured', last_checked: null, status_message: '' }
const BANK = { id: 2, kind: 'bank', provider: 'Al Rajhi', state: 'error', last_checked: '2030-01-15T10:30:00Z', status_message: 'Certificate expired' }

const stub = (tag: string, slotNames: string[] = []) => Vue.defineComponent({
  inheritAttrs: false,
  props: { title: String, description: String, label: String, tone: String, emptyText: String, loading: Boolean, empty: Boolean },
  setup(props, { attrs, slots }) {
    return () => Vue.h(tag, attrs, [props.title, props.description, props.label, props.loading ? 'loading' : props.empty ? props.emptyText : slots.default?.(), ...slotNames.map(name => slots[name]?.())])
  },
})
const stubs = {
  ...DEFAULT_STUBS,
  SharedListPage: stub('main'), SharedListCard: stub('section'), SharedPageState: stub('div'),
  SharedForbiddenState: stub('p'), SharedStatusBadge: stub('b'),
}

async function render(options: { capabilities: string[]; items?: unknown[] }) {
  const messages = flatten(ar)
  const component = loadShared(page, {
    messages,
    modules: {
      '@webvue/ui/app/utils/formatDate': { formatDateTime },
      '@webvue/ui/app/utils/statusBadge': { badgeLabel },
      '@/composables/useIntegrationConnections': {
        useIntegrationConnections: () => ({ data: Vue.ref({ items: options.items ?? [], total: options.items?.length ?? 0 }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined }),
      },
      '@/utils/integrationStateBadge': { integrationStateBadge },
    },
    globals: { useAccess: () => ({ can: (key: string) => options.capabilities.includes(key) }) },
  })
  const app = Vue.createSSRApp({ render: () => Vue.h(component) })
  app.config.globalProperties.$t = fakeT(messages) as never
  for (const [tag, impl] of Object.entries(stubs)) app.component(tag, impl)
  return renderToString(app)
}

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value as Record<string, unknown>, path) }
  }, {})
}

describe('/settings/integrations', () => {
  it('lists each connection with kind, provider, state, last check and message', async () => {
    expect(IntegrationConnectionListSchema.safeParse({ items: [ZATCA, BANK], total: 2 }).success).toBe(true)
    const html = await render({ capabilities: ['integrations.read'], items: [ZATCA, BANK] })
    expect(html).toContain(ar.integrations.kind.zatca)
    expect(html).toContain(ar.integrations.kind.bank)
    expect(html).toContain('Al Rajhi')
    expect(html).toContain(ar.integrations.state.not_configured)
    expect(html).toContain(ar.integrations.state.error)
    expect(html).toContain(ar.integrations.neverChecked)
    expect(html).toContain(ar.integrations.lastChecked.replace('{at}', formatDateTime('2030-01-15T10:30:00Z')))
    expect(html).toContain('Certificate expired')
  })

  it('shows the empty state when there is no connection', async () => {
    const html = await render({ capabilities: ['integrations.read'], items: [] })
    expect(html).toContain(ar.integrations.empty)
  })

  it('shows the forbidden state, not the list, without integrations.read', async () => {
    const html = await render({ capabilities: [], items: [ZATCA] })
    expect(html).toContain(ar.integrations.forbidden)
    expect(html).not.toContain('integration-connections')
  })
})

describe('integrations navigation and locales', () => {
  it('gates direct navigation and the settings link on integrations.read', () => {
    expect(canReachPath({ capabilities: [] }, '/settings/integrations')).toBe(false)
    expect(canReachPath({ capabilities: ['integrations.read'] }, '/settings/integrations')).toBe(true)
    expect(useNav({ capabilities: [] }).map(item => item.to)).not.toContain('/settings/integrations')
    expect(useNav({ capabilities: ['integrations.read'] }).map(item => item.to)).toContain('/settings/integrations')
  })

  it('ships the same keys in Arabic and English', () => {
    expect(Object.keys(flatten(ar)).sort()).toEqual(Object.keys(flatten(en)).sort())
  })
})
