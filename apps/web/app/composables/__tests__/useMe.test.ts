import { MeSchema } from '@liwan/contracts'
import { createError } from 'h3'
import { describe, expect, it } from 'vitest'
import { isLoggedOutError, isSchemaError, isTenantSuspendedError, MOBILE_STEP_PATH, mobileStepRedirect, normalizeMobileInput } from '../useMe'

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

describe('isTenantSuspendedError', () => {
  it('recognizes the 403 the API answers after it ended a suspended tenant session', () => {
    expect(isTenantSuspendedError({ statusCode: 403, data: { code: 'tenant_suspended' } })).toBe(true)
    expect(isTenantSuspendedError({ statusCode: 403, data: { data: { code: 'tenant_suspended' } } })).toBe(true)
  })

  it('keeps an ordinary logged-out 403 and other failures apart', () => {
    expect(isTenantSuspendedError({ statusCode: 403 })).toBe(false)
    expect(isTenantSuspendedError({ statusCode: 403, data: { code: 'forbidden' } })).toBe(false)
    expect(isTenantSuspendedError({ statusCode: 500, data: { code: 'tenant_suspended' } })).toBe(false)
    expect(isTenantSuspendedError(null)).toBe(false)
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

describe('mobileStepRedirect', () => {
  const needs = { mobile_required: true }
  const route = (path: string, fullPath = path, access?: string) => ({ path, fullPath, meta: access ? { access } : {} })

  it('sends a user who needs a number to the mobile step and remembers where they were going', () => {
    expect(mobileStepRedirect(needs, route('/projects', '/projects?status=active'))).toEqual({ path: MOBILE_STEP_PATH, query: { next: '/projects?status=active' } })
  })

  it('sends the home page there without a return path', () => {
    expect(mobileStepRedirect(needs, route('/'))).toEqual({ path: MOBILE_STEP_PATH })
  })

  it('leaves the step itself, public pages, a signed-out visitor and a user with a number alone', () => {
    expect(mobileStepRedirect(needs, route(MOBILE_STEP_PATH))).toBeNull()
    expect(mobileStepRedirect(needs, route('/join', '/join?token=x', 'public'))).toBeNull()
    expect(mobileStepRedirect(null, route('/projects'))).toBeNull()
    expect(mobileStepRedirect({ mobile_required: false }, route('/projects'))).toBeNull()
  })
})

describe('normalizeMobileInput', () => {
  it('adds the default country to a local Saudi number', () => {
    expect(normalizeMobileInput('0500000001')).toBe('+966500000001')
    expect(normalizeMobileInput('500000001')).toBe('+966500000001')
    expect(normalizeMobileInput('05 0000-0001')).toBe('+966500000001')
  })

  it('keeps an international number, whichever way it was typed', () => {
    expect(normalizeMobileInput('+966 50 000 0001')).toBe('+966500000001')
    expect(normalizeMobileInput('00966500000001')).toBe('+966500000001')
    expect(normalizeMobileInput('966500000001')).toBe('+966500000001')
    expect(normalizeMobileInput('+201001234567')).toBe('+201001234567')
  })

  it('reads Arabic-Indic and Persian digits as ASCII digits', () => {
    expect(normalizeMobileInput('٠٥٠٠٠٠٠٠٠١')).toBe('+966500000001')
    expect(normalizeMobileInput('۰۵۰۰۰۰۰۰۰۱')).toBe('+966500000001')
    expect(normalizeMobileInput('+٩٦٦ ٥٠ ٠٠٠ ٠٠٠١')).toBe('+966500000001')
    expect(normalizeMobileInput('۹۶۶۵۰۰۰۰۰۰۰۱')).toBe('+966500000001')
  })

  it('drops the trunk 0 typed after the country code', () => {
    expect(normalizeMobileInput('+966 05 0000 0001')).toBe('+966500000001')
    expect(normalizeMobileInput('00966 0500000001')).toBe('+966500000001')
    expect(normalizeMobileInput('966 0500000001')).toBe('+966500000001')
    expect(normalizeMobileInput('+٩٦٦ ٠٥٠٠٠٠٠٠٠١')).toBe('+966500000001')
    expect(normalizeMobileInput('+201001234567')).toBe('+201001234567')
  })

  it('returns anything else cleaned but unchanged, for the contract to refuse', () => {
    expect(normalizeMobileInput('')).toBe('')
    expect(normalizeMobileInput('abc')).toBe('abc')
    expect(normalizeMobileInput('12345')).toBe('12345')
  })
})
