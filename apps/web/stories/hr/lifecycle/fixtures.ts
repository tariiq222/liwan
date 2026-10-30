import type { HrActivityPlan, HrDeparture, HrPlanRunDetail } from '@liwan/contracts'

export const plan: HrActivityPlan = {
  id: 4,
  name: 'خطة التهيئة',
  department: { id: 2, name: 'الموارد البشرية' },
  active: true,
  steps: [
    { id: 12, summary: 'تجهيز المكتب', responsible_type: 'manager', responsible: null, delay_count: 1, delay_unit: 'days', delay_from: 'before_plan_date' },
    { id: 13, summary: 'تسليم العهدة', responsible_type: 'other', responsible: { id: 7, name: 'Huda' }, delay_count: 0, delay_unit: 'days', delay_from: 'after_plan_date' },
  ],
}

export const inactivePlan: HrActivityPlan = { ...plan, id: 5, name: 'خطة قديمة', active: false, steps: [plan.steps[0]!] }

export const run: HrPlanRunDetail = {
  id: 8,
  employee: { id: 10, name: 'نورة' },
  plan: { id: 4, name: 'خطة التهيئة' },
  plan_date: '2026-11-02',
  launched_by: { id: 7, name: 'Huda' },
  done: 1,
  total: 2,
  state: 'open',
  cancellation: null,
  can_cancel: true,
  steps: [
    { id: 21, summary: 'تجهيز المكتب', assignee: { id: 7, name: 'Huda' }, date_deadline: '2026-11-01', state: 'done', date_done: '2026-10-30', can_complete: false },
    { id: 22, summary: 'تسليم العهدة', assignee: { id: 10, name: 'نورة' }, date_deadline: '2026-11-05', state: 'today', date_done: null, can_complete: true },
  ],
}

export const departure: HrDeparture = {
  employee: { id: 10, name: 'نورة' },
  active: true,
  departure_date: '2026-11-30',
  reason: { id: 3, name: 'استقالة' },
  description: 'استقالة شخصية',
  clearance: { run_id: 8, done: 1, total: 3 },
}

export const clearedDeparture: HrDeparture = { ...departure, clearance: { run_id: 9, done: 3, total: 3 } }

export const planTo = (item: HrActivityPlan) => ({ path: `/hr/onboarding/plans/${item.id}` })
export const runTo = (item: { id: number }) => ({ path: `/hr/onboarding/${item.id}` })
export const departureTo = (item: HrDeparture) => ({ path: `/hr/offboarding/${item.employee.id}` })
