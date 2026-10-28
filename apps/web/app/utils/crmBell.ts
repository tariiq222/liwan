import { CrmBellRowSchema, type CrmBellRow } from '@webvue/contracts'
import { agreeKey, termFormForCount } from '../composables/crm/useCrmTerms'

type Translate = (key: string, named?: Record<string, unknown>) => string

const SINGLE_KEYS: Record<Exclude<CrmBellRow['kind'], 'crm.assigned'>, string> = {
  'crm.followup_due': 'crm.bell.followupDue',
  'crm.needs_manager': 'crm.bell.needsManager',
}

/**
 * The title of a CRM bell row. The server sends the opportunity's name, how many an assignment stands for and the
 * company's own word for an opportunity; the sentence is worded here, in the UI language, so it never arrives as prose.
 * A row that does not match the contract shows its plain title instead of breaking the bell.
 */
export function crmBellTitle(row: Record<string, unknown>, t: Translate, language: 'ar' | 'en'): string {
  const parsed = CrmBellRowSchema.safeParse(row)
  if (!parsed.success) return typeof row.title === 'string' ? row.title : ''
  const { kind, title: name, count, term } = parsed.data
  if (kind !== 'crm.assigned') return t(SINGLE_KEYS[kind], { name })
  const word = term[language]
  if (count === 1) return t('crm.bell.assigned', { term: word.singular, name })
  return t(agreeKey('crm.bell.assignedMany', term.gender), { count, term: termFormForCount(count, language) === 'one' ? word.singular : word.plural, name })
}

/**
 * The bell's title callback: the bell calls it while it renders, so the app's own translator and language are at hand.
 * (The callback is handed only a translator without named values, which the sentences need.)
 */
export function crmBellTitleInApp(row: Record<string, unknown>): string {
  const { $i18n } = useNuxtApp()
  return crmBellTitle(row, (key, named) => $i18n.t(key, named ?? {}), $i18n.locale.value === 'en' ? 'en' : 'ar')
}
