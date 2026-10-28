import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { CrmSettingsTermsSchema, type CrmSettingsTerms } from '@webvue/contracts'
import { arabicPluralRule } from '../../../i18n/pluralRules'
import { crmKeys } from './crmKeys'

export type CrmTermKey = keyof CrmSettingsTerms
export type CrmTermForm = 'one' | 'other'
export type CrmTermGender = 'm' | 'f'

/** The words a company that never renamed anything sees; they equal the server defaults. */
export const DEFAULT_CRM_TERMS: CrmSettingsTerms = {
  customer: { ar: { singular: 'عميل', plural: 'عملاء' }, en: { singular: 'customer', plural: 'customers' }, gender: 'm' },
  opportunity: { ar: { singular: 'فرصة', plural: 'فرص' }, en: { singular: 'opportunity', plural: 'opportunities' }, gender: 'f' },
  package: { ar: { singular: 'باقة', plural: 'باقات' }, en: { singular: 'plan', plural: 'plans' }, gender: 'f' },
}

/**
 * vue-i18n has no ICU `select`, so a message that must agree with a term's gender has one variant per gender
 * (`<key>.m`, `<key>.f`), each taking the term as `{term}`: «عميل جديد» and «حالة جديدة».
 */
export const agreeKey = (messageKey: string, gender: CrmTermGender) => `${messageKey}.${gender}`

const FORM_FIELD = { one: 'singular', other: 'plural' } as const

export function termWord(terms: CrmSettingsTerms, key: CrmTermKey, form: CrmTermForm, language: 'ar' | 'en'): string {
  return terms[key][language][FORM_FIELD[form]]
}

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

/**
 * The company's own words for customer, opportunity and package, in the UI language. Every CRM user reads them from
 * `/crm/terms` (the settings route is for managers); until they load, or if they cannot be read, the defaults show.
 */
export function useCrmTerms() {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  const { locale } = useI18n()
  const query = useQuery({
    queryKey: computed(() => crmKeys.terms(me.value?.company?.id)),
    enabled: computed(() => !!me.value && can('crm.leads.read')),
    queryFn: () => $api('/api/v1/crm/terms', { schema: CrmSettingsTermsSchema }),
    staleTime: 5 * 60_000,
  })
  const terms = computed(() => query.data.value ?? DEFAULT_CRM_TERMS)
  const language = computed<'ar' | 'en'>(() => (locale.value === 'en' ? 'en' : 'ar'))
  return {
    terms,
    term: (key: CrmTermKey, form: CrmTermForm) => termWord(terms.value, key, form, language.value),
    termFor: (key: CrmTermKey, count: number) => termWord(terms.value, key, termFormForCount(count, language.value), language.value),
    gender: (key: CrmTermKey): CrmTermGender => terms.value[key].gender,
  }
}
