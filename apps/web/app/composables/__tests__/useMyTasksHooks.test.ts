import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ queries: [] as Array<Record<string, any>> }))
const invalidateQueries = vi.hoisted(() => vi.fn(async () => undefined))
const $api = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/vue-query', () => ({
  useMutation: (options: Record<string, unknown>) => options,
  useQuery: (options: Record<string, any>) => { state.queries.push(options); return options },
  useQueryClient: () => ({ invalidateQueries }),
}))

type Mutation<V> = { mutationFn: (v: V) => Promise<unknown>; onSuccess?: (row: unknown, v: V) => Promise<unknown> }

describe('my-task hooks wiring', () => {
  beforeEach(() => {
    invalidateQueries.mockClear()
    $api.mockReset()
    state.queries.length = 0
    ;(globalThis as typeof globalThis & { useApi: () => unknown }).useApi = () => ({ $api })
  })

  it('posting a comment refreshes that task\'s comments', async () => {
    const { usePostMyTaskComment } = await import('../useMyTasks')
    const m = usePostMyTaskComment() as unknown as Mutation<{ id: number; body: string }>
    $api.mockResolvedValue({})
    await m.mutationFn({ id: 7, body: 'hi' })
    expect($api).toHaveBeenCalledWith('/api/v1/my-tasks/7/comments', expect.objectContaining({ method: 'POST', body: { body: 'hi' } }))
    await m.onSuccess!({}, { id: 7, body: 'hi' })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'comments', 7] })
  })

  it('uploading an attachment refreshes attachments and the detail (attachment_count)', async () => {
    const { useUploadMyTaskAttachment } = await import('../useMyTasks')
    const m = useUploadMyTaskAttachment() as unknown as Mutation<{ id: number; name: string; data: string }>
    $api.mockResolvedValue({})
    await m.mutationFn({ id: 7, name: 'a.pdf', data: 'x' })
    expect($api).toHaveBeenCalledWith('/api/v1/my-tasks/7/attachments', expect.objectContaining({ method: 'POST' }))
    await m.onSuccess!({}, { id: 7, name: 'a.pdf', data: 'x' })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'attachments', 7] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'detail', 7] })
  })

  it('deleting an attachment refreshes attachments and the detail', async () => {
    const { useDeleteMyTaskAttachment } = await import('../useMyTasks')
    const m = useDeleteMyTaskAttachment() as unknown as Mutation<{ id: number; attachmentId: number }>
    $api.mockResolvedValue(undefined)
    await m.mutationFn({ id: 7, attachmentId: 4 })
    expect($api).toHaveBeenCalledWith('/api/v1/my-tasks/7/attachments/4', { method: 'DELETE' })
    await m.onSuccess!(undefined, { id: 7, attachmentId: 4 })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'attachments', 7] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-tasks', 'detail', 7] })
  })

  it('does not request a task, its comments or attachments without a valid id', async () => {
    const { useMyTask, useMyTaskComments, useMyTaskAttachments } = await import('../useMyTasks')
    for (const id of [null, 7.5, Number.NaN]) {
      useMyTask(id as never); useMyTaskComments(id as never); useMyTaskAttachments(id as never)
    }
    expect(state.queries.every(q => q.enabled.value === false)).toBe(true)
    state.queries.length = 0
    useMyTask(7); useMyTaskComments(7); useMyTaskAttachments(7)
    expect(state.queries.every(q => q.enabled.value === true)).toBe(true)
    expect($api).not.toHaveBeenCalled()
  })
})
