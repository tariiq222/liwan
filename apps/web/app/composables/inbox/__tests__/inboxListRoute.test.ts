import { describe, expect, it } from 'vitest'
import { DEFAULT_INBOX_LIST_ROUTE, INBOX_PAGE_SIZE, inboxListQuery, inboxPageOffset, parseInboxListRoute, serializeInboxListRoute } from '../inboxListRoute'

describe('inbox list route', () => {
  it('parses an empty query to the defaults', () => {
    expect(parseInboxListRoute({})).toEqual(DEFAULT_INBOX_LIST_ROUTE)
  })

  it('round-trips every filter through the URL query', () => {
    const route = { assignee: 'me', state: 'pending', departmentId: 4, q: 'سارة', offset: 30 } as const
    expect(parseInboxListRoute(serializeInboxListRoute(route))).toEqual(route)
  })

  it('serializes only filters that differ from the defaults', () => {
    expect(serializeInboxListRoute(DEFAULT_INBOX_LIST_ROUTE)).toEqual({})
    expect(serializeInboxListRoute({ ...DEFAULT_INBOX_LIST_ROUTE, state: 'open' })).toEqual({ state: 'open' })
  })

  it('ignores values the list does not know instead of sending them to the server', () => {
    expect(parseInboxListRoute({ assignee: '7', state: 'archived', department_id: '-3', offset: 'x', q: '  hi ' }))
      .toEqual({ assignee: 'all', state: '', departmentId: null, q: 'hi', offset: 0 })
  })

  it('takes the first value of a repeated parameter', () => {
    expect(parseInboxListRoute({ state: ['closed', 'open'] }).state).toBe('closed')
  })

  it('builds the list endpoint query with the page window', () => {
    expect(inboxListQuery({ assignee: 'unassigned', state: 'open', departmentId: 2, q: 'x', offset: 60 }))
      .toEqual({ assignee: 'unassigned', state: 'open', department_id: 2, q: 'x', limit: INBOX_PAGE_SIZE, offset: 60 })
    expect(inboxListQuery(DEFAULT_INBOX_LIST_ROUTE)).toEqual({ limit: INBOX_PAGE_SIZE, offset: 0 })
  })

  it('keeps a requested page inside the list', () => {
    expect(inboxPageOffset(2, 100)).toBe(INBOX_PAGE_SIZE)
    expect(inboxPageOffset(99, 100)).toBe(3 * INBOX_PAGE_SIZE)
    expect(inboxPageOffset(0, 0)).toBe(0)
  })
})
