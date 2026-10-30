import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { CrmSettingsTermsSchema, type CrmSettingsTerms } from '@liwan/contracts'
import { termFormForCount, type CrmTermForm, type CrmTermGender } from '../../utils/crmTermForms'
import { crmKeys } from './crmKeys'

export type CrmTermKey = keyof CrmSettingsTerms

/** The words a company that never renamed anything sees; they equal the server defaults. */
export const DEFAULT_CRM_TERMS: CrmSettingsTerms = {
  customer: { ar: { singular: 'عميل', plural: 'عملاء' }, en: { singular: 'customer', plural: 'customers' }, gender: 'm' },
  opportunity: { ar: { singular: 'فرصة', plural: 'فرص' }, en: { singular: 'opportunity', plural: 'opportunities' }, gender: 'f' },
  package: { ar: { singular: 'باقة', plural: 'باقات' }, en: { singular: 'plan', plural: 'plans' }, gender: 'f' },
}

const FORM_FIELD = { one: 'singular', other: 'plural' } as const

export function termWord(terms: CrmSettingsTerms, key: CrmTermKey, form: CrmTermForm, language: 'ar' | 'en'): string {
  return terms[key][language][FORM_FIELD[form]]
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
