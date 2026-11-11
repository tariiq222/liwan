import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyChatDeleted, applyChatTyping, chatDeletedBatch, chatTypists, collectChatIds, collectInboxIds, collectTaskIds, nextBackoffDelay, parseBusFrame } from '../useBus'
import { CHAT_TYPING_MS } from '../../utils/chatState'

describe('parseBusFrame', () => {
  it('parses a frame with one notification and returns its id as lastId', () => {
    const raw = JSON.stringify([{ id: 42, message: { type: 'liwan/task', payload: { id: 7, event: 'updated' } } }])
    const { notifications, lastId } = parseBusFrame(raw)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.message.type).toBe('liwan/task')
    expect(lastId).toBe(42)
  })

  it('takes the id of the last notification when a frame carries several', () => {
    const raw = JSON.stringify([
      { id: 10, message: { type: 'liwan/task', payload: { id: 1 } } },
      { id: 11, message: { type: 'liwan/task', payload: { id: 2 } } },
      { id: 12, message: { type: 'liwan/task', payload: { id: 3 } } },
    ])
    const { lastId } = parseBusFrame(raw)
    expect(lastId).toBe(12)
  })

  it('returns an undefined lastId for an empty frame, leaving the tracked last untouched', () => {
    const { notifications, lastId } = parseBusFrame('[]')
    expect(notifications).toHaveLength(0)
    expect(lastId).toBeUndefined()
  })

  it('passes through notification types the caller does not act on', () => {
    const raw = JSON.stringify([{ id: 1, message: { type: 'some/other', payload: {} } }])
    const { notifications } = parseBusFrame(raw)
    expect(notifications[0]!.message.type).toBe('some/other')
  })

  // Runs inside the socket's onmessage: a throw there is an unhandled error,
  // so a malformed frame must degrade to "nothing to do" instead.
  it('returns an empty frame for malformed JSON instead of throwing', () => {
    expect(() => parseBusFrame('{not json')).not.toThrow()
    const { notifications, lastId } = parseBusFrame('{not json')
    expect(notifications).toEqual([])
    expect(lastId).toBeUndefined()
  })

  it('returns an empty frame for valid JSON that is not an array', () => {
    const { notifications, lastId } = parseBusFrame('{"id":1}')
    expect(notifications).toEqual([])
    expect(lastId).toBeUndefined()
  })
})

describe('collectTaskIds', () => {
  it('dedupes multiple notifications for the same task id, keeping first-seen order', () => {
    const raw = [
      { id: 1, message: { type: 'liwan/task', payload: { id: 7 } } },
      { id: 2, message: { type: 'liwan/task', payload: { id: 9 } } },
      { id: 3, message: { type: 'liwan/task', payload: { id: 7 } } },
      { id: 4, message: { type: 'liwan/task', payload: { id: 7 } } },
    ]
    expect(collectTaskIds(raw)).toEqual([7, 9])
  })

  it('ignores notification types other than liwan/task', () => {
    const raw = [
      { id: 1, message: { type: 'some/other', payload: { id: 1 } } },
      { id: 2, message: { type: 'liwan/task', payload: { id: 2 } } },
    ]
    expect(collectTaskIds(raw)).toEqual([2])
  })

  it('ignores notifications missing a numeric payload id', () => {
    const raw = [
      { id: 1, message: { type: 'liwan/task', payload: {} } },
      { id: 2, message: { type: 'liwan/task' } },
      { id: 3, message: { type: 'liwan/task', payload: { id: 'not-a-number' } } },
    ]
    expect(collectTaskIds(raw as any)).toEqual([])
  })

  it('returns an empty array for an empty frame', () => {
    expect(collectTaskIds([])).toEqual([])
  })
})

describe('collectChatIds', () => {
  it('collects liwan/chat conversation ids', () => {
    expect(collectChatIds([
      { id: 1, message: { type: 'liwan/chat', payload: { id: 42, event: 'message' } } },
      { id: 2, message: { type: 'liwan/task', payload: { id: 7 } } },
      { id: 3, message: { type: 'liwan/chat', payload: { id: 42 } } },
    ])).toEqual([42])
  })
})

describe('collectInboxIds', () => {
  it('collects liwan/inbox conversation ids only', () => {
    expect(collectInboxIds([
      { id: 1, message: { type: 'liwan/inbox', payload: { id: 9, event: 'conversation' } } },
      { id: 2, message: { type: 'liwan/chat', payload: { id: 42 } } },
      { id: 3, message: { type: 'liwan/inbox', payload: { id: 9 } } },
    ])).toEqual([9])
  })

  it('collects the id of a template change, which refreshes every inbox query', () => {
    expect(collectInboxIds([
      { id: 1, message: { type: 'liwan/inbox', payload: { id: 12, event: 'template' } } },
    ])).toEqual([12])
  })

  it('collects every id of one batched conversation notification once', () => {
    expect(collectInboxIds([
      { id: 1, message: { type: 'liwan/inbox', payload: { event: 'conversation', ids: [4, 7, 4] } } },
      { id: 2, message: { type: 'liwan/inbox', payload: { event: 'conversation', id: 9 } } },
    ])).toEqual([4, 7, 9])
  })
})

describe('applyChatTyping', () => {
  beforeEach(() => { vi.useFakeTimers(); chatTypists.value = [] })
  afterEach(() => vi.useRealTimers())

  it('keeps the writer name and expires typing after the idle window', () => {
    applyChatTyping({ conversationId: 8, userId: 3, userName: 'Peer', isTyping: true })
    expect(chatTypists.value).toEqual([{ conversationId: 8, userId: 3, userName: 'Peer', isTyping: true }])
    vi.advanceTimersByTime(CHAT_TYPING_MS)
    expect(chatTypists.value).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tracks each channel and each user on their own, so a second typist or channel does not replace the first', () => {
    applyChatTyping({ conversationId: 8, userId: 3, userName: 'A', isTyping: true })
    vi.advanceTimersByTime(2_000)
    applyChatTyping({ conversationId: 8, userId: 4, userName: 'B', isTyping: true })
    applyChatTyping({ conversationId: 9, userId: 3, userName: 'A', isTyping: true })
    expect(chatTypists.value.map(entry => `${entry.conversationId}:${entry.userId}`)).toEqual(['8:3', '8:4', '9:3'])
    vi.advanceTimersByTime(CHAT_TYPING_MS - 2_000)
    expect(chatTypists.value.map(entry => `${entry.conversationId}:${entry.userId}`)).toEqual(['8:4', '9:3'])
    applyChatTyping({ conversationId: 8, userId: 4, userName: 'B', isTyping: false })
    expect(chatTypists.value.map(entry => `${entry.conversationId}:${entry.userId}`)).toEqual(['9:3'])
  })

  it('restarts the idle window when the same user types again, without a duplicate entry', () => {
    applyChatTyping({ conversationId: 8, userId: 3, userName: 'A', isTyping: true })
    vi.advanceTimersByTime(CHAT_TYPING_MS - 1)
    applyChatTyping({ conversationId: 8, userId: 3, userName: 'A', isTyping: true })
    vi.advanceTimersByTime(CHAT_TYPING_MS - 1)
    expect(chatTypists.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(chatTypists.value).toEqual([])
  })
})

describe('nextBackoffDelay', () => {
  const noJitter = () => 0.5 // random() = 0.5 -> jitter term is 0

  it('starts at 1s for the first attempt (attempt 0)', () => {
    expect(nextBackoffDelay(0, noJitter)).toBe(1000)
  })

  it('doubles each attempt', () => {
    expect(nextBackoffDelay(1, noJitter)).toBe(2000)
    expect(nextBackoffDelay(2, noJitter)).toBe(4000)
    expect(nextBackoffDelay(3, noJitter)).toBe(8000)
    expect(nextBackoffDelay(4, noJitter)).toBe(16000)
  })

  it('caps at 30s and stays there for later attempts', () => {
    expect(nextBackoffDelay(5, noJitter)).toBe(30000)
    expect(nextBackoffDelay(10, noJitter)).toBe(30000)
    expect(nextBackoffDelay(20, noJitter)).toBe(30000)
  })

  it('applies up to +/-20% jitter around the base delay', () => {
    const maxRandom = () => 1 // random()=1 -> +20% jitter
    const minRandom = () => 0 // random()=0 -> -20% jitter
    expect(nextBackoffDelay(0, maxRandom)).toBe(1200)
    expect(nextBackoffDelay(0, minRandom)).toBe(800)
  })

  it('never returns a negative or zero delay for any random() in [0,1)', () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      expect(nextBackoffDelay(0, () => r)).toBeGreaterThan(0)
    }
  })
})

describe('applyChatDeleted', () => {
  const deleted = (id: number, messageId: number) => ({ message: { type: 'liwan/chat', payload: { id, event: 'message_deleted', message_id: messageId } } })

  it('announces the id of a message removed for good, and ignores every other event', () => {
    chatDeletedBatch.value = []
    applyChatDeleted([
      { message: { type: 'liwan/chat', payload: { id: 5, event: 'message_updated', message_id: 9 } } },
      { message: { type: 'liwan/task', payload: { id: 5, event: 'message_deleted', message_id: 9 } } },
    ])
    expect(chatDeletedBatch.value).toEqual([])
    applyChatDeleted([deleted(5, 9)])
    expect(chatDeletedBatch.value).toEqual([{ conversationId: 5, messageId: 9 }])
  })

  it('keeps every delete of one frame, and the next frame replaces the batch instead of growing it', () => {
    applyChatDeleted([deleted(5, 9), deleted(5, 10), deleted(6, 3)])
    expect(chatDeletedBatch.value).toEqual([{ conversationId: 5, messageId: 9 }, { conversationId: 5, messageId: 10 }, { conversationId: 6, messageId: 3 }])
    applyChatDeleted([deleted(5, 11)])
    expect(chatDeletedBatch.value).toEqual([{ conversationId: 5, messageId: 11 }])
  })
})
