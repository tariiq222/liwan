import { describe, expect, it, vi } from 'vitest'
import { projectKeys } from '../../../composables/projectKeys'
import type { AppRecordOption, AppSearchApi } from '../../types'
import { PROJECT_REF_PAGE, fetchAllProjectRefs, projectPicker } from '../recordPicker'

function refs(...ids: number[]): AppRecordOption[] {
  return ids.map(id => ({ id, name: `P${id}` }))
}

describe('fetchAllProjectRefs', () => {
  it('concatenates full pages and stops on a short page', async () => {
    const requestPage = vi.fn(async (offset: number) => {
      if (offset === 0) return refs(...Array.from({ length: PROJECT_REF_PAGE }, (_, i) => i + 1))
      if (offset === PROJECT_REF_PAGE) return refs(PROJECT_REF_PAGE + 1)
      throw new Error(`unexpected offset ${offset}`)
    })
    const items = await fetchAllProjectRefs(requestPage)
    expect(requestPage).toHaveBeenCalledTimes(2)
    expect(requestPage).toHaveBeenNthCalledWith(1, 0)
    expect(requestPage).toHaveBeenNthCalledWith(2, PROJECT_REF_PAGE)
    expect(items).toHaveLength(PROJECT_REF_PAGE + 1)
    expect(items.at(-1)).toEqual({ id: PROJECT_REF_PAGE + 1, name: `P${PROJECT_REF_PAGE + 1}` })
  })

  it('does not walk further after an empty last page', async () => {
    const requestPage = vi.fn(async (offset: number) => (offset === 0 ? refs(...Array.from({ length: PROJECT_REF_PAGE }, (_, i) => i + 1)) : []))
    const items = await fetchAllProjectRefs(requestPage)
    expect(requestPage).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(PROJECT_REF_PAGE)
  })

  it('stops paging when the query is cancelled', async () => {
    const controller = new AbortController()
    const requestPage = vi.fn(async (offset: number) => {
      if (offset === 0) {
        controller.abort()
        return refs(...Array.from({ length: PROJECT_REF_PAGE }, (_, i) => i + 1))
      }
      throw new Error('mixed-filter accumulation: later page must not run')
    })
    await expect(fetchAllProjectRefs(requestPage, PROJECT_REF_PAGE, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestPage).toHaveBeenCalledTimes(1)
  })
})

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
