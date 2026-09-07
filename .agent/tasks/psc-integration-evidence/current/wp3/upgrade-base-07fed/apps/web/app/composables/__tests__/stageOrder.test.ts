import { describe, expect, it } from 'vitest'
import { moveId, stageMoveIndex } from '../stageOrder'

describe('moveId', () => {
  it('moves an element and leaves the input untouched', () => {
    const ids = [1, 2, 3, 4]
    expect(moveId(ids, 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveId(ids, 3, 0)).toEqual([4, 1, 2, 3])
    expect(ids).toEqual([1, 2, 3, 4])
  })
})

describe('stageMoveIndex', () => {
  it('supports arrow and boundary moves', () => {
    expect(stageMoveIndex(4, 2, 'up')).toBe(1)
    expect(stageMoveIndex(4, 1, 'down')).toBe(2)
    expect(stageMoveIndex(4, 3, 'first')).toBe(0)
    expect(stageMoveIndex(4, 0, 'last')).toBe(3)
  })

  it('stays within the list at either boundary', () => {
    expect(stageMoveIndex(4, 0, 'up')).toBe(0)
    expect(stageMoveIndex(4, 3, 'down')).toBe(3)
  })
})
