import { describe, expect, it } from 'vitest'
import type { InboxMessage } from '@liwan/contracts'
import { mergeMessagePages, nextOlderOffset } from '../useInbox'

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
