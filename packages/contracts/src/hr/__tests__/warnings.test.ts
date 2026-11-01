import { describe, expect, it } from 'vitest'
import {
  HrWarningBellRowSchema,
  HrWarningCandidateListSchema,
  HrWarningContestSchema,
  HrWarningCreateSchema,
  HrWarningListSchema,
  HrWarningRevisionSchema,
  HrWarningSchema,
  HrWarningSettingsPatchSchema,
  HrWarningSettingsSchema,
  HrWarningStandingSchema,
  HrWarningTypeCreateSchema,
  HrWarningTypeListSchema,
  HrWarningTypePatchSchema,
  HrWarningWithdrawSchema,
} from '..'

const WARNING = {
  id: 4,
  employee: { id: 10, name: 'Noura' },
  type: { id: 2, name: 'إنذار كتابي', severity: 20 },
  date_issued: '2026-11-01',
  reason: 'تأخر متكرر',
  corrective_action: 'الالتزام بالدوام',
  state: 'issued',
  acknowledgement: 'required',
  ack_pending: true,
  issued_by: { id: 3, name: 'HR' },
  issued_at: '2026-11-01T08:00:00Z',
  acknowledged_at: null,
  contested_at: null,
  contest_note: null,
  withdrawn_by: null,
  withdrawn_at: null,
  withdraw_reason: null,
  revision: 2,
}

describe('HrWarningSchema', () => {
  it('accepts an issued warning inside the list envelope', () => {
    const parsed = HrWarningListSchema.parse({ items: [WARNING], total: 1 })
    expect(parsed.items[0]?.ack_pending).toBe(true)
  })

  it('accepts a draft that was never issued and a withdrawn warning', () => {
    const draft = { ...WARNING, state: 'draft', acknowledgement: 'optional', ack_pending: false, issued_by: null, issued_at: null, revision: 1 }
    expect(HrWarningSchema.parse(draft).issued_at).toBeNull()
    const withdrawn = {
      ...WARNING, state: 'withdrawn', ack_pending: false, withdrawn_by: { id: 3, name: 'HR' },
      withdrawn_at: '2026-11-02T08:00:00Z', withdraw_reason: 'Resolved',
    }
    expect(HrWarningSchema.parse(withdrawn).withdraw_reason).toBe('Resolved')
  })

  it('rejects an unknown state, an unknown key and a missing revision', () => {
    expect(() => HrWarningSchema.parse({ ...WARNING, state: 'closed' })).toThrow()
    expect(() => HrWarningSchema.parse({ ...WARNING, extra: 1 })).toThrow()
    expect(() => HrWarningSchema.parse({ ...WARNING, revision: undefined })).toThrow()
  })
})

describe('warning writes', () => {
  it('requires an employee, a type and a reason to draft', () => {
    expect(HrWarningCreateSchema.parse({ employee_id: 10, type_id: 2, reason: ' Late ' }).reason).toBe('Late')
    expect(() => HrWarningCreateSchema.parse({ employee_id: 10, type_id: 2, reason: ' ' })).toThrow()
    expect(() => HrWarningCreateSchema.parse({ employee_id: 10, reason: 'x' })).toThrow()
    expect(() => HrWarningCreateSchema.parse({ employee_id: 10, type_id: 2, reason: 'x', state: 'issued' })).toThrow()
  })

  it('carries the revision on every step and a reason or note where one is required', () => {
    expect(HrWarningRevisionSchema.parse({ revision: 2 }).revision).toBe(2)
    expect(() => HrWarningRevisionSchema.parse({})).toThrow()
    expect(() => HrWarningWithdrawSchema.parse({ revision: 2, reason: '' })).toThrow()
    expect(HrWarningContestSchema.parse({ revision: 2, note: 'Not me' }).note).toBe('Not me')
    expect(() => HrWarningContestSchema.parse({ revision: 2 })).toThrow()
  })
})

describe('warning types', () => {
  const type = { id: 1, name: 'إنذار شفهي', severity: 10, active: true, revision: 1 }

  it('lists the tenant value list', () => {
    expect(HrWarningTypeListSchema.parse({ items: [type], total: 1 }).items).toHaveLength(1)
  })

  it('creates with a name and a severity and patches with at least one field', () => {
    expect(HrWarningTypeCreateSchema.parse({ name: 'Safety', severity: 25 }).severity).toBe(25)
    expect(() => HrWarningTypeCreateSchema.parse({ name: 'Safety', severity: 0 })).toThrow()
    expect(HrWarningTypePatchSchema.parse({ revision: 1, active: false }).active).toBe(false)
    expect(() => HrWarningTypePatchSchema.parse({ revision: 1 })).toThrow()
  })
})

describe('warning settings and standing', () => {
  const settings = {
    warnings_issued_by: 'hr_only', warnings_employee_acknowledgement: 'optional',
    warnings_escalation_window_months: 12, can_issue: false, revision: 0,
  }

  it('accepts the defaults before the first save and bounds the window', () => {
    expect(HrWarningSettingsSchema.parse(settings).revision).toBe(0)
    const { can_issue: _canIssue, ...policy } = settings
    expect(HrWarningSettingsPatchSchema.parse({ ...policy, warnings_issued_by: 'manager_and_hr' }).warnings_issued_by).toBe('manager_and_hr')
    expect(() => HrWarningSettingsPatchSchema.parse(settings)).toThrow()
    expect(() => HrWarningSettingsSchema.parse(policy)).toThrow()
    expect(() => HrWarningSettingsSchema.parse({ ...settings, warnings_escalation_window_months: 61 })).toThrow()
    expect(() => HrWarningSettingsSchema.parse({ ...settings, warnings_issued_by: 'anyone' })).toThrow()
  })

  it('accepts a standing with no counted warning', () => {
    const standing = { employee_id: 10, window_months: 12, active_count: 0, highest_severity: null }
    expect(HrWarningStandingSchema.parse(standing).highest_severity).toBeNull()
    expect(HrWarningStandingSchema.parse({ ...standing, active_count: 2, highest_severity: 30 }).active_count).toBe(2)
  })
})

describe('HrWarningCandidateListSchema', () => {
  it('lists the employees the caller may warn', () => {
    expect(HrWarningCandidateListSchema.parse({ items: [{ id: 10, name: 'Noura' }], total: 1 }).total).toBe(1)
    expect(() => HrWarningCandidateListSchema.parse({ items: [{ id: 10 }], total: 1 })).toThrow()
  })
})

describe('HrWarningBellRowSchema', () => {
  const row = { id: 5, kind: 'hr.warning_issued', warning_id: 4, title: 'إنذار كتابي', created_at: '2026-11-01T08:00:00Z', is_read: false }

  it('points at the warning', () => {
    expect(HrWarningBellRowSchema.parse(row).warning_id).toBe(4)
  })

  it('rejects another kind or a row without its warning', () => {
    expect(() => HrWarningBellRowSchema.parse({ ...row, kind: 'hr.leave_approved' })).toThrow()
    expect(() => HrWarningBellRowSchema.parse({ ...row, warning_id: undefined })).toThrow()
  })
})
