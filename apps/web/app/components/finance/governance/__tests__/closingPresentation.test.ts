import { describe, expect, it } from 'vitest'
import type { FinanceFiscalYear } from '@webvue/contracts'
import { ApiError } from '../../../../composables/useApi'
import { blockerText, closingErrorMessage, selectedOpenYear } from '../closingPresentation'

const t = (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key
const year = (value: number, state: FinanceFiscalYear['state']): FinanceFiscalYear => ({
  year: value, date_from: `${value}-01-01`, date_to: `${value}-12-31`, state, result: 0, closing_entry: null,
})

describe('selected closing year', () => {
  const years = [year(2024, 'closed'), year(2025, 'open'), year(2026, 'locked')]

  it('is the year of ?year= only when that year is open', () => {
    expect(selectedOpenYear('2025', years)).toBe(2025)
    expect(selectedOpenYear('2024', years)).toBeNull()
    expect(selectedOpenYear('2026', years)).toBeNull()
    expect(selectedOpenYear('1999', years)).toBeNull()
    expect(selectedOpenYear(undefined, years)).toBeNull()
    expect(selectedOpenYear('abc', years)).toBeNull()
  })
})

describe('closing blockers and errors', () => {
  it('words a blocker by its code, with the draft count the server reports', () => {
    const blocker = { code: 'has_drafts', message: 'post or delete', details: { drafts: 3 } } as const
    expect(blockerText(blocker, t)).toBe('financeGovernance.closing.blockers.has_drafts:{"drafts":3}')
    expect(blockerText({ code: 'year_not_ended', message: 'x', details: {} }, t)).toContain('blockers.year_not_ended')
  })

  it('explains a known code in the user language and falls back to the server text', () => {
    expect(closingErrorMessage(new ApiError(422, 'already_closed', 'raw'), t)).toBe('financeGovernance.closing.errors.already_closed')
    expect(closingErrorMessage(new ApiError(422, 'no_general_journal', 'raw'), t)).toContain('blockers.no_general_journal')
    expect(closingErrorMessage(new ApiError(422, 'something_new', 'server text'), t)).toBe('server text')
    expect(closingErrorMessage(new Error('boom'), t)).toBe('errors.generic')
  })
})
