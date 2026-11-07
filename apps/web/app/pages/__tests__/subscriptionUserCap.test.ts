import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_USERS } from '@liwan/commercial-contracts'
import { refusalKey, usersOverCap } from '../../utils/subscription'

/**
 * A8: Release 1 sells at most 100 users per company. The rule is a pure predicate the page asks, so the cap is tested
 * by calling it rather than by reading the page's source; what stays page-level is genuinely about markup (the input's
 * bound) and wording (both locales).
 */
const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const locale = (lang: string) => JSON.parse(read(`i18n/locales/${lang}/subscription.json`)) as { subscription: { change: Record<string, string> } }

const page = read('app/pages/subscription/change.vue')
const en = locale('en').subscription.change
const ar = locale('ar').subscription.change
const ARABIC_WORDING = 'لأكثر من 100 مستخدم، تواصل معنا'

describe('subscription users cap', () => {
  it('takes the number from the contract, not from a second literal', () => {
    expect(MAX_USERS).toBe(100)
    expect(read('app/utils/subscription.ts')).toContain('MAX_USERS')
    // One constant: the page no longer declares its own 100.
    expect(page).not.toMatch(/const MAX_USERS\s*=/)
  })

  it('lets a customer inside the cap through and refuses one above it', () => {
    for (const users of [0, 1, 3, 99, 100]) expect(usersOverCap(users), String(users)).toBe(false)
    for (const users of [101, 250, 10_000]) expect(usersOverCap(users), String(users)).toBe(true)
  })

  it('caps the users input in the customer page', () => {
    const inputs = page.match(/<UInputNumber\s+v-model="users"[^>]*>/g) ?? []
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain(':max="100"')
    // The page asks the predicate before quoting, starting a trial or accepting.
    expect((page.match(/overCap/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('states the approved Arabic wording and its English counterpart', () => {
    expect(ar.usersCapNote).toContain(ARABIC_WORDING)
    expect(en.usersCapNote).toMatch(/100 users/i)
    expect((en.usersCapNote ?? '').toLowerCase()).toContain('contact us')
  })

  it('explains the server refusal instead of the generic message', () => {
    expect(refusalKey('users_limit_exceeded')).toBe('subscription.change.usersCapNote')
    // And the page shows that key rather than a generic failure.
    expect(page).toContain("previewError.value = t('subscription.change.usersCapNote')")
  })
})
