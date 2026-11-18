import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { subscriptionDisplayState } from '@liwan/commercial-contracts'
import { entitledFeaturePrefixes } from '@liwan/commercial-ui/app/utils/entitlementApps'
import { humanizeId } from '@liwan/ui/app/utils/humanizeId'
import * as subscriptionUtils from '../../utils/subscription'

// The overview page's own script runs with a mocked API and the Nuxt auto-imports stood in for; its template renders with plain stand-ins.
const filename = resolve(import.meta.dirname, '../subscription/index.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const script = stripImports(compileScript(descriptor, { id: 'subscription-index' }).content).replaceAll('import.meta.client', 'true').replace('export default', 'return')
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'subscription-index', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', transpile(template.code))(Vue)

const sub = (overrides: Record<string, unknown> = {}) => ({
  state: 'active', pending_order: null, cancellation: null, cancellable: false, deletion: null, trial_ends_at: null, trial_outcome: 'free_base', pending_free_base_lock: null,
  renewal_at: '2026-12-01', on_free_base: false,
  applied: { cadence: { unit: 'month', count: 1 }, entitlement: { features: { 'crm.enabled': true, 'ai.enabled': true, 'tasks.enabled': true, 'zzz.enabled': true } } },
  auto_renew: { enabled: false, payment_method: null },
  ...overrides,
})

async function mountPage(view: Record<string, unknown> | null, capabilities = ['subscription.read', 'subscription.manage']) {
  const api = {
    subscription: vi.fn(async () => view), usage: vi.fn(async () => null), branches: vi.fn(async () => null), invoices: vi.fn(async () => ({ items: [], total: 0 })),
    trialEndPreview: vi.fn(async () => null), catalog: vi.fn(async () => ({ bundles: [] })),
  }
  const messages: Record<string, string> = { 'subscription.apps.crm': 'إدارة العملاء', 'subscription.apps.ai': 'Liwan AI', 'subscription.apps.tasks': 'مهام المشاريع' }
  const bindings = {
    ...subscriptionUtils, subscriptionDisplayState, entitledFeaturePrefixes, humanizeId, formatDate: (value: string) => `date:${value}`,
    payPath: (id: string) => `/subscription/pay/${id}`,
    _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, definePageMeta: () => {}, navigateTo: vi.fn(),
    useI18n: () => ({ t: (key: string) => messages[key] ?? key, te: (key: string) => key in messages, locale: Vue.ref('ar') }),
    useHydrated: () => Vue.ref(true), useAccess: () => ({ can: () => true }), useMe: () => ({ me: Vue.ref({ is_root_company: true }) }), useRefreshShellNotice: () => async () => {},
    useSubscriptionApi: () => api,
    useCustomerCapabilities: () => ({ can: (capability: string) => capabilities.includes(capability), readOnly: Vue.ref(false) }),
    useAsyncData: async (_key: unknown, fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { data.value = await fn() })
      await refresh()
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
    app.component(name, Vue.defineComponent({
      name, inheritAttrs: false,
      setup(_, { attrs, slots }) {
        return () => Vue.h('div', { 'data-component': name, 'data-testid': attrs['data-testid'] as string | undefined, 'data-state': attrs['data-state'] as string | undefined, 'data-to': attrs.to as string | undefined },
          [[attrs.title, attrs.label, attrs.value].filter(Boolean).join(' '), slots.default?.(), slots.actions?.()])
      },
    }))
  }
  const html = await renderToString(app)
  scope.stop()
  return { html, api }
}

describe('the subscription page of a workspace on the free base', () => {
  it('shows the free-base badge, no renewal row, and one primary «subscribe now» action to the change page', async () => {
    const { html } = await mountPage(sub({ on_free_base: true, renewal_at: '2026-12-01' }))
    expect(html).toContain('data-state="free_base"'); expect(html).toContain('subscription.state.freeBase'); expect(html).not.toContain('subscription.state.active')
    expect(html).not.toContain('subscription.summary.renewal'); expect(html).not.toContain('date:2026-12-01')
    expect(html).toContain('data-testid="subscribe-now"'); expect(html).toContain('subscription.summary.subscribeNow'); expect(html).toContain('data-to="/subscription/change"')
    expect(html).not.toContain('subscription.summary.change')
    expect(html.match(/data-to="\/subscription\/change"/g)).toHaveLength(1)
  })
  it('offers the subscribe action only to someone who may manage the subscription', async () => {
    const { html } = await mountPage(sub({ on_free_base: true }), ['subscription.read'])
    expect(html).not.toContain('subscribe-now'); expect(html).not.toContain('data-to="/subscription/change"')
  })
  it('a paying workspace keeps its active badge, its renewal row and the change button', async () => {
    const { html } = await mountPage(sub())
    expect(html).toContain('data-state="active"'); expect(html).toContain('subscription.state.active'); expect(html).not.toContain('freeBase')
    expect(html).toContain('subscription.summary.renewal'); expect(html).toContain('date:2026-12-01')
    expect(html).toContain('data-testid="change-subscription"'); expect(html).toContain('subscription.summary.change')
  })
  it('a pending order still shows its own state, not the free base', async () => {
    const pending = { id: 'o1', payment_state: 'awaiting_payment', fulfillment_state: 'not_started', cancelled: false }
    const { html } = await mountPage(sub({ on_free_base: true, pending_order: pending }))
    expect(html).toContain('data-state="awaiting_payment"')
  })
})

describe('the services of the workspace', () => {
  it('name every application in the customer language, never a Latin id', async () => {
    const { html } = await mountPage(sub())
    expect(html).toContain('Liwan AI'); expect(html).toContain('مهام المشاريع'); expect(html).toContain('إدارة العملاء')
    expect(html).not.toContain('>Tasks<'); expect(html).not.toContain('>Ai<')
  })
})
