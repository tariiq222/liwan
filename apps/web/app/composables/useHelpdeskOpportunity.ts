import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CrmOpportunityListSchema, TicketOpportunityAnswerSchema, type TicketOpportunityAnswer } from '@liwan/contracts'
import { helpdeskKeys } from './helpdesk/helpdeskKeys'

// The opportunity a support ticket is linked to (the helpdesk bridge to CRM). Reading needs both applications' read
// capabilities; linking or unlinking needs the ticket's write capability and CRM read (owner decision 2026-11-20).

/** Rows the opportunity picker asks for. */
export const HELPDESK_OPPORTUNITY_PICK_LIMIT = 20

const opportunityKey = (ticketId: number) => [...helpdeskKeys.detail(ticketId), 'opportunity'] as const
const opportunityUrl = (ticketId: number) => `/api/v1/helpdesk/tickets/${ticketId}/opportunity`
const NO_LINK: TicketOpportunityAnswer = { opportunity: null, hidden: false }

type Translate = (key: string) => string
interface Refusal { status?: number; field?: string }

export function useHelpdeskOpportunityAccess() {
  const { can } = useAccess()
  return {
    read: computed(() => can('helpdesk.tickets.read') && can('crm.leads.read')),
    write: computed(() => can('helpdesk.tickets.write') && can('crm.leads.read')),
  }
}

/** The link of a ticket: the opportunity ref, `hidden` when a link exists that the caller cannot read, or neither. */
export function useTicketOpportunity(ticketId: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => opportunityKey(toValue(ticketId))),
    enabled: computed(() => toValue(ticketId) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(opportunityUrl(toValue(ticketId)), { signal, schema: TicketOpportunityAnswerSchema }),
  })
}

/** Links an opportunity, or replaces the linked one. The ticket travels with the call so a card reused for another ticket never receives this answer. */
export function useLinkTicketOpportunity() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, opportunityId }: { ticketId: number; opportunityId: number }) => $api(opportunityUrl(ticketId), { method: 'PUT', body: { opportunity_id: opportunityId }, schema: TicketOpportunityAnswerSchema }),
    onSuccess: (answer, { ticketId }) => qc.setQueryData(opportunityKey(ticketId), answer),
    // 403/404/422: what the server holds now may differ from what the card shows.
    onError: (_error, { ticketId }) => qc.invalidateQueries({ queryKey: opportunityKey(ticketId) }),
  })
}

/** Unlinking answers 204 whatever was linked, a hidden opportunity included. */
export function useUnlinkTicketOpportunity() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId }: { ticketId: number }) => $api(opportunityUrl(ticketId), { method: 'DELETE' }),
    onSuccess: (_result, { ticketId }) => qc.setQueryData(opportunityKey(ticketId), NO_LINK),
    onError: (_error, { ticketId }) => qc.invalidateQueries({ queryKey: opportunityKey(ticketId) }),
  })
}

/** Active opportunities matching a name or a phone (a ticket usually concerns a won deal); the list with every status also holds archived ones, which the server refuses to link, so they are left out. Nothing is asked before a term is typed. */
export function useHelpdeskOpportunityPick(q: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['helpdesk', 'opportunity-pick', toValue(q).trim()] as const),
    enabled: computed(() => toValue(enabled) && toValue(q).trim() !== ''),
    placeholderData: keepPreviousData,
    retry: false,
    select: (list) => ({ ...list, items: list.items.filter(item => item.active) }),
    queryFn: ({ signal }) => $api('/api/v1/crm/opportunities', { query: { q: toValue(q).trim(), status: 'all', limit: HELPDESK_OPPORTUNITY_PICK_LIMIT, offset: 0 }, signal, schema: CrmOpportunityListSchema }),
  })
}

/** What a refused link or unlink says: 403 lacks a right, 422 on `opportunity_id` is an archived opportunity (a lost one included), 404 a ticket or opportunity the user cannot see. */
export function helpdeskOpportunityErrorMessage(error: unknown, t: Translate): string {
  const failure = (error ?? {}) as Refusal
  if (failure.status === 403) return t('helpdesk.opportunity.errors.forbidden')
  if (failure.status === 422 && failure.field === 'opportunity_id') return t('helpdesk.opportunity.errors.archived')
  if (failure.status === 404) return t('helpdesk.opportunity.errors.missing')
  return t('errors.generic')
}
