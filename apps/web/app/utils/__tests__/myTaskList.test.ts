import { describe, expect, it } from 'vitest'
import {
  dedupeById,
  deadlineDay,
  isOverdue,
  listPatch,
  nextOffset,
  parseListState,
  toListParams,
} from '../myTaskList'

describe('my-tasks list route state', () => {
  it('defaults to the open tab, all scope and deadline sort', () => {
    expect(parseListState({})).toEqual({ tab: 'open', scope: 'all', sort: 'deadline', q: '' })
  })

  it('reads valid values and ignores anything else', () => {
    expect(parseListState({ tab: 'done', scope: 'created', sort: 'name', q: ' x ' }))
      .toEqual({ tab: 'done', scope: 'created', sort: 'name', q: ' x ' })
    expect(parseListState({ tab: 'x', scope: ['assigned', 'created'], sort: 'zzz', q: ['a'] }))
      .toEqual({ tab: 'open', scope: 'assigned', sort: 'deadline', q: 'a' })
  })

  it('maps the state to API params', () => {
    expect(toListParams({ tab: 'done', scope: 'all', sort: 'deadline', q: ' hi ' }))
      .toEqual({ closed: true, scope: undefined, sort: undefined, q: 'hi' })
    expect(toListParams({ tab: 'open', scope: 'assigned', sort: 'created', q: '' }))
      .toEqual({ closed: false, scope: 'assigned', sort: 'created', q: undefined })
  })

  it('drops default values from the URL and keeps unrelated keys', () => {
    expect(listPatch({ keep: '1', tab: 'done', q: 'a' }, { tab: 'open', q: '' })).toEqual({ keep: '1' })
    expect(listPatch({}, { scope: 'created' })).toEqual({ scope: 'created' })
    expect(listPatch({}, { scope: 'all', sort: 'deadline' })).toEqual({})
  })
})

describe('my-tasks deadline rendering', () => {
  it('keeps the UTC date part without a day shift', () => {
    expect(deadlineDay('2026-10-14T00:00:00Z')).toBe('2026-10-14')
    expect(deadlineDay('2026-01-01T00:00:00Z')).toBe('2026-01-01')
    expect(deadlineDay(null)).toBeNull()
  })

  it('is overdue only for an open task whose day is before today', () => {
    expect(isOverdue('2026-10-12T00:00:00Z', 'open', '2026-10-13')).toBe(true)
    expect(isOverdue('2026-10-13T00:00:00Z', 'open', '2026-10-13')).toBe(false)
    expect(isOverdue('2026-10-12T00:00:00Z', 'done', '2026-10-13')).toBe(false)
    expect(isOverdue(null, 'open', '2026-10-13')).toBe(false)
  })
})

describe('my-tasks paging', () => {
  it('continues by offset + limit against the total, even after a short page', () => {
    expect(nextOffset({ offset: 0, limit: 50, total: 120, received: 48 })).toBe(50)
    expect(nextOffset({ offset: 50, limit: 50, total: 120, received: 50 })).toBe(100)
  })

  it('stops at the total or on an empty page', () => {
    expect(nextOffset({ offset: 100, limit: 50, total: 120, received: 20 })).toBeUndefined()
    expect(nextOffset({ offset: 50, limit: 50, total: 120, received: 0 })).toBeUndefined()
    expect(nextOffset({ offset: 0, limit: 50, total: 50, received: 50 })).toBeUndefined()
  })
})

describe('my-tasks row de-duplication', () => {
  it('keeps the first occurrence of an id and the order', () => {
    const rows = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'c' }, { id: 3, n: 'd' }]
    expect(dedupeById(rows)).toEqual([{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 3, n: 'd' }])
    expect(dedupeById([])).toEqual([])
  })
})
