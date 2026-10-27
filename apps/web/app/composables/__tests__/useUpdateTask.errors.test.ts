import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'

const setQueryData = vi.fn()
const queryClient = {
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(() => ({ id: 1, name: 'old' })),
  getQueriesData: vi.fn(() => [[['tasks', 'list', 'a'], { pages: [] }]]),
  setQueryData,
  invalidateQueries: vi.fn(),
}
let options: Record<string, (...args: unknown[]) => unknown> = {}
vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => queryClient,
  useMutation: (o: typeof options) => { options = o; return {} },
  useQuery: vi.fn(),
  useInfiniteQuery: vi.fn(),
}))

const toastAdd = vi.fn()
const globals = globalThis as typeof globalThis & { useI18n: () => unknown; useToast: () => unknown; useApi: () => unknown }

async function setup(notifyErrors?: boolean) {
  const { useUpdateTask } = await import('../useTasks')
  useUpdateTask(notifyErrors === undefined ? undefined : { notifyErrors })
}

describe('useUpdateTask failure', () => {
  beforeEach(() => {
    toastAdd.mockReset()
    setQueryData.mockReset()
    globals.useI18n = () => ({ t: (key: string) => key })
    globals.useToast = () => ({ add: toastAdd })
    globals.useApi = () => ({ $api: vi.fn() })
  })

  it('rolls the optimistic change back and shows the server message in an error toast', async () => {
    await setup()
    const ctx = await options.onMutate!({ id: 1, patch: { priority: '3' } })
    setQueryData.mockClear()
    options.onError!(new ApiError(422, 'invalid', 'رسالة الخادم'), { id: 1 }, ctx)
    expect(setQueryData).toHaveBeenCalledWith(['tasks', 'detail', 1], { id: 1, name: 'old' })
    expect(setQueryData).toHaveBeenCalledWith(['tasks', 'list', 'a'], { pages: [] })
    expect(toastAdd).toHaveBeenCalledWith({ title: 'رسالة الخادم', color: 'error' })
  })

  it('falls back to the generic message for a non-API error', async () => {
    await setup()
    options.onError!(new Error('boom'), { id: 1 }, undefined)
    expect(toastAdd).toHaveBeenCalledWith({ title: 'errors.generic', color: 'error' })
  })

  it('stays silent when the caller reports the failure itself', async () => {
    await setup(false)
    options.onError!(new ApiError(422, 'invalid', 'x'), { id: 1 }, undefined)
    expect(toastAdd).not.toHaveBeenCalled()
  })
})
