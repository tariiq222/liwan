import { describe, expect, it } from 'vitest'
import type { AppAttentionProvider, AppAttentionRow } from '../../../modules/types'
import { allFailed, mergeAttentionRows, providersInScope, visibleProviders } from '../attentionModel'

const provider = (id: string, module: string, capability = `${module}.read`): AppAttentionProvider =>
  ({ id, module, capability, queryKey: ['attention', id], load: async () => [] })
const row = (id: string, tone: AppAttentionRow['tone']): AppAttentionRow => ({ id, label: id, to: `/${id}`, tone })

const tasks = provider('tasks', 'tasks')
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
