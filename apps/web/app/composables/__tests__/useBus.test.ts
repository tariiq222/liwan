import { describe, expect, it } from 'vitest'
import { nextBackoffDelay, parseBusFrame } from '../useBus'

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
