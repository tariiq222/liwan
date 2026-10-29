import { describe, expect, it } from 'vitest'
import arCrm from '../../../i18n/locales/ar/crm.json'
import enCrm from '../../../i18n/locales/en/crm.json'
import { crmBellTitle } from '../crmBell'

// A minimal vue-i18n: dotted keys into the locale file, `{name}` placeholders replaced.
const translator = (messages: object) => (key: string, named: Record<string, unknown> = {}) => {
  const message = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages)
  if (typeof message !== 'string') throw new Error(`missing key ${key}`)
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(named[name]))
}

const term = (gender: 'm' | 'f') => ({ ar: { singular: 'فرصة', plural: 'فرص' }, en: { singular: 'opportunity', plural: 'opportunities' }, gender })
const row = (kind: string, extra: Record<string, unknown> = {}) => ({ id: 1, kind, opportunity_id: 9, title: 'Mona', count: 1, term: term('f'), created_at: '2026-10-28T09:00:00Z', is_read: false, ...extra })

describe('crmBellTitle', () => {
  const ar = translator(arCrm)
  const en = translator(enCrm)

  it('words one assignment with the company term and the name', () => {
    expect(crmBellTitle(row('crm.assigned'), ar, 'ar')).toBe('تم إسناد فرصة لك: Mona')
    expect(crmBellTitle(row('crm.assigned'), en, 'en')).toBe('New opportunity assigned to you: Mona')
  })

  it('words a batch with the counted form of the term and the first name', () => {
    expect(crmBellTitle(row('crm.assigned', { count: 3 }), ar, 'ar')).toBe('تم إسناد 3 فرص إليك. الأولى: Mona')
    expect(crmBellTitle(row('crm.assigned', { count: 11 }), ar, 'ar')).toBe('تم إسناد 11 فرصة إليك. الأولى: Mona')
    expect(crmBellTitle(row('crm.assigned', { count: 3, term: term('m') }), ar, 'ar')).toBe('تم إسناد 3 فرص إليك. الأول: Mona')
    expect(crmBellTitle(row('crm.assigned', { count: 3 }), en, 'en')).toBe('3 opportunities assigned to you, first: Mona')
  })

  it('words a due follow-up and a manager decision', () => {
    expect(crmBellTitle(row('crm.followup_due'), ar, 'ar')).toBe('اتصال متابعة مستحق: Mona')
    expect(crmBellTitle(row('crm.needs_manager'), ar, 'ar')).toBe('يحتاج قرار المدير: Mona')
    expect(crmBellTitle(row('crm.needs_manager'), en, 'en')).toBe('Needs a manager decision: Mona')
  })

  it('shows the plain title of a row it cannot read instead of failing the bell', () => {
    expect(crmBellTitle({ kind: 'crm.assigned', title: 'Mona' }, ar, 'ar')).toBe('Mona')
    expect(crmBellTitle({ kind: 'crm.assigned' }, ar, 'ar')).toBe('')
  })
})
