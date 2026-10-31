import { describe, expect, it } from 'vitest'
import { uiLocaleHeaders, withUiLocale } from '../uiLocale'

const eventWith = (cookie?: string) => ({ node: { req: { headers: cookie ? { cookie } : {} } }, headers: new Headers(cookie ? { cookie } : {}) }) as never

describe('uiLocaleHeaders', () => {
  it('forwards a supported UI language from the cookie', () => {
    expect(uiLocaleHeaders(eventWith('liwan-locale=ar'))).toEqual({ 'x-liwan-ui-locale': 'ar' })
    expect(uiLocaleHeaders(eventWith('a=1; liwan-locale=en'))).toEqual({ 'x-liwan-ui-locale': 'en' })
  })
  it('falls back to Arabic, the UI default, for a missing or unsupported value', () => {
    for (const cookie of [undefined, 'liwan-locale=fr', 'liwan-locale=ar_001', 'liwan-locale=', 'other=ar']) {
      expect(uiLocaleHeaders(eventWith(cookie))).toEqual({ 'x-liwan-ui-locale': 'ar' })
    }
  })
  it('drops a browser-supplied header and rebuilds it from the cookie', () => {
    expect(withUiLocale(eventWith(), { accept: 'x', 'x-liwan-ui-locale': 'en' })).toEqual({ accept: 'x', 'x-liwan-ui-locale': 'ar' })
    expect(withUiLocale(eventWith('liwan-locale=en'), { 'x-liwan-ui-locale': 'ar' })).toEqual({ 'x-liwan-ui-locale': 'en' })
  })
})
