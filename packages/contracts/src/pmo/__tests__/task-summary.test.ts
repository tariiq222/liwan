import { describe, expect, it } from 'vitest'
import golden from './task-summary.golden.json'
import { TaskSummarySchema } from '../task'

describe('TaskSummarySchema', () => {
  // The same payload is asserted by TestTaskSummary.test_summary_matches_golden in
  // odoo-addons/liwan_pmo/tests/test_task_summary.py.
  it('accepts the golden payload the controller produces', () => {
    expect(TaskSummarySchema.parse(golden)).toEqual(golden)
  })

  it('rejects missing counts, negatives, fractions and extra keys', () => {
    expect(() => TaskSummarySchema.parse({ total: 1, open: 1, overdue: 0 })).toThrow()
    expect(() => TaskSummarySchema.parse({ ...golden, overdue: -1 })).toThrow()
    expect(() => TaskSummarySchema.parse({ ...golden, open: 1.5 })).toThrow()
    expect(() => TaskSummarySchema.parse({ ...golden, secret: 1 })).toThrow()
  })
})
