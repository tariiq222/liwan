import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A8: Release 1 sells at most 100 users per company. The customer page must cap the users input, say what to do
 * above the cap, and explain the server's `users_limit_exceeded` refusal instead of the generic failure message.
 */
const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const locale = (lang: string) => JSON.parse(read(`i18n/locales/${lang}/subscription.json`)) as { subscription: { change: Record<string, string> } }

const page = read('app/pages/subscription/change.vue')
const utils = read('app/utils/subscription.ts')
const en = locale('en').subscription.change
const ar = locale('ar').subscription.change
const ARABIC_WORDING = 'لأكثر من 100 مستخدم، تواصل معنا'

const usersInput = /<UInputNumber\s+v-model="users"[^>]*>/g

describe('subscription users cap', () => {
  it('caps the users input at 100 in the customer page', () => {
    const inputs = page.match(usersInput) ?? []
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain(':max="100"')
    // The page refuses locally too: no quote, trial or order is sent above the cap.
    expect(page).toContain('const MAX_USERS = 100')
    expect(page).toContain('usersOverCap')
  })

  it('shows the approved Arabic wording and its English counterpart from the locale', () => {
    expect(ar.usersCapNote).toContain(ARABIC_WORDING)
    expect(en.usersCapNote).toMatch(/100 users/i)
    expect((en.usersCapNote ?? '').toLowerCase()).toContain('contact us')
    // Both languages carry the same key, and the page renders it next to the users field.
    expect(Object.keys(en).sort()).toContain('usersCapNote')
    expect(Object.keys(ar)).toContain('usersCapNote')
    expect(page).toContain("t('subscription.change.usersCapNote')")
  })

  it('explains the server refusal instead of the generic message', () => {
    // The page's refusal mechanism: `refusalCode` reads the code from the error body, `refusalKey`
    // (utils/subscription.ts, shared with the other subscription pages) maps it to this message.
    expect(page).toContain('refusalCode')
    expect(page).toContain('refusalKey')
    expect(utils).toContain("code === 'users_limit_exceeded'")
    expect(utils).toContain("'subscription.change.usersCapNote'")
  })
})
