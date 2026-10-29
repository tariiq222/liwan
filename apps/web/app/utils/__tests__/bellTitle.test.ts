import { afterEach, describe, expect, it, vi } from 'vitest'
import { declaredBellTitle } from '../bellTitle'

const term = { ar: { singular: 'فرصة', plural: 'فرص' }, en: { singular: 'opportunity', plural: 'opportunities' }, gender: 'f' }
const crmRow = { id: 3, kind: 'crm.followup_due', opportunity_id: 17, title: 'Mona', count: 1, term, created_at: '2026-10-28T09:00:00Z', is_read: false }

afterEach(() => vi.unstubAllGlobals())

describe('declaredBellTitle', () => {
  it("words a CRM row with the manifest's title, not the plain name", () => {
    vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (key: string, named: Record<string, string>) => `${key}|${named.name}`, locale: { value: 'ar' } } }))
    expect(declaredBellTitle(crmRow, key => key)).toBe('crm.bell.followupDue|Mona')
  })

  it('has nothing for a kind no manifest declares', () => {
    expect(declaredBellTitle({ kind: 'sales_order_assigned' }, key => key)).toBeUndefined()
  })
})
