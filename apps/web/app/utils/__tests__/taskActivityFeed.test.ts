import type { TimelineEntry } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import { activityFeed } from '../taskActivityFeed'

const entry = (id: number, kind: 'comment' | 'log', at: string) => ({ id, kind, at }) as unknown as TimelineEntry
// The server answers newest first.
const server = [entry(4, 'comment', '2026-11-04T10:00:00Z'), entry(3, 'log', '2026-11-03T10:00:00Z'), entry(2, 'comment', '2026-11-02T10:00:00Z'), entry(1, 'log', '2026-11-01T10:00:00Z')]
const ids = (entries: TimelineEntry[]) => entries.map(item => item.id)

describe('activityFeed', () => {
  it('merges comments and the log into one oldest-first feed', () => {
    expect(ids(activityFeed(server, 'all'))).toEqual([1, 2, 3, 4])
  })
  it('keeps one kind for the comments and log filters', () => {
    expect(ids(activityFeed(server, 'comments'))).toEqual([2, 4])
    expect(ids(activityFeed(server, 'log'))).toEqual([1, 3])
  })
  it('keeps the server order reversed for entries at the same instant, and does not mutate the input', () => {
    const same = [entry(2, 'comment', '2026-11-01T10:00:00Z'), entry(1, 'log', '2026-11-01T10:00:00Z')]
    expect(ids(activityFeed(same, 'all'))).toEqual([1, 2])
    expect(ids(same)).toEqual([2, 1])
  })
  it('is empty for an empty timeline', () => {
    expect(activityFeed([], 'all')).toEqual([])
  })
})
