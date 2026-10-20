import { describe, expect, it, vi } from 'vitest'
import { projectKeys } from '../../../composables/projectKeys'
import type { AppRecordOption, AppSearchApi } from '../../types'
import { PROJECT_REF_PAGE, projectPicker } from '../recordPicker'

function refs(...ids: number[]): AppRecordOption[] {
  return ids.map(id => ({ id, name: `P${id}` }))
}

describe('projectPicker', () => {
  it('shares the minimal project cache key the project writes refresh', () => {
    expect(projectPicker.queryKey).toBe(projectKeys.minimal)
    expect(projectPicker.kind).toBe('project')
  })

  it('walks the minimal project pages through the api', async () => {
    const api = vi.fn(async (_url: string, options: { query?: Record<string, unknown> }) => (
      options.query?.offset === 0 ? refs(1, 2) : []
    )) as unknown as AppSearchApi
    const items = await projectPicker.options(api)
    expect(items).toEqual(refs(1, 2))
    expect(api).toHaveBeenCalledWith('/api/v1/projects', expect.objectContaining({ query: { minimal: 1, limit: PROJECT_REF_PAGE, offset: 0 } }))
  })
})
