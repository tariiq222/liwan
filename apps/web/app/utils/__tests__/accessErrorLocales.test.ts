import { describe, expect, it } from 'vitest'
import ar from '../../../i18n/locales/ar/access.json'
import en from '../../../i18n/locales/en/access.json'

const codes = ['self_access_change', 'role_disabled', 'missing_dependency', 'duplicate_or_invalid_capability', 'record_company_unknown', 'scope_kind_invalid', 'scope_role_invalid']

describe('access.errors locale keys', () => {
  it.each(codes)('%s has a message in both locales', (code) => {
    for (const locale of [ar, en]) {
      const text = (locale.access.errors as Record<string, string>)[code]
      expect(text).toBeTruthy()
      expect(text).not.toBe(code)
    }
  })
})
