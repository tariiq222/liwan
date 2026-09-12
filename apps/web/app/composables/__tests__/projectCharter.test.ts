import { describe, expect, it } from 'vitest'
import { ApiError } from '../useApi'
import { isStaleProjectWrite } from '../useProjects'
import { projectKeys } from '../projectKeys'

describe('isStaleProjectWrite', () => {
  it('matches only the standard 409 stale_write envelope', () => {
    expect(isStaleProjectWrite(new ApiError(409, 'stale_write', 'changed', 'expected_updated_at'))).toBe(true)
    expect(isStaleProjectWrite(new ApiError(409, 'conflict', 'in use'))).toBe(false)
    expect(isStaleProjectWrite(new ApiError(422, 'invalid', 'bad'))).toBe(false)
    expect(isStaleProjectWrite(new Error('stale_write'))).toBe(false)
  })
})

describe('projectKeys', () => {
  it('keeps project detail cache identity so a charter save can replace the server snapshot', () => {
    expect(projectKeys.detail(12)).toEqual(['projects', 'detail', 12])
  })
})
