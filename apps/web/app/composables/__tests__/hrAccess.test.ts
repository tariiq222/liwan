import { describe, expect, it } from 'vitest'
import { hrAccessLabelKey } from '../hrAccess'

describe('HR access badge mapping', () => {
  it('maps every wire access state to its locale key', () => {
    expect(hrAccessLabelKey({ access: null })).toBe('hr.directory.access.noAccount')
    expect(hrAccessLabelKey({ access: { user_id: 1, login: 'a', role: 'employee', active: true } })).toBe('hr.directory.access.employee')
    expect(hrAccessLabelKey({ access: { user_id: 1, login: 'a', role: 'admin', active: true } })).toBe('hr.directory.access.admin')
    expect(hrAccessLabelKey({ access: { user_id: 1, login: 'a', role: 'vendor', active: true } })).toBe('hr.directory.access.vendor')
    expect(hrAccessLabelKey({ access: { user_id: 1, login: 'a', role: 'employee', active: false } })).toBe('hr.directory.access.stopped')
  })
})
