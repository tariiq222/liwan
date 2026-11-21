import { describe, expect, it } from 'vitest'
import { formatFileSize } from '../fileSize'

// A translation stub with the Arabic strings, so the test reads the way the screen does.
const ar = (key: string, params: Record<string, unknown> = {}) => ({
  'app.fileSize.bytes': `${params.size} بايت`,
  'app.fileSize.kilobytes': `${params.size} كيلوبايت`,
  'app.fileSize.megabytes': `${params.size} ميجابايت`,
  'app.notAvailable': '—',
})[key] ?? key

describe('formatFileSize', () => {
  it('never prints a zero size for a real file', () => {
    // The old formatter rounded a 20 KB attachment to «0.0 MB», which reads as an empty file.
    for (const bytes of [1, 512, 2048, 20 * 1024, 49 * 1024]) {
      expect(formatFileSize(bytes, ar), String(bytes)).not.toContain('0 ميجابايت')
      expect(formatFileSize(bytes, ar), String(bytes)).not.toMatch(/\b0\b/)
    }
  })

  it('uses the locale unit rather than a hardcoded English one', () => {
    expect(formatFileSize(3 * 1024 * 1024, ar)).toBe('3 ميجابايت')
    expect(formatFileSize(1536 * 1024, ar)).toBe('1.5 ميجابايت')
    expect(formatFileSize(2048, ar)).toBe('2 كيلوبايت')
    expect(formatFileSize(900, ar)).toBe('900 بايت')
  })

  it('drops the fraction above ten megabytes', () => {
    expect(formatFileSize(24 * 1024 * 1024, ar)).toBe('24 ميجابايت')
    expect(formatFileSize(11.4 * 1024 * 1024, ar)).toBe('11 ميجابايت')
  })

  it('answers a dash for a value that is not a size', () => {
    expect(formatFileSize(Number.NaN, ar)).toBe('—')
    expect(formatFileSize(-1, ar)).toBe('—')
  })

  it('keeps one decimal under ten megabytes so a row does not jump', () => {
    expect(formatFileSize(Math.round(1.5 * 1024 * 1024), ar)).toBe('1.5 ميجابايت')
    expect(formatFileSize(1024 * 1024, ar)).toBe('1 ميجابايت')
  })
})
