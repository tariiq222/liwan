import { describe, expect, it } from 'vitest'
import type { InboxMessage } from '@liwan/contracts'
import { mergeLatestPage, mergeMessagePages, nextOlderOffset } from '../useInbox'

const message = (id: number) => ({ id, direction: 'in', body: `m${id}`, author: null, template: null, delivery_state: 'received', error: null, attachments: [], created_at: '2026-10-28T10:00:00Z' }) as unknown as InboxMessage
const page = (ids: number[], total: number) => ({ items: ids.map(message), total })

describe('inbox message pages', () => {
  it('puts older pages before newer ones, each page staying in ascending order', () => {
    const merged = mergeMessagePages([page([5, 6], 6), page([3, 4], 6), page([1, 2], 6)])
    expect(merged.map(item => item.id)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps a message once when new arrivals shifted it onto two pages', () => {
    const merged = mergeMessagePages([page([4, 5, 6], 6), page([3, 4], 6)])
    expect(merged.map(item => item.id)).toEqual([3, 4, 5, 6])
  })

  it('keeps the boundary message when the polled newest page shifts forward', () => {
    const history = [page(Array.from({ length: 100 }, (_, i) => 101 + i), 201), page(Array.from({ length: 100 }, (_, i) => 1 + i), 201)]
    // One arrival moved the newest page from 101–200 to 102–201; the old first page must not be dropped.
    const merged = mergeMessagePages(mergeLatestPage(history, page(Array.from({ length: 100 }, (_, i) => 102 + i), 201), false))
    expect(merged.map(item => item.id)).toEqual(Array.from({ length: 201 }, (_, i) => 1 + i))
  })

  it('lets the polled page win when a message changed state', () => {
    const stale = { ...message(7), delivery_state: 'queued', unconfirmed: false } as InboxMessage
    const fresh = { ...message(7), delivery_state: 'failed', unconfirmed: true } as InboxMessage
    const history = [{ items: [message(5), message(6), stale], total: 8 }]
    const merged = mergeMessagePages(mergeLatestPage(history, { items: [fresh, message(8)], total: 8 }, false))
    expect(merged.map(item => [item.id, item.delivery_state])).toEqual([
      [5, 'received'], [6, 'received'], [7, 'failed'], [8, 'received'],
    ])
  })

  it('keeps the loaded history when the polled page is off', () => {
    const history = [page([3, 4], 4)]
    expect(mergeLatestPage(history, page([4, 5], 5), true)).toBe(history)
  })

  it('asks for the next older page at the loaded count until the total is reached', () => {
    expect(nextOlderOffset([page([5, 6], 6)])).toBe(2)
    expect(nextOlderOffset([page([5, 6], 6), page([3, 4], 6)])).toBe(4)
    expect(nextOlderOffset([page([5, 6], 6), page([3, 4], 6), page([1, 2], 6)])).toBeUndefined()
  })

  it('reaches history beyond one server page of 200', () => {
    const pages = [page(Array.from({ length: 100 }, (_, i) => 300 - i), 450)]
    expect(nextOlderOffset(pages)).toBe(100)
    expect(nextOlderOffset([...pages, page(Array.from({ length: 100 }, (_, i) => 200 - i), 450), page(Array.from({ length: 100 }, (_, i) => 100 - i), 450), page(Array.from({ length: 100 }, (_, i) => 1000 + i), 450)])).toBe(400)
  })

  it('stops on an empty page instead of looping', () => {
    expect(nextOlderOffset([page([], 10)])).toBeUndefined()
  })
})
