import { describe, expect, it } from 'vitest'
import {
  deadlineDay,
  isOverdue,
  listPatch,
  parseListState,
  toListParams,
} from '../myTaskList'

describe('my-tasks list route state', () => {
  it('defaults to the open tab, all scope and deadline sort', () => {
    expect(parseListState({})).toEqual({ tab: 'open', scope: 'all', sort: 'deadline', q: '', offset: 0 })
  })

  it('reads valid values and ignores anything else', () => {
    expect(parseListState({ tab: 'closed', scope: 'created', sort: 'name', q: ' x ', offset: 0 }))
      .toEqual({ tab: 'closed', scope: 'created', sort: 'name', q: ' x ', offset: 0 })
    expect(parseListState({ tab: 'x', scope: ['assigned', 'created'], sort: 'zzz', q: ['a'] }))
      .toEqual({ tab: 'open', scope: 'assigned', sort: 'deadline', q: 'a', offset: 0 })
  })

  it('maps the state to API params', () => {
    expect(toListParams({ tab: 'closed', scope: 'all', sort: 'deadline', q: ' hi ', offset: 0 }))
      .toEqual({ closed: true, scope: undefined, sort: undefined, q: 'hi', offset: 0 })
    expect(toListParams({ tab: 'open', scope: 'assigned', sort: 'created', q: '', offset: 0 }))
      .toEqual({ closed: false, scope: 'assigned', sort: 'created', q: undefined, offset: 0 })
  })

  it('drops default values from the URL and keeps unrelated keys', () => {
    expect(listPatch({ keep: '1', tab: 'closed', q: 'a' }, { tab: 'open', q: '', offset: 0 })).toEqual({ keep: '1' })
    expect(listPatch({}, { scope: 'created' })).toEqual({ scope: 'created' })
    expect(listPatch({}, { scope: 'all', sort: 'deadline' })).toEqual({})
  })
})

describe('my-tasks deadline rendering', () => {
  it('keeps the UTC date part without a day shift', () => {
    expect(deadlineDay('2026-10-14T00:00:00Z')).toBe('2026-10-14')
    expect(deadlineDay('2026-01-01T00:00:00Z')).toBe('2026-01-01')
    expect(deadlineDay('2026-10-20T21:30:00Z')).toBe('2026-10-20')
    expect(deadlineDay(null)).toBeNull()
  })

  it('is overdue only for an open task whose day is before today', () => {
    expect(isOverdue('2026-10-12T00:00:00Z', 'open', '2026-10-13')).toBe(true)
    expect(isOverdue('2026-10-13T00:00:00Z', 'open', '2026-10-13')).toBe(false)
    expect(isOverdue('2026-10-12T00:00:00Z', 'done', '2026-10-13')).toBe(false)
    expect(isOverdue(null, 'open', '2026-10-13')).toBe(false)
  })
})

describe('closed scope and URL pagination', () => {
  it('reads a closed scope with its actual page offset', () => {
    expect(parseListState({ tab: 'closed', offset: '50' })).toEqual({ tab: 'closed', scope: 'all', sort: 'deadline', q: '', offset: 50 })
  })
  it('resets only pagination when search changes and retains other URL state', () => {
    expect(listPatch({ q: 'old', offset: '50', scope: 'created', view: 'board' }, { q: 'بحث & عربي' }))
      .toEqual({ q: 'بحث & عربي', scope: 'created', view: 'board' })
  })
  it('requests the server closed scope without client-filtering done versus cancelled', () => {
    expect(toListParams(parseListState({ tab: 'closed', offset: '50' }))).toMatchObject({ closed: true, offset: 50 })
  })
})
