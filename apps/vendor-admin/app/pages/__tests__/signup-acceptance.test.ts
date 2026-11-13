import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = read('app/pages/customers/[id].vue')
const customers = (name: 'ar' | 'en') => JSON.parse(read(`i18n/locales/${name}/vendor.json`)).vendor.customers

describe('sign-up acceptance on the vendor customer page', () => {
  it('shows the accepted version and date only when the customer has an acceptance', () => {
    expect(page).toContain('<p v-if="customer.signup_acceptance"')
    expect(page).toContain("t('vendor.customers.signupAcceptance', { version: customer.signup_acceptance.terms_version, date: formatLiwanDate(customer.signup_acceptance.accepted_at) })")
  })
  it('words the line in both languages with the version and the date', () => {
    for (const name of ['ar', 'en'] as const) {
      const text = customers(name).signupAcceptance as string
      expect(text, name).toContain('{version}')
      expect(text, name).toContain('{date}')
    }
  })
})
