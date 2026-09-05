import { describe, expect, it } from 'vitest'
import { moveId } from '../stageOrder'

describe('moveId', () => {
  it('moves an element and leaves the input untouched', () => {
    const ids = [1, 2, 3, 4]
    expect(moveId(ids, 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveId(ids, 3, 0)).toEqual([4, 1, 2, 3])
    expect(ids).toEqual([1, 2, 3, 4])
  })
})
