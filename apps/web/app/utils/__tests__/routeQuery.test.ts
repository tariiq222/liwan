import { describe, it, expect } from 'vitest'
import { firstQuery, lastPageOffset, parseOffset } from '../routeQuery'

describe('firstQuery', () => {
  it('returns a plain string value as-is', () => {
    expect(firstQuery('عقد')).toBe('عقد')
  })
  it('unwraps the first element of an array', () => {
    expect(firstQuery(['a', 'b'])).toBe('a')
  })
  it('returns undefined for undefined, numbers and non-string array elements', () => {
    expect(firstQuery(undefined)).toBeUndefined()
    expect(firstQuery(3)).toBeUndefined()
    expect(firstQuery([3, 'b'])).toBeUndefined()
    expect(firstQuery([])).toBeUndefined()
  })
})

describe('parseOffset', () => {
  it('accepts a non-negative integer string or number', () => {
    expect(parseOffset('25')).toBe(25)
    expect(parseOffset(25)).toBe(25)
    expect(parseOffset('0')).toBe(0)
  })
  it('unwraps the first element of an array', () => {
    expect(parseOffset(['50', '75'])).toBe(50)
  })
  it('falls back to 0 for anything invalid', () => {
    expect(parseOffset(undefined)).toBe(0)
    expect(parseOffset('-5')).toBe(0)
    expect(parseOffset('1.5')).toBe(0)
    expect(parseOffset('abc')).toBe(0)
    expect(parseOffset(null)).toBe(0)
    expect(parseOffset(true)).toBe(0)
  })
})

describe('lastPageOffset', () => {
  it('lands a past-the-end offset on the last page that has rows', () => {
    // The appointments list pages by 25 and «أعمالي» by 50; the helper takes the page size, so it serves both.
    expect(lastPageOffset(0, 25)).toBe(0)
    expect(lastPageOffset(25, 25)).toBe(0)
    expect(lastPageOffset(26, 25)).toBe(25)
    expect(lastPageOffset(50, 25)).toBe(25)
    expect(lastPageOffset(51, 25)).toBe(50)
    expect(lastPageOffset(0, 50)).toBe(0)
    expect(lastPageOffset(50, 50)).toBe(0)
    expect(lastPageOffset(51, 50)).toBe(50)
    expect(lastPageOffset(100, 50)).toBe(50)
    expect(lastPageOffset(101, 50)).toBe(100)
  })
})
