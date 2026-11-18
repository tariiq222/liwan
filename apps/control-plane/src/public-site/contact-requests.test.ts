import { describe, expect, it } from 'vitest'
import { publicContactSchema } from '@liwan/commercial-contracts'
import { contactNotifyEmailConfig } from '../config.js'
import { contactNoticeMail, contactRefusalCode } from './contact-requests.js'

const valid = { name: 'Sara', email: 'sara@acme.com.sa', message: 'Hi', consent: true, turnstile_token: 't' }
const code = (patch: Record<string, unknown>) => {
  const result = publicContactSchema.safeParse({ ...valid, ...patch })
  return result.success ? 'ok' : contactRefusalCode(result.error)
}

describe('contact refusal codes (the ones the marketing site has messages for)', () => {
  it.each([
    [{ email: 'nope' }, 'invalid_email'], [{ mobile: '0555' }, 'invalid_mobile'], [{ consent: false }, 'consent_required'],
    [{ turnstile_token: undefined }, 'turnstile_required'], [{ name: '' }, 'validation_failed'], [{ message: 'x'.repeat(2001) }, 'validation_failed'], [{}, 'ok'],
  ])('%j -> %s', (patch, expected) => { expect(code(patch)).toBe(expected) })
})

describe('contact notice mail', () => {
  it('lists every given field, keeps header text on one line and leaves out the empty ones', () => {
    const mail = contactNoticeMail({ name: 'Sara\r\nBcc: x@evil.test', email: 'sara@acme.com.sa', company: null, mobile: '+966555000111', users: null, message: 'Line one\nLine two', lang: 'ar', utm: { utm_source: 'ad' } })
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.text).toContain('البريد: sara@acme.com.sa')
    expect(mail.text).toContain('الجوال: +966555000111')
    expect(mail.text).toContain('utm_source: ad')
    expect(mail.text).toContain('Line one\nLine two')
    expect(mail.text).not.toContain('الشركة')
    expect(mail.text).not.toContain('عدد المستخدمين')
  })
})

describe('CONTACT_NOTIFY_EMAIL', () => {
  it('is off when unset or blank and a single trimmed address when set', () => {
    expect(contactNotifyEmailConfig({})).toBeUndefined()
    expect(contactNotifyEmailConfig({ CONTACT_NOTIFY_EMAIL: '  ' })).toBeUndefined()
    expect(contactNotifyEmailConfig({ CONTACT_NOTIFY_EMAIL: ' owner@liwanos.com ' })).toBe('owner@liwanos.com')
  })
  it.each(['a@b.com, c@d.com', 'Owner <a@b.com>', 'not-an-email', 'a@b.com;c@d.com'])('refuses %s', value => {
    expect(() => contactNotifyEmailConfig({ CONTACT_NOTIFY_EMAIL: value })).toThrow('CONTACT_NOTIFY_EMAIL')
  })
})
