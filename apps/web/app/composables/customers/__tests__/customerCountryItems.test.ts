import { describe, expect, it } from 'vitest'
import { countryId, countryItems, countryValue, MAIN_COMPANY_COUNTRY } from '../customerCountryItems'

const sa = { id: 191, code: 'SA', name: 'المملكة العربية السعودية' }
const eg = { id: 65, code: 'EG', name: 'مصر' }

describe('countryItems', () => {
  it('puts the main company\'s country first, then every country in the server order', () => {
    expect(countryItems([eg, sa], null, 'دولة الشركة').map(item => item.value)).toEqual([MAIN_COMPANY_COUNTRY, '65', '191'])
  })

  it('keeps the saved country selectable before the list has loaded, and does not repeat it after', () => {
    expect(countryItems([], sa, 'x').map(item => item.value)).toEqual([MAIN_COMPANY_COUNTRY, '191'])
    expect(countryItems([sa, eg], sa, 'x').filter(item => item.value === '191')).toHaveLength(1)
  })
})

describe('countryValue and countryId', () => {
  it('round-trip a country, and null stands for the main company\'s country', () => {
    expect(countryValue(null)).toBe(MAIN_COMPANY_COUNTRY)
    expect(countryId(MAIN_COMPANY_COUNTRY)).toBeNull()
    expect(countryId(countryValue(191))).toBe(191)
  })
})
