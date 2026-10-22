import { describe, expect, it } from 'vitest'
import { MutationObserver, QueryClient } from '@tanstack/vue-query'
import { operationRequestMutationOptions } from '../mutations'

const record = {
  id: 8, purpose: 'employee', name: 'طلب', process: { id: 3, name: 'اعتماد' }, process_revision: 2,
  state: 'pending', revision: 4, cycle: 1, requester: { id: 2, user_id: 2, name: 'طلب' },
  created_at: '2026-10-14', execution_count: 0, description: '', target: null, steps: [], events: [], attachments: [],
  allowed_actions: { edit: false, submit: false, approve: true, reject: true, return: true, withdraw: false },
} as const

describe('operation mutations use confirmed server state', () => {
  it('keeps cached evidence until the server succeeds, then replaces detail and invalidates lists', async () => {
    const client = new QueryClient()
    client.setQueryData(['operations', 'requests', 'detail', 8], { ...record, revision: 3 })
    client.setQueryData(['operations', 'requests', 'list', {}], { items: [], total: 0 })
    client.setQueryData(['operations', 'requests', 'personal', 1, 2, 8], { ...record, revision: 3 })
    client.setQueryData(['operations', 'requests', 'summary', 'self-service', 1, 2], { total: 1 })
    let resolve!: (value: unknown) => void
    const calls: unknown[] = []
    const api = async (path: string, options: unknown) => { calls.push([path, options]); return await new Promise(res => { resolve = res }) }
    const observer = new MutationObserver(client, operationRequestMutationOptions(api as never, client))
    const pending = observer.mutate({ action: 'approve', id: 8, body: { revision: 3 } })
    await Promise.resolve()
    await Promise.resolve()
    expect(client.getQueryData(['operations', 'requests', 'detail', 8])).toMatchObject({ revision: 3 })
    expect(calls).toHaveLength(1)
    resolve(record)
    await pending
    expect(calls[0]).toMatchObject(['/api/v1/operations/requests/8/approve', { method: 'POST', body: { revision: 3 } }])
    expect(client.getQueryData(['operations', 'requests', 'detail', 8])).toEqual(record)
    expect(client.getQueryState(['operations', 'requests', 'list', {}])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['operations', 'requests', 'personal', 1, 2, 8])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['operations', 'requests', 'summary', 'self-service', 1, 2])?.isInvalidated).toBe(true)
  })
  it('never automatically retries decisions after conflict or execution failure', async () => {
    for (const error of [{ status: 409, code: 'revision_conflict' }, { status: 422, code: 'execution_failed' }]) {
      const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } })
      let calls = 0
      const api = async () => { calls++; throw error }
      const observer = new MutationObserver(client, operationRequestMutationOptions(api as never, client))
      await expect(observer.mutate({ action: 'approve', id: 8, body: { revision: 3 } })).rejects.toEqual(error)
      expect(calls).toBe(1)
    }
  })
})
