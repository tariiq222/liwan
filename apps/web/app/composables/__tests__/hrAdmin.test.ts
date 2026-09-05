import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { describe, expect, it } from 'vitest'
import { HR_ACCESS_MUTATION_GC_TIME, hrEmployeeListQuery, invalidateHrAccessCaches, invalidateHrEmployeeLists } from '../useHrEmployees'

describe('HR administration helpers', () => {
  it('serializes active and archived employee list parameters', () => {
    expect(hrEmployeeListQuery({ q: '', department_id: undefined, archived: false, limit: 50, offset: 0 })).toEqual({
      q: undefined,
      department_id: undefined,
      archived: undefined,
      limit: 50,
      offset: 0,
    })
    expect(hrEmployeeListQuery({ archived: true, limit: 25, offset: 10 })).toEqual({
      q: undefined,
      department_id: undefined,
      archived: true,
      limit: 25,
      offset: 10,
    })
  })

  it('invalidates employee and people reads after access changes', async () => {
    const queryClient = new QueryClient()
    const employeeKey = ['hr', 'employees', { archived: false }]
    await queryClient.prefetchQuery({ queryKey: employeeKey, queryFn: async () => ({ items: [], total: 0 }) })
    await queryClient.prefetchQuery({ queryKey: ['people'], queryFn: async () => [] })
    invalidateHrAccessCaches(queryClient)
    expect(queryClient.getQueryState(employeeKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['people'])?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('invalidates every employee list variant after an employee mutation', async () => {
    const queryClient = new QueryClient()
    const activeKey = ['hr', 'employees', { archived: false }]
    const archivedKey = ['hr', 'employees', { archived: true }]
    await queryClient.prefetchQuery({ queryKey: activeKey, queryFn: async () => ({ items: [], total: 0 }) })
    await queryClient.prefetchQuery({ queryKey: archivedKey, queryFn: async () => ({ items: [], total: 0 }) })
    invalidateHrEmployeeLists(queryClient)
    expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('evicts password variables from the mutation cache after success and failure', async () => {
    async function run(mutationFn: (body: { password: string }) => Promise<unknown>) {
      const queryClient = new QueryClient()
      let reset = () => {}
      const observer = new MutationObserver(queryClient, {
        gcTime: HR_ACCESS_MUTATION_GC_TIME,
        mutationFn,
        onSettled: () => reset(),
      })
      reset = observer.reset
      const unsubscribe = observer.subscribe(() => {})
      await observer.mutate({ password: 'secret-password' }).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
      unsubscribe()
      queryClient.clear()
    }

    await run(async () => ({ ok: true }))
    await run(async () => {
      throw new Error('request failed')
    })
  })
})
