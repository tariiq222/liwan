import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HelpdeskAttachmentsSchema,
  HelpdeskMessagesSchema,
  HelpdeskReferenceSchema,
  HelpdeskSettingsSchema,
  HelpdeskSummarySchema,
  HelpdeskTicketPageSchema,
  HelpdeskTicketSchema,
  type HelpdeskSettingsPatch,
  type HelpdeskTicket,
  type HelpdeskTicketCreate,
  type HelpdeskTicketPatch,
} from '@liwan/contracts'
import { helpdeskApiQuery, helpdeskKeys, type HelpdeskListState } from './helpdeskKeys'

export function useHelpdeskTickets(state: MaybeRefOrGetter<HelpdeskListState>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.list(toValue(state))),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/helpdesk/tickets', {
      query: helpdeskApiQuery(toValue(state)), schema: HelpdeskTicketPageSchema,
    }),
  })
}

export function useHelpdeskTicket(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/helpdesk/tickets/${toValue(id)}`, { schema: HelpdeskTicketSchema }),
  })
}

export function useHelpdeskMessages(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.messages(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/helpdesk/tickets/${toValue(id)}/messages`, { schema: HelpdeskMessagesSchema }),
  })
}

export function useHelpdeskReference() {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.reference(me.value?.company.id)),
    queryFn: () => $api('/api/v1/helpdesk/reference', { schema: HelpdeskReferenceSchema }),
  })
}

export function useHelpdeskSummary() {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.summary(me.value?.company.id)),
    queryFn: () => $api('/api/v1/helpdesk/summary', { schema: HelpdeskSummarySchema }),
  })
}

export function useHelpdeskSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.settings(me.value?.company.id)),
    enabled: computed(() => Boolean(toValue(enabled))),
    queryFn: () => $api('/api/v1/helpdesk/settings', { schema: HelpdeskSettingsSchema }),
  })
}

/** Every write answers the ticket as saved: it replaces the record and refreshes the lists and the counters. */
function useTicketWrite<Args, Saved extends { id: number }>(
  send: (api: ReturnType<typeof useApi>['$api'], args: Args) => Promise<Saved>,
  target?: (args: Args) => number,
) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Args) => send($api, args),
    onSuccess: async (saved: Saved) => {
      qc.setQueryData(helpdeskKeys.detail(saved.id), saved)
      await Promise.all([
        qc.invalidateQueries({ queryKey: helpdeskKeys.all, predicate: query => query.queryKey[1] === 'list' }),
        qc.invalidateQueries({ queryKey: helpdeskKeys.all, predicate: query => query.queryKey[1] === 'summary' }),
        qc.invalidateQueries({ queryKey: helpdeskKeys.messages(saved.id) }),
      ])
    },
    onError: async (_failure, args) => {
      if (target) await qc.invalidateQueries({ queryKey: helpdeskKeys.detail(target(args)) })
    },
  })
}

export const useCreateHelpdeskTicket = () => useTicketWrite<HelpdeskTicketCreate, HelpdeskTicket>(
  (api, body) => api('/api/v1/helpdesk/tickets', { method: 'POST', body, schema: HelpdeskTicketSchema }),
)

export const useUpdateHelpdeskTicket = () => useTicketWrite<{ id: number; body: HelpdeskTicketPatch }, HelpdeskTicket>(
  (api, { id, body }) => api(`/api/v1/helpdesk/tickets/${id}`, { method: 'PATCH', body, schema: HelpdeskTicketSchema }),
  ({ id }) => id,
)

export type HelpdeskAction =
  | { action: 'assign'; assignee_id: number | null }
  | { action: 'stage'; stage_id: number }
  | { action: 'close' | 'reopen' }

export const useHelpdeskAction = () => useTicketWrite<{ id: number; body: HelpdeskAction }, HelpdeskTicket>(
  (api, { id, body }) => api(`/api/v1/helpdesk/tickets/${id}/${body.action}`, {
    method: 'POST',
    body: body.action === 'assign' ? { assignee_id: body.assignee_id }
      : body.action === 'stage' ? { stage_id: body.stage_id } : {},
    schema: HelpdeskTicketSchema,
  }),
  ({ id }) => id,
)

export const useHelpdeskComment = () => useTicketWrite<{ id: number; body: string; internal: boolean }, HelpdeskTicket>(
  (api, { id, body, internal }) => api(`/api/v1/helpdesk/tickets/${id}/messages`, {
    method: 'POST', body: { body, internal }, schema: HelpdeskMessagesSchema,
  }).then(async () => api(`/api/v1/helpdesk/tickets/${id}`, { schema: HelpdeskTicketSchema })),
  ({ id }) => id,
)

export function useHelpdeskAttachments(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const target = () => toValue(id) ?? 0
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: helpdeskKeys.detail(target()) })
  }
  const upload = useMutation({
    mutationFn: (body: { name: string; mimetype: string; data: string }) =>
      $api(`/api/v1/helpdesk/tickets/${target()}/attachments`, {
        method: 'POST', body, schema: HelpdeskAttachmentsSchema,
      }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (attachmentId: number) =>
      $api(`/api/v1/helpdesk/tickets/${target()}/attachments/${attachmentId}`, {
        method: 'DELETE', body: {}, schema: HelpdeskAttachmentsSchema,
      }),
    onSuccess: refresh,
  })
  return { upload, remove }
}

export const useSaveHelpdeskSettings = () => {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: HelpdeskSettingsPatch) => $api('/api/v1/helpdesk/settings', {
      method: 'PATCH', body, schema: HelpdeskSettingsSchema,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['helpdesk', 'settings'] })
    },
  })
}
