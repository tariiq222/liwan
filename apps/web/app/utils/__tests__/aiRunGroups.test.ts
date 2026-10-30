import type { AiRunSummary } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import { filterRunsByTitle, groupRunsByDate } from '../aiRunGroups'

const NOW = new Date(2026, 9, 22, 15, 0, 0)
const run = (id: string, updated: Date, title: string | null = id): AiRunSummary => ({ run_id: id, title, status: 'done', updated_at: updated.toISOString(), archived: false })

describe('groupRunsByDate', () => {
  it('splits runs into today, the last 7 days and older, keeping their order', () => {
    const groups = groupRunsByDate([
      run('a', new Date(2026, 9, 22, 8, 0)),
      run('b', new Date(2026, 9, 21, 23, 59)),
      run('c', new Date(2026, 9, 15, 0, 0)),
      run('d', new Date(2026, 9, 14, 23, 59)),
      run('e', new Date(2026, 8, 1)),
    ], NOW)
    expect(groups.map(group => [group.key, group.runs.map(item => item.run_id)])).toEqual([
      ['today', ['a']], ['week', ['b', 'c']], ['older', ['d', 'e']],
    ])
  })

  it('treats a time later today and a future update as today', () => {
    expect(groupRunsByDate([run('a', new Date(2026, 9, 22, 23, 0)), run('b', new Date(2026, 10, 3))], NOW)[0]).toMatchObject({ key: 'today' })
  })

  it('drops empty groups and handles no runs', () => {
    expect(groupRunsByDate([], NOW)).toEqual([])
    expect(groupRunsByDate([run('a', new Date(2026, 0, 1))], NOW).map(group => group.key)).toEqual(['older'])
  })
})

describe('filterRunsByTitle', () => {
  const runs = [run('a', NOW, 'ما مهامي المتأخرة؟'), run('b', NOW, 'Payroll check'), run('c', NOW, null)]
  const titleOf = (item: AiRunSummary) => item.title ?? 'بلا عنوان'

  it('keeps everything for an empty or blank query', () => {
    expect(filterRunsByTitle(runs, '  ', titleOf)).toHaveLength(3)
  })

  it('matches the displayed title, ignoring case and surrounding spaces', () => {
    expect(filterRunsByTitle(runs, ' payroll ', titleOf).map(item => item.run_id)).toEqual(['b'])
    expect(filterRunsByTitle(runs, 'المتأخرة', titleOf).map(item => item.run_id)).toEqual(['a'])
    expect(filterRunsByTitle(runs, 'بلا', titleOf).map(item => item.run_id)).toEqual(['c'])
    expect(filterRunsByTitle(runs, 'zzz', titleOf)).toEqual([])
  })
})
