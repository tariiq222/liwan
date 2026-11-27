import { describe, expect, it } from 'vitest'
import { signupFunnelRowSchema } from '../commercial/analytics.js'

const counts = { registered: 3, started: 2, conversion_eligible: 2, converted: 1, renewal_eligible: 1, renewed: 1 }
const accepted = (selection: string, apps: string[]) =>
  expect(signupFunnelRowSchema.safeParse({ selection, apps, ...counts }).success, JSON.stringify({ selection, apps })).toBe(true)
const rejected = (selection: string, apps: string[]) =>
  expect(signupFunnelRowSchema.safeParse({ selection, apps, ...counts }).success, JSON.stringify({ selection, apps })).toBe(false)

describe('signupFunnelRowSchema', () => {
  it('accepts the base plan alone, one app, and several apps joined with +', () => {
    accepted('base', [])
    accepted('crm', ['crm'])
    accepted('crm+finance+people', ['crm', 'finance', 'people'])
  })

  it('orders apps by code unit, which puts a digit before an underscore', () => {
    accepted('a0+a_', ['a0', 'a_'])
    rejected('a_+a0', ['a_', 'a0'])
  })

  it('rejects a selection that does not name exactly its apps', () => {
    rejected('base', ['crm'])
    rejected('crm', [])
    rejected('crm', ['crm', 'inbox'])
    rejected('crm+people', ['crm', 'inbox'])
  })

  it('rejects a repeated app and apps out of order', () => {
    rejected('crm+crm', ['crm', 'crm'])
    rejected('crm+inbox', ['inbox', 'crm'])
  })

  it('reserves the name base for the base plan alone, so no app may be named base', () => {
    rejected('base', ['base'])
    rejected('base+crm', ['base', 'crm'])
  })

  it('bounds each app id at 64 characters, and not the joined selection', () => {
    const long = ['0', '1', '2', '3'].map(digit => `${'a'.repeat(63)}${digit}`)
    accepted(long.join('+'), long)
    rejected('a'.repeat(65), ['a'.repeat(65)])
  })

  it('rejects invalid app ids and unknown keys', () => {
    for (const badApp of ['', 'CRM', 'crm+inbox', 'crm-app']) {
      rejected(badApp, [badApp])
    }
    expect(signupFunnelRowSchema.safeParse({ selection: 'crm', apps: ['crm'], ...counts, extra: 1 }).success).toBe(false)
  })
})
