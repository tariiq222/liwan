import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import type { Analytics, AnalyticsFigures } from '@liwan/commercial-contracts'
import { mountPage } from '../../__tests__/pageHarness'
import * as vendorAnalytics from '../../utils/vendorAnalytics'
import { usageMetricLabel } from '../../utils/vendorSubscriptions'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
/** Every `[dotted.key, text]` pair of a locale file. */
const entries = (value: unknown, prefix = ''): [string, string][] =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => entries(child, `${prefix}${key}.`)) : [[prefix.slice(0, -1), String(value)]]
const analyticsLocale = (lang: 'ar' | 'en') => JSON.parse(read(`i18n/locales/${lang}/analytics.json`)).analytics

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const none = { available: false, reason: 'no_data' } as const
const figures: AnalyticsFigures = {
  revenue: { mrr: none, arr: none, new_mrr: none, expansion_mrr: none, contraction_mrr: none, churned_mrr: none, arpc: none, extra_branch_mrr: none },
  collection: { collected: none, outstanding: none, overdue_0_30: none, overdue_31_60: none, overdue_61_plus: none, payment_success_rate: none, avg_days_to_pay: none },
  customers: { active: none, new: none, churned: none, churn_rate_by_count: none, churn_rate_by_revenue: none, trial_conversion_rate: none },
  operations: { avg_hours_to_ready: none },
}
const analytics = (signup_funnel: Analytics['signup_funnel']): Analytics => ({
  period: { from: '2026-10-01', to: '2026-10-15' }, previous_period: { from: '2026-09-16', to: '2026-09-30' },
  currency: 'SAR', exponent: 2, excluded_subscriptions: 0, generated_at: '2026-10-15T12:00:00Z',
  current: figures, previous: figures, trend: [], signup_funnel,
  snapshot: { states: [], plans: [], plan_changes: [], upsell: [], low_usage: [], usage_unavailable: 0, renewals: [], stalled_fulfillments: { count: 0, items: [] } },
})

/** The page answered with `signup_funnel`, reading the English messages its labels come from. */
async function analyticsPage(signup_funnel: Analytics['signup_funnel']) {
  const text = Object.fromEntries([...entries(JSON.parse(read('i18n/locales/en/analytics.json'))), ...entries(JSON.parse(read('i18n/locales/en/vendor.json')))])
  const page = await mountPage('analytics.vue', {
    ...vendorAnalytics, formatCommercialMoney, usageMetricLabel, downloadCsv: vi.fn(),
    useRoute: () => ({ query: {}, path: '/analytics' }), useRouter: () => ({ push: vi.fn() }),
    useVendorAnalytics: () => ({ load: async () => analytics(signup_funnel) }),
    useI18n: () => ({ t: (key: string) => text[key] ?? key, te: (key: string) => key in text, locale: Vue.ref('en') }),
  })
  mounted.push(page)
  return page
}
const labels = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(match => match[1]!)

describe('vendor analytics page: dynamic signup funnel', () => {
  it('renders one block per selection, labelled by its apps, once any selection has a registration', async () => {
    const page = await analyticsPage([
      { selection: 'base', apps: [], registered: 3, started: 2, conversion_eligible: 1, converted: 1, renewal_eligible: 1, renewed: 1 },
      { selection: 'crm+inbox', apps: ['crm', 'inbox'], registered: 5, started: 4, conversion_eligible: 2, converted: 1, renewal_eligible: 1, renewed: 1 },
      { selection: 'people', apps: ['people'], registered: 0, started: 0, conversion_eligible: 0, converted: 0, renewal_eligible: 0, renewed: 0 },
    ])
    const { html } = await page.rendered()
    expect(labels(html)).toEqual(['Base only', 'Customer management + Customer inbox', 'People'])
  })

  it('hides the section when no selection has a registration', async () => {
    const page = await analyticsPage([
      { selection: 'base', apps: [], registered: 0, started: 0, conversion_eligible: 0, converted: 0, renewal_eligible: 0, renewed: 0 },
    ])
    const { html, captured } = await page.rendered()
    expect(captured.some(node => node.name === 'SharedRecordSection')).toBe(false)
    expect(html).not.toContain('Self-service signup through renewal')
  })

  it('keeps exact AR/EN key parity for analytics.json and only defines the base-only funnel label', () => {
    const ar = analyticsLocale('ar'), en = analyticsLocale('en')
    expect(entries(ar).map(([key]) => key).sort()).toEqual(entries(en).map(([key]) => key).sort())
    expect(Object.keys(ar.signupFunnel.apps)).toEqual(['base'])
    expect(Object.keys(en.signupFunnel.apps)).toEqual(['base'])
  })
})
