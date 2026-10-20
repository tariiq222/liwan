import { describe, expect, it, vi } from 'vitest'
import { fetchAllRecordOptions } from '../fetchAllRecordOptions'
import type { AppRecordOption } from '../types'

const PAGE = 200

function refs(...ids: number[]): AppRecordOption[] {
  return ids.map(id => ({ id, name: `R${id}` }))
}

describe('fetchAllRecordOptions', () => {
  it('concatenates full pages and stops on a short page', async () => {
    const requestPage = vi.fn(async (offset: number) => {
      if (offset === 0) return refs(...Array.from({ length: PAGE }, (_, i) => i + 1))
      if (offset === PAGE) return refs(PAGE + 1)
      throw new Error(`unexpected offset ${offset}`)
    })
    const items = await fetchAllRecordOptions(requestPage, PAGE)
    expect(requestPage).toHaveBeenCalledTimes(2)
    expect(requestPage).toHaveBeenNthCalledWith(1, 0)
    expect(requestPage).toHaveBeenNthCalledWith(2, PAGE)
    expect(items).toHaveLength(PAGE + 1)
    expect(items.at(-1)).toEqual({ id: PAGE + 1, name: `R${PAGE + 1}` })
  })

  it('does not walk further after an empty last page', async () => {
    const requestPage = vi.fn(async (offset: number) => (offset === 0 ? refs(...Array.from({ length: PAGE }, (_, i) => i + 1)) : []))
    const items = await fetchAllRecordOptions(requestPage, PAGE)
    expect(requestPage).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(PAGE)
  })

  it('stops paging when the query is cancelled', async () => {
    const controller = new AbortController()
    const requestPage = vi.fn(async (offset: number) => {
      if (offset === 0) {
        controller.abort()
        return refs(...Array.from({ length: PAGE }, (_, i) => i + 1))
      }
      throw new Error('mixed-filter accumulation: later page must not run')
    })
    await expect(fetchAllRecordOptions(requestPage, PAGE, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestPage).toHaveBeenCalledTimes(1)
  })
})
