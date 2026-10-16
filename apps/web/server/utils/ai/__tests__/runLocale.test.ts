import { describe, expect, it } from 'vitest'
import { runLocale } from '../runLocale'

describe('runLocale', () => {
  it.each([
    ['en', 'en'], ['en-US', 'en'], ['EN', 'en'], ['ar', 'ar'], ['ar-SA', 'ar'],
    [undefined, 'ar'], ['', 'ar'], ['garbage', 'ar'], ['english', 'ar'], ['xen', 'ar'],
  ])('maps %j to %s', (cookie, expected) => {
    expect(runLocale(cookie)).toBe(expected)
  })
})
