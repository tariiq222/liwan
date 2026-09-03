import { describe, expect, it } from 'vitest'
import { isLoggedOutError } from '../useMe'

describe('isLoggedOutError', () => {
  it('treats a 403 as logged-out', () => {
    expect(isLoggedOutError({ statusCode: 403 })).toBe(true)
  })

  it('treats a 500 as a real error, not logged-out', () => {
    expect(isLoggedOutError({ statusCode: 500 })).toBe(false)
  })

  it('treats a 502 as a real error, not logged-out', () => {
    expect(isLoggedOutError({ statusCode: 502 })).toBe(false)
  })

  it('treats null/undefined as a real error, not logged-out', () => {
    expect(isLoggedOutError(null)).toBe(false)
    expect(isLoggedOutError(undefined)).toBe(false)
  })

  it('treats an error object without a statusCode as a real error, not logged-out', () => {
    expect(isLoggedOutError(new Error('boom'))).toBe(false)
  })
})
