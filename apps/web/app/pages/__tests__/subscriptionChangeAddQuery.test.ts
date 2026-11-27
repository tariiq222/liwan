import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { cadenceLabel, formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { queryText } from '../../utils/routeQuery'
import * as subscriptionUtils from '../../utils/subscription'

// Compiles and executes the real `/subscription/change` page script with resolved `useAsyncData` so `?add=`
// initialization, cadence defaults, and `SharedUnsavedChanges` dirty-state behavior are verified end to end.
const filename = resolve(import.meta.dirname, '../subscription/change.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const script = stripImports(compileScript(descriptor, { id: 'subscription-change' }).content).replaceAll('import.meta.client', 'true').replace('export default', 'return')
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'subscription-change', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', transpile(template.code))(Vue)

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const M = { unit: 'month' as const, count: 1 }
const Y = { unit: 'year' as const, count: 1 }
const Q = { unit: 'month' as const, count: 3 }

const catalogFixture = () => ({
  plans: [
    {
      id: 'plan-1',
      name: 'LiwanOS',
      included_bundle_revision_ids: ['b-included'],
      optional_bundle_revision_ids: ['b-crm', 'b-hr', 'b-annual-only'],
      included_users: 3,
      included_storage_mb: 20480,
      storage_step_mb: 10240,
      storage_step_threshold_mb: 102400,
      storage_large_step_mb: 102400,
      included_extra_branches: 0,
      trial_days: 14,
      prices: [{ cadence: M, amount: sar(10000) }, { cadence: Y, amount: sar(100000) }],
      user_prices: [{ cadence: M, amount: sar(2000) }, { cadence: Y, amount: sar(20000) }],
      storage_prices: [{ cadence: M, amount: sar(500) }, { cadence: Y, amount: sar(5000) }],
    },
  ],
  bundles: [
    { id: 'b-included', name: 'Included', prices: [{ cadence: M, amount: sar(0) }, { cadence: Y, amount: sar(0) }] },
    { id: 'b-crm', name: 'CRM', prices: [{ cadence: M, amount: sar(15000) }, { cadence: Y, amount: sar(150000) }] },
    { id: 'b-hr', name: 'HR', prices: [{ cadence: M, amount: sar(20000) }, { cadence: Y, amount: sar(200000) }] },
    { id: 'b-annual-only', name: 'Annual Only', prices: [{ cadence: Y, amount: sar(120000) }] },
  ],
})

const subscriberFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub-1',
  revision: 2,
  state: 'active',
  trial_ends_at: null,
  trial_outcome: null,
  pending_free_base_lock: null,
  applied: {
    plan_revision_id: 'plan-1',
    cadence: Y,
    bundle_revision_ids: ['b-crm'],
    extra_branch_count: 1,
    entitlement: { features: { 'users.limit': 5, 'storage.limit_mb': 30720 } },
    ...(overrides.applied as Record<string, unknown> | undefined),
  },
  ...overrides,
})

async function mountChangePage(options: { sub: Record<string, unknown> | null; add?: string } = { sub: null }) {
  const api = {
    catalog: vi.fn(async () => catalogFixture()),
    subscription: vi.fn(async () => {
      if (options.sub === null) throw { statusCode: 404 }
      return options.sub
    }),
    trialEndPreview: vi.fn(async () => null),
    preview: vi.fn(async () => null),
    quote: vi.fn(async () => null),
    accept: vi.fn(async () => null),
    startTrial: vi.fn(async () => null),
    done: vi.fn(),
  }
  const bindings = {
    ...subscriptionUtils,
    cadenceLabel,
    formatCommercialMoney,
    queryText,
    payPath: (id: string) => `/subscription/pay/${id}`,
    _defineComponent: Vue.defineComponent,
    _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    ref: Vue.ref,
    computed: Vue.computed,
    watch: Vue.watch,
    nextTick: Vue.nextTick,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    definePageMeta: () => {},
    navigateTo: vi.fn(),
    useRoute: () => ({ query: options.add !== undefined ? { add: options.add } : {} }),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar') }),
    useHydrated: () => Vue.ref(true),
    useSubscriptionApi: () => api,
    useCustomerCapabilities: () => ({ can: (capability: string) => capability === 'subscription.manage', readOnly: Vue.ref(false) }),
    useAsyncData: async (_key: unknown, fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null)
      const error = Vue.ref<unknown>(null)
      const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { data.value = await fn() })
      await refresh()
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  await Vue.nextTick()
  await Vue.nextTick()

  const app = Vue.createSSRApp(Vue.defineComponent({
    setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))),
    render,
  }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
    app.component(name, Vue.defineComponent({
      name,
      inheritAttrs: false,
      setup(_, { attrs, slots }) {
        const checked = attrs.modelValue ?? attrs['model-value']
        return () => Vue.h('div', {
          'data-component': name,
          'data-label': attrs.label as string | undefined,
          'data-checked': checked !== undefined ? String(checked) : undefined,
          'data-dirty': attrs.dirty !== undefined ? String(attrs.dirty) : undefined,
        }, [slots.default?.(), slots.actions?.()])
      },
    }))
  }
  const html = await renderToString(app)
  const snapshot = {
    planId: state.planId.value as string,
    cadenceKey: state.cadenceKey.value as string,
    bundleIds: [...(state.bundleIds.value as string[])],
    dirty: state.dirty.value as boolean,
    body: state.body.value as Record<string, unknown> | null,
    html,
  }
  scope.stop()
  return snapshot
}

describe('/subscription/change ?add= pre-selection', () => {
  it('initializes cadence and pre-selects a valid ?add= bundle cleanly for a first-time buyer with dirty=false', async () => {
    const res = await mountChangePage({ sub: null, add: 'b-hr' })
    expect(res.planId).toBe('plan-1')
    expect(res.cadenceKey).toBe('month:1')
    expect(res.bundleIds).toEqual(['b-hr'])
    expect(res.dirty).toBe(false)
    expect(res.body).toMatchObject({ kind: 'new', plan_revision_id: 'plan-1', bundle_revision_ids: ['b-hr'], cadence: M })
    expect(res.html).toContain('data-component="SharedUnsavedChanges" data-dirty="false"')
    expect(res.html).toMatch(/data-component="UCheckbox" data-label="HR[^"]*" data-checked="true"/)
  })

  it('preserves existing applied bundles and adds a valid ?add= bundle for an existing subscriber with dirty=false', async () => {
    const res = await mountChangePage({ sub: subscriberFixture(), add: 'b-hr' })
    expect(res.cadenceKey).toBe('year:1')
    expect(res.bundleIds).toEqual(['b-crm', 'b-hr'])
    expect(res.dirty).toBe(false)
    expect(res.body).toMatchObject({ kind: 'change', bundle_revision_ids: ['b-crm', 'b-hr'], cadence: Y })
  })

  it('falls back to the first valid cadence when the applied plan is withdrawn and its cadence is unavailable, keeping ?add=', async () => {
    const withdrawn = subscriberFixture({
      applied: {
        plan_revision_id: 'plan-withdrawn',
        cadence: Q,
        bundle_revision_ids: ['b-crm'],
        extra_branch_count: 0,
        entitlement: { features: { 'users.limit': 3, 'storage.limit_mb': 20480 } },
      },
    })
    const res = await mountChangePage({ sub: withdrawn, add: 'b-hr' })
    expect(res.planId).toBe('plan-1')
    expect(res.cadenceKey).toBe('month:1')
    expect(res.bundleIds).toEqual(['b-crm', 'b-hr'])
    expect(res.dirty).toBe(false)
  })

  it('ignores unknown, unpriced-for-cadence, and already-included ?add= ids safely with dirty=false', async () => {
    const unknown = await mountChangePage({ sub: null, add: 'b-does-not-exist' })
    expect(unknown.cadenceKey).toBe('month:1')
    expect(unknown.bundleIds).toEqual([])
    expect(unknown.dirty).toBe(false)

    // First-time buyer defaults to month:1 where b-annual-only has no price.
    const unpriced = await mountChangePage({ sub: null, add: 'b-annual-only' })
    expect(unpriced.cadenceKey).toBe('month:1')
    expect(unpriced.bundleIds).toEqual([])
    expect(unpriced.dirty).toBe(false)

    const included = await mountChangePage({ sub: subscriberFixture(), add: 'b-included' })
    expect(included.bundleIds).toEqual(['b-crm'])
    expect(included.dirty).toBe(false)
  })
})
