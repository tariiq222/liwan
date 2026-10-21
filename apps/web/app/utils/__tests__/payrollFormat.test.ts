import { describe, expect, it } from 'vitest'
import { currentPayrollDate, currentPayrollMonth, formatPayrollAmount, formatPayrollMonth, formatPayrollPercent, payrollRunStateTone } from '../payrollFormat'

describe('payroll formatting', () => {
  it('prints amounts with two decimals and Latin digits in both locales', () => {
    expect(formatPayrollAmount(18200, 'en')).toContain('18,200.00')
    expect(formatPayrollAmount(1234.5, 'ar')).toMatch(/1.?234\.50/)
    expect(formatPayrollAmount(1234.5, 'ar')).not.toMatch(/[٠-٩]/)
  })

  it('keeps the percent sign inside the isolated number', () => {
    expect(formatPayrollPercent(9.5, 'ar')).toBe('\u20669.50%\u2069')
  })

  it('names the month and keeps a malformed one as given', () => {
    expect(formatPayrollMonth('2026-10', 'en')).toBe('October 2026')
    expect(formatPayrollMonth('2026-10', 'ar')).toMatch(/2026/)
    expect(formatPayrollMonth('2026-13', 'en')).toBe('2026-13')
  })

  it('reads the current month from the local calendar', () => {
    expect(currentPayrollMonth(new Date(2026, 0, 31))).toBe('2026-01')
    expect(currentPayrollDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('gives every run state its own badge tone', () => {
    const tones = (['draft', 'computed', 'approved', 'posted', 'paid'] as const).map(payrollRunStateTone)
    expect(new Set(tones).size).toBe(5)
  })
})
