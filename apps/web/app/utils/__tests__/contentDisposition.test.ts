import { describe, expect, it } from 'vitest'
import { contentDispositionFilename } from '../contentDisposition'

describe('contentDispositionFilename', () => {
  it('reads the extended, quoted and plain forms', () => {
    expect(contentDispositionFilename("attachment; filename*=UTF-8''salaries-2026-10.csv")).toBe('salaries-2026-10.csv')
    expect(contentDispositionFilename("attachment; filename*=UTF-8''%D8%B1%D9%88%D8%A7%D8%AA%D8%A8.csv")).toBe('رواتب.csv')
    expect(contentDispositionFilename('attachment; filename="wps-2026-10.csv"')).toBe('wps-2026-10.csv')
    expect(contentDispositionFilename('attachment; filename=wps.csv')).toBe('wps.csv')
  })

  it('answers null without a name', () => {
    expect(contentDispositionFilename(null)).toBeNull()
    expect(contentDispositionFilename('attachment')).toBeNull()
  })
})
