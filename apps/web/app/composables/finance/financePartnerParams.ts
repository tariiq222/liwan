export const FINANCE_PARTNER_PAGE_SIZE = 25
export const FINANCE_PARTNER_KINDS = ['customer', 'vendor'] as const
export type FinancePartnerKind = typeof FINANCE_PARTNER_KINDS[number]

export interface FinancePartnerListState {
  q: string
  kind: FinancePartnerKind | null
  archived: boolean
  offset: number
}

type RouteValue = unknown

function single(value: RouteValue): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

/** The list state of `/finance/partners` from its URL query: anything unknown (a repeated key, another kind) falls back to the default. */
export function parsePartnerListQuery(query: Record<string, RouteValue>): FinancePartnerListState {
  const kind = single(query.kind)
  const offset = Number(single(query.offset))
  return {
    q: single(query.q).trim(),
    kind: (FINANCE_PARTNER_KINDS as readonly string[]).includes(kind) ? kind as FinancePartnerKind : null,
    archived: single(query.archived) === '1',
    offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
  }
}

/** The URL query of a list state, with every default left out so a default list has a clean URL. */
export function partnerListQuery(state: FinancePartnerListState): Record<string, string | undefined> {
  return {
    q: state.q || undefined,
    kind: state.kind ?? undefined,
    archived: state.archived ? '1' : undefined,
    offset: state.offset ? String(state.offset) : undefined,
  }
}

/** The kind of a partner row as the badges it shows; a partner may be both. */
export function partnerKinds(partner: { customer: boolean; vendor: boolean }): FinancePartnerKind[] {
  return FINANCE_PARTNER_KINDS.filter(kind => (kind === 'customer' ? partner.customer : partner.vendor))
}
