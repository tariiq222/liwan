import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import { governanceKeys, governanceFilters } from '../state'

describe('governance list state', () => {
  it('validates URL enums and offset while preserving valid filters on refresh', () => {
    expect(governanceFilters({ q: '  sponsor ', kind: 'risk', status: 'closed', priority: 'high', offset: '200' })).toEqual({ q: 'sponsor', kind: 'risk', status: 'closed', priority: 'high', limit: 50, offset: 200 })
    expect(governanceFilters({ kind: 'bad', status: ['closed'], priority: 'urgent', offset: '-1' })).toEqual({ q: undefined, kind: undefined, status: undefined, priority: undefined, limit: 50, offset: 0 })
  })
  it('invalidates every governance query and leaves another project untouched', async () => {
    const qc = new QueryClient()
    const keys = [governanceKeys.stakeholders(7, {}), governanceKeys.stakeholder(7, 1), governanceKeys.raci(7, {}), governanceKeys.register(7, {}), governanceKeys.registerItem(7, 2)]
    for (const key of [...keys, governanceKeys.stakeholders(8, {})]) qc.setQueryData(key, {})
    await qc.invalidateQueries({ queryKey: governanceKeys.all(7) })
    for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated).toBe(true)
    expect(qc.getQueryState(governanceKeys.stakeholders(8, {}))?.isInvalidated).toBe(false)
    qc.removeQueries({ queryKey: governanceKeys.stakeholder(7, 1), exact: true })
    expect(qc.getQueryData(governanceKeys.stakeholder(7, 1))).toBeUndefined()
  })
})

import { governanceMatrixFilters } from '../state'
it('restores matrix viewport queries and rejects malformed page/filter values', () => {
  expect(governanceMatrixFilters({ task_q: 'Phase 2', stakeholder_q: 'Sponsor', closed: '1', task_page: '1', stakeholder_page: '20' })).toEqual({ taskQ: 'Phase 2', stakeholderQ: 'Sponsor', closed: true, taskPage: 1, stakeholderPage: 20 })
  expect(governanceMatrixFilters({ task_q: ['bad'], closed: 'false', task_page: '-2', stakeholder_page: 'NaN' })).toEqual({ taskQ: '', stakeholderQ: '', closed: false, taskPage: 0, stakeholderPage: 0 })
  expect(governanceMatrixFilters({ task_page: '99999999999999999999', stakeholder_page: '1.5' }).taskPage).toBe(0)
})
