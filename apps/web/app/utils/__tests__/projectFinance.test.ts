import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import {
  FINANCE_PAGE,
  actualAccountErrorKey,
  actualAccountLabel,
  actualLinesQuery,
  financeKindFilters,
  isExternalActual,
  budgetStatus,
  clampListOffset,
  ledgerEmptiness,
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
  it('keeps the source tile for an external actual before any budget row or posted line', () => {
    expect(financeSummaryMode({ planned: null, budget_count: 0, expense_count: 0, actual_source: 'external' })).toBe('need-budget')
    expect(financeSummaryMode({ planned: 100, budget_count: 1, expense_count: 0, actual_source: 'external' })).toBe('dashboard')
    expect(financeSummaryMode({ planned: null, budget_count: 0, expense_count: 0, actual_source: 'manual' })).toBe('empty')
  })
})

describe('external actual helpers', () => {
  it('offers the expense filter only for a manual actual', () => {
    expect(financeKindFilters(undefined)).toEqual(['all', 'budget', 'expense'])
    expect(financeKindFilters({ actual_source: 'manual' })).toEqual(['all', 'budget', 'expense'])
    expect(financeKindFilters({ actual_source: 'external' })).toEqual(['all', 'budget'])
    expect(isExternalActual({ actual_source: 'external' })).toBe(true)
    expect(isExternalActual({ actual_source: 'manual' })).toBe(false)
  })
  it('clamps the actual lines page like the ledger', () => {
    expect(actualLinesQuery({})).toEqual({ limit: FINANCE_PAGE, offset: 0 })
    expect(actualLinesQuery({ limit: 999, offset: -5 })).toEqual({ limit: 200, offset: 0 })
    expect(actualLinesQuery({ limit: 20, offset: 40 })).toEqual({ limit: 20, offset: 40 })
  })
  it('labels a cost center by its code when it has one', () => {
    expect(actualAccountLabel({ name: 'Tower', code: 'CC-1' })).toBe('CC-1 · Tower')
    expect(actualAccountLabel({ name: 'Tower', code: null })).toBe('Tower')
  })
  it('explains a taken or unknown cost center and falls back to the generic error', () => {
    expect(actualAccountErrorKey(new ApiError(409, 'account_linked', 'x', 'account_id'))).toBe('projects.finance.actualAccount.linked')
    expect(actualAccountErrorKey(new ApiError(422, 'invalid', 'x', 'account_id'))).toBe('projects.finance.actualAccount.invalid')
    expect(actualAccountErrorKey(new ApiError(422, 'invalid', 'x', 'other'))).toBe('errors.generic')
    expect(actualAccountErrorKey(new Error('boom'))).toBe('errors.generic')
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

describe('ledgerEmptiness', () => {
  const base = { ledgerEmpty: true, filtered: false, offset: 0 }
  it('invites a first entry only when nothing is recorded anywhere', () => {
    expect(ledgerEmptiness({ ...base, summary: { actual_source: 'ledger', expense_count: 0 } })).toBe('bare')
    expect(ledgerEmptiness({ ...base, summary: { actual_source: 'external', expense_count: 0 } })).toBe('bare')
  })
  it('does not say "no entries" when external actual lines exist', () => {
    expect(ledgerEmptiness({ ...base, summary: { actual_source: 'external', expense_count: 2 } })).toBe('actual-only')
  })
  it('leaves filtered, paged or non-empty ledgers to the list', () => {
    const summary = { actual_source: 'ledger' as const, expense_count: 0 }
    expect(ledgerEmptiness({ ...base, filtered: true, summary })).toBe('none')
    expect(ledgerEmptiness({ ...base, offset: 50, summary })).toBe('none')
    expect(ledgerEmptiness({ ...base, ledgerEmpty: false, summary })).toBe('none')
  })
})
