import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { PersonalTask } from '@nasq/contracts'
import { ApiError } from '../useApi'
import { myTaskKeys } from '../myTaskKeys'
import {
  convertMyTask,
  createMyTask,
  fetchConvertTargets,
  fetchMyTaskAttachments,
  fetchMyTaskComments,
  myTaskListQuery,
  retryMyTask,
  transitionMyTask,
  updateMyTask,
} from '../useMyTasks'

const person = { id: 1, name: 'A' }
function task(over: Partial<PersonalTask> = {}): PersonalTask {
  return {
    id: 7, name: 'T', description: '', state: 'open', priority: 'normal', date_deadline: null,
    assignees: [person], creator: person, parent: null, is_subtask: false, subtasks: [], attachment_count: 0,
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
    allowed_actions: { write: true, done: true, reopen: false, cancel: true, convert: true },
    ...over,
  } as PersonalTask
}

describe('myTaskKeys', () => {
  it('builds stable key shapes under one root', () => {
    expect(myTaskKeys.all).toEqual(['my-tasks'])
    expect(myTaskKeys.list({ q: 'a' })).toEqual(['my-tasks', 'list', { q: 'a' }])
    expect(myTaskKeys.detail(7)).toEqual(['my-tasks', 'detail', 7])
    expect(myTaskKeys.comments(7)).toEqual(['my-tasks', 'comments', 7])
    expect(myTaskKeys.attachments(7)).toEqual(['my-tasks', 'attachments', 7])
    expect(myTaskKeys.convertTargets('p')).toEqual(['my-tasks', 'convert-targets', 'p'])
  })
})

describe('myTaskListQuery', () => {
  it('drops empty values, clamps paging and maps the closed flag', () => {
    expect(myTaskListQuery({ q: '  ', closed: false, limit: 500, offset: -1 })).toEqual({
      q: undefined, closed: 0, assigned: undefined, created: undefined, sort: undefined, limit: 100, offset: 0,
    })
    expect(myTaskListQuery({ q: ' x ', closed: true, scope: 'created', limit: 20, offset: 40 })).toMatchObject({
      q: 'x', closed: 1, created: 'me', assigned: undefined, limit: 20, offset: 40,
    })
    expect(myTaskListQuery({ scope: 'assigned' })).toMatchObject({ assigned: 'me', created: undefined })
  })
})

describe('personal task writes', () => {
  it('replaces the detail cache with the server shape and invalidates only list keys on PATCH', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task())
    qc.setQueryData(myTaskKeys.comments(7), [])
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const server = task({ name: 'Renamed' })
    const api = vi.fn().mockResolvedValue(server)
    await updateMyTask(api, qc, { id: 7, body: { name: 'Renamed' } })
    expect(api).toHaveBeenCalledWith('/api/v1/my-tasks/7', expect.objectContaining({ method: 'PATCH', body: { name: 'Renamed' } }))
    expect(qc.getQueryData(myTaskKeys.detail(7))).toEqual(server)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'list'] })
  })

  it('also invalidates the parent detail when the written task is a sub-task', async () => {
    const parent = { id: 3, name: 'P' }
    for (const run of [
      (api: never, qc: QueryClient) => createMyTask(api, qc, { name: 'T', parent_id: 3 }),
      (api: never, qc: QueryClient) => updateMyTask(api, qc, { id: 7, body: { name: 'x' } }),
      (api: never, qc: QueryClient) => transitionMyTask(api, qc, { id: 7, action: 'done' }),
    ]) {
      const qc = new QueryClient()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      await run(vi.fn().mockResolvedValue(task({ parent })) as never, qc)
      expect(spy).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'list'] })
      expect(spy).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'detail', 3] })
    }
  })

  it('does not touch any other detail for a top-level task', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await updateMyTask(vi.fn().mockResolvedValue(task()) as never, qc, { id: 7, body: {} })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('seeds the detail cache on create', async () => {
    const qc = new QueryClient()
    const server = task({ id: 9 })
    const api = vi.fn().mockResolvedValue(server)
    await createMyTask(api, qc, { name: 'T' })
    expect(api).toHaveBeenCalledWith('/api/v1/my-tasks', expect.objectContaining({ method: 'POST' }))
    expect(qc.getQueryData(myTaskKeys.detail(9))).toEqual(server)
  })

  it('applies a transition only after the server answers', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task())
    let resolve!: (v: PersonalTask) => void
    const api = vi.fn().mockReturnValue(new Promise<PersonalTask>(r => { resolve = r }))
    const pending = transitionMyTask(api, qc, { id: 7, action: 'done' })
    expect(api).toHaveBeenCalledWith('/api/v1/my-tasks/7/done', expect.objectContaining({ method: 'POST' }))
    expect((qc.getQueryData(myTaskKeys.detail(7)) as PersonalTask).state).toBe('open')
    resolve(task({ state: 'done' }))
    await pending
    expect((qc.getQueryData(myTaskKeys.detail(7)) as PersonalTask).state).toBe('done')
  })

  it('leaves the cached detail untouched and the lists valid when a transition fails', async () => {
    const qc = new QueryClient()
    const before = task()
    qc.setQueryData(myTaskKeys.detail(7), before)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const api = vi.fn().mockRejectedValue(new Error('forbidden'))
    await expect(transitionMyTask(api, qc, { id: 7, action: 'cancel' })).rejects.toThrow('forbidden')
    expect(qc.getQueryData(myTaskKeys.detail(7))).toBe(before)
    expect(spy).not.toHaveBeenCalled()
  })

  it('converts through the server and drops every cached copy of the task', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task())
    qc.setQueryData(myTaskKeys.comments(7), { items: [], total: 0 })
    qc.setQueryData(myTaskKeys.attachments(7), { items: [], total: 0 })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const api = vi.fn().mockResolvedValue({ href: '/projects/3/tasks/7' })
    await expect(convertMyTask(api, qc, { id: 7, projectId: 3 })).resolves.toEqual({ href: '/projects/3/tasks/7' })
    expect(api).toHaveBeenCalledWith('/api/v1/my-tasks/7/convert', expect.objectContaining({ method: 'POST', body: { project_id: 3 } }))
    expect(qc.getQueryData(myTaskKeys.detail(7))).toBeUndefined()
    expect(qc.getQueryData(myTaskKeys.comments(7))).toBeUndefined()
    expect(qc.getQueryData(myTaskKeys.attachments(7))).toBeUndefined()
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'list'] })
  })

  it('cancels in-flight reads before removing, so the 404 detail is never refetched', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task())
    const order: string[] = []
    vi.spyOn(qc, 'cancelQueries').mockImplementation(async () => { order.push('cancel') })
    vi.spyOn(qc, 'removeQueries').mockImplementation(() => { order.push('remove') })
    await convertMyTask(vi.fn().mockResolvedValue({ href: '/x' }) as never, qc, { id: 7, projectId: 3 })
    expect(order).toEqual(['cancel', 'cancel', 'cancel', 'remove', 'remove', 'remove'])
    expect(qc.cancelQueries).toHaveBeenCalledWith({ queryKey: myTaskKeys.detail(7), exact: true })
    expect(qc.removeQueries).toHaveBeenCalledWith({ queryKey: myTaskKeys.detail(7), exact: true })
  })

  it('invalidates the parent detail when a converted task was a sub-task', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task({ parent: { id: 3, name: 'P' } }))
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await convertMyTask(vi.fn().mockResolvedValue({ href: '/x' }) as never, qc, { id: 7, projectId: 3 })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'detail', 3] })
  })

  it('does not invalidate any parent when the converted task had none', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task())
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await convertMyTask(vi.fn().mockResolvedValue({ href: '/x' }) as never, qc, { id: 7, projectId: 3 })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('collection envelopes', () => {
  // A fake $api that applies the schema the composable passes, like the real one.
  const apiReturning = (data: unknown) =>
    vi.fn(async (_path: string, opts: { schema?: { parse: (v: unknown) => unknown } }) => opts.schema ? opts.schema.parse(data) : data)

  it('parses comments, attachments and convert targets as { items, total }', async () => {
    const comment = { id: 1, body: 'hi', author: null, created_at: '2026-10-13T00:00:00Z' }
    const att = { id: 2, name: 'a.pdf', mimetype: 'application/pdf', url: '/web/content/2' }
    const c = await fetchMyTaskComments(apiReturning({ items: [comment], total: 1 }) as never, 7)
    expect(c).toEqual({ items: [comment], total: 1 })
    expect((await fetchMyTaskAttachments(apiReturning({ items: [att], total: 1 }) as never, 7)).items).toEqual([att])
    const api = apiReturning({ items: [{ id: 3, name: 'P' }], total: 1 })
    expect((await fetchConvertTargets(api as never, ' p ')).total).toBe(1)
    expect(api).toHaveBeenCalledWith('/api/v1/my-tasks/convert-targets', expect.objectContaining({ query: { q: 'p' } }))
  })

  it('rejects a bare array', async () => {
    await expect(fetchMyTaskComments(apiReturning([]) as never, 7)).rejects.toThrow()
  })
})

describe('retryMyTask', () => {
  it('never retries a 403 or 404 but retries other failures once', () => {
    expect(retryMyTask(0, new ApiError(404, 'not_found', 'x'))).toBe(false)
    expect(retryMyTask(0, new ApiError(403, 'forbidden', 'x'))).toBe(false)
    expect(retryMyTask(0, new ApiError(500, 'server', 'x'))).toBe(true)
    expect(retryMyTask(0, new Error('network'))).toBe(true)
    expect(retryMyTask(1, new ApiError(500, 'server', 'x'))).toBe(false)
  })
})
