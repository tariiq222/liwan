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
  'app/components/subscription/UsagePanel.vue',
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
})
