import { describe, expect, it, vi } from 'vitest'
import { applyChatTyping, chatTypingEvent, collectChatIds, collectTaskIds, nextBackoffDelay, parseBusFrame } from '../useBus'
import { CHAT_TYPING_MS } from '../../utils/chatState'

describe('parseBusFrame', () => {
  it('parses a frame with one notification and returns its id as lastId', () => {
    const raw = JSON.stringify([{ id: 42, message: { type: 'nasq/task', payload: { id: 7, event: 'updated' } } }])
    const { notifications, lastId } = parseBusFrame(raw)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.message.type).toBe('nasq/task')
    expect(lastId).toBe(42)
  })

  it('takes the id of the last notification when a frame carries several', () => {
    const raw = JSON.stringify([
      { id: 10, message: { type: 'nasq/task', payload: { id: 1 } } },
      { id: 11, message: { type: 'nasq/task', payload: { id: 2 } } },
      { id: 12, message: { type: 'nasq/task', payload: { id: 3 } } },
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
      { id: 1, message: { type: 'nasq/task', payload: { id: 7 } } },
      { id: 2, message: { type: 'nasq/task', payload: { id: 9 } } },
      { id: 3, message: { type: 'nasq/task', payload: { id: 7 } } },
      { id: 4, message: { type: 'nasq/task', payload: { id: 7 } } },
    ]
    expect(collectTaskIds(raw)).toEqual([7, 9])
  })

  it('ignores notification types other than nasq/task', () => {
    const raw = [
      { id: 1, message: { type: 'some/other', payload: { id: 1 } } },
      { id: 2, message: { type: 'nasq/task', payload: { id: 2 } } },
    ]
    expect(collectTaskIds(raw)).toEqual([2])
  })

  it('ignores notifications missing a numeric payload id', () => {
    const raw = [
      { id: 1, message: { type: 'nasq/task', payload: {} } },
      { id: 2, message: { type: 'nasq/task' } },
      { id: 3, message: { type: 'nasq/task', payload: { id: 'not-a-number' } } },
    ]
    expect(collectTaskIds(raw as any)).toEqual([])
  })

  it('returns an empty array for an empty frame', () => {
    expect(collectTaskIds([])).toEqual([])
  })
})

describe('collectChatIds', () => {
  it('collects nasq/chat conversation ids', () => {
    expect(collectChatIds([
      { id: 1, message: { type: 'nasq/chat', payload: { id: 42, event: 'message' } } },
      { id: 2, message: { type: 'nasq/task', payload: { id: 7 } } },
      { id: 3, message: { type: 'nasq/chat', payload: { id: 42 } } },
    ])).toEqual([42])
  })
})

describe('applyChatTyping', () => {
  it('keeps the writer name and expires typing after the idle window', () => {
    vi.useFakeTimers()
    applyChatTyping({ conversationId: 8, userId: 3, userName: 'Peer', isTyping: true })
    expect(chatTypingEvent.value).toMatchObject({ userName: 'Peer', isTyping: true })
    vi.advanceTimersByTime(CHAT_TYPING_MS)
    expect(chatTypingEvent.value?.isTyping).toBe(false)
    vi.useRealTimers()
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
