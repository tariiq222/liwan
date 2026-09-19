import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import {
  FINANCE_PAGE,
  MAX_FINANCE_AMOUNT,
  budgetStatus,
  canonicalFromMinor,
  clampListOffset,
  financeCreateBody,
  draftFromEntry,
  emptyFinanceDraft,
  financeListQuery,
  financePatchHasMutation,
  financeSubmitToken,
  financeWriteAllowed,
  formatNullableAmount,
  formatNullablePercent,
  formatUtilization,
  financeSummaryMode,
  isFinanceDraftDirty,
  isFinanceIsoDate,
  isReferencedBudgetConflict,
  isStaleFinanceWrite,
  nextOffsetAfterListResult,
  parseFinanceListRoute,
  parseMoneyInput,
  financePatchBody,
  patchFinanceListRoute,
  sameFinanceListRoute,
  serializeFinanceListRoute,
  shouldKeepFinanceFormMounted,
  validateFinanceDraft,
  type FinanceDraft,
  type FinanceEntryLike,
} from '../projectFinance'
import { parsePositiveId } from '../routeParams'

const SAR = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }

function draft(overrides: Partial<FinanceDraft> = {}): FinanceDraft {
  return {
    ...emptyFinanceDraft('budget'),
    title: 'Office fit-out',
    amountInput: '1000.00',
    ...overrides,
  }
}

function entry(overrides: Partial<FinanceEntryLike> = {}): FinanceEntryLike {
  return {
    id: 9,
    project_id: 4,
    kind: 'expense',
    title: 'Paint',
    amount: 250.5,
    expense_date: '2030-03-02',
    reference: 'PO-1',
    notes: 'First coat',
    budget_entry_id: 3,
    updated_at: 'v2',
    ...overrides,
  }
}

describe('parsePositiveId', () => {
  it('accepts a positive integer and refuses values that must not trigger a request', () => {
    expect(parsePositiveId('18')).toBe(18)
    expect(parsePositiveId(18)).toBe(18)
    expect(parsePositiveId(['18'])).toBe(18)
    expect(parsePositiveId('0')).toBeNull()
    expect(parsePositiveId('-3')).toBeNull()
    expect(parsePositiveId('3.2')).toBeNull()
    expect(parsePositiveId('08')).toBeNull()
    expect(parsePositiveId('1e2')).toBeNull()
    expect(parsePositiveId('abc')).toBeNull()
    expect(parsePositiveId('')).toBeNull()
    expect(parsePositiveId(undefined)).toBeNull()
    expect(parsePositiveId(Number.NaN)).toBeNull()
  })
})

describe('finance list route helpers', () => {
  it('reads kind/q/offset from the URL and treats an unknown kind as the unfiltered view', () => {
    expect(parseFinanceListRoute({ kind: 'expense', q: 'paint', offset: '50' })).toEqual({
      kind: 'expense',
      q: 'paint',
      offset: 50,
    })
    expect(parseFinanceListRoute({ kind: 'all', q: ['x'], offset: '-4' })).toEqual({
      kind: 'all',
      q: '',
      offset: 0,
    })
    expect(parseFinanceListRoute({})).toEqual({ kind: 'all', q: '', offset: 0 })
  })

  it('omits default kind/q/offset from the serialized query so refresh URLs stay clean', () => {
    expect(serializeFinanceListRoute({ kind: 'all', q: '  ', offset: 0 })).toEqual({
      kind: undefined,
      q: undefined,
      offset: undefined,
    })
    expect(serializeFinanceListRoute({ kind: 'budget', q: '  desks  ', offset: 50 })).toEqual({
      kind: 'budget',
      q: 'desks',
      offset: 50,
    })
  })

  it('resets offset when search or kind changes, and keeps offset when only the page changes', () => {
    const paged = parseFinanceListRoute({ kind: 'expense', q: 'paint', offset: '50' })
    expect(serializeFinanceListRoute(patchFinanceListRoute(paged, { q: 'wood' }))).toEqual({
      kind: 'expense',
      q: 'wood',
      offset: undefined,
    })
    expect(serializeFinanceListRoute(patchFinanceListRoute(paged, { kind: 'budget' }))).toEqual({
      kind: 'budget',
      q: 'paint',
      offset: undefined,
    })
    expect(serializeFinanceListRoute(patchFinanceListRoute(paged, { offset: 100 }))).toEqual({
      kind: 'expense',
      q: 'paint',
      offset: 100,
    })
  })

  it('keeps list query keys distinct per kind, search and page', () => {
    const page0 = financeListQuery({ kind: 'budget', q: 'a', limit: FINANCE_PAGE, offset: 0 })
    const page1 = financeListQuery({ kind: 'budget', q: 'a', limit: FINANCE_PAGE, offset: 50 })
    const otherKind = financeListQuery({ kind: 'expense', q: 'a', limit: FINANCE_PAGE, offset: 0 })
    expect(page0).not.toEqual(page1)
    expect(page0).not.toEqual(otherKind)
    expect(page0).toEqual({ kind: 'budget', q: 'a', limit: 50, offset: 0 })
    expect(financeListQuery({ kind: 'all', q: '  ', limit: 500, offset: -1 })).toEqual({
      kind: undefined,
      q: undefined,
      limit: 200,
      offset: 0,
    })
  })

  it('treats equivalent serialized queries as the same route', () => {
    const left = serializeFinanceListRoute(parseFinanceListRoute({ q: 'a', offset: '0' }))
    const right = serializeFinanceListRoute({ kind: 'all', q: 'a', offset: 0 })
    expect(sameFinanceListRoute(left, right)).toBe(true)
  })
})

describe('parseMoneyInput', () => {
  it('accepts Arabic-Indic digits and Arabic decimal/thousands marks without using float-string parsing', () => {
    expect(parseMoneyInput('١٢٫٥٠', 2)).toEqual({ ok: true, value: 12.5, minor: 1250n, canonical: '12.50' })
    expect(parseMoneyInput('١٬٠٠٠٫٥٠', 2)).toEqual({ ok: true, value: 1000.5, minor: 100050n, canonical: '1000.50' })
    expect(parseMoneyInput('١٢.٥', 2)).toEqual({ ok: true, value: 12.5, minor: 1250n, canonical: '12.50' })
  })

  it('accepts a comma decimal only when it cannot be thousands grouping', () => {
    expect(parseMoneyInput('12,50', 2)).toMatchObject({ ok: true, canonical: '12.50', minor: 1250n })
    expect(parseMoneyInput('1,000.50', 2)).toMatchObject({ ok: true, canonical: '1000.50', minor: 100050n })
    expect(parseMoneyInput('1,234', 2)).toMatchObject({ ok: true, canonical: '1234.00', minor: 123400n })
    expect(parseMoneyInput('1 234.56', 2)).toMatchObject({ ok: true, canonical: '1234.56' })
    expect(parseMoneyInput('1,234,56', 2)).toMatchObject({ ok: true, canonical: '1234.56' })
  })

  it('rejects malformed grouping instead of silently widening the amount', () => {
    expect(parseMoneyInput('1,2345', 2).ok).toBe(false)
    expect(parseMoneyInput('1,2345', 2)).not.toEqual(expect.objectContaining({ value: 12345 }))
    expect(parseMoneyInput('1,2,3', 2).ok).toBe(false)
    expect(parseMoneyInput('1,2,3', 2)).not.toEqual(expect.objectContaining({ value: 123 }))
    expect(parseMoneyInput('12 34', 2).ok).toBe(false)
    expect(parseMoneyInput('12 34', 2)).not.toEqual(expect.objectContaining({ value: 1234 }))
  })

  it('rejects mixed incompatible decimal conventions and ambiguous comma grouping', () => {
    expect(parseMoneyInput('1.234,56', 2).ok).toBe(false)
    expect(parseMoneyInput('1٫50.0', 2).ok).toBe(false)
    expect(parseMoneyInput('1,234', 3).ok).toBe(false)
    expect(parseMoneyInput('1,234,567', 3).ok).toBe(false)
    expect(parseMoneyInput('١٬٢٣٤٥', 2).ok).toBe(false)
  })

  it('keeps minor-unit arithmetic exact where binary floats are not', () => {
    const ten = parseMoneyInput('0.10', 2)
    const twenty = parseMoneyInput('0.20', 2)
    expect(ten.ok && twenty.ok).toBe(true)
    if (!ten.ok || !twenty.ok) return
    expect(canonicalFromMinor(ten.minor + twenty.minor, 2)).toBe('0.30')
    expect(ten.canonical).toBe('0.10')
    expect(String(0.1 + 0.2)).not.toBe('0.3')
  })

  it('rejects empty, negative, non-finite, scientific, boolean, excess precision and overflow values', () => {
    expect(parseMoneyInput('   ', 2)).toEqual({ ok: false, code: 'empty' })
    expect(parseMoneyInput('-1', 2)).toEqual({ ok: false, code: 'negative' })
    expect(parseMoneyInput('Infinity', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('1e2', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('1E+2', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('NaN', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('true', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('12.345', 2)).toEqual({ ok: false, code: 'precision' })
    expect(parseMoneyInput('12.50', 0)).toEqual({ ok: false, code: 'precision' })
    expect(parseMoneyInput('1000000000000.01', 2)).toEqual({ ok: false, code: 'too_large' })
    expect(parseMoneyInput(String(MAX_FINANCE_AMOUNT), 2)).toMatchObject({ ok: true, canonical: '1000000000000.00' })
  })

  it('pads short fractions to the currency decimal places instead of leaving a float-string', () => {
    expect(parseMoneyInput('12', 2)).toMatchObject({ ok: true, canonical: '12.00', minor: 1200n })
    expect(parseMoneyInput('12.5', 3)).toMatchObject({ ok: true, canonical: '12.500', minor: 12500n })
  })
})

describe('budgetStatus', () => {
  it('treats a null planned amount as unknown, and a zero plan with actual spend as over budget', () => {
    expect(budgetStatus({ planned: null, actual: 0, over_budget: false })).toBe('unknown')
    expect(budgetStatus({ planned: null, actual: 25, over_budget: false })).toBe('unknown')
    expect(budgetStatus({ planned: 0, actual: 0, over_budget: false })).toBe('within')
    expect(budgetStatus({ planned: 0, actual: 10, over_budget: true })).toBe('over')
    expect(budgetStatus({ planned: 100, actual: 40, over_budget: false })).toBe('within')
  })
})

describe('financeSummaryMode', () => {
  it('hides the KPI strip on an empty ledger, asks for a budget when spend has no plan, and dashboards when planned exists', () => {
    expect(financeSummaryMode({ planned: null, budget_count: 0, expense_count: 0 })).toBe('empty')
    expect(financeSummaryMode({ planned: null, budget_count: 0, expense_count: 2 })).toBe('need-budget')
    expect(financeSummaryMode({ planned: 100, budget_count: 1, expense_count: 0 })).toBe('dashboard')
  })
})

describe('clampListOffset', () => {
  it('moves a past-the-end page back onto the last page that still has rows', () => {
    expect(clampListOffset(50, 50, 50)).toBe(0)
    expect(clampListOffset(100, 50, 50)).toBe(0)
    expect(clampListOffset(50, 51, 50)).toBe(50)
    expect(clampListOffset(50, 0, 50)).toBe(0)
    expect(clampListOffset(0, 80, 50)).toBe(0)
  })

  it('does not apply a clamp until the current query has settled with matching offset', () => {
    expect(nextOffsetAfterListResult({ isFetching: true, requestedOffset: 50, responseOffset: 50, total: 50, pageSize: 50 })).toBeNull()
    expect(nextOffsetAfterListResult({ isFetching: false, requestedOffset: 50, responseOffset: 0, total: 50, pageSize: 50 })).toBeNull()
    expect(nextOffsetAfterListResult({ isFetching: false, requestedOffset: 50, responseOffset: 50, total: undefined, pageSize: 50 })).toBeNull()
    expect(nextOffsetAfterListResult({ isFetching: false, requestedOffset: 50, responseOffset: 50, total: 50, pageSize: 50 })).toBe(0)
    expect(nextOffsetAfterListResult({ isFetching: false, requestedOffset: 50, responseOffset: 50, total: 51, pageSize: 50 })).toBeNull()
  })
})

describe('stale write token', () => {
  it('blocks ordinary save from using a refreshed token until overwrite is explicit and the latest fetch succeeded', () => {
    expect(financeSubmitToken({ stale: true, overwrite: false, writeToken: 'v2', latestToken: 'v3', latestFetchFailed: false })).toBeNull()
    expect(financeSubmitToken({ stale: false, overwrite: false, writeToken: 'v2', latestToken: 'v3', latestFetchFailed: false })).toBe('v2')
    expect(financeSubmitToken({ stale: true, overwrite: true, writeToken: 'v2', latestToken: 'v3', latestFetchFailed: false })).toBe('v3')
    expect(financeSubmitToken({ stale: true, overwrite: true, writeToken: 'v2', latestToken: 'v3', latestFetchFailed: true })).toBeNull()
    expect(financeSubmitToken({ stale: true, overwrite: true, writeToken: 'v2', latestToken: null, latestFetchFailed: false })).toBeNull()
  })
})

describe('finance write permission and form persistence', () => {
  it('does not treat a cached can_manage flag as current permission after an access error', () => {
    expect(financeWriteAllowed({ can_manage: true }, null)).toBe(true)
    expect(financeWriteAllowed({ can_manage: false }, null)).toBe(false)
    expect(financeWriteAllowed({ can_manage: true }, new ApiError(500, 'http_error', 'down'))).toBe(false)
    expect(financeWriteAllowed({ can_manage: true }, new ApiError(403, 'forbidden', 'no'))).toBe(false)
    expect(financeWriteAllowed(null, null)).toBe(false)
  })

  it('keeps a mounted form when cached entry or access exists, even if a later refetch failed', () => {
    expect(shouldKeepFinanceFormMounted({ hasCachedEntry: true, hasCachedAccess: false })).toBe(true)
    expect(shouldKeepFinanceFormMounted({ hasCachedEntry: false, hasCachedAccess: true })).toBe(true)
    expect(shouldKeepFinanceFormMounted({ hasCachedEntry: false, hasCachedAccess: false })).toBe(false)
  })
})

describe('unknown versus zero formatting', () => {
  it('labels a null amount as unknown and keeps an explicit zero as a zero amount', () => {
    expect(formatNullableAmount(null, SAR, 'unknown')).toBe('unknown')
    expect(formatNullableAmount(0, SAR, 'unknown')).toBe('0.00 ر.س')
    expect(formatNullableAmount(null, SAR, 'unknown')).not.toBe(formatNullableAmount(0, SAR, 'unknown'))
    expect(formatNullableAmount(250.5, SAR, 'unknown')).toBe('250.50 ر.س')
  })

  it('labels null utilization and counts as unknown, distinct from zero', () => {
    expect(formatNullablePercent(null, 'unknown')).toBe('unknown')
    expect(formatNullablePercent(0, 'unknown')).toBe('0%')
    expect(formatUtilization(null, 'unknown')).toBe('unknown')
    expect(formatUtilization(12.5, 'unknown')).toBe('12.50%')
  })
})

describe('isFinanceIsoDate', () => {
  it('accepts a calendar date and rejects a timestamp or impossible day', () => {
    expect(isFinanceIsoDate('2030-02-01')).toBe(true)
    expect(isFinanceIsoDate('2030-02-30')).toBe(false)
    expect(isFinanceIsoDate('2030-02-01T00:00:00Z')).toBe(false)
    expect(isFinanceIsoDate('')).toBe(false)
    expect(isFinanceIsoDate(null)).toBe(false)
  })
})

describe('validateFinanceDraft', () => {
  it('requires a title, a dated positive expense, and currency precision', () => {
    expect(validateFinanceDraft(draft({ kind: 'expense', title: '  ', amountInput: '', expenseDate: null }), 2)).toEqual([
      { field: 'title', code: 'required' },
      { field: 'amount', code: 'empty' },
      { field: 'expense_date', code: 'required' },
    ])
    expect(validateFinanceDraft(draft({ kind: 'expense', amountInput: '0', expenseDate: '2030-01-01' }), 2)).toEqual([
      { field: 'amount', code: 'positive' },
    ])
    expect(validateFinanceDraft(draft({ kind: 'expense', amountInput: '12.345', expenseDate: '2030-01-01' }), 2)).toEqual([
      { field: 'amount', code: 'precision' },
    ])
    expect(validateFinanceDraft(draft({ kind: 'expense', amountInput: '10.00', expenseDate: '2030-02-30' }), 2)).toEqual([
      { field: 'expense_date', code: 'invalid' },
    ])
  })

  it('allows a zero budget, ignores expense-only fields for budget, and still checks title length', () => {
    expect(validateFinanceDraft(draft({ kind: 'budget', amountInput: '0', expenseDate: '2030-01-01', budgetEntryId: 8 }), 2)).toEqual([])
    expect(validateFinanceDraft(draft({ title: 'a'.repeat(201) }), 2)).toEqual([{ field: 'title', code: 'too_long' }])
    expect(validateFinanceDraft(draft({ reference: 'r'.repeat(201) }), 2)).toEqual([{ field: 'reference', code: 'too_long' }])
    expect(validateFinanceDraft(draft({ notes: 'n'.repeat(10001) }), 2)).toEqual([{ field: 'notes', code: 'too_long' }])
  })
})

describe('financeCreateBody', () => {
  it('omits expense date and budget reference on a budget create', () => {
    const body = financeCreateBody(
      draft({
        kind: 'budget',
        amountInput: '١٢٫٥٠',
        expenseDate: '2030-01-01',
        budgetEntryId: 8,
        reference: '  ',
        notes: '',
      }),
      2,
    )
    expect(body).toEqual({ kind: 'budget', title: 'Office fit-out', amount: 12.5 })
    expect(body).not.toHaveProperty('expense_date')
    expect(body).not.toHaveProperty('budget_entry_id')
  })

  it('sends a dated positive expense and an optional budget link', () => {
    expect(financeCreateBody(
      draft({
        kind: 'expense',
        amountInput: '250.50',
        expenseDate: '2030-03-02',
        reference: 'PO-1',
        notes: 'First coat',
        budgetEntryId: 3,
      }),
      2,
    )).toEqual({
      kind: 'expense',
      title: 'Office fit-out',
      amount: 250.5,
      expense_date: '2030-03-02',
      reference: 'PO-1',
      notes: 'First coat',
      budget_entry_id: 3,
    })
  })

  it('omits an empty expense budget link rather than sending null on create', () => {
    const body = financeCreateBody(
      draft({ kind: 'expense', amountInput: '1.00', expenseDate: '2030-01-01', budgetEntryId: null }),
      2,
    )
    expect(body).not.toHaveProperty('budget_entry_id')
  })
})

describe('financePatchBody', () => {
  it('sends only changed mutable fields plus the revision token, and never kind or project id', () => {
    const baseline = draftFromEntry(entry())
    const next = { ...baseline, title: 'Paint rooms', amountInput: '300.00' }
    expect(financePatchBody(next, baseline, 'v2', 2)).toEqual({
      expected_updated_at: 'v2',
      title: 'Paint rooms',
      amount: 300,
    })
  })

  it('does not submit budget reference or date when the entry is a budget', () => {
    const baseline = draftFromEntry(entry({ kind: 'budget', amount: 0, expense_date: null, budget_entry_id: null }))
    const next = { ...baseline, expenseDate: '2030-01-01', budgetEntryId: 4, amountInput: '0.00' }
    expect(financePatchBody(next, baseline, 'v3', 2)).toEqual({
      expected_updated_at: 'v3',
    })
  })

  it('does not produce a mutable patch for an unchanged edit', () => {
    const baseline = draftFromEntry(entry())
    const patch = financePatchBody({ ...baseline }, baseline, 'v2', 2)
    expect(financePatchHasMutation(patch)).toBe(false)
    expect(isFinanceDraftDirty(baseline, baseline, 2)).toBe(false)
  })

  it('can clear an expense budget link with an explicit null', () => {
    const baseline = draftFromEntry(entry())
    const next = { ...baseline, budgetEntryId: null }
    expect(financePatchBody(next, baseline, 'v2', 2)).toEqual({
      expected_updated_at: 'v2',
      budget_entry_id: null,
    })
  })
})

describe('conflict helpers', () => {
  it('treats only stale_write 409 as a stale save, and other 409s as a referenced-budget conflict', () => {
    expect(isStaleFinanceWrite(new ApiError(409, 'stale_write', 'changed', 'expected_updated_at'))).toBe(true)
    expect(isStaleFinanceWrite(new ApiError(409, 'budget_in_use', 'linked'))).toBe(false)
    expect(isReferencedBudgetConflict(new ApiError(409, 'budget_in_use', 'linked'))).toBe(true)
    expect(isReferencedBudgetConflict(new ApiError(409, 'stale_write', 'changed'))).toBe(false)
    expect(isReferencedBudgetConflict(new ApiError(422, 'invalid', 'bad'))).toBe(false)
  })
})
