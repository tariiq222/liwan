import { describe, expect, it, vi } from 'vitest'
import {
  PROJECT_REF_PAGE,
  fetchAllProjectRefs,
  parseProjectListRoute,
  patchProjectListRoute,
  projectListQuery,
  serializeProjectListRoute,
  sameProjectListRoute,
  type ProjectRef,
} from '../useProjects'
import { projectKeys } from '../projectKeys'

function refs(...ids: number[]): ProjectRef[] {
  return ids.map((id) => ({ id, name: `P${id}` }))
}

describe('projectListQuery', () => {
  it('serializes paging and filters without mixing empty values', () => {
    expect(projectListQuery(false, { q: '  ', status: undefined, limit: 50, offset: 0 })).toEqual({
      archived: undefined,
      q: undefined,
      status: undefined,
      limit: 50,
      offset: 0,
    })
    expect(projectListQuery(true, { q: ' portal ', status: 'unset', limit: 500, offset: -4 })).toEqual({
      archived: 1,
      q: 'portal',
      status: 'unset',
      limit: 200,
      offset: 0,
    })
  })

  it('clamps an explicit 0 limit to 1 and drops non-integer offsets', () => {
    expect(projectListQuery(false, { limit: 0 }).limit).toBe(1)
    expect(projectListQuery(false, { offset: Number.POSITIVE_INFINITY }).offset).toBe(0)
    expect(projectListQuery(false, { offset: 12.5 }).offset).toBe(0)
  })

  it('keeps list query keys distinct per filter and page', () => {
    const page0 = [...projectKeys.list, projectListQuery(false, { q: 'a', limit: 50, offset: 0 })]
    const page1 = [...projectKeys.list, projectListQuery(false, { q: 'a', limit: 50, offset: 50 })]
    const other = [...projectKeys.list, projectListQuery(false, { q: 'b', limit: 50, offset: 0 })]
    expect(page0).not.toEqual(page1)
    expect(page0).not.toEqual(other)
    expect(page0[0]).toBe('projects')
    expect(page0[1]).toBe('list')
  })

  it('separates the mine scope in the server query key', () => {
    const mine = projectListQuery(false, { mine: true, limit: 50, offset: 0 })
    const all = projectListQuery(false, { mine: false, limit: 50, offset: 0 })
    expect(mine).toMatchObject({ mine: 1 })
    expect(all).not.toHaveProperty('mine')
    expect([...projectKeys.list, mine]).not.toEqual([...projectKeys.list, all])
  })
})

describe('patchProjectListRoute', () => {
  it('merges rapid q then status without dropping either, and resets offset', () => {
    const afterSearch = patchProjectListRoute(parseProjectListRoute({ offset: '50' }), { q: 'Bulk' })
    const afterStatus = patchProjectListRoute(afterSearch, { status: 'on_track' })
    expect(serializeProjectListRoute(afterStatus)).toEqual({
      q: 'Bulk',
      status: 'on_track',
      offset: undefined,
      archived: undefined,
    })
  })

  it('keeps offset when only the page changes', () => {
    const listed = patchProjectListRoute(parseProjectListRoute({ q: 'Bulk', status: 'on_track' }), { offset: 50 })
    expect(serializeProjectListRoute(listed)).toEqual({
      q: 'Bulk',
      status: 'on_track',
      offset: 50,
      archived: undefined,
    })
  })
})

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


describe('design view state with paginated project filters', () => {
  it('preserves cards and sorting through search, status and pagination updates', () => {
    const initial = parseProjectListRoute({ view: 'cards', sort: 'progress', offset: '50' })
    const searched = patchProjectListRoute(initial, { q: 'نسق', status: 'on_track' })
    expect(serializeProjectListRoute(searched)).toMatchObject({ q: 'نسق', status: 'on_track', offset: undefined, view: 'cards', sort: 'progress' })
    const paged = patchProjectListRoute(searched, { offset: 50 })
    expect(serializeProjectListRoute(paged)).toMatchObject({ offset: 50, view: 'cards', sort: 'progress' })
  })
  it('recognizes view changes and clears default view/sort from the URL', () => {
    const cards = parseProjectListRoute({ view: 'cards', sort: 'name' })
    const table = patchProjectListRoute(cards, { view: 'table', sort: 'default' })
    expect(sameProjectListRoute(serializeProjectListRoute(cards), serializeProjectListRoute(table))).toBe(false)
    expect(serializeProjectListRoute(table)).toHaveProperty('view', 'table')
    expect(parseProjectListRoute(serializeProjectListRoute(table)).view).toBe('table')
    expect(serializeProjectListRoute(table)).not.toHaveProperty('sort')
  })
})

describe('mine project route state', () => {
  it('round-trips true, false, and absent mine values', () => {
    expect(parseProjectListRoute({ mine: '1' }).mine).toBe(true)
    expect(parseProjectListRoute({ mine: 'true' }).mine).toBe(true)
    expect(parseProjectListRoute({ mine: '0' }).mine).toBe(false)
    expect(parseProjectListRoute({ mine: 'false' }).mine).toBe(false)
    expect(parseProjectListRoute({}).mine).toBe(false)
    expect(serializeProjectListRoute(parseProjectListRoute({ mine: '1' }))).toMatchObject({ mine: '1' })
    expect(serializeProjectListRoute(parseProjectListRoute({}))).not.toHaveProperty('mine')
  })

  it('keeps mine through filter, sort, view, archive, page, and clear patches', () => {
    const initial = parseProjectListRoute({ mine: '1', q: 'portal', offset: '50', view: 'cards' })
    const searched = patchProjectListRoute(initial, { q: 'نسق' })
    const sorted = patchProjectListRoute(searched, { sort: 'progress' })
    const archived = patchProjectListRoute(sorted, { archived: true })
    const paged = patchProjectListRoute(archived, { offset: 50 })
    const cleared = patchProjectListRoute(paged, { q: '', status: 'all', sort: 'default' })
    expect(cleared.mine).toBe(true)
    expect(cleared.view).toBe('cards')
    expect(cleared.archived).toBe(true)
    expect(cleared.offset).toBe(0)
  })

  it('drops mine when the route is /projects without the query key', () => {
    expect(parseProjectListRoute({ mine: '1' }).mine).toBe(true)
    expect(parseProjectListRoute({}).mine).toBe(false)
    expect(serializeProjectListRoute(parseProjectListRoute({}))).not.toHaveProperty('mine')
  })
})


describe('global project ordering', () => {
  it('sends the selected order with every page request', () => {
    expect(projectListQuery(false, { sort: 'progress', limit: 50, offset: 50 })).toMatchObject({ sort: 'progress', limit: 50, offset: 50 })
    expect(projectListQuery(false, { sort: 'name' })).toMatchObject({ sort: 'name' })
  })
  it('returns to the first page when the order changes, preserving filters', () => {
    const next = patchProjectListRoute(parseProjectListRoute({ q: 'نسق', status: 'on_track', offset: '50' }), { sort: 'progress' })
    expect(next).toMatchObject({ q: 'نسق', status: 'on_track', sort: 'progress', offset: 0 })
  })
})
