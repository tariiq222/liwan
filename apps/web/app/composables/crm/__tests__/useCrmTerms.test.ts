import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { arabicPluralRule } from '../../../../i18n/pluralRules'
import arCrm from '../../../../i18n/locales/ar/crm.json'
import enCrm from '../../../../i18n/locales/en/crm.json'
import { DEFAULT_CRM_TERMS, termWord } from '../useCrmTerms'
import { agreeKey, termFormForCount } from '../../../utils/crmTermForms'

const i18n = createI18n({
  legacy: false,
  locale: 'ar',
  pluralRules: { ar: arabicPluralRule },
  messages: { ar: arCrm, en: enCrm },
})
const t = i18n.global.t
const newRecord = (word: string, gender: 'm' | 'f') => t(agreeKey('crm.settings.terms.preview', gender), { term: word })

describe('crm terms', () => {
  it('reads «عميل جديد» with the default words', () => {
    const customer = DEFAULT_CRM_TERMS.customer
    expect(newRecord(termWord(DEFAULT_CRM_TERMS, 'customer', 'one', 'ar'), customer.gender)).toBe('عميل جديد')
  })

  it('agrees the adjective with a renamed feminine term: «حالة جديدة»', () => {
    const renamed = { ...DEFAULT_CRM_TERMS, opportunity: { ...DEFAULT_CRM_TERMS.opportunity, ar: { singular: 'حالة', plural: 'حالات' } } }
    expect(newRecord(termWord(renamed, 'opportunity', 'one', 'ar'), renamed.opportunity.gender)).toBe('حالة جديدة')
  })

  it('agrees with a masculine rename too, and does not change in English', () => {
    expect(newRecord('مستفيد', 'm')).toBe('مستفيد جديد')
    i18n.global.locale.value = 'en'
    expect(newRecord('client', 'f')).toBe('New client')
    i18n.global.locale.value = 'ar'
  })

  it('picks the singular or plural word', () => {
    expect(termWord(DEFAULT_CRM_TERMS, 'package', 'one', 'ar')).toBe('باقة')
    expect(termWord(DEFAULT_CRM_TERMS, 'package', 'other', 'ar')).toBe('باقات')
    expect(termWord(DEFAULT_CRM_TERMS, 'package', 'other', 'en')).toBe('plans')
    expect(termWord(DEFAULT_CRM_TERMS, 'package', 'one', 'en')).toBe('plan')
  })

  it.each([
    [0, 'other', 'other'],
    [1, 'one', 'one'],
    [2, 'other', 'other'],
    [3, 'other', 'other'],
    [11, 'one', 'other'],
    [99, 'one', 'other'],
    [100, 'one', 'other'],
    [101, 'one', 'other'],
  ] as const)('counts %i as %s in Arabic and %s in English', (count, arabic, english) => {
    expect(termFormForCount(count, 'ar')).toBe(arabic)
    expect(termFormForCount(count, 'en')).toBe(english)
  })
})
