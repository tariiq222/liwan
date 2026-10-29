import type { CrmOpportunity, CrmOpportunityFilters, CrmStage } from '@webvue/contracts'

export const CRM_LIST_PATH = '/crm/opportunities'
const LIST_QUERY_KEYS = ['q', 'stage_id', 'user_id', 'source_id', 'due', 'unassigned', 'needs_manager', 'status', 'view', 'page'] as const
const FLAG_FILTERS = ['due', 'unassigned', 'needs_manager'] as const
// `open` is the server default, so only the other choices are kept in the address.
const LIST_STATUSES = ['won', 'lost', 'all'] as const
const ID_FILTERS = ['stage_id', 'user_id', 'source_id'] as const

type Query = Record<string, unknown>

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value)

function positiveId(value: unknown): number | undefined {
  const id = Number(first(value))
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/** The API filters the list's route query asks for: ids must be positive integers, flags are `1`, anything else is ignored. */
export function opportunityFilters(query: Query): CrmOpportunityFilters {
  const filters: CrmOpportunityFilters = {}
  for (const key of ID_FILTERS) {
    const id = positiveId(query[key])
    if (id) filters[key] = id
  }
  for (const key of FLAG_FILTERS) if (first(query[key]) === '1') filters[key] = true
  const status = first(query.status)
  if (LIST_STATUSES.some(value => value === status)) filters.status = status as (typeof LIST_STATUSES)[number]
  const text = first(query.q)
  if (typeof text === 'string' && text.trim()) filters.q = text.trim().slice(0, 200)
  return filters
}

/** How many filters are on (the search counts), for the filter bar's badge and its clear action. */
export const activeFilterCount = (query: Query) => Object.keys(opportunityFilters(query)).length

/** The list address that keeps its filters, view and page: what a record or the create panel returns to. */
export function opportunityListLocation(query: Query, hash = '') {
  const search = new URLSearchParams()
  for (const key of LIST_QUERY_KEYS) {
    const value = first(query[key])
    if (typeof value === 'string' && value) search.set(key, value)
  }
  return `${CRM_LIST_PATH}${search.size ? `?${search}` : ''}${hash}`
}

export function safeCrmReturnTo(value: unknown, fallback: string) {
  return typeof value === 'string' && /^\/crm\/opportunities(?:[?#]|$)/.test(value) ? value : fallback
}

/** The discount a sale grants, as the server derives it: the part of the package price given away, to two decimals. */
export function derivedDiscountPercent(listPrice: number, finalPrice: number): number {
  if (!(listPrice > 0) || finalPrice >= listPrice) return 0
  return Math.round(((listPrice - finalPrice) * 100) / listPrice * 100) / 100
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]]

/** «in 3 hours» / «2 days ago», in the given locale; the nearest whole unit, at least one minute. */
export function relativeTime(iso: string, now: number, locale: string): string {
  const diff = new Date(iso).getTime() - now
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => Math.abs(diff) >= ms) ?? RELATIVE_UNITS[2]!
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(diff / size), unit)
}

/** Whether a call is already due: it has a next-call time that has passed. */
export const isCallDue = (opportunity: Pick<CrmOpportunity, 'next_call_at' | 'status'>, now: number) =>
  opportunity.status === 'pending' && opportunity.next_call_at !== null && new Date(opportunity.next_call_at).getTime() <= now

/** The stages a record can be moved to by hand: a sale goes through the sale action, so the sold stage is not offered. */
export const movableStages = (stages: CrmStage[]) => stages.filter(stage => stage.active && !stage.is_won)

const PRICE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** A price with Latin digits and grouping, up to two decimals. The CRM API carries no currency, so none is drawn. */
export const formatPrice = (value: number) => PRICE.format(Number.isFinite(value) ? value : 0)
