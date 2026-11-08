import { describe, expect, it } from 'vitest'
import { hostingModelSchema } from '@liwan/commercial-contracts'
import { hostingKey } from '../vendorTenant'
import ar from '../../../i18n/locales/ar/vendor.json'
import en from '../../../i18n/locales/en/vendor.json'

describe('hostingKey', () => {
  it('maps every hosting model to a label in both locales', () => {
    for (const model of hostingModelSchema.options) {
      expect(ar.vendor.hosting[hostingKey[model]]).toBeTruthy()
      expect(en.vendor.hosting[hostingKey[model]]).toBeTruthy()
    }
    expect(Object.keys(ar.vendor.hosting).sort()).toEqual(Object.values(hostingKey).sort())
  })
})
