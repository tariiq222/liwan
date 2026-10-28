import { arabicPluralRule } from '../../i18n/pluralRules'

// Pure word-form rules of the CRM terms. They import nothing that reaches the app registry, so the CRM manifest's bell
// titles can use them without a circular import.

export type CrmTermForm = 'one' | 'other'
export type CrmTermGender = 'm' | 'f'

/**
 * vue-i18n has no ICU `select`, so a message that must agree with a term's gender has one variant per gender
 * (`<key>.m`, `<key>.f`), each taking the term as `{term}`: «عميل جديد» and «حالة جديدة».
 */
export const agreeKey = (messageKey: string, gender: CrmTermGender) => `${messageKey}.${gender}`

// Positions of the CLDR Arabic categories in `arabicPluralRule` (zero | one | two | few | many | other) whose counted noun is plural.
const ARABIC_PLURAL_CATEGORIES: ReadonlySet<number> = new Set([0, 2, 3])
const ARABIC_CATEGORY_COUNT = 6

/**
 * The form a counted noun takes. Arabic counts 1, 11-99 and 100 or more with the singular («١١ عميلاً», «١٠٠ عميل»);
 * 0, 2 and 3-10 take the plural. English uses the singular for exactly one. The Arabic categories come from the
 * shared plural rule of the locale layer.
 */
export function termFormForCount(count: number, language: 'ar' | 'en'): CrmTermForm {
  if (language === 'ar') return ARABIC_PLURAL_CATEGORIES.has(arabicPluralRule(count, ARABIC_CATEGORY_COUNT)) ? 'other' : 'one'
  return new Intl.PluralRules('en').select(Math.abs(count)) === 'one' ? 'one' : 'other'
}
