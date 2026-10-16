// Arabic plural rule for vue-i18n. A message with six forms maps to the CLDR
// categories in this order: zero | one | two | few | many | other
// (0, 1, 2, 3-10, 11-99, 100+). Messages with fewer forms keep the vue-i18n
// default rule, so existing "a | b" messages still work.
import type { PluralizationRule } from 'vue-i18n'

const ARABIC_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
const arabicCategories = new Intl.PluralRules('ar')

// Same as the vue-i18n built-in rule.
function defaultRule(choice: number, choicesLength: number): number {
  const index = Math.abs(choice)
  if (choicesLength === 2) return index ? (index > 1 ? 1 : 0) : 1
  return index ? Math.min(index, 2) : 0
}

export const arabicPluralRule: PluralizationRule = (choice, choicesLength) => {
  if (choicesLength !== ARABIC_FORMS.length) return defaultRule(choice, choicesLength)
  return ARABIC_FORMS.indexOf(arabicCategories.select(Math.abs(choice)) as typeof ARABIC_FORMS[number])
}

export const pluralRules = { ar: arabicPluralRule }
