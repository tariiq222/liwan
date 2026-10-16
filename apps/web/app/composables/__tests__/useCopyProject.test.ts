import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDetailSchema } from '@webvue/contracts'

const captured = vi.hoisted(() => ({ options: undefined as any, qc: undefined as any }))
vi.mock('@tanstack/vue-query', () => ({
  useMutation: (options: unknown) => { captured.options = options; return {} },
  useQuery: () => ({}),
  useQueryClient: () => captured.qc,
}))

import { useCopyProject } from '../useProjects'
import { projectKeys } from '../projectKeys'

afterEach(() => { vi.unstubAllGlobals(); captured.options = undefined })

describe('useCopyProject', () => {
  it('posts the name and start date to the source project copy route and parses a project', async () => {
    const $api = vi.fn(async () => ({ id: 31 }))
    vi.stubGlobal('useApi', () => ({ $api }))
    captured.qc = { setQueryData: vi.fn(), invalidateQueries: vi.fn() }
    useCopyProject()
    await captured.options.mutationFn({ id: 12, body: { name: 'Launch (copy)', start_date: '2030-05-01' } })
    expect($api).toHaveBeenCalledWith('/api/v1/projects/12/copy', {
      method: 'POST',
      body: { name: 'Launch (copy)', start_date: '2030-05-01' },
      schema: ProjectDetailSchema,
    })
  })

  it('caches the new project and invalidates the project lists like create does', () => {
    vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
    const setQueryData = vi.fn()
    const invalidateQueries = vi.fn()
    captured.qc = { setQueryData, invalidateQueries }
    useCopyProject()
    const detail = { id: 31 }
    captured.options.onSuccess(detail)
    expect(setQueryData).toHaveBeenCalledWith(projectKeys.detail(31), detail)
    expect(invalidateQueries).toHaveBeenCalled()
    expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(projectKeys.all)
  })
})
