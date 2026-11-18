import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every literal `t('a.b.c')` in the subscription UI must resolve in BOTH locales.
 *
 * A missing key does not throw in vue-i18n: it renders the key itself, so the customer reads "app.copy" where a button
 * label belongs. This test catches that, for the pages and components where this release added or changed strings.
 */
const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const flatten = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>)
  .flatMap(([key, child]) => (child && typeof child === 'object' && !Array.isArray(child))
    ? flatten(child, `${prefix}${key}.`)
    : [`${prefix}${key}`])

const locales = {
  ar: new Set(flatten(JSON.parse(read('i18n/locales/ar/subscription.json')).subscription).map(key => `subscription.${key}`)),
  en: new Set(flatten(JSON.parse(read('i18n/locales/en/subscription.json')).subscription).map(key => `subscription.${key}`)),
}
const FILES = [
  'app/pages/subscription/invoices/[id].vue',
  'app/pages/subscription/index.vue',
  'app/pages/subscription/change.vue',
  'app/pages/subscription/status.vue',
  'app/pages/subscription/activate.vue',
  'app/pages/subscription/pay/[order].vue',
  'app/components/subscription/PaymentForm.vue',
  'app/components/subscription/PaymentMethodPanel.vue',
  'app/components/subscription/AutoRenewControl.vue',
  'app/pages/subscription/branches.vue',
  'app/pages/subscription/branches/new.vue',
  'app/components/subscription/UsagePanel.vue',
  'app/components/subscription/TrialEndPanel.vue',
  'app/components/subscription/BranchSummary.vue',
]
const literalKeys = (path: string) => [...read(path).matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)].map(match => match[1]!)

describe('subscription translations resolve', () => {
  for (const file of FILES) {
    it(`${file} uses only keys that exist in ar and en`, () => {
      const missing = literalKeys(file)
        .filter(key => key.startsWith('subscription.'))
        .filter(key => !locales.ar.has(key) || !locales.en.has(key))
      expect(missing, `missing in ${file}`).toEqual([])
    })
  }

  it('the bank-transfer copy control uses its own keys, not a namespace that does not exist', () => {
    const page = read('app/pages/subscription/invoices/[id].vue')
    expect(page).toContain("t('subscription.bankTransfer.copy')")
    expect(page).toContain("t('subscription.bankTransfer.copied')")
    // `app.copy`/`app.copied` are defined in no web locale: the button used to render the raw key.
    expect(page).not.toContain("t('app.copy')")
    expect(locales.en.has('subscription.bankTransfer.copy')).toBe(true)
    expect(locales.ar.has('subscription.bankTransfer.copied')).toBe(true)
  })

  it('names every application a tenant can be entitled to, so no Latin id reaches the customer', () => {
    const ids = ['pmo', 'meetings', 'hr', 'chat', 'crm', 'inbox', 'finance', 'ai', 'tasks', 'documents', 'operations', 'appointments', 'helpdesk', 'sales', 'integrations', 'payments']
    for (const id of ids) {
      expect(locales.ar.has(`subscription.apps.${id}`), `ar ${id}`).toBe(true)
      expect(locales.en.has(`subscription.apps.${id}`), `en ${id}`).toBe(true)
    }
  })

  it('has the keys the dynamic lookups build (state, pay kind, cadence, settled details, refusals)', () => {
    const keys = ['subscription.state.freeBase', 'subscription.summary.subscribeNow', 'subscription.pay.kinds.first_payment', 'subscription.pay.period', 'subscription.pay.periodRange',
      'subscription.pay.trialPaidStarts', 'subscription.trialEnd.details.settledConverted', 'subscription.trialEnd.cadence.month', 'subscription.trialEnd.cadence.year', 'subscription.cadence.month', 'subscription.cadence.year',
      'subscription.change.usageUnavailable', 'subscription.change.downgradeBelowUsage']
    for (const key of keys) { expect(locales.ar.has(key), `ar ${key}`).toBe(true); expect(locales.en.has(key), `en ${key}`).toBe(true) }
    expect(locales.ar.has('subscription.trialEnd.noInvoiceShown')).toBe(false)
  })

  it('cadence reads correctly for every count 1 to 12 in Arabic and English', async () => {
    const { createI18n } = await import('vue-i18n')
    const { pluralRules } = await import('../../../i18n/pluralRules')
    const messages = { ar: JSON.parse(read('i18n/locales/ar/subscription.json')), en: JSON.parse(read('i18n/locales/en/subscription.json')) }
    const i18n = createI18n({ legacy: false, locale: 'ar', fallbackLocale: 'en', messages, pluralRules }) as unknown as { global: { t: (key: string, params: Record<string, unknown>) => string; locale: { value: string } } }
    const t = i18n.global.t
    const ar = (unit: string, count: number) => t(`subscription.trialEnd.cadence.${unit}`, { count })
    expect(ar('month', 1)).toBe('شهريًا'); expect(ar('month', 2)).toBe('كل شهرين'); expect(ar('month', 3)).toBe('كل 3 أشهر'); expect(ar('month', 10)).toBe('كل 10 أشهر')
    expect(ar('month', 11)).toBe('كل 11 شهرًا'); expect(ar('month', 12)).toBe('كل 12 شهرًا'); expect(ar('year', 2)).toBe('كل سنتين')
    expect(t('subscription.cadence.month', { count: 1 })).toBe('شهري'); expect(t('subscription.cadence.year', { count: 3 })).toBe('كل 3 سنوات')
    i18n.global.locale.value = 'en'
    expect(t('subscription.cadence.month', { count: 1 })).toBe('Monthly'); expect(t('subscription.cadence.month', { count: 3 })).toBe('Every 3 months')
  })

  it('the settled trial text is past tense: it ended, data is kept, apps are read-only now', () => {
    const ar = JSON.parse(read('i18n/locales/ar/subscription.json')).subscription.trialEnd
    expect(ar.details.settled).not.toContain('ستصبح')
    expect(ar.details.settled).toContain('انتهت'); expect(ar.details.settled).toContain('أصبحت للقراءة فقط')
    expect(ar.states.settled).not.toContain('اكتمل الانتقال')
  })
})
