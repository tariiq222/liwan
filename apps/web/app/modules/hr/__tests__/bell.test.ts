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

  it('falls back to the plain title for a row that breaks the contract', () => {
    expect(hrBellTitle({ ...row('hr.leave_approved'), leave_id: 'x' }, translator(enHr))).toBe('2026-11-02 - 2026-11-03')
  })

  it('opens the leave request page and is declared by the manifest', () => {
    expect(hrBellHref(row('hr.leave_approved'))).toBe('/account/leave/7')
    // The row goes to the requester, who may hold only the self-service leave capabilities.
    expect(canReachPath({ capabilities: ['hr.employees.read', 'hr.leave.read', 'hr.leave.request'] }, '/account/leave/7')).toBe(true)
    expect(canReachPath({ capabilities: ['hr.employees.read', 'hr.leave.read', 'hr.leave.request'] }, '/hr/leave/7')).toBe(false)
    expect(hrBellHref({ kind: 'hr.leave_approved' })).toBeNull()
    expect(manifest.bell?.kinds?.map(kind => kind.kind)).toEqual(['hr.leave_approved', 'hr.leave_refused'])
  })
})
