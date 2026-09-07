import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { refDebounced } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { HR_ACCESS_MUTATION_GC_TIME, hrEmployeeListQuery, hrManagerOptions, invalidateHrAccessCaches, invalidateHrEmployeeLists, retryHrManagerQueries, type HrEmployee } from '../useHrEmployees'
import { hrDocumentListRouteQuery } from '../useHrDocuments'
import { hasPendingHrSearch, hrCommittedListParams } from '../useHrSearch'

describe('HR administration helpers', () => {
  it.each(['directory', 'department documents', 'global documents'])('blocks %s pagination until typed search is committed', async () => {
    vi.useFakeTimers()
    try {
      const search = ref('')
      const committedSearch = ref('')
      const debouncedSearch = refDebounced(search, 250)
      let page = 1
      const tryNextPage = () => {
        if (hasPendingHrSearch(search.value, committedSearch.value)) return
        page = 2
      }

      search.value = 'policy'
      tryNextPage()
      expect(page).toBe(1)
      await vi.advanceTimersByTimeAsync(249)
      await nextTick()
      tryNextPage()
      expect(page).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await nextTick()
      committedSearch.value = debouncedSearch.value
      tryNextPage()
      expect(page).toBe(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not refetch a null selected manager during retry', () => {
    const listRefetch = vi.fn()
    const selectedRefetch = vi.fn()
    retryHrManagerQueries(null, listRefetch, selectedRefetch)
    expect(listRefetch).toHaveBeenCalledOnce()
    expect(selectedRefetch).not.toHaveBeenCalled()
  })

  it.each(['directory', 'department documents', 'global documents'])('commits %s search and first page together', async () => {
    vi.useFakeTimers()
    try {
      const routeQuery = ref<{ q?: string; offset?: number | undefined }>({ q: 'old', offset: 25 })
      const draftSearch = ref('old')
      const debouncedSearch = refDebounced(draftSearch, 250)
      const requests: Array<{ q?: string; offset: number }> = []
      const committedParams = computed(() => hrCommittedListParams(routeQuery.value))
      watch(committedParams, (params) => requests.push(params), { immediate: true })

      draftSearch.value = 'new'
      await vi.advanceTimersByTimeAsync(249)
      expect(requests).toEqual([{ q: 'old', offset: 25 }])
      await vi.advanceTimersByTimeAsync(1)
      routeQuery.value = { q: debouncedSearch.value, offset: undefined }
      await nextTick()

      expect(requests).toEqual([{ q: 'old', offset: 25 }, { q: 'new', offset: 0 }])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('removes a stale document offset when returning to the first page', () => {
    expect(hrDocumentListRouteQuery({ q: 'policy', department_id: '7', offset: '25', returnTo: '/hr' }, {
      q: 'policy',
      department_id: 7,
      offset: 0,
    })).toEqual({ q: 'policy', department_id: 7, offset: undefined, returnTo: '/hr' })
  })

  it('keeps the selected manager and exposes server search results beyond the initial page', () => {
    const employee = (id: number, name: string) => ({ id, name } as HrEmployee)
    const options = hrManagerOptions({
      employees: [employee(1, 'First page employee')],
      searchResults: [employee(201, 'Employee beyond page one')],
      selected: employee(250, 'Current manager'),
      currentManager: null,
      search: 'beyond',
      excludeId: 999,
    })

    expect(options.map(({ id }) => id).sort((a, b) => a - b)).toEqual([201, 250])
  })

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
