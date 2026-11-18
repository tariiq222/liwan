import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { pluralRules } from '../pluralRules'

const load = (lang: 'ar' | 'en') => JSON.parse(readFileSync(join(__dirname, '../../../../packages/commercial-ui/i18n/locales', lang, 'commercial.json'), 'utf8'))
const i18n = createI18n({ legacy: false, locale: 'ar', fallbackLocale: 'en', messages: { ar: load('ar'), en: load('en') } as never, pluralRules }) as unknown as { global: { t: (key: string, params: Record<string, unknown>, plural: number) => string; locale: { value: string } } }
const t = (key: string, count: number) => i18n.global.t(key, { count }, count)

describe('commercial.pricing.cadence', () => {
  it('reads correctly for every cadence count 1 to 12 in Arabic', () => {
    const month = Array.from({ length: 12 }, (_, i) => t('commercial.pricing.cadence.month', i + 1))
    expect(month).toEqual(['شهري', 'كل شهرين', 'كل 3 أشهر', 'كل 4 أشهر', 'كل 5 أشهر', 'كل 6 أشهر', 'كل 7 أشهر', 'كل 8 أشهر', 'كل 9 أشهر', 'كل 10 أشهر', 'كل 11 شهرًا', 'كل 12 شهرًا'])
    const year = Array.from({ length: 12 }, (_, i) => t('commercial.pricing.cadence.year', i + 1))
    expect(year.slice(0, 3)).toEqual(['سنوي', 'كل سنتين', 'كل 3 سنوات'])
    expect(year[10]).toBe('كل 11 سنة')
  })

  it('reads correctly in English', () => {
    i18n.global.locale.value = 'en'
    expect(t('commercial.pricing.cadence.month', 1)).toBe('Monthly')
    expect(t('commercial.pricing.cadence.month', 3)).toBe('Every 3 months')
    expect(t('commercial.pricing.cadence.year', 2)).toBe('Every 2 years')
    i18n.global.locale.value = 'ar'
  })
})
