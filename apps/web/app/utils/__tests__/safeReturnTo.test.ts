import { describe, expect, it } from 'vitest'
import { returnToQuery, safeReturnTo } from '../safeReturnTo'

describe('safeReturnTo', () => {
  const fallback = '/hr'
  const allowed = ['/hr'] as const

  it.each([
    ['/hr', '/hr'],
    ['/hr?department=7&q=%D8%A7', '/hr?department=7&q=%D8%A7'],
    ['/hr/employees/42/edit?tab=general#archive', '/hr/employees/42/edit?tab=general#archive'],
  ])('keeps an owner-local path and its query/hash', (value, expected) => {
    expect(safeReturnTo(value, fallback, allowed)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    42,
    '',
    '//evil.example/hr',
    'https://evil.example/hr',
    '/\\evil.example/hr',
    '/hr\n/projects',
    '/projects/1',
    '/hr-malicious',
    '/hr/%2e%2e/projects',
  ])('uses the deterministic fallback for unsafe value %s', (value) => {
    expect(safeReturnTo(value, fallback, allowed)).toBe(fallback)
  })

  it('accepts any one of the declared owner prefixes at a route boundary', () => {
    expect(safeReturnTo('/projects/8?tab=board', '/tasks', ['/tasks', '/projects/8'])).toBe('/projects/8?tab=board')
    expect(safeReturnTo('/projects/80', '/tasks', ['/tasks', '/projects/8'])).toBe('/tasks')
  })

  it('allows task detail to return to an internal digest path and rejects others', () => {
    const allowed = ['/tasks', '/notification-digests'] as const
    expect(safeReturnTo('/notification-digests/12?returnTo=%2Fnotifications', '/tasks', allowed)).toBe('/notification-digests/12?returnTo=%2Fnotifications')
    expect(safeReturnTo('/notifications', '/tasks', allowed)).toBe('/tasks')
    expect(safeReturnTo('https://evil.example/notification-digests/1', '/tasks', allowed)).toBe('/tasks')
  })

  it('builds the shared returnTo query contract', () => {
    expect(returnToQuery('/projects?q=one&status=on_track')).toEqual({ returnTo: '/projects?q=one&status=on_track' })
  })
})
