import { describe, expect, it } from 'vitest'
import {
  HrActivityPlanCreateSchema,
  HrActivityPlanListSchema,
  HrActivityPlanPatchSchema,
  HrActivityPlanSchema,
  HrOwnOnboardingStepDoneSchema,
  HrOwnOnboardingStepListSchema,
  HrPlanRunCreateSchema,
  HrPlanRunDetailSchema,
  HrPlanRunListSchema,
  HrPlanRunCancelSchema,
  HrPlanRunSchema,
  HrPlanRunStepSchema,
  HrPlanStepDoneSchema,
  HrPlanStepInputSchema,
  HrPlanStepSchema,
} from '..'

const STEP = {
  id: 12,
  summary: 'تهيئة الجهاز',
  responsible_type: 'manager',
  responsible: null,
  delay_count: 0,
  delay_unit: 'days',
  delay_from: 'before_plan_date',
}

const PLAN = {
  id: 4,
  name: 'خطة التهيئة',
  department: { id: 2, name: 'الموارد البشرية' },
  active: true,
  steps: [STEP, { ...STEP, id: 13, responsible_type: 'other', responsible: { id: 7, name: 'Huda' } }],
}

const RUN = {
  id: 8,
  employee: { id: 10, name: 'Noura' },
  plan: { id: 4, name: 'خطة التهيئة' },
  plan_date: '2026-11-02',
  launched_by: { id: 7, name: 'Huda' },
  done: 1,
  total: 2,
  state: 'open',
  cancellation: null,
}

describe('HrActivityPlanSchema', () => {
  it('accepts a plan with its steps inside a list', () => {
    const parsed = HrActivityPlanListSchema.parse({ items: [PLAN], total: 1 })
    expect(parsed.items[0]?.steps).toHaveLength(2)
    expect(parsed.items[0]?.steps[1]?.responsible?.id).toBe(7)
  })

  it('accepts a plan without department and with no steps', () => {
    expect(HrActivityPlanSchema.parse({ ...PLAN, department: null, active: false, steps: [] }).steps).toEqual([])
  })

  it('rejects an unknown responsible type, delay unit and extra keys', () => {
    expect(() => HrPlanStepSchema.parse({ ...STEP, responsible_type: 'hr' })).toThrow()
    expect(() => HrPlanStepSchema.parse({ ...STEP, delay_unit: 'hours' })).toThrow()
    expect(() => HrPlanStepSchema.parse({ ...STEP, delay_from: 'plan_date' })).toThrow()
    expect(() => HrActivityPlanSchema.parse({ ...PLAN, extra: true })).toThrow()
  })
})

describe('plan writes', () => {
  const INPUT = {
    summary: 'تهيئة الجهاز',
    responsible_type: 'other',
    responsible_user_id: 7,
    delay_count: 2,
    delay_unit: 'days',
    delay_from: 'after_plan_date',
  }

  it('accepts a create with at least one step and a step input naming its user', () => {
    const created = HrActivityPlanCreateSchema.parse({ name: ' خطة ', steps: [INPUT] })
    expect(created.name).toBe('خطة')
    expect(created.steps[0]?.responsible_user_id).toBe(7)
  })

  it('requires a responsible user only for the other type', () => {
    const { responsible_user_id: _user, ...withoutUser } = INPUT
    expect(HrPlanStepInputSchema.parse({ ...withoutUser, responsible_type: 'manager' }).responsible_user_id).toBeUndefined()
    expect(() => HrPlanStepInputSchema.parse(withoutUser)).toThrow()
    expect(() => HrPlanStepInputSchema.parse({ ...withoutUser, responsible_type: 'coach', responsible_user_id: 7 })).toThrow()
  })

  it('rejects an empty step list and an empty patch', () => {
    expect(() => HrActivityPlanCreateSchema.parse({ name: 'خطة', steps: [] })).toThrow()
    expect(() => HrActivityPlanPatchSchema.parse({})).toThrow()
    expect(HrActivityPlanPatchSchema.parse({ steps: [INPUT] }).steps).toHaveLength(1)
  })
})

describe('HrPlanRunSchema', () => {
  it('accepts runs and the derived state of a finished checklist', () => {
    const done = { ...RUN, done: 2, state: 'done' }
    expect(HrPlanRunListSchema.parse({ items: [RUN, done], total: 2 }).items[1]?.state).toBe('done')
    expect(() => HrPlanRunSchema.parse({ ...RUN, state: 'closed' })).toThrow()
  })

  it('carries who cancelled a run, when and why, and refuses a cancellation without a reason', () => {
    const cancellation = { by: { id: 7, name: 'Huda' }, on: '2026-10-28T09:30:00Z', reason: 'wrong employee' }
    expect(HrPlanRunSchema.parse({ ...RUN, state: 'cancelled', cancellation }).cancellation?.reason).toBe('wrong employee')
    expect(() => HrPlanRunSchema.parse({ ...RUN, state: 'cancelled', cancellation: { ...cancellation, reason: '' } })).toThrow()
    expect(() => HrPlanRunSchema.parse({ ...RUN, cancellation: undefined })).toThrow()
    expect(HrPlanRunCancelSchema.parse({ reason: ' late ' }).reason).toBe('late')
    expect(() => HrPlanRunCancelSchema.parse({ reason: '  ' })).toThrow()
  })

  it('accepts a run with its steps and rejects an unknown step state', () => {
    const step = {
      id: 21,
      summary: 'تسليم العهدة',
      assignee: { id: 10, name: 'Noura' },
      date_deadline: '2026-11-05',
      state: 'today',
      date_done: null,
      can_complete: true,
    }
    const parsed = HrPlanRunDetailSchema.parse({ ...RUN, steps: [step], can_cancel: true })
    expect(parsed.steps[0]?.can_complete).toBe(true)
    expect(HrPlanRunStepSchema.parse({ ...step, state: 'done', date_done: '2026-11-04' }).date_done).toBe('2026-11-04')
    expect(() => HrPlanRunStepSchema.parse({ ...step, state: 'late' })).toThrow()
    expect(() => HrPlanRunDetailSchema.parse(RUN)).toThrow()
  })

  it('validates the launch payload and the completion payload', () => {
    expect(HrPlanRunCreateSchema.parse({ employee_id: 10, plan_id: 4 }).plan_date).toBeUndefined()
    expect(HrPlanRunCreateSchema.parse({ employee_id: 10, plan_id: 4, plan_date: '2026-11-02' }).plan_date).toBe('2026-11-02')
    expect(() => HrPlanRunCreateSchema.parse({ employee_id: 10 })).toThrow()
    expect(HrPlanStepDoneSchema.parse({})).toEqual({})
    expect(HrPlanStepDoneSchema.parse({ feedback: 'تم' }).feedback).toBe('تم')
    expect(() => HrPlanStepDoneSchema.parse({ note: 'x' })).toThrow()
  })
})

describe('the employee own onboarding steps', () => {
  const step = { id: 7, run_id: 2, summary: 'Sign the contract', date_deadline: '2026-11-03', state: 'planned' }

  it('accepts the list and the completion answer', () => {
    expect(HrOwnOnboardingStepListSchema.parse({ items: [step], total: 1 }).items[0].run_id).toBe(2)
    expect(HrOwnOnboardingStepDoneSchema.parse({ id: 7, run_id: 2, done: true }).done).toBe(true)
  })

  it('refuses an unknown key, a state outside the derived ones and a not-done answer', () => {
    expect(HrOwnOnboardingStepListSchema.safeParse({ items: [{ ...step, assignee: null }], total: 1 }).success).toBe(false)
    expect(HrOwnOnboardingStepListSchema.safeParse({ items: [{ ...step, state: 'blocked' }], total: 1 }).success).toBe(false)
    expect(HrOwnOnboardingStepDoneSchema.safeParse({ id: 7, run_id: 2, done: false }).success).toBe(false)
  })
})
