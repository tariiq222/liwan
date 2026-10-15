import { describe, expect, it } from 'vitest'
import { canCopyProject } from '../projectCopyAccess'

describe('canCopyProject', () => {
  it('needs the project, the server create signal and task read access', () => {
    expect(canCopyProject(true, true, true)).toBe(true)
    expect(canCopyProject(false, true, true)).toBe(false)
    expect(canCopyProject(true, false, true)).toBe(false)
    expect(canCopyProject(true, undefined, true)).toBe(false)
    expect(canCopyProject(true, true, false)).toBe(false)
  })
})
