import { describe, expect, it } from 'vitest'
import { FREE_MAIL_DOMAINS, isFreeMailAddress } from './free-mail.js'

describe('free-mail refusal', () => {
  it.each(['a@gmail.com', 'a@googlemail.com', 'a@yahoo.com', 'a@yahoo.co.uk', 'a@outlook.com', 'a@hotmail.com', 'a@live.com', 'a@msn.com',
    'a@icloud.com', 'a@me.com', 'a@mac.com', 'a@aol.com', 'a@proton.me', 'a@protonmail.com', 'a@gmx.de', 'a@mail.com', 'a@yandex.ru',
    'a@zoho.com', 'a@mail.ru'])('refuses %s', email => {
    expect(isFreeMailAddress(email)).toBe(true)
  })

  it('compares case-insensitively on the exact domain', () => {
    expect(isFreeMailAddress('Someone@GMAIL.COM')).toBe(true)
    expect(isFreeMailAddress('owner@acme.com.sa')).toBe(false)
    expect(isFreeMailAddress('owner@mail.gmail.com')).toBe(false)
    expect(isFreeMailAddress('owner@notgmail.com')).toBe(false)
    expect(isFreeMailAddress('gmail.com@acme.sa')).toBe(false)
  })

  it('keeps every listed domain lower-case and bare', () => {
    for (const domain of FREE_MAIL_DOMAINS) expect(domain).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]+$/)
  })
})
