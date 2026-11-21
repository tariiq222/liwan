import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  IntegrationAvailableNumberListSchema,
  IntegrationCallListSchema,
  IntegrationCallStateViewSchema,
  IntegrationCommunicationSettingsSchema,
  IntegrationLookupResultSchema,
  IntegrationMessageListSchema,
  IntegrationMessageStateViewSchema,
  IntegrationSenderListSchema,
  IntegrationSenderSchema,
  type IntegrationCallList,
  type IntegrationCallState,
  type IntegrationCallStateView,
  type IntegrationVoiceTest,
  type IntegrationCommunicationSettings,
  type IntegrationCommunicationSettingsUpdate,
  type IntegrationLookupTest,
  type IntegrationMessageChannel,
  type IntegrationMessageState,
  type IntegrationMessageStateView,
  type IntegrationMessagingTest,
  type IntegrationSender,
  type IntegrationSenderChannel,
  type IntegrationSenderCreate,
  type IntegrationSenderList,
  type IntegrationSenderUpdate,
} from '@liwan/contracts'
import { messageIsFinal } from '../utils/integrationMessaging'
import { callIsFinal } from '../utils/integrationVoice'

export const COMMUNICATION_PAGE_SIZE = 20
/** A test message that is still waiting for its receipt is read every few seconds, for two minutes at most. */
const TEST_POLL_MS = 3000
const TEST_POLL_MAX_MS = 120_000

export const communicationKeys = {
  senders: ['integrations', 'senders'] as const,
  available: (connectionId: number) => ['integrations', 'available-numbers', connectionId] as const,
  settings: ['integrations', 'communication-settings'] as const,
  messages: ['integrations', 'messages'] as const,
  test: (id: number) => ['integrations', 'messages', 'test', id] as const,
  calls: ['integrations', 'calls'] as const,
  voiceTest: (id: number) => ['integrations', 'calls', 'test', id] as const,
}

export interface SenderFilters { channel?: IntegrationSenderChannel, connection_id?: number, active: boolean, page: number }
export interface MessageFilters {
  channel?: IntegrationMessageChannel
  state?: IntegrationMessageState
  sender_id?: number
  from?: string
  to_date?: string
  q?: string
  page: number
}
export interface CallFilters {
  state?: IntegrationCallState
  sender_id?: number
  from?: string
  to_date?: string
  q?: string
  page: number
}

const paging = (page: number) => ({ limit: COMMUNICATION_PAGE_SIZE, offset: (page - 1) * COMMUNICATION_PAGE_SIZE })

export function useIntegrationSenders(filters: MaybeRefOrGetter<SenderFilters>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...communicationKeys.senders, 'list', toValue(filters)] as const),
    enabled,
    queryFn: () => {
      const { channel, connection_id, active, page } = toValue(filters)
      return $api('/api/v1/integrations/senders', { query: { channel, connection_id, active, ...paging(page) }, schema: IntegrationSenderListSchema })
    },
    retry: false,
  })
}

/** The numbers of the provider account, read live from the provider; a provider refusal is the query's error (502 `provider_error`). */
export function useAvailableNumbers(connectionId: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => communicationKeys.available(toValue(connectionId) ?? 0)),
    enabled: () => toValue(enabled) && toValue(connectionId) !== null,
    queryFn: () => $api('/api/v1/integrations/senders/available', { query: { connection_id: toValue(connectionId) }, schema: IntegrationAvailableNumberListSchema }),
    retry: false,
    staleTime: 0,
  })
}

export function useCreateIntegrationSender() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: IntegrationSenderCreate) => $api('/api/v1/integrations/senders', { method: 'POST', body, schema: IntegrationSenderSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: communicationKeys.senders }),
  })
}

// The server's answer replaces the sender in every cached list. A default flag moves between senders, so the lists are
// also read again; that read, not a guess, settles which other sender lost the default.
function replaceSender(list: IntegrationSenderList | undefined, sender: IntegrationSender): IntegrationSenderList | undefined {
  if (!list) return list
  const items = list.items.flatMap(item => (item.id !== sender.id ? [item] : sender.active === item.active ? [sender] : []))
  return { items, total: list.total - (list.items.length - items.length) }
}

export function useUpdateIntegrationSender() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number, body: IntegrationSenderUpdate }) =>
      $api(`/api/v1/integrations/senders/${id}`, { method: 'PATCH', body, schema: IntegrationSenderSchema }),
    onSuccess: async sender => {
      qc.setQueriesData<IntegrationSenderList>({ queryKey: communicationKeys.senders }, list => replaceSender(list, sender))
      await qc.invalidateQueries({ queryKey: communicationKeys.senders })
    },
  })
}

/** DELETE archives: the sender leaves the active list and shows under the archived filter. */
export function useArchiveIntegrationSender() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api<void>(`/api/v1/integrations/senders/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: communicationKeys.senders }),
  })
}

export function useCommunicationSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: communicationKeys.settings,
    enabled,
    queryFn: () => $api('/api/v1/integrations/communication-settings', { schema: IntegrationCommunicationSettingsSchema }),
    retry: false,
  })
}

export function useUpdateCommunicationSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: IntegrationCommunicationSettingsUpdate) =>
      $api('/api/v1/integrations/communication-settings', { method: 'PATCH', body, schema: IntegrationCommunicationSettingsSchema }),
    onSuccess: settings => { qc.setQueryData(communicationKeys.settings, settings) },
  })
}

export function useSendTestMessage() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: IntegrationMessagingTest) =>
      $api('/api/v1/integrations/messaging/test', { method: 'POST', body, schema: IntegrationMessageStateViewSchema }),
    onSuccess: message => { qc.setQueryData(communicationKeys.test(message.id), message) },
  })
}

/** The state of one test message, read every few seconds until nothing more can arrive. A manual `refetch` always works. */
export function useTestMessage(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const startedAt = ref(Date.now())
  watch(() => toValue(id), () => { startedAt.value = Date.now() })
  return useQuery({
    queryKey: computed(() => communicationKeys.test(toValue(id) ?? 0)),
    enabled: () => toValue(id) !== null,
    queryFn: () => $api(`/api/v1/integrations/messaging/test/${toValue(id)}`, { schema: IntegrationMessageStateViewSchema }),
    refetchInterval: query => {
      const message = query.state.data
      if (!message || messageIsFinal(message) || Date.now() - startedAt.value > TEST_POLL_MAX_MS) return false
      return TEST_POLL_MS
    },
    retry: false,
  })
}

/** The message log. Reading it needs `integrations.log.read`; the caller gates `enabled` on that capability. */
export function useIntegrationMessages(filters: MaybeRefOrGetter<MessageFilters>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...communicationKeys.messages, 'list', toValue(filters)] as const),
    enabled,
    queryFn: () => {
      const { channel, state, sender_id, from, to_date, q, page } = toValue(filters)
      return $api('/api/v1/integrations/messaging/messages', {
        query: { channel, state, sender_id, date_from: from, date_to: to_date, q: q || undefined, ...paging(page) },
        schema: IntegrationMessageListSchema,
      })
    },
    retry: false,
  })
}

/** Send a failed or unconfirmed message again as a new row. `unconfirmed` may already have reached the provider. */
export function useRetryMessage() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number): Promise<IntegrationMessageStateView> =>
      $api(`/api/v1/integrations/messaging/messages/${id}/retry`, { method: 'POST', body: {}, schema: IntegrationMessageStateViewSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: communicationKeys.messages }),
  })
}

/** Place one test call: `speak` says a text to `to`; `bridge` calls the agent first and dials `to` in. */
export function usePlaceTestCall() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: IntegrationVoiceTest) =>
      $api('/api/v1/integrations/voice/test', { method: 'POST', body, schema: IntegrationCallStateViewSchema }),
    onSuccess: call => { qc.setQueryData(communicationKeys.voiceTest(call.id), call) },
  })
}

/** The state of one test call, read every few seconds until it settles; a call is never placed again automatically. */
export function useTestCall(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const startedAt = ref(Date.now())
  watch(() => toValue(id), () => { startedAt.value = Date.now() })
  return useQuery({
    queryKey: computed(() => communicationKeys.voiceTest(toValue(id) ?? 0)),
    enabled: () => toValue(id) !== null,
    queryFn: () => $api(`/api/v1/integrations/voice/test/${toValue(id)}`, { schema: IntegrationCallStateViewSchema }),
    refetchInterval: query => {
      const call = query.state.data
      if (!call || callIsFinal(call) || Date.now() - startedAt.value > TEST_POLL_MAX_MS) return false
      return TEST_POLL_MS
    },
    retry: false,
  })
}

/** The call log. Reading it needs `integrations.log.read`; the caller gates `enabled` on that capability. */
export function useIntegrationCalls(filters: MaybeRefOrGetter<CallFilters>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...communicationKeys.calls, 'list', toValue(filters)] as const),
    enabled,
    queryFn: () => {
      const { state, sender_id, from, to_date, q, page } = toValue(filters)
      return $api('/api/v1/integrations/voice/calls', {
        query: { state, sender_id, date_from: from, date_to: to_date, q: q || undefined, ...paging(page) },
        schema: IntegrationCallListSchema,
      })
    },
    retry: false,
  })
}

/** Check one number with the provider; `line_type` asks the billed Line Type Intelligence package. */
export function useLookupNumber() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: IntegrationLookupTest) => $api('/api/v1/integrations/lookup/test', { method: 'POST', body, schema: IntegrationLookupResultSchema }),
  })
}
