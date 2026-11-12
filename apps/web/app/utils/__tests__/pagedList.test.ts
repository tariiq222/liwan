import { describe, expect, it, vi } from 'vitest'
import { fetchAllPages } from '../pagedList'

const source = Array.from({ length: 450 }, (_, index) => index)
const PAGE = 200
const pageOf = () => vi.fn(async (offset: number) => ({ items: source.slice(offset, offset + PAGE), total: source.length }))

describe('fetchAllPages', () => {
  it('asks for pages with a growing offset until it holds the total', async () => {
    const fetchPage = pageOf()
    const result = await fetchAllPages(fetchPage)
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 200, 400])
    expect(result).toEqual({ items: source, total: 450 })
  })
  it('makes one request for a short list', async () => {
    const fetchPage = vi.fn(async () => ({ items: [1, 2], total: 2 }))
    expect(await fetchAllPages(fetchPage)).toEqual({ items: [1, 2], total: 2 })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
  it('stops on an empty page even when the total promises more', async () => {
    const fetchPage = vi.fn(async (offset: number) => ({ items: offset === 0 ? [1, 2] : [], total: 9 }))
    expect(await fetchAllPages(fetchPage)).toEqual({ items: [1, 2], total: 9 })
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
  it('returns an empty list after one request', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], total: 0 }))
    expect(await fetchAllPages(fetchPage)).toEqual({ items: [], total: 0 })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
  it('stops between pages when aborted', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn(async (offset: number) => { controller.abort(); return { items: source.slice(offset, offset + PAGE), total: 450 } })
    await expect(fetchAllPages(fetchPage, controller.signal)).rejects.toThrow()
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})
