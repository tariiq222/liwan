import { describe, expect, it } from 'vitest'
import { isolateLtr, varianceLabel, varianceTone } from '../variance'

describe('baseline variance presentation', () => {
  it('signs late and early days and leaves a missing date empty', () => {
    expect(varianceLabel(3)).toBe(isolateLtr('+3'))
    expect(varianceLabel(-2)).toBe(isolateLtr('−2'))
    expect(varianceLabel(0)).toBe(isolateLtr('0'))
    expect(varianceLabel(null)).toBeNull()
  })

  it('marks late as a problem, early as good, and the rest as neutral', () => {
    expect(varianceTone(1)).toBe('destructive')
    expect(varianceTone(-1)).toBe('success')
    expect(varianceTone(0)).toBe('neutral')
    expect(varianceTone(null)).toBe('neutral')
  })
})
