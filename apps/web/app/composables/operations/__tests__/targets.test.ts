import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { OperationTargetsSchema } from '@nasq/contracts'
import { operationTargetQueryOptions } from '../useOperations'
import type { OperationApi } from '../mutations'

describe('operation target search boundary', () => {
  it('sends the current search and isolates cached results by procedure and search', async () => {
    const calls: { path: string; query?: Record<string, unknown> }[] = []
    const api: OperationApi = async <T>(path: string, options: Parameters<OperationApi>[1]) => {
      calls.push({ path, query: options.query })
      expect(options.schema).toBe(OperationTargetsSchema)
      return options.schema!.parse({ items: [{ id: 78, name: 'Older eligible record', href: '/tasks/78' }], total: 1 }) as T
    }
    const id = ref<number | null>(3)
    const q = ref('')
    const enabled = ref(true)
    const options = operationTargetQueryOptions(api, id, enabled, q)
    expect(options.queryKey.value).toEqual(['operations', 'targets', 3, ''])
    await options.queryFn()
    expect(calls[0]).toEqual({ path: '/api/v1/operations/processes/3/targets', query: { q: undefined } })
    q.value = '  Older eligible  '
    expect(options.queryKey.value).toEqual(['operations', 'targets', 3, 'Older eligible'])
    expect(await options.queryFn()).toMatchObject({ items: [{ id: 78 }] })
    expect(calls[1]).toEqual({ path: '/api/v1/operations/processes/3/targets', query: { q: 'Older eligible' } })
    id.value = 4
    expect(options.queryKey.value).toEqual(['operations', 'targets', 4, 'Older eligible'])
    enabled.value = false
    expect(options.enabled.value).toBe(false)
    id.value = null; enabled.value = true
    expect(options.enabled.value).toBe(false)
  })
})
