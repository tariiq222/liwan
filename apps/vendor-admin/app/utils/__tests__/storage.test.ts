import { describe, expect, it } from 'vitest'
import ar from '../../../i18n/locales/ar/vendor.json'
import en from '../../../i18n/locales/en/vendor.json'
import { limitLabel } from '../vendorCommercial'
import { formatStorageBytes, formatStorageMb } from '../storage'

const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [])

describe('storage amounts', () => {
  it('prints MB below 1024 MB and GB from there, always with the unit', () => {
    expect(formatStorageMb(0)).toBe('0 MB')
    expect(formatStorageMb(512)).toBe('512 MB')
    expect(formatStorageMb(1023)).toBe('1023 MB')
    expect(formatStorageMb(1024)).toBe('1 GB')
    expect(formatStorageMb(5120)).toBe('5 GB')
    expect(formatStorageMb(102400)).toBe('100 GB')
  })
  it('keeps a whole number whole and rounds anything else to one decimal', () => {
    expect(formatStorageMb(1536)).toBe('1.5 GB')
    expect(formatStorageMb(1100)).toBe('1.1 GB')
    expect(formatStorageMb(1030)).toBe('1 GB')
    expect(formatStorageMb(0.29)).toBe('0.3 MB')
  })
  it('chooses the unit after rounding, so 1023.96 MB is 1 GB and not 1024 MB', () => {
    expect(formatStorageMb(1023.96)).toBe('1 GB')
    expect(formatStorageMb(1023.94)).toBe('1023.9 MB')
    expect(formatStorageMb(1048575.9)).toBe('1024 GB')
  })
  it('shows a value that is not a finite number the way a missing value is shown', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(formatStorageMb(value)).toBe('—')
    expect(formatStorageBytes(Number.NaN)).toBe('—')
  })
  it('does not print a positive amount as 0 MB', () => {
    expect(formatStorageMb(0.04)).toBe('<0.1 MB')
    expect(formatStorageMb(0.05)).toBe('0.1 MB')
    expect(formatStorageBytes(1)).toBe('<0.1 MB')
    expect(formatStorageMb(0)).toBe('0 MB')
  })
  it('reads bytes as megabytes of 1024 KB', () => {
    expect(formatStorageBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatStorageBytes(3 * 1024 ** 3)).toBe('3 GB')
  })
  it('shows a storage limit with its unit and any other limit as a plain number', () => {
    const t = (key: string) => key
    expect(limitLabel(2048, t, 'storage.limit_mb')).toBe('2 GB')
    expect(limitLabel(2048, t, 'users.limit')).toBe('2048')
    expect(limitLabel(null, t, 'storage.limit_mb')).toBe('vendor.pricing.limit.unlimited')
  })
  it('names no binary units (MiB, GiB) in either locale', () => {
    for (const text of [...strings(ar), ...strings(en)]) expect(text, text).not.toMatch(/\b(?:MiB|GiB)\b|mebibyte|gibibyte|ميبيبايت|جيبيبايت/i)
  })
})
