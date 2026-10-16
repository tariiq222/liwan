import { MeSchema } from '@webvue/contracts'
import { createError } from 'h3'
import { describe, expect, it } from 'vitest'
import { isLoggedOutError, isSchemaError } from '../useMe'

// A real ZodError, produced the same way `transform` in useMe.ts produces one:
// parsing a `/api/v1/me` payload that fails schema validation (lang: null).
const zodError = MeSchema.safeParse({
  id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: null,
  tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
}).error!

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
  it('flags the H3Error-wrapped ZodError that useAsyncData actually delivers', () => {
    // This is exactly what happens at runtime: `transform` throws the ZodError,
    // and Nuxt's useAsyncData catches it and rewraps it via h3's createError(error).
    const wrapped = createError(zodError)
    expect(isSchemaError(wrapped)).toBe(true)
  })

  it('flags a bare ZodError', () => {
    expect(isSchemaError(zodError)).toBe(true)
  })

  it('does not flag a transport/server error with no ZodError cause', () => {
    const serverError = Object.assign(new Error('boom'), { statusCode: 500 })
    expect(isSchemaError(serverError)).toBe(false)
  })

  it('does not flag a logged-out (403) error', () => {
    expect(isSchemaError({ statusCode: 403 })).toBe(false)
  })

  it('does not flag null/undefined', () => {
    expect(isSchemaError(null)).toBe(false)
    expect(isSchemaError(undefined)).toBe(false)
  })
})
