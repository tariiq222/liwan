import { describe, expect, it } from 'vitest'
import {
  HrInsuranceBellRowSchema,
  HrInsuranceDependentCreateSchema,
  HrInsuranceDependentPatchSchema,
  HrInsuranceDependentSchema,
  HrInsuranceEndSchema,
  HrInsuranceEnrollmentCreateSchema,
  HrInsuranceEnrollmentDetailSchema,
  HrInsuranceEnrollmentListSchema,
  HrInsuranceEnrollmentPatchSchema,
  HrInsuranceOwnListSchema,
  HrInsurancePlanCreateSchema,
  HrInsurancePlanListSchema,
  HrInsurancePlanPatchSchema,
  HrInsurancePlanSchema,
  HrInsuranceProviderCreateSchema,
  HrInsuranceProviderListSchema,
  HrInsuranceProviderPatchSchema,
  HrInsuranceSettingsSchema,
  HrInsuranceSummarySchema,
} from '..'

const PLAN = {
  id: 3,
  provider: { id: 1, name: 'Bupa' },
  name: 'Gold 2026',
  tier: 'Gold',
  policy_number: 'POL-1',
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  annual_premium: 1500,
  state: 'active',
  expires_in_days: 60,
  active: true,
  revision: 1,
}
const PLAN_REF = { id: 3, provider: { id: 1, name: 'Bupa' }, name: 'Gold 2026', tier: 'Gold', valid_from: '2026-01-01', valid_to: '2026-12-31' }
const DEPENDENT = {
  id: 7,
  enrollment_id: 5,
  name: 'Sara',
  relation: 'spouse',
  birth_date: '1990-04-01',
  national_id_masked: '******5432',
  national_id: null,
  date_from: '2026-02-01',
  date_to: null,
  state: 'active',
  revision: 1,
}
const ENROLLMENT_CORE = {
  id: 5,
  employee: { id: 10, name: 'Noura' },
  member_number: 'MBR-1',
  date_from: '2026-02-01',
  date_to: null,
  date_end: '2026-12-31',
  state: 'active',
  employee_share: 100,
  company_share: 300,
  revision: 1,
}

describe('providers and plans', () => {
  it('lists the providers and plans inside the envelope', () => {
    expect(HrInsuranceProviderListSchema.parse({ items: [{ id: 1, name: 'Bupa', active: true, revision: 1 }], total: 1 }).total).toBe(1)
    expect(HrInsurancePlanListSchema.parse({ items: [PLAN], total: 1 }).items[0]?.state).toBe('active')
  })

  it('accepts an archived plan with no expiry figure and rejects an unknown state or key', () => {
    expect(HrInsurancePlanSchema.parse({ ...PLAN, state: 'archived', active: false, expires_in_days: null }).expires_in_days).toBeNull()
    expect(() => HrInsurancePlanSchema.parse({ ...PLAN, state: 'lapsed' })).toThrow()
    expect(() => HrInsurancePlanSchema.parse({ ...PLAN, extra: 1 })).toThrow()
  })

  it('writes a provider with a name and a plan with ordered dates', () => {
    expect(HrInsuranceProviderCreateSchema.parse({ name: ' Bupa ' }).name).toBe('Bupa')
    expect(HrInsuranceProviderPatchSchema.parse({ revision: 1, active: false }).active).toBe(false)
    expect(() => HrInsuranceProviderPatchSchema.parse({ revision: 1 })).toThrow()
    const create = { provider_id: 1, name: 'Gold', valid_from: '2026-01-01', valid_to: '2026-12-31', annual_premium: 1500 }
    expect(HrInsurancePlanCreateSchema.parse(create).annual_premium).toBe(1500)
    expect(() => HrInsurancePlanCreateSchema.parse({ ...create, valid_to: '2025-12-31' })).toThrow()
    expect(() => HrInsurancePlanCreateSchema.parse({ ...create, annual_premium: -1 })).toThrow()
    expect(HrInsurancePlanPatchSchema.parse({ revision: 1, valid_to: '2027-01-01' }).valid_to).toBe('2027-01-01')
    expect(() => HrInsurancePlanPatchSchema.parse({ revision: 1 })).toThrow()
  })
})

describe('enrollments and dependents', () => {
  it('accepts a list row and a detail with its dependents', () => {
    expect(HrInsuranceEnrollmentListSchema.parse({ items: [{ ...ENROLLMENT_CORE, plan: PLAN_REF, dependents_count: 1 }], total: 1 }).total).toBe(1)
    const detail = HrInsuranceEnrollmentDetailSchema.parse({ ...ENROLLMENT_CORE, plan: PLAN, dependents_count: 1, notes: null, dependents: [DEPENDENT] })
    expect(detail.dependents[0]?.national_id_masked).toBe('******5432')
  })

  it('accepts a lapsed enrollment and a cancelled dependent', () => {
    expect(HrInsuranceEnrollmentListSchema.parse({ items: [{ ...ENROLLMENT_CORE, state: 'lapsed', plan: PLAN_REF, dependents_count: 0 }], total: 1 }).items[0]?.state).toBe('lapsed')
    expect(HrInsuranceDependentSchema.parse({ ...DEPENDENT, state: 'cancelled' }).state).toBe('cancelled')
  })

  it('rejects a list row that carries a notes field or a dependent with an unknown relation', () => {
    expect(() => HrInsuranceEnrollmentListSchema.parse({ items: [{ ...ENROLLMENT_CORE, plan: PLAN_REF, dependents_count: 0, notes: 'x' }], total: 1 })).toThrow()
    expect(() => HrInsuranceDependentSchema.parse({ ...DEPENDENT, relation: 'cousin' })).toThrow()
  })

  it('creates with an employee, a plan and a start date and patches only shares and notes', () => {
    const create = { employee_id: 10, plan_id: 3, date_from: '2026-02-01' }
    expect(HrInsuranceEnrollmentCreateSchema.parse({ ...create, member_number: 'M1', employee_share: 50 }).employee_share).toBe(50)
    expect(() => HrInsuranceEnrollmentCreateSchema.parse({ plan_id: 3, date_from: '2026-02-01' })).toThrow()
    expect(HrInsuranceEnrollmentPatchSchema.parse({ revision: 1, notes: 'x' }).notes).toBe('x')
    expect(() => HrInsuranceEnrollmentPatchSchema.parse({ revision: 1, plan_id: 4 })).toThrow()
    expect(() => HrInsuranceEnrollmentPatchSchema.parse({ revision: 1 })).toThrow()
  })

  it('ends with an optional date and carries the revision on every step', () => {
    expect(HrInsuranceEndSchema.parse({ revision: 1 }).revision).toBe(1)
    expect(HrInsuranceEndSchema.parse({ revision: 1, date_end: '2026-06-01' }).date_end).toBe('2026-06-01')
    expect(() => HrInsuranceEndSchema.parse({ date_end: '2026-06-01' })).toThrow()
  })

  it('writes a dependent with a name, a relation and a start date', () => {
    const create = { name: 'Sara', relation: 'child', date_from: '2026-02-01' }
    expect(HrInsuranceDependentCreateSchema.parse({ ...create, national_id: '1098765432' }).national_id).toBe('1098765432')
    expect(() => HrInsuranceDependentCreateSchema.parse({ ...create, relation: 'cousin' })).toThrow()
    expect(HrInsuranceDependentPatchSchema.parse({ revision: 1, name: 'Sarah' }).name).toBe('Sarah')
    expect(() => HrInsuranceDependentPatchSchema.parse({ revision: 1 })).toThrow()
  })
})

describe('the own card, the policy and the summary', () => {
  it('hides nothing the route does not and allows an empty dependents list when the policy hides them', () => {
    const own = { ...ENROLLMENT_CORE, plan: PLAN_REF, dependents_visible: false, dependents: [] }
    expect(HrInsuranceOwnListSchema.parse({ items: [own], total: 1 }).items[0]?.dependents_visible).toBe(false)
    expect(() => HrInsuranceOwnListSchema.parse({ items: [{ ...own, notes: 'x' }], total: 1 })).toThrow()
  })

  it('bounds the alert window and accepts the defaults before the first save', () => {
    const settings = { insurance_visibility: 'own_enrollment_and_dependents', insurance_expiry_alert_days: 60, insurance_require_dependent_id: false, revision: 0 }
    expect(HrInsuranceSettingsSchema.parse(settings).revision).toBe(0)
    expect(() => HrInsuranceSettingsSchema.parse({ ...settings, insurance_expiry_alert_days: 0 })).toThrow()
    expect(() => HrInsuranceSettingsSchema.parse({ ...settings, insurance_expiry_alert_days: 366 })).toThrow()
    expect(() => HrInsuranceSettingsSchema.parse({ ...settings, insurance_visibility: 'all' })).toThrow()
  })

  it('carries counts only', () => {
    const summary = { active_members: 4, active_enrollments: 3, active_dependents: 1, expiring_plans: 1, employees_without_insurance: 2, expiry_alert_days: 60 }
    expect(HrInsuranceSummarySchema.parse(summary).active_members).toBe(4)
    expect(() => HrInsuranceSummarySchema.parse({ ...summary, names: ['x'] })).toThrow()
  })
})

describe('HrInsuranceBellRowSchema', () => {
  const row = { id: 5, kind: 'hr.insurance_plan_expiring', plan_id: 3, title: 'Gold 2026', created_at: '2026-11-01T08:00:00Z', is_read: false }

  it('points at the plan', () => {
    expect(HrInsuranceBellRowSchema.parse(row).plan_id).toBe(3)
  })

  it('rejects another kind or a row without its plan', () => {
    expect(() => HrInsuranceBellRowSchema.parse({ ...row, kind: 'hr.warning_issued' })).toThrow()
    expect(() => HrInsuranceBellRowSchema.parse({ ...row, plan_id: undefined })).toThrow()
  })
})
