import { describe, expect, it } from 'vitest'
import {
  ChangeCategoryListSchema, ChangeCategoryWriteSchema, ChangeControlModeSchema, ProjectChangeActionSchema,
  ProjectChangeListSchema, ProjectChangePatchSchema, ProjectChangeSchema, ProjectChangeWriteSchema,
} from '../change'
import { NotificationSchema } from '../notification'

const change = {
  id: 4, project_id: 2, number: 3, title: 'Add a reporting module', description: '', reason: 'The client asked',
  category: { id: 7, name: 'Cost' }, state: 'submitted', requester: { id: 5, name: 'Sara' },
  impact_schedule_days: -3, impact_cost: 1250.5, currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  impact_scope: '', decided_by: null, decided_at: null, decision_note: '', implemented_at: null,
  created_at: '2026-11-01T10:00:00Z', updated_at: 'v2',
  can_edit: false, can_submit: false, can_withdraw: true, can_decide: false, can_implement: false,
}

describe('change request contracts', () => {
  it('round trips a request, with a negative schedule impact and a null category', () => {
    expect(ProjectChangeSchema.parse(change)).toEqual(change)
    expect(ProjectChangeSchema.safeParse({ ...change, category: null, currency: null }).success).toBe(true)
  })

  it('rejects an unknown state, a bad write token and extra keys', () => {
    expect(ProjectChangeSchema.safeParse({ ...change, state: 'archived' }).success).toBe(false)
    expect(ProjectChangeSchema.safeParse({ ...change, updated_at: '2' }).success).toBe(false)
    expect(ProjectChangeSchema.safeParse({ ...change, extra: 1 }).success).toBe(false)
  })

  it('keeps the list envelope strict', () => {
    expect(ProjectChangeListSchema.safeParse({ items: [change], total: 1, can_create: true }).success).toBe(true)
    expect(ProjectChangeListSchema.safeParse({ items: [change], total: 1 }).success).toBe(false)
  })

  it('accepts only the writable fields, and a patch needs its token', () => {
    expect(ProjectChangeWriteSchema.safeParse({ title: 'x', category_id: null, impact_cost: -5 }).success).toBe(true)
    expect(ProjectChangeWriteSchema.safeParse({ state: 'approved' }).success).toBe(false)
    expect(ProjectChangePatchSchema.safeParse({ title: 'x' }).success).toBe(false)
    expect(ProjectChangePatchSchema.safeParse({ title: 'x', expected_updated_at: 'v2' }).success).toBe(true)
  })

  it('limits a decision note to 2000 characters', () => {
    expect(ProjectChangeActionSchema.safeParse({ note: 'x'.repeat(2000) }).success).toBe(true)
    expect(ProjectChangeActionSchema.safeParse({ note: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('knows the three modes only', () => {
    expect(ChangeControlModeSchema.options).toEqual(['off', 'optional', 'required'])
    expect(ChangeControlModeSchema.safeParse('sometimes').success).toBe(false)
  })

  it('reads and writes the category list', () => {
    const item = { id: 1, name: 'Scope', sequence: 10, active: true }
    expect(ChangeCategoryListSchema.safeParse({ items: [item], total: 1 }).success).toBe(true)
    expect(ChangeCategoryWriteSchema.safeParse({ name: '' }).success).toBe(false)
    expect(ChangeCategoryWriteSchema.safeParse({ active: false }).success).toBe(true)
  })

  it('parses the three bell rows of a change request', () => {
    for (const kind of ['change_review', 'change_approved', 'change_rejected']) {
      const row = { id: 1, kind, project_id: 2, project_name: 'Alpha', change_id: 4, body: 'x', created_at: 'now', is_read: false }
      expect(NotificationSchema.safeParse(row).success, kind).toBe(true)
      expect(NotificationSchema.safeParse({ ...row, change_id: undefined }).success, kind).toBe(false)
    }
  })
})
