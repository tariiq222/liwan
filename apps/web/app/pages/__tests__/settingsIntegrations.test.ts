import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { IntegrationConnectionListSchema } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import { DEFAULT_STUBS, fakeT, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { canReachPath } from '../../utils/accessPolicy'
import { integrationErrorText, integrationProviderLabel, integrationUsedBy, oauthReasonKey } from '../../utils/integrationLabels'
import { integrationStateBadge } from '../../utils/integrationStateBadge'
import { useNav } from '../../composables/nav/shellModules'
import ar from '../../../i18n/locales/ar/integrations.json'
import en from '../../../i18n/locales/en/integrations.json'

const card = resolve(import.meta.dirname, '../../components/settings/IntegrationConnectionsCard.vue')
const META = {
  ref: 'connection:1', id: 1, provider: 'meta', auth: 'keys', external_id: '1029', label: 'متجر الورد', app_id: null, state: 'connected',
  status_message: '', last_checked: '2030-01-15T10:30:00Z', token_expires_at: null, secrets: [], used_by: ['inbox.whatsapp'], webhooks: [], settings_path: null,
}
const TIKTOK = { ...META, ref: 'connection:2', id: 2, provider: 'tiktok', auth: 'oauth', external_id: 'open-1', label: '', state: 'error', status_message: 'Token expired', last_checked: null, used_by: [] }
const ZATCA = {
  ...META, ref: 'external:zatca', id: null, provider: 'zatca', auth: 'external', external_id: null, label: '', state: 'not_configured',
  last_checked: null, used_by: ['zatca.invoicing'], settings_path: '/settings/apps/finance#zatca',
}

const stub = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  props: { title: String, description: String, label: String, tone: String, emptyText: String, loading: Boolean, empty: Boolean },
  setup(props, { attrs, slots }) {
    return () => Vue.h(tag, attrs, [props.title, props.description, props.label, props.loading ? 'loading' : props.empty ? props.emptyText : slots.default?.()])
  },
})
const stubs = { ...DEFAULT_STUBS, SharedRecordSection: stub('section'), SharedPageState: stub('div'), SharedStatusBadge: stub('b') }

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value as Record<string, unknown>, path) }
  }, {})
}
const messages = flatten(ar)
const t = fakeT(messages)
const te = (key: string) => key in messages

async function render(items: unknown[]) {
  const component = loadShared(card, {
    messages,
    modules: {
      '@liwan/ui/app/utils/formatDate': { formatDateTime },
      '@liwan/ui/app/utils/statusBadge': { badgeLabel },
      '@/composables/useIntegrationConnections': {
        useIntegrationConnections: () => ({ data: Vue.ref({ items, total: items.length }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined }),
      },
      '@/utils/integrationLabels': { integrationProviderLabel, integrationUsedBy },
      '@/utils/integrationStateBadge': { integrationStateBadge },
    },
  })
  const app = Vue.createSSRApp({ render: () => Vue.h(component) })
  app.config.globalProperties.$t = t as never
  for (const [tag, impl] of Object.entries(stubs)) app.component(tag, impl)
  return renderToString(app)
}

describe('the connections card of /settings/integrations', () => {
  it('lists each connection with provider, account, users, state, last check and message', async () => {
    expect(IntegrationConnectionListSchema.safeParse({ items: [META, TIKTOK, ZATCA], total: 3 }).success).toBe(true)
    const html = await render([META, TIKTOK, ZATCA])
    expect(html).toContain(ar.integrations.provider.meta)
    expect(html).toContain('متجر الورد')
    expect(html).toContain('open-1')
    expect(html).toContain(`يستخدمه: ${ar.integrations.use.inbox.whatsapp}`)
    expect(html).toContain(ar.integrations.connections.unused)
    expect(html).toContain(ar.integrations.state.connected)
    expect(html).toContain(ar.integrations.state.error)
    expect(html).toContain(ar.integrations.state.not_configured)
    expect(html).toContain(ar.integrations.connections.neverChecked)
    expect(html).toContain(ar.integrations.connections.lastChecked.replace('{at}', formatDateTime('2030-01-15T10:30:00Z')))
    expect(html).toContain('Token expired')
  })

  it('links a stored connection to its page and an external one to its owner, and shows an unknown use as it is', async () => {
    const html = await render([META, ZATCA])
    expect(html).toContain('/settings/integrations/connections/1')
    expect(html).toContain('/settings/apps/finance#zatca')
    expect(html).toContain('zatca.invoicing')
    expect(html).not.toContain('connections/null')
  })

  it('shows the empty state when there is no connection', async () => {
    expect(await render([])).toContain(ar.integrations.connections.empty)
  })
})

describe('integration labels', () => {
  it('names a provider and falls back to its code', () => {
    expect(integrationProviderLabel('tiktok', t, te)).toBe('TikTok')
    expect(integrationProviderLabel('newbank', t, te)).toBe('newbank')
  })

  it('words a refusal by its code and otherwise shows the API text', () => {
    expect(integrationErrorText({ status: 409, code: 'in_use', message: 'x' }, t)).toBe(ar.integrations.errors.inUse)
    expect(integrationErrorText({ status: 422, code: 'integration_rejected', message: 'x' }, t)).toBe(ar.integrations.errors.rejected)
    expect(integrationErrorText({ status: 500, code: 'boom', message: 'Server said no' }, t)).toBe('Server said no')
    expect(integrationErrorText(new Error('x'), t)).toBe('errors.generic')
  })

  it('words an OAuth return reason and falls back for an unknown one', () => {
    expect(oauthReasonKey('denied')).toBe('integrations.oauth.errors.denied')
    expect(oauthReasonKey('something_new')).toBe('integrations.oauth.errors.other')
    expect(te(oauthReasonKey('something_new'))).toBe(true)
  })
})

describe('integrations navigation and locales', () => {
  it('gates the page on integrations.read, the create panel on integrations.manage, and keeps the system page free of it', () => {
    expect(canReachPath({ capabilities: [] }, '/settings/integrations')).toBe(false)
    expect(canReachPath({ capabilities: ['integrations.read'] }, '/settings/integrations')).toBe(true)
    expect(canReachPath({ capabilities: ['integrations.read'] }, '/settings/integrations/new')).toBe(false)
    expect(canReachPath({ capabilities: ['integrations.manage'] }, '/settings/integrations/new')).toBe(true)
    expect(canReachPath({ capabilities: ['integrations.read'] }, '/settings/system')).toBe(false)
    expect(useNav({ capabilities: [] }).map(item => item.to)).not.toContain('/settings/integrations#connections')
    expect(useNav({ capabilities: ['integrations.read'] }).map(item => item.to)).toContain('/settings/integrations#connections')
    expect(useNav({ capabilities: ['integrations.read'] }).map(item => item.to)).not.toContain('/settings/system#integrations')
  })

  it('ships the same keys in Arabic and English', () => {
    expect(Object.keys(flatten(ar)).sort()).toEqual(Object.keys(flatten(en)).sort())
  })

  it('names every provider and use in both languages', () => {
    for (const locale of [ar, en]) {
      expect(Object.keys(locale.integrations.provider).sort()).toEqual(['meta', 'paymob', 'tiktok', 'zatca'])
      expect(Object.keys(locale.integrations.use.inbox).sort()).toEqual(['tiktok', 'whatsapp'])
    }
  })
})
