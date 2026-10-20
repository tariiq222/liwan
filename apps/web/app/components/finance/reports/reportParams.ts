import { REPORTS, type ReportSlug } from './reportConfig'
import { queryText, queryDay, queryPositiveInt } from '../../../utils/routeQuery'

export const LEDGER_PAGE_SIZE = 50
export const TARGET_MOVES = ['posted', 'all'] as const
export const STATEMENT_KINDS = ['receivable', 'payable'] as const
export const STATEMENT_TYPES = ['activity', 'outstanding'] as const

/** What the filter bar can say, with the period already resolved (the URL leaves it out until the user changes it). */
export interface ReportFilters {
  dateFrom: string
  dateTo: string
  targetMove: (typeof TARGET_MOVES)[number]
  kind: (typeof STATEMENT_KINDS)[number]
  type: (typeof STATEMENT_TYPES)[number]
  partnerId: number | null
  accountId: number | null
  planId: number | null
  page: number
}

export type ReportParams = Record<string, string | number>

type Query = Record<string, unknown>

/** The report filters out of a route query. Without dates the period is the current month up to `today`; `date_to` never precedes `date_from`. */
export function reportFiltersFromQuery(query: Query, today: string): ReportFilters {
  const dateTo = queryDay(query.date_to) ?? today
  const dateFrom = queryDay(query.date_from) ?? `${today.slice(0, 8)}01`
  const targetMove = queryText(query.target_move)
  const kind = queryText(query.kind)
  const type = queryText(query.type)
  return {
    dateFrom: dateFrom <= dateTo ? dateFrom : dateTo,
    dateTo,
    targetMove: TARGET_MOVES.find(value => value === targetMove) ?? 'posted',
    kind: STATEMENT_KINDS.find(value => value === kind) ?? 'receivable',
    type: STATEMENT_TYPES.find(value => value === type) ?? 'activity',
    partnerId: queryPositiveInt(query.partner_id),
    accountId: queryPositiveInt(query.account_id),
    planId: queryPositiveInt(query.plan_id),
    page: queryPositiveInt(query.page) ?? 1,
  }
}

/** True when the report sends only `date_to`: balances as of a day, and the outstanding statement. */
export function reportEndsOnly(slug: ReportSlug, filters: ReportFilters): boolean {
  const set = REPORTS[slug].filters
  return set.period === 'end' || (set.type && filters.type === 'outstanding')
}

/** The query of `GET /finance/reports/{slug}`: only the filters the report takes. */
export function reportParams(slug: ReportSlug, filters: ReportFilters): ReportParams {
  const set = REPORTS[slug].filters
  return {
    ...(reportEndsOnly(slug, filters) ? {} : { date_from: filters.dateFrom }),
    date_to: filters.dateTo,
    ...(set.targetMove ? { target_move: filters.targetMove } : {}),
    ...(set.kind ? { kind: filters.kind } : {}),
    ...(set.type ? { type: filters.type } : {}),
    ...(set.partner && filters.partnerId ? { partner_id: filters.partnerId } : {}),
    ...(set.plan && filters.planId ? { plan_id: filters.planId } : {}),
    ...(set.account && filters.accountId ? { account_id: filters.accountId, limit: LEDGER_PAGE_SIZE, offset: (filters.page - 1) * LEDGER_PAGE_SIZE } : {}),
  }
}

/** A partner statement cannot be asked for before a partner is chosen. */
export function reportReady(slug: ReportSlug, filters: ReportFilters): boolean {
  return !REPORTS[slug].filters.partner || filters.partnerId !== null
}

/** The filters the user changed from their defaults, among those the report takes. */
export function reportActiveFilterCount(slug: ReportSlug, filters: ReportFilters, today: string): number {
  const set = REPORTS[slug].filters
  const base = reportFiltersFromQuery({}, today)
  const changed = [
    !reportEndsOnly(slug, filters) && filters.dateFrom !== base.dateFrom,
    filters.dateTo !== base.dateTo,
    set.targetMove && filters.targetMove !== base.targetMove,
    set.kind && filters.kind !== base.kind,
    set.type && filters.type !== base.type,
    set.partner && filters.partnerId !== null,
    set.plan && filters.planId !== null,
  ]
  return changed.filter(Boolean).length
}
