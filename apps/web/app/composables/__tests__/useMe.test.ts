import { describe, expect, it } from 'vitest'
import { isLoggedOutError, isSchemaError } from '../useMe'

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

describe('isSchemaError', () => {
  it('flags a ZodError thrown out of transform', () => {
    const zodError = Object.assign(new Error('invalid_type at lang'), { name: 'ZodError' })
    expect(isSchemaError(zodError)).toBe(true)
  })

  it('flags an error whose message names ZodError', () => {
    expect(isSchemaError(new Error('ZodError: expected string, received null'))).toBe(true)
  })

  it('does not flag a transport error carrying a statusCode', () => {
    expect(isSchemaError({ statusCode: 502, message: 'invalid response' })).toBe(false)
    expect(isSchemaError({ statusCode: 403 })).toBe(false)
  })

  it('does not flag a plain connection failure', () => {
    expect(isSchemaError(new Error('fetch failed'))).toBe(false)
    expect(isSchemaError(null)).toBe(false)
  })
})
