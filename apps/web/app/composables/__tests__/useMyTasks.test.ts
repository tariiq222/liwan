import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { PersonalTask } from '@nasq/contracts'
import { myTaskKeys } from '../myTaskKeys'
import {
  convertMyTask,
  createMyTask,
  myTaskListQuery,
  transitionMyTask,
  updateMyTask,
} from '../useMyTasks'

const person = { id: 1, name: 'A' }
function task(over: Partial<PersonalTask> = {}): PersonalTask {
  return {
    id: 7, name: 'T', description: '', state: 'open', priority: 'normal', date_deadline: null,
    assignees: [person], creator: person, parent: null, subtasks: [], attachment_count: 0,
    created_at: '2026-10-13', updated_at: '2026-10-13',
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

  it('converts through the server and refreshes the task caches', async () => {
    const qc = new QueryClient()
    qc.setQueryData(myTaskKeys.detail(7), task())
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const api = vi.fn().mockResolvedValue({ href: '/projects/3/tasks/7' })
    await expect(convertMyTask(api, qc, { id: 7, projectId: 3 })).resolves.toEqual({ href: '/projects/3/tasks/7' })
    expect(api).toHaveBeenCalledWith('/api/v1/my-tasks/7/convert', expect.objectContaining({ method: 'POST', body: { project_id: 3 } }))
    // The converted task is no longer a personal task: drop its detail instead of keeping a stale copy.
    expect(qc.getQueryData(myTaskKeys.detail(7))).toBeUndefined()
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'list'] })
  })
})
