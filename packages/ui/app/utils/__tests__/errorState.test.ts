import { describe, expect, it } from 'vitest'
import { errorStateKind } from '../errorState'

describe('errorStateKind', () => {
  it.each([
    [{ status: 403 }, 'forbidden'],
    [{ statusCode: 403 }, 'forbidden'],
    [{ status: 404 }, 'notFound'],
    [{ statusCode: 404 }, 'notFound'],
    [{ status: 409 }, 'conflict'],
    [{ status: 500 }, 'generic'],
    [{ status: 422, code: 'invalid' }, 'generic'],
    [new Error('Failed to fetch'), 'generic'],
    ['boom', 'generic'],
    [{}, 'generic'],
  ] as const)('%o is %s', (error, kind) => {
    expect(errorStateKind(error)).toBe(kind)
  })

  it('prefers status over statusCode, as PageState always did', () => {
    expect(errorStateKind({ status: 409, statusCode: 404 })).toBe('conflict')
  })
})
