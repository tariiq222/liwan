import { describe, expect, it } from 'vitest'
import type { AppAttentionProvider, AppAttentionRow } from '../../../modules/types'
import { allFailed, ATTENTION_ROWS_PER_PROVIDER, cappedWorkKinds, filterWorkRows, groupByWork, mergeAttentionRows, parseWorkKind, providersInScope, sourcesOf, visibleProviders, WORK_ROWS_LIMIT, workCountLabel } from '../attentionModel'

const provider = (id: string, module: string, capability = `${module}.read`): AppAttentionProvider =>
  ({ id, module, work: 'execute', capability, queryKey: ['attention', id], load: async () => [] })
const row = (id: string, tone: AppAttentionRow['tone']): AppAttentionRow => ({ id, label: id, to: `/${id}`, tone })

const tasks = provider('tasks', 'tasks')
const approvals: AppAttentionProvider = { ...provider('approvals', 'operations'), work: 'decide' }
const meetingsA = provider('meetings-a', 'meetings')
const meetingsB = provider('meetings-b', 'meetings')
const providers = [tasks, meetingsA, meetingsB]

describe('providersInScope', () => {
  it('keeps one module\'s providers in order, everything for all, and nothing without a scope', () => {
    expect(providersInScope(providers, 'meetings')).toEqual([meetingsA, meetingsB])
    expect(providersInScope(providers, 'all')).toEqual(providers)
    expect(providersInScope(providers, null)).toEqual([])
    expect(providersInScope(providers, 'finance')).toEqual([])
  })
})

describe('visibleProviders', () => {
  it('drops a provider whose capability the caller lacks', () => {
    expect(visibleProviders(providers, capability => capability === 'tasks.read')).toEqual([tasks])
    expect(visibleProviders(providers, () => false)).toEqual([])
  })
})

describe('mergeAttentionRows', () => {
  it('puts urgent rows first, then provider order, and tags each row with its module', () => {
    const rows = mergeAttentionRows([
      { provider: tasks, rows: [row('t1', 'normal'), row('t2', 'urgent')] },
      { provider: meetingsA, rows: [row('m1', 'urgent'), row('m2', 'normal')] },
    ], 10)
    expect(rows.map(item => [item.id, item.module])).toEqual([['tasks:t2', 'tasks'], ['meetings-a:m1', 'meetings'], ['tasks:t1', 'tasks'], ['meetings-a:m2', 'meetings']])
  })
  it('tags each row with the work kind of its provider', () => {
    const rows = mergeAttentionRows([{ provider: tasks, rows: [row('t1', 'normal')] }, { provider: approvals, rows: [row('a1', 'urgent')] }], 10)
    expect(rows.map(item => [item.id, item.work])).toEqual([['approvals:a1', 'decide'], ['tasks:t1', 'execute']])
  })
  it('cuts to the limit, and a zero or negative limit gives nothing', () => {
    const results = [{ provider: tasks, rows: [row('a', 'normal'), row('b', 'normal'), row('c', 'normal')] }]
    expect(mergeAttentionRows(results, 2).map(item => item.id)).toEqual(['tasks:a', 'tasks:b'])
    expect(mergeAttentionRows(results, 0)).toEqual([])
    expect(mergeAttentionRows(results, -1)).toEqual([])
  })
  it('shows a record once when two providers return it, keeping the first by the merge order', () => {
    const same = { id: 'task-5', label: 'Same task', to: '/tasks/5', tone: 'urgent' as const }
    const rows = mergeAttentionRows([
      { provider: tasks, rows: [same] },
      { provider: meetingsA, rows: [{ ...same, tone: 'normal' as const }, row('m1', 'normal')] },
      { provider: meetingsB, rows: [same] },
    ], 3)
    expect(rows.map(item => item.id)).toEqual(['tasks:task-5', 'meetings-a:m1'])
    expect(new Set(rows.map(item => item.id)).size).toBe(rows.length)
  })
  it('is empty for no results', () => {
    expect(mergeAttentionRows([], 3)).toEqual([])
  })
})

describe('allFailed', () => {
  it('is true only when there is something to load and every provider failed', () => {
    expect(allFailed([])).toBe(false)
    expect(allFailed([{ isError: true }, { isError: true }])).toBe(true)
    expect(allFailed([{ isError: true }, { isError: false }])).toBe(false)
  })
})

describe('groupByWork', () => {
  it('splits rows by work kind, keeping the order inside each group and empty groups present', () => {
    const rows = mergeAttentionRows([
      { provider: tasks, rows: [row('t1', 'normal'), row('t2', 'urgent')] },
      { provider: approvals, rows: [row('a1', 'normal')] },
    ], 10)
    const grouped = groupByWork(rows)
    expect(grouped.execute.map(item => item.id)).toEqual(['tasks:t2', 'tasks:t1'])
    expect(grouped.decide.map(item => item.id)).toEqual(['approvals:a1'])
    expect(grouped.follow).toEqual([])
    expect(groupByWork([])).toEqual({ execute: [], decide: [], follow: [] })
  })
})

describe('parseWorkKind', () => {
  it('accepts the three kinds and falls back to the first for anything else', () => {
    expect(['execute', 'decide', 'follow'].map(parseWorkKind)).toEqual(['execute', 'decide', 'follow'])
    for (const value of [undefined, null, '', 'all', ['decide'], 3]) expect(parseWorkKind(value)).toBe('execute')
  })
})

describe('work page filters', () => {
  const rows = mergeAttentionRows([
    { provider: tasks, rows: [{ ...row('t1', 'normal'), label: 'Quarterly Report', caption: 'due today' }] },
    { provider: meetingsA, rows: [{ ...row('m1', 'normal'), label: 'Board meeting', suggestion: 'Prepare the report' }] },
  ], 10)

  it('lists the modules present in the rows once, in order', () => {
    expect(sourcesOf(rows)).toEqual(['tasks', 'meetings'])
    expect(sourcesOf([])).toEqual([])
  })
  it('keeps everything for all sources and an empty query', () => {
    expect(filterWorkRows(rows, { source: 'all', query: '  ' })).toEqual(rows)
  })
  it('filters by source', () => {
    expect(filterWorkRows(rows, { source: 'meetings', query: '' }).map(item => item.id)).toEqual(['meetings-a:m1'])
  })
  it('searches label, caption and suggestion ignoring case, and combines with the source', () => {
    expect(filterWorkRows(rows, { source: 'all', query: 'REPORT' }).map(item => item.id)).toEqual(['tasks:t1', 'meetings-a:m1'])
    expect(filterWorkRows(rows, { source: 'all', query: 'due' }).map(item => item.id)).toEqual(['tasks:t1'])
    expect(filterWorkRows(rows, { source: 'meetings', query: 'report' }).map(item => item.id)).toEqual(['meetings-a:m1'])
    expect(filterWorkRows(rows, { source: 'tasks', query: 'board' })).toEqual([])
  })
})

describe('workCountLabel', () => {
  it('shows the figure, and a plus when it is only a lower bound', () => {
    expect(workCountLabel(0, false)).toBe('0')
    expect(workCountLabel(WORK_ROWS_LIMIT - 1, false)).toBe(String(WORK_ROWS_LIMIT - 1))
    expect(workCountLabel(WORK_ROWS_LIMIT, false)).toBe(`${WORK_ROWS_LIMIT}+`)
    expect(workCountLabel(7, true)).toBe('7+')
  })
})

describe('cappedWorkKinds', () => {
  const rowsOf = (count: number) => Array.from({ length: count }, (_, index) => row(`r${index}`, 'normal'))
  it('names the kinds in which some provider returned as many rows as it may', () => {
    const full = rowsOf(ATTENTION_ROWS_PER_PROVIDER)
    expect(cappedWorkKinds([{ provider: tasks, rows: full }, { provider: approvals, rows: rowsOf(3) }])).toEqual(['execute'])
    expect(cappedWorkKinds([{ provider: tasks, rows: rowsOf(ATTENTION_ROWS_PER_PROVIDER - 1) }, { provider: approvals, rows: full }])).toEqual(['decide'])
    expect(cappedWorkKinds([])).toEqual([])
  })
})
