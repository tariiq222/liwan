import type { FinanceBudgetDistribute } from '@liwan/contracts'

/** One cost center's share as typed; the percent stays a string until it is validated. */
export interface ShareDraft { analyticId: number | null; percent: string }

export interface DistributeDraft {
  accountId: number | null
  amount: string
  label: string
  dateFrom: string | null
  dateTo: string | null
  shares: ShareDraft[]
}

export const emptyDistribute = (): DistributeDraft => ({ accountId: null, amount: '', label: '', dateFrom: null, dateTo: null, shares: [{ analyticId: null, percent: '50' }, { analyticId: null, percent: '50' }] })

/** Whole cents of percent: 100 split into `count` parts that add up to exactly 100 (the last part takes the remainder). */
export function evenPercents(count: number): string[] {
  const part = Math.floor(10000 / count) / 100
  return Array.from({ length: count }, (_, index) => String(index === count - 1 ? Math.round((100 - part * (count - 1)) * 100) / 100 : part))
}

const numberOf = (value: string) => value.trim() === '' ? Number.NaN : Number(value)
export const percentTotal = (shares: readonly ShareDraft[]) => Math.round(shares.reduce((sum, share) => sum + (Number.isFinite(numberOf(share.percent)) ? numberOf(share.percent) : 0), 0) * 1e6) / 1e6

/** What a share comes to in money, to the cent; the last share on the server absorbs rounding, so this is a preview. */
export const shareAmount = (amount: string, percent: string) => {
  const total = numberOf(amount)
  const part = numberOf(percent)
  return Number.isFinite(total) && Number.isFinite(part) ? Math.round(total * part) / 100 : null
}

export interface DistributeErrors {
  account: boolean
  amount: boolean
  order: boolean
  /** Fewer than two cost centers, or one chosen twice or missing. */
  shares: boolean
  /** The percents do not add up to 100. */
  total: boolean
}

export function validateDistribute(draft: DistributeDraft): DistributeErrors {
  const ids = draft.shares.map(share => share.analyticId)
  const amount = numberOf(draft.amount)
  return {
    account: !draft.accountId,
    amount: !(Number.isFinite(amount) && amount >= 0),
    order: !!draft.dateFrom && !!draft.dateTo && draft.dateTo < draft.dateFrom,
    shares: draft.shares.length < 2 || ids.some(value => value === null) || new Set(ids).size !== ids.length || draft.shares.some(share => !(numberOf(share.percent) > 0 && numberOf(share.percent) <= 100)),
    total: Math.abs(percentTotal(draft.shares) - 100) >= 1e-6,
  }
}

export const hasDistributeErrors = (errors: DistributeErrors) => Object.values(errors).some(Boolean)

export function buildDistribute(draft: DistributeDraft): FinanceBudgetDistribute {
  const label = draft.label.trim()
  return {
    account_id: draft.accountId!,
    amount: numberOf(draft.amount),
    ...(label ? { label } : {}),
    ...(draft.dateFrom ? { date_from: draft.dateFrom } : {}),
    ...(draft.dateTo ? { date_to: draft.dateTo } : {}),
    shares: draft.shares.map(share => ({ analytic_account_id: share.analyticId!, percent: numberOf(share.percent) })),
  }
}
