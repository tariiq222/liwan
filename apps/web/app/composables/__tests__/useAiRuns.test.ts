import type { AiRunList, AiRunSummary } from '@nasq/contracts'
import { describe, expect, it } from 'vitest'
import { withPatchedRun } from '../useAiRuns'

const row = (id: string, title: string, archived = false): AiRunSummary => ({ run_id: id, title, status: 'done', updated_at: '2026-10-16T10:00:00.000Z', archived })
const list = (...items: AiRunSummary[]): AiRunList => ({ items, total: items.length })

describe('withPatchedRun', () => {
  it("replaces a renamed row with the server's row and keeps the others and the order", () => {
    const renamed = row('r_2', 'جديد')
    expect(withPatchedRun(list(row('r_1', 'أ'), row('r_2', 'ب'), row('r_3', 'ج')), renamed)).toEqual(list(row('r_1', 'أ'), renamed, row('r_3', 'ج')))
  })

  it('drops a row that moved to the other list and recounts', () => {
    expect(withPatchedRun(list(row('r_1', 'أ'), row('r_2', 'ب')), row('r_2', 'ب', true))).toEqual(list(row('r_1', 'أ')))
    expect(withPatchedRun(list(row('r_9', 'قديمة', true)), row('r_9', 'قديمة', false))).toEqual(list())
  })

  it('leaves a list that does not hold the row as it is', () => {
    const other = list(row('r_1', 'أ'))
    expect(withPatchedRun(other, row('r_7', 'x'))).toEqual(other)
  })
})
