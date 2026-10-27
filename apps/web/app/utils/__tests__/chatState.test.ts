import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@webvue/contracts'
import {
  CHAT_PAGE_SIZE,
  CHAT_POLL_MS,
  chatCacheScope,
  chatListQuery,
  chatPollInterval,
  isFatalChatStatus,
  mergeMessages,
  messageDayKey,
  needsMessageCatchUp,
  nextListOffset,
  parseChatListRoute,
  preserveFailedDraft,
  serializeChatListRoute,
  shouldSendOnEnter,
  visibleReadMessageId,
} from '../chatState'

function msg(id: number): ChatMessage {
  return {
    id,
    conversation_id: 1,
    author: { id: 2, name: 'Sara' },
    body: `m${id}`,
    created_at: '2026-09-07T10:00:00Z',
    attachments: [],
    parent: null,
    edited: false,
    pinned: false,
    starred: false,
    reactions: [],
    notice: null,
  }
}

describe('chat list route', () => {
  it('parses q and filter and drops defaults when serializing', () => {
    expect(parseChatListRoute({ q: 'ops', filter: 'unread' })).toEqual({ q: 'ops', filter: 'unread', offset: 0 })
    expect(parseChatListRoute({ filter: 'channels' }).filter).toBe('channels')
    expect(parseChatListRoute({ filter: 'starred' }).filter).toBe('starred')
    expect(parseChatListRoute({ filter: 'nope' }).filter).toBe('all')
    expect(serializeChatListRoute({ q: '  ', filter: 'all', offset: 0 })).toEqual({ q: undefined, filter: undefined, offset: undefined })
    expect(chatListQuery({ q: ' ops ', filter: 'groups', offset: 50 })).toEqual({
      q: 'ops', filter: 'groups', limit: 50, offset: 50,
    })
  })
})

describe('mergeMessages', () => {
  it('refreshes edited content and reactions without duplicating existing messages', () => {
    const original = msg(2)
    const updated = { ...original, body: 'edited', edited: true, reactions: [{ content: '👍', count: 1, me: false }] }
    const merged = mergeMessages([msg(1), original], [updated, msg(3)], 'newer')
    expect(merged.map(item => item.id)).toEqual([1, 2, 3])
    expect(merged[1]).toEqual(updated)
    expect(original.body).toBe('m2')
  })
  it('prepends older messages without dropping current ones or jumping ids', () => {
    const current = [msg(3), msg(4)]
    const merged = mergeMessages(current, [msg(1), msg(2), msg(3)], 'older')
    expect(merged.map(item => item.id)).toEqual([1, 2, 3, 4])
    expect(current.map(item => item.id)).toEqual([3, 4])
  })
  it('appends only unseen newer messages', () => {
    const merged = mergeMessages([msg(1), msg(2)], [msg(2), msg(3)], 'newer')
    expect(merged.map(item => item.id)).toEqual([1, 2, 3])
  })
})

describe('composer and cache', () => {
  it('sends on Enter but not Shift+Enter or IME composition', () => {
    expect(shouldSendOnEnter({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(shouldSendOnEnter({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(shouldSendOnEnter({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })
  it('keeps the failed draft and scopes cache per user', () => {
    expect(preserveFailedDraft('hello', true)).toBe('hello')
    expect(preserveFailedDraft('hello', false, '')).toBe('')
    expect(chatCacheScope(7)).toEqual(['chat', 7])
    expect(CHAT_POLL_MS).toBe(5000)
  })
})

describe('visible read and polling fail-closed', () => {
  it('marks only the newest id actually visible while the tab is active', () => {
    expect(visibleReadMessageId({ tabVisible: true, pageVisible: true, visibleIds: [4, 7, 5] })).toBe(7)
    expect(visibleReadMessageId({ tabVisible: true, pageVisible: true, visibleIds: [2] })).toBe(2)
    expect(visibleReadMessageId({ tabVisible: false, pageVisible: true, visibleIds: [9] })).toBeNull()
    expect(visibleReadMessageId({ tabVisible: true, pageVisible: false, visibleIds: [9] })).toBeNull()
    expect(visibleReadMessageId({ tabVisible: true, pageVisible: true, visibleIds: [] })).toBeNull()
  })
  it('stops polling on 403/404 and keeps polling otherwise', () => {
    expect(isFatalChatStatus(403)).toBe(true)
    expect(isFatalChatStatus(404)).toBe(true)
    expect(isFatalChatStatus(500)).toBe(false)
    expect(chatPollInterval(403)).toBe(false)
    expect(chatPollInterval(undefined)).toBe(CHAT_POLL_MS)
  })
  it('keeps catching up when a newer page is full so ids are not skipped', () => {
    const full = Array.from({ length: CHAT_PAGE_SIZE }, (_, i) => msg(i + 10))
    expect(needsMessageCatchUp(9, full)).toBe(true)
    expect(needsMessageCatchUp(9, [msg(10)])).toBe(false)
    expect(nextListOffset(0, 120, CHAT_PAGE_SIZE)).toBe(50)
    expect(nextListOffset(50, 120, CHAT_PAGE_SIZE)).toBe(100)
    expect(nextListOffset(100, 120, CHAT_PAGE_SIZE)).toBe(100)
    expect(messageDayKey('2026-09-07T10:00:00Z')).toBe('2026-09-07')
  })
})
