import { describe, expect, it } from 'vitest'
import { isBoardCapped } from '../boardCap'

describe('isBoardCapped', () => {
  it('warns when the cache contains hidden tasks after all pages loaded', () => {
    expect(isBoardCapped(201, 200, false)).toBe(true)
  })

  it('warns when another page still exists at the cap', () => {
    expect(isBoardCapped(200, 200, true)).toBe(true)
  })

  it('does not warn when exactly the cap is the complete result', () => {
    expect(isBoardCapped(200, 200, false)).toBe(false)
  })
})
