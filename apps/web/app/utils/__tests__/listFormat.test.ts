import { describe, expect, it } from 'vitest'
import arCommon from '../../../i18n/locales/ar/common.json'
import enCommon from '../../../i18n/locales/en/common.json'
import { joinList } from '../listFormat'

const translator = (messages: { app: { listSeparator: string } }) => (key: string) => (key === 'app.listSeparator' ? messages.app.listSeparator : key)

describe('joinList', () => {
  it('uses the Arabic comma in Arabic', () => {
    expect(joinList(['سارة', 'ليلى', 'منى'], translator(arCommon))).toBe('سارة، ليلى، منى')
  })

  it('uses the Latin comma in English', () => {
    expect(joinList(['Sara', 'Layla'], translator(enCommon))).toBe('Sara, Layla')
  })

  it('returns one item unchanged and an empty list as an empty string', () => {
    expect(joinList(['Sara'], translator(enCommon))).toBe('Sara')
    expect(joinList([], translator(enCommon))).toBe('')
  })
})
