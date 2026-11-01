import { describe, expect, it } from 'vitest'
import {
  BaselineGateSchema, BaselineVarianceSchema, ProjectBaselineDetailSchema, ProjectBaselineListSchema, ProjectBaselineSchema, ProjectBaselineWriteSchema,
} from '../baseline'

const baseline = {
  id: 4, project_id: 2, number: 2, taken_by: { id: 5, name: 'Mona' }, taken_at: '2026-11-01T10:00:00Z', note: 'After the change',
  change: { id: 9, number: 3, title: 'Add a reporting module' }, budget_total: 12500.5,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }, planned_start: '2026-03-01', planned_end: '2026-06-30', task_count: 2,
}
const line = { id: 1, task_id: 7, name: 'Design', planned_start: '2026-03-01', planned_end: '2026-03-20', planned_value_share: 0.5 }
const row = { baseline_start: '2026-03-01', baseline_end: '2026-03-20', current_start: '2026-03-04', current_end: '2026-03-18', start_variance_days: 3, end_variance_days: -2 }
const variance = {
  project_id: 2, baseline: { number: 2, taken_at: '2026-11-01T10:00:00Z' },
  schedule: {
    project: row,
    tasks: [{ task_id: 7, name: 'Design', status: 'tracked', archived: false, ...row }, { task_id: null, name: 'Added', status: 'added', archived: false, baseline_start: null, baseline_end: null, current_start: '2026-03-06', current_end: '2026-03-07', start_variance_days: null, end_variance_days: null }, { task_id: null, name: 'Gone', status: 'removed', archived: false, baseline_start: null, baseline_end: null, current_start: null, current_end: null, start_variance_days: null, end_variance_days: null }],
    hidden_count: 0, late_count: 0, early_count: 1, undated_count: 0, removed_count: 1, added_count: 1,
  },
  cost: { currency: baseline.currency, baseline_budget: 1000, current_budget: 1500, budget_variance: 500, actual: 700, remaining_against_baseline: 300, over_baseline: false },
}

describe('baseline contracts', () => {
  it('round trips a baseline with and without a covering change', () => {
    expect(ProjectBaselineSchema.parse(baseline)).toEqual(baseline)
    expect(ProjectBaselineSchema.safeParse({ ...baseline, change: null, planned_start: null, currency: null }).success).toBe(true)
  })

  it('keeps the detail strict, with task lines of a deleted task', () => {
    expect(ProjectBaselineDetailSchema.safeParse({ ...baseline, hidden_count: 1, tasks: [line, { ...line, id: 2, task_id: null, planned_end: null }] }).success).toBe(true)
    expect(ProjectBaselineDetailSchema.safeParse({ ...baseline, hidden_count: 0, tasks: [{ ...line, planned_value_share: 1.5 }] }).success).toBe(false)
    expect(ProjectBaselineDetailSchema.safeParse({ ...baseline, hidden_count: 0, tasks: [], extra: 1 }).success).toBe(false)
    expect(ProjectBaselineSchema.safeParse({ ...baseline, planned_end: '2026-02-30' }).success).toBe(false)
  })

  it('keeps the list envelope strict', () => {
    const list = { items: [baseline], total: 1, can_take: true, change_required: false, coverable_changes: [{ id: 9, number: 3, title: 'x' }] }
    expect(ProjectBaselineListSchema.safeParse(list).success).toBe(true)
    expect(ProjectBaselineListSchema.safeParse({ items: [baseline], total: 1 }).success).toBe(false)
  })

  it('takes only a note and a change', () => {
    expect(ProjectBaselineWriteSchema.safeParse({}).success).toBe(true)
    expect(ProjectBaselineWriteSchema.safeParse({ note: 'x'.repeat(2000), change_id: 9 }).success).toBe(true)
    expect(ProjectBaselineWriteSchema.safeParse({ note: 'x'.repeat(2001) }).success).toBe(false)
    expect(ProjectBaselineWriteSchema.safeParse({ budget_total: 1 }).success).toBe(false)
  })

  it('reads a variance, with undated and removed rows, and the empty answer before any baseline', () => {
    expect(BaselineVarianceSchema.parse(variance)).toEqual(variance)
    expect(BaselineVarianceSchema.safeParse({ project_id: 2, baseline: null, schedule: null, cost: null }).success).toBe(true)
    expect(BaselineVarianceSchema.safeParse({ ...variance, cost: { ...variance.cost, extra: 1 } }).success).toBe(false)
  })

  it('knows the three gate modes only', () => {
    expect(BaselineGateSchema.options).toEqual(['off', 'warning', 'required'])
    expect(BaselineGateSchema.safeParse('sometimes').success).toBe(false)
  })
})
