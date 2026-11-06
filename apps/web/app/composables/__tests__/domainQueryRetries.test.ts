import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { QueryClient } from '@tanstack/vue-query'
import { ApiError } from '../useApi'
import { useDocumentFiles } from '../useDocuments'
import { retryMyTask } from '../useMyTasks'
const state = vi.hoisted(() => ({ query: null as any }))
vi.mock('@tanstack/vue-query', async original => ({ ...await original<any>(), useQuery: (options: any) => { state.query = options; return { error: ref(null) } } }))

for (const name of ['document files', 'personal task']) {
  it(`${name} retries only one classified transient failure`, async () => {
    vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
    vi.stubGlobal('useMe', () => ({ me: ref({ id: 7, company: { id: 1 } }) }))
    if (name === 'document files') useDocumentFiles(8, {}, 1)
    const retry = name === 'document files' ? state.query.retry : retryMyTask
    const cases = [
      [new ApiError(503, 'unavailable', 'x'), 2], [new ApiError(0, 'network', 'x'), 2],
      [new ApiError(429, 'limited', 'x'), 2], [new ApiError(409, 'conflict', 'x'), 1],
      [new ApiError(401, 'unauthorized', 'x'), 1], [new ApiError(422, 'invalid', 'x'), 1],
      [Object.assign(new Error('schema'), { name: 'ZodError' }), 1], [new Error('unclassified'), 1],
    ] as const
    for (const [error, expected] of cases) {
      const qc = new QueryClient(); let starts = 0
      await expect(qc.fetchQuery({ queryKey: ['retry', name, error.message, 'status' in error ? error.status : error.name], retry, retryDelay: 0, queryFn: async () => { starts++; throw error } })).rejects.toBe(error)
      expect(starts, `${name}: ${error.name}/${'status' in error ? error.status : error.message}`).toBe(expected)
      qc.clear()
    }
    vi.unstubAllGlobals()
  })
}
