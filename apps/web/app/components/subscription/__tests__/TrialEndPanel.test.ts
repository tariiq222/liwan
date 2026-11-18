import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { quoteLinesByTiming } from '@liwan/commercial-ui/app/utils/commercial'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { formatSubscriptionMoney } from '../../../utils/subscription'

const filename = resolve(import.meta.dirname, '../TrialEndPanel.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const script = stripImports(compileScript(descriptor, { id: 'trial-end' }).content).replace('export default', 'return')
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'trial-end', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', transpile(template.code))(Vue)

const money = (minor: number) => ({ minor, currency: 'SAR', exponent: 2 })
const base = {
  status: 'trialing', trial_ends_at: '2026-11-20T21:00:00Z', next_attempt_at: null, outcome: null, locked_bundle_revision_ids: [], first_invoice: null, price_after_trial: null,
  kept: { bundle_revision_ids: [], paid_users: 0, paid_storage_gb: 0, paid_extra_branches: 0 }, limits: { users: 5, storage_mb: 1024, extra_branches: 0 },
  excess: { users: 0, extra_branches: 0, storage_bytes: 0, source: 'fresh', sampled_at: null },
}

async function renderPanel(preview: Record<string, unknown>, cadence: unknown = { unit: 'month', count: 1 }) {
  const bindings = { _defineComponent: Vue.defineComponent, quoteLinesByTiming, formatDateTime: (v: string) => `dt:${v}`, formatSubscriptionMoney, computed: Vue.computed, useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key), locale: Vue.ref('en') }) }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const props = { preview: { ...base, ...preview }, bundleNames: {}, cadence }
  const state = component.setup(props, { expose: () => {} })
  const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...state }), render: (ctx: Record<string, unknown>) => render({ ...ctx, ...props, $slots: {} }) }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
    app.component(name, Vue.defineComponent({ name, inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'] as string | undefined }, [[attrs.title, attrs.description, attrs.label, attrs.value].filter(Boolean).join(' '), slots.default?.()]) }))
  }
  return renderToString(app)
}

describe('the price during a running trial', () => {
  it('shows what the full chosen apps cost after the trial, with the cadence', async () => {
    const html = await renderPanel({ price_after_trial: money(34900) })
    expect(html).toContain('data-testid="trial-price-after"'); expect(html).toContain('349.00'); expect(html).toContain('subscription.trialEnd.priceAfterTrial')
    expect(html).not.toContain('trial-free-after')
  })
  it('says the plan continues free only when there is no price', async () => {
    const html = await renderPanel({ price_after_trial: null })
    expect(html).toContain('data-testid="trial-free-after"'); expect(html).not.toContain('trial-price-after')
  })
})

describe('an ended trial', () => {
  it('reads past tense and has no price section when nothing was invoiced', async () => {
    const html = await renderPanel({ status: 'settled', outcome: 'free_base' })
    expect(html).toContain('subscription.trialEnd.details.settled'); expect(html).not.toContain('settledConverted')
    expect(html).not.toContain('trial-price-after'); expect(html).not.toContain('trial-free-after')
  })
  it('a converted trial does not claim its apps are read-only', async () => {
    const html = await renderPanel({ status: 'settled', outcome: 'converted' })
    expect(html).toContain('subscription.trialEnd.details.settledConverted')
  })
})
