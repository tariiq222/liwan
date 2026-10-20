import { describe, expect, it } from 'vitest'
import { accountPatch } from '../analyticForms'

const account = { id: 1, name: 'مشروع الرياض', code: 'PRJ-01', plan: { id: 2, name: 'المشاريع' }, active: true }

describe('the cost center edit', () => {
  it('sends only what changed, trimmed', () => {
    expect(accountPatch(account, ' مشروع جدة ', 'PRJ-01')).toEqual({ name: 'مشروع جدة' })
    expect(accountPatch(account, 'مشروع الرياض', 'PRJ-02')).toEqual({ code: 'PRJ-02' })
    expect(accountPatch(account, 'x', '')).toEqual({ name: 'x', code: '' })
  })

  it('sends nothing when nothing changed', () => {
    expect(accountPatch(account, ' مشروع الرياض ', 'PRJ-01 ')).toBeNull()
  })
})
