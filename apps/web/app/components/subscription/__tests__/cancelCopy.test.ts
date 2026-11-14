import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dayBefore, refusalKey } from '../../../utils/subscription'

const root = resolve(import.meta.dirname, '../../../..')
const locale = (lang: 'ar' | 'en') => JSON.parse(readFileSync(resolve(root, `i18n/locales/${lang}/subscription.json`), 'utf8')).subscription
const lookup = (tree: any, key: string) => key.split('.').reduce((node, part) => node?.[part], tree)
const REFUSALS = ['nothing_to_cancel', 'subscription_past_due', 'lock_pending', 'subscription_suspended', 'subscription_change_pending', 'cancel_trial_unsupported', 'cancel_already_effective', 'subscription_cancelling']

describe('cancellation refusal copy', () => {
  it('has an Arabic and an English sentence for every refusal the control plane answers', () => {
    for (const code of REFUSALS) {
      const key = refusalKey(code)
      expect(key, code).toBeTruthy()
      for (const lang of ['ar', 'en'] as const) expect(typeof lookup(locale(lang), key!.replace(/^subscription\./, '')), `${lang} ${key}`).toBe('string')
    }
  })
  it('keeps the same cancel keys in both languages', () => {
    const keys = (value: any, prefix = ''): string[] => Object.entries(value).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])
    expect(keys(locale('ar').cancel).sort()).toEqual(keys(locale('en').cancel).sort())
  })
  it('names the last day the paid applications stay, the day before the drop', () => {
    expect(dayBefore('2026-12-12')).toBe('2026-12-11')
    expect(dayBefore('2027-01-01')).toBe('2026-12-31')
    expect(dayBefore('2028-03-01')).toBe('2028-02-29')
  })
})
