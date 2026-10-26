import { describe, expect, it } from 'vitest'
import { ApiError } from '../../useApi'
import { financeSetupKey, financeSetupScopeKey } from '../useFinanceSetup'
import {
  FINANCE_FISCAL_LOCK_FIELDS,
  emptyFinanceFiscalDraft,
  financeExpectedContextHeaders,
  financeFiscalDelta,
  financeFiscalDirty,
  financeFiscalDraftFromValues,
  financeFiscalErrorKey,
  financeFiscalFieldError,
  financeFiscalIssues,
  financeFiscalSaveMessage,
  financeSetupScopeToken,
  isFinanceCalendarDate,
  isFinanceContextChanged,
  isFinanceRequestContextInvalid,
  sameFinanceSetupScope,
  type FinanceFiscalDraft,
  type FinanceSetupScope,
} from '../financeFiscalSetup'

const VALUES = {
  fiscalyear_last_day: 31,
  fiscalyear_last_month: 12,
  fiscalyear_lock_date: '2026-06-30' as string | null,
  tax_lock_date: null as string | null,
  sale_lock_date: null as string | null,
  purchase_lock_date: null as string | null,
  hard_lock_date: '2026-01-01' as string | null,
}

const baseline = () => financeFiscalDraftFromValues(VALUES)
const draftWith = (changes: Partial<FinanceFiscalDraft>) => ({ ...baseline(), ...changes })
const codes = (draft: FinanceFiscalDraft) => financeFiscalIssues(draft, baseline()).map(issue => `${issue.field}:${issue.code}`)

const t = (key: string) => `t:${key}`
const scope = (overrides: Partial<FinanceSetupScope> = {}): FinanceSetupScope => ({ userId: 7, companyId: 3, epoch: 4, ...overrides })

describe('the fiscal draft and its delta', () => {
  it('starts from the saved values, without the hard lock, and is not dirty', () => {
    expect(baseline()).toEqual({
      fiscalyear_last_day: '31', fiscalyear_last_month: '12',
      fiscalyear_lock_date: '2026-06-30', tax_lock_date: null, sale_lock_date: null, purchase_lock_date: null,
    })
    expect(financeFiscalDirty(baseline(), baseline())).toBe(false)
    expect(financeFiscalDelta(baseline(), baseline())).toBeNull()
  })

  it('never fabricates a year end before the setup was read', () => {
    expect(emptyFinanceFiscalDraft()).toEqual({
      fiscalyear_last_day: '', fiscalyear_last_month: '',
      fiscalyear_lock_date: null, tax_lock_date: null, sale_lock_date: null, purchase_lock_date: null,
    })
  })

  it('sends the changed fields only', () => {
    expect(financeFiscalDelta(draftWith({ fiscalyear_last_day: '30', fiscalyear_last_month: '6' }), baseline()))
      .toEqual({ fiscalyear_last_day: 30, fiscalyear_last_month: 6 })
    expect(financeFiscalDelta(draftWith({ tax_lock_date: '2026-07-31' }), baseline())).toEqual({ tax_lock_date: '2026-07-31' })
    expect(financeFiscalDelta(draftWith({ fiscalyear_lock_date: '2026-07-31' }), baseline()))
      .toEqual({ fiscalyear_lock_date: '2026-07-31' })
    expect(financeFiscalDelta(draftWith({ fiscalyear_last_day: '30', tax_lock_date: '2026-07-31' }), baseline()))
      .toEqual({ fiscalyear_last_day: 30, tax_lock_date: '2026-07-31' })
  })

  it('treats a retyped value that did not change as no change', () => {
    expect(financeFiscalDirty(draftWith({ fiscalyear_last_day: '031' }), baseline())).toBe(true)
    expect(financeFiscalDirty(draftWith({ fiscalyear_last_day: '31' }), baseline())).toBe(false)
  })
})

describe('the rules a draft must satisfy before anything is sent', () => {
  it.each([
    ['', 'fiscalyear_last_day:invalidDay'],
    ['0', 'fiscalyear_last_day:invalidDay'],
    ['32', 'fiscalyear_last_day:invalidDay'],
    ['01', 'fiscalyear_last_day:invalidDay'],
    ['+1', 'fiscalyear_last_day:invalidDay'],
    ['3a', 'fiscalyear_last_day:invalidDay'],
    ['1.0', 'fiscalyear_last_day:invalidDay'],
    [' ', 'fiscalyear_last_day:invalidDay'],
  ])('refuses the day %o', (day, expected) => {
    expect(codes(draftWith({ fiscalyear_last_day: day }))).toContain(expected)
    expect(financeFiscalDelta(draftWith({ fiscalyear_last_day: day }), baseline())).toBeNull()
  })

  it.each([['', 'invalidMonth'], ['0', 'invalidMonth'], ['13', 'invalidMonth'], ['012', 'invalidMonth']])(
    'refuses the month %o',
    (month, code) => {
      expect(codes(draftWith({ fiscalyear_last_month: month }))).toContain(`fiscalyear_last_month:${code}`)
    },
  )

  it('refuses a year end that the calendar does not have instead of clamping it', () => {
    expect(codes(draftWith({ fiscalyear_last_day: '31', fiscalyear_last_month: '2' }))).toContain('fiscalyear_last_day:invalidYearEnd')
    expect(codes(draftWith({ fiscalyear_last_day: '30', fiscalyear_last_month: '2' }))).toContain('fiscalyear_last_day:invalidYearEnd')
    expect(codes(draftWith({ fiscalyear_last_day: '29', fiscalyear_last_month: '2' }))).toEqual([])
    expect(codes(draftWith({ fiscalyear_last_day: '31', fiscalyear_last_month: '4' }))).toContain('fiscalyear_last_day:invalidYearEnd')
    expect(financeFiscalDelta(draftWith({ fiscalyear_last_day: '31', fiscalyear_last_month: '2' }), baseline())).toBeNull()
  })

  it('keeps the hard lock out of everything the editor can build', () => {
    expect(FINANCE_FISCAL_LOCK_FIELDS).not.toContain('hard_lock_date')
    expect(Object.keys(financeFiscalDelta(draftWith({ fiscalyear_lock_date: '2026-07-31' }), baseline())!))
      .toEqual(['fiscalyear_lock_date'])
  })

  it('refuses clearing a saved lock and moving one earlier', () => {
    expect(codes(draftWith({ fiscalyear_lock_date: null }))).toContain('fiscalyear_lock_date:lockCannotClear')
    expect(codes(draftWith({ fiscalyear_lock_date: '2026-06-29' }))).toContain('fiscalyear_lock_date:lockCannotMoveEarlier')
    expect(codes(draftWith({ fiscalyear_lock_date: '2026-06-30' }))).toEqual([])
    expect(codes(draftWith({ fiscalyear_lock_date: '2026-07-01' }))).toEqual([])
  })

  it('accepts setting a lock that was empty', () => {
    expect(codes(draftWith({ sale_lock_date: '2026-03-01' }))).toEqual([])
    expect(financeFiscalDelta(draftWith({ sale_lock_date: '2026-03-01' }), baseline())).toEqual({ sale_lock_date: '2026-03-01' })
  })

  it('refuses a lock date the calendar does not have', () => {
    expect(codes(draftWith({ tax_lock_date: '2026-02-31' }))).toContain('tax_lock_date:invalidLockDate')
    expect(codes(draftWith({ tax_lock_date: '2026-2-1' }))).toContain('tax_lock_date:invalidLockDate')
    expect(financeFiscalDelta(draftWith({ tax_lock_date: '2026-02-31' }), baseline())).toBeNull()
  })

  it('reads a real calendar date and a leap day', () => {
    expect(isFinanceCalendarDate('2024-02-29')).toBe(true)
    expect(isFinanceCalendarDate('2023-02-29')).toBe(false)
    expect(isFinanceCalendarDate('2026-02-31')).toBe(false)
    expect(isFinanceCalendarDate('2026-04-31')).toBe(false)
    expect(isFinanceCalendarDate('2026-12-31')).toBe(true)
    expect(isFinanceCalendarDate('2026-1-1')).toBe(false)
  })
})

describe('the messages a refusal becomes', () => {
  it('translates the refusal codes the card knows', () => {
    expect(financeFiscalErrorKey('fiscal_year_has_posted_entries')).toBe('finance.setup.fiscal.errors.fiscal_year_has_posted_entries')
    expect(financeFiscalErrorKey('lock_date_loosening')).toBe('finance.setup.fiscal.errors.lock_date_loosening')
    expect(financeFiscalErrorKey('request_context_changed')).toBe('finance.setup.fiscal.errors.request_context_changed')
    expect(financeFiscalErrorKey('chart_already_loaded')).toBeNull()
    expect(financeFiscalSaveMessage(new ApiError(422, 'fiscal_year_has_posted_entries', 'server text'), t))
      .toBe('t:finance.setup.fiscal.errors.fiscal_year_has_posted_entries')
  })

  it('keeps the server text for a code it does not know and never claims success', () => {
    expect(financeFiscalSaveMessage(new ApiError(422, 'chart_already_loaded', 'server text'), t)).toBe('server text')
    expect(financeFiscalSaveMessage({ status: 0, message: 'socket hang up' }, t)).toBe('t:errors.saveUncertain')
    expect(financeFiscalSaveMessage(new Error('boom'), t)).toBe('t:errors.generic')
  })

  it('shows a server refusal under the field it named', () => {
    const refusal = new ApiError(422, 'lock_date_loosening', 'server text', 'sale_lock_date')
    expect(financeFiscalFieldError(refusal, 'sale_lock_date', t)).toBe('t:finance.setup.fiscal.errors.lock_date_loosening')
    expect(financeFiscalFieldError(refusal, 'tax_lock_date', t)).toBeUndefined()
    expect(financeFiscalFieldError(new Error('boom'), 'sale_lock_date', t)).toBeUndefined()
  })

  it('separates a changed context from a malformed one', () => {
    expect(isFinanceContextChanged(new ApiError(409, 'request_context_changed', 'x'))).toBe(true)
    expect(isFinanceContextChanged(new ApiError(422, 'invalid_request_context', 'x'))).toBe(false)
    expect(isFinanceRequestContextInvalid(new ApiError(422, 'invalid_request_context', 'x'))).toBe(true)
    expect(isFinanceContextChanged(new Error('boom'))).toBe(false)
  })
})

describe('the identity a setup screen answers for', () => {
  it('is the user, the company and the observed epoch together', () => {
    expect(financeSetupScopeToken(scope())).toBe('7:3:4')
    expect(sameFinanceSetupScope(scope(), scope())).toBe(true)
    expect(sameFinanceSetupScope(scope(), scope({ epoch: 5 }))).toBe(false)
    expect(sameFinanceSetupScope(scope(), scope({ companyId: 9 }))).toBe(false)
    expect(sameFinanceSetupScope(scope(), scope({ userId: 8 }))).toBe(false)
    expect(sameFinanceSetupScope(scope(), null)).toBe(false)
    expect(sameFinanceSetupScope(null, null)).toBe(false)
  })

  it('states the expected context as canonical decimals, never as a target', () => {
    expect(financeExpectedContextHeaders(scope())).toEqual({
      'X-WebVue-Expected-User-Id': '7',
      'X-WebVue-Expected-Company-Id': '3',
    })
    expect(financeExpectedContextHeaders({ userId: 9007199254740991, companyId: 1, epoch: 0 }))
      .toEqual({ 'X-WebVue-Expected-User-Id': '9007199254740991', 'X-WebVue-Expected-Company-Id': '1' })
  })

  it('keeps the setup cache under the shared prefix with one leaf per identity', () => {
    expect(financeSetupScopeKey(scope()).slice(0, 2)).toEqual(financeSetupKey)
    expect(financeSetupScopeKey(scope())).toEqual([...financeSetupKey, 'scope', '7:3:4'])
    expect(financeSetupScopeKey(scope({ epoch: 5 }))).not.toEqual(financeSetupScopeKey(scope()))
    expect(financeSetupScopeKey(null)).toEqual([...financeSetupKey, 'scope', 'none'])
  })
})
