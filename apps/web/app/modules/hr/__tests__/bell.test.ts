import { describe, expect, it } from 'vitest'
import { canReachPath } from '../../../utils/accessPolicy'
import arHr from '../../../../i18n/locales/ar/hr.json'
import enHr from '../../../../i18n/locales/en/hr.json'
import manifest from '../manifest'
import { hrBellHref, hrBellTitle } from '../bell'

// A minimal vue-i18n: dotted keys into the locale file, `{name}` placeholders replaced.
const translator = (messages: object) => (key: string, named: Record<string, unknown> = {}) => {
  const message = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages)
  if (typeof message !== 'string') throw new Error(`missing key ${key}`)
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(named[name]))
}

const row = (kind: string) => ({ id: 1, kind, leave_id: 7, title: '2026-11-02 - 2026-11-03', created_at: '2026-10-29T09:00:00Z', is_read: false })

describe('hr leave bell rows', () => {
  it('words the decision in Arabic and English with the leave dates', () => {
    expect(hrBellTitle(row('hr.leave_approved'), translator(arHr))).toBe('تم اعتماد طلب إجازتك (2026-11-02 - 2026-11-03)')
    expect(hrBellTitle(row('hr.leave_refused'), translator(arHr))).toBe('تم رفض طلب إجازتك (2026-11-02 - 2026-11-03)')
    expect(hrBellTitle(row('hr.leave_approved'), translator(enHr))).toBe('Your leave request (2026-11-02 - 2026-11-03) was approved')
    expect(hrBellTitle(row('hr.leave_refused'), translator(enHr))).toBe('Your leave request (2026-11-02 - 2026-11-03) was refused')
  })

  it('words an onboarding step with its summary and opens the own tasks page', () => {
    const step = { id: 2, kind: 'hr.onboarding_step', run_id: 5, title: 'Sign the contract', created_at: '2026-10-31T09:00:00Z', is_read: false }
    expect(hrBellTitle(step, translator(arHr))).toBe('تم إسناد خطوة تهيئة إليك: Sign the contract')
    expect(hrBellTitle(step, translator(enHr))).toBe('An onboarding step was assigned to you: Sign the contract')
    expect(hrBellHref(step)).toBe('/account/onboarding')
    expect(canReachPath({ capabilities: ['hr.employees.read', 'hr.leave.read'], platform: { readable_features: ['hr.enabled', 'hr.onboarding'], writable_features: [] } }, '/account/onboarding')).toBe(true)
  })

  it('words a warning with its type only, never the reason, and opens the own warnings page', () => {
    const issued = { id: 3, kind: 'hr.warning_issued', warning_id: 9, title: 'Written warning', created_at: '2026-11-01T09:00:00Z', is_read: false }
    expect(hrBellTitle(issued, translator(arHr))).toBe('صدر بحقك إنذار إداري: Written warning')
    expect(hrBellTitle(issued, translator(enHr))).toBe('An administrative warning was issued to you: Written warning')
    expect(hrBellHref(issued)).toBe('/account/warnings')
    expect(canReachPath({ capabilities: ['hr.employees.read'], platform: { readable_features: ['hr.enabled', 'hr.warnings'], writable_features: [] } }, '/account/warnings')).toBe(true)
    expect(canReachPath({ capabilities: ['hr.employees.read'], platform: { readable_features: ['hr.enabled'], writable_features: [] } }, '/account/warnings')).toBe(false)
  })

  it('falls back to the plain title for a row that breaks the contract', () => {
    expect(hrBellTitle({ ...row('hr.leave_approved'), leave_id: 'x' }, translator(enHr))).toBe('2026-11-02 - 2026-11-03')
  })

  it('opens the leave request page and is declared by the manifest', () => {
    expect(hrBellHref(row('hr.leave_approved'))).toBe('/account/leave/7')
    // The row goes to the requester, who may hold only the self-service leave capabilities.
    expect(canReachPath({ capabilities: ['hr.employees.read', 'hr.leave.read', 'hr.leave.request'] }, '/account/leave/7')).toBe(true)
    expect(canReachPath({ capabilities: ['hr.employees.read', 'hr.leave.read', 'hr.leave.request'] }, '/hr/leave/7')).toBe(false)
    expect(hrBellHref({ kind: 'hr.leave_approved' })).toBeNull()
    // A custom role with only hr.employees.read still gets the bell for its own warnings.
    expect(manifest.bell?.capabilities).toEqual(['hr.employees.read'])
    expect(manifest.bell?.kinds?.map(kind => kind.kind)).toEqual(['hr.leave_approved', 'hr.leave_refused', 'hr.onboarding_step', 'hr.warning_issued'])
  })
})
