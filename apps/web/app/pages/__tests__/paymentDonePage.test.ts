import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const locale = (name: 'ar' | 'en') => JSON.parse(read(`i18n/locales/${name}/subscription.json`)).subscription

describe('public payment-done page', () => {
  const page = read('app/pages/payment-done.vue')
  it('needs no session and reads no account', () => {
    expect(page).toContain("access: 'public'")
    expect(page).toContain('layout: false')
    for (const forbidden of ['useMe', 'useSubscriptionApi', 'useBranding', '/api/']) expect(page).not.toContain(forbidden)
  })
  it('claims a payment only for the verified result', () => {
    expect(page).toContain("route.query.result === 'paid' || route.query.result === 'failed' ? route.query.result : 'pending'")
  })
  it('tells the customer that setup started and the invitation comes by email, in both languages', () => {
    for (const name of ['ar', 'en'] as const) {
      const done = locale(name).paymentDone
      for (const state of ['paid', 'failed', 'pending']) { expect(done[state].title).toBeTruthy(); expect(done[state].body).toBeTruthy() }
      expect(done.title).toBeTruthy()
    }
    expect(locale('en').paymentDone.paid.body).toMatch(/invitation.*email/i)
    expect(locale('ar').paymentDone.paid.body).toContain('دعوة')
    expect(locale('ar').paymentDone.paid.body).toContain('البريد')
  })
})
