import { describe, expect, it } from 'vitest'
import { scrollEdges } from '../useScrollEdges'

describe('scroll edge affordances', () => {
  it.each([
    [0, 400, 200, { top: false, bottom: true }],
    [100, 400, 200, { top: true, bottom: true }],
    [200, 400, 200, { top: true, bottom: false }],
    [0, 180, 200, { top: false, bottom: false }],
    [199.5, 400, 200, { top: true, bottom: false }],
    [-5, 400, 200, { top: false, bottom: true }],
  ])('shows only the directions containing more content (%s/%s/%s)', (scrollTop, scrollHeight, clientHeight, expected) => {
    expect(scrollEdges({ scrollTop, scrollHeight, clientHeight })).toEqual(expected)
  })
})
