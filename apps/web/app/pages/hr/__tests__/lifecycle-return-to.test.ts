import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

const PAGES = [
  'pages/hr/onboarding/[runId].vue',
  'pages/hr/onboarding/plans/[planId].vue',
  'pages/hr/offboarding/[employeeId].vue',
  'pages/hr/offboarding/plans/[planId].vue',
]
const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')

describe('the lifecycle record pages back link', () => {
  it.each(PAGES)('%s reads returnTo only through safeReturnTo', (page) => {
    const source = read(page)
    expect(source).toMatch(/safeReturnTo\(route\.query\.returnTo, '\/hr\/[^']+', \['\/hr'\]\)/)
    expect(source).not.toContain("returnTo.startsWith('/')")
  })

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example/hr', '/%2F/evil.example', '%2F%2Fevil.example', '/hr/%2e%2e/projects'])(
    'falls back to the default path for %s', (value) => {
      expect(safeReturnTo(value, '/hr/onboarding', ['/hr'])).toBe('/hr/onboarding')
    })

  it('keeps an HR path with its query', () => {
    expect(safeReturnTo('/hr/onboarding?state=open', '/hr/onboarding', ['/hr'])).toBe('/hr/onboarding?state=open')
  })
})
