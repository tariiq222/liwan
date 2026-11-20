import { describe, expect, it } from 'vitest'
import { DEFAULT_INBOX_LIST_ROUTE, INBOX_PAGE_SIZE, inboxListQuery, inboxOffsetCorrection, inboxPageOffset, parseInboxListRoute, serializeInboxListRoute } from '../inboxListRoute'

describe('inbox list route', () => {
  it('parses an empty query to the defaults', () => {
    expect(parseInboxListRoute({})).toEqual(DEFAULT_INBOX_LIST_ROUTE)
  })

  it('round-trips every filter through the URL query', () => {
    const route = { assignee: 'me', state: 'pending', priority: 'urgent', channel: 'tiktok', departmentId: 4, csat: 'bad', q: 'سارة', sort: 'waiting', offset: 30 } as const
    expect(parseInboxListRoute(serializeInboxListRoute(route))).toEqual(route)
  })

  it('serializes only filters that differ from the defaults', () => {
    expect(serializeInboxListRoute(DEFAULT_INBOX_LIST_ROUTE)).toEqual({})
    expect(serializeInboxListRoute({ ...DEFAULT_INBOX_LIST_ROUTE, state: 'open' })).toEqual({ state: 'open' })
    expect(serializeInboxListRoute({ ...DEFAULT_INBOX_LIST_ROUTE, channel: 'whatsapp' })).toEqual({ channel: 'whatsapp' })
    expect(serializeInboxListRoute({ ...DEFAULT_INBOX_LIST_ROUTE, sort: 'waiting' })).toEqual({ sort: 'waiting' })
  })

  it('ignores values the list does not know instead of sending them to the server', () => {
    expect(parseInboxListRoute({ assignee: '7', state: 'archived', priority: 'critical', channel: 'sms', department_id: '-3', offset: 'x', csat: 'great', q: '  hi ', sort: 'oldest' }))
      .toEqual({ assignee: 'all', state: '', priority: '', channel: '', departmentId: null, csat: '', q: 'hi', sort: 'recent', offset: 0 })
  })

  it('takes the first value of a repeated parameter', () => {
    expect(parseInboxListRoute({ state: ['closed', 'open'] }).state).toBe('closed')
  })

  it('builds the list endpoint query with the page window', () => {
    expect(inboxListQuery({ assignee: 'unassigned', state: 'open', priority: 'high', channel: 'tiktok', departmentId: 2, csat: 'good', q: 'x', sort: 'waiting', offset: 60 }))
      .toEqual({ assignee: 'unassigned', state: 'open', priority: 'high', channel_kind: 'tiktok', department_id: 2, csat: 'good', q: 'x', sort: 'waiting', limit: INBOX_PAGE_SIZE, offset: 60 })
    expect(inboxListQuery(DEFAULT_INBOX_LIST_ROUTE)).toEqual({ limit: INBOX_PAGE_SIZE, offset: 0 })
  })

  it('keeps a requested page inside the list', () => {
    expect(inboxPageOffset(2, 100)).toBe(INBOX_PAGE_SIZE)
    expect(inboxPageOffset(99, 100)).toBe(3 * INBOX_PAGE_SIZE)
    expect(inboxPageOffset(0, 0)).toBe(0)
  })

  it('corrects an offset past the end or off a page boundary', () => {
    expect(inboxOffsetCorrection(9999, 40)).toBe(30)
    expect(inboxOffsetCorrection(30, 40)).toBeNull()
    expect(inboxOffsetCorrection(15, 40)).toBe(0)
    expect(inboxOffsetCorrection(45, 100)).toBe(30)
    expect(inboxOffsetCorrection(60, 40)).toBe(30)
    expect(inboxOffsetCorrection(30, 0)).toBe(0)
    expect(inboxOffsetCorrection(0, 0)).toBeNull()
    expect(inboxOffsetCorrection(30, 30)).toBe(0)
  })

  it('parses a negative, non-numeric or fractional offset to the first page', () => {
    for (const offset of ['-5', 'abc', '1.5']) expect(parseInboxListRoute({ offset }).offset).toBe(0)
  })
})
