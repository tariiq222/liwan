import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxTikTokConnectResponseSchema,
  InboxTikTokShortcutEnableResultSchema,
  InboxTikTokShortcutListSchema,
  InboxTikTokShortcutSchema,
  InboxTikTokSyncAnswerSchema,
  InboxTikTokSyncSchema,
  type InboxTikTokConnect,
  type InboxTikTokShortcutCreate,
  type InboxTikTokShortcutEnable,
  type InboxTikTokShortcutPatch,
} from '@liwan/contracts'
import { hasFeature } from '../../modules/registry'

// The TikTok channel's own surface: the OAuth connect, and the refusal reasons its routes answer with. Every
// reason becomes one translated line in the inbox namespace, so a failed reply or settings save never shows the
// server's English text; a reason this build does not know keeps the message the server sent.
export const INBOX_TIKTOK_FEATURE = 'inbox.tiktok'

/** The `details.reason` values of the TikTok routes: D3/D4 sends, E2 connect, E5 automation, E6 import, E7 guards. */
export const INBOX_TIKTOK_REASONS = [
  'inbox_tiktok_unsupported_kind',
  'inbox_tiktok_reply_limit',
  'inbox_window_closed',
  'inbox_tiktok_auto_message_reviewing',
  'inbox_tiktok_auto_message_limit',
  'inbox_tiktok_sync_running',
  'inbox_tiktok_not_configured',
  'inbox_channel_kind_unsupported',
  'inbox_tiktok_scopes_missing',
  'inbox_tiktok_account_taken',
] as const

const REASON_LABELS: ReadonlySet<string> = new Set(INBOX_TIKTOK_REASONS)

/** The locale key of a TikTok refusal reason, or null when this build has no line for it. */
export function inboxTikTokReasonKey(reason: unknown): string | null {
  return typeof reason === 'string' && REASON_LABELS.has(reason) ? `inbox.tiktokErrors.${reason}` : null
}

/** The locale key of a refused call's `details.reason`, or null when the refusal names none this build knows. */
export function inboxTikTokErrorKey(error: unknown): string | null {
  const details = (error as { details?: { reason?: unknown } } | null | undefined)?.details
  return inboxTikTokReasonKey(details?.reason)
}

/** Whether the tenant holds the `inbox.tiktok` sub-feature, so its screens are offered at all. */
export function useInboxTikTokEnabled() {
  const { me } = useMe()
  return computed(() => hasFeature(me.value, INBOX_TIKTOK_FEATURE))
}

/**
 * Starts the TikTok authorization: a new channel names itself, a channel being reconnected names its id.
 * The answer is the account page the browser is sent to; the callback creates or updates the channel.
 */
export function useConnectInboxTikTok() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: InboxTikTokConnect) => $api('/api/v1/inbox/channels/tiktok/connect', {
      method: 'POST', body, schema: InboxTikTokConnectResponseSchema,
    }),
  })
}

// ---------------------------------------------------------------- suggested questions, chat prompts and import

// Same 'inbox' root as the staff keys, so the bus invalidation of ['inbox'] refreshes the channel page too.
export const inboxTikTokKeys = {
  shortcuts: (channelId: number) => ['inbox', 'tiktok-shortcuts', channelId] as const,
  sync: (channelId: number) => ['inbox', 'tiktok-sync', channelId] as const,
}

const shortcutsPath = (channelId: number) => `/api/v1/inbox/channels/${channelId}/tiktok/shortcuts`
const syncPath = (channelId: number) => `/api/v1/inbox/channels/${channelId}/tiktok/sync`

/** One channel's suggested questions and chat prompts, with TikTok's audit status for each. */
export function useInboxTikTokShortcuts(channelId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxTikTokKeys.shortcuts(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(shortcutsPath(toValue(channelId) ?? 0), { schema: InboxTikTokShortcutListSchema }),
  })
}

/** Creates an item, or patches one when `id` is given; every change reloads the list. */
export function useSaveInboxTikTokShortcut(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const id = computed(() => toValue(channelId))
  return useMutation({
    mutationFn: ({ id: shortcutId, body }: { id?: number; body: InboxTikTokShortcutCreate | InboxTikTokShortcutPatch }) => shortcutId
      ? $api(`${shortcutsPath(id.value)}/${shortcutId}`, { method: 'PATCH', body, schema: InboxTikTokShortcutSchema })
      : $api(shortcutsPath(id.value), { method: 'POST', body, schema: InboxTikTokShortcutSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxTikTokKeys.shortcuts(id.value) }),
  })
}

export function useDeleteInboxTikTokShortcut(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (shortcutId: number) => $api(`${shortcutsPath(toValue(channelId))}/${shortcutId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxTikTokKeys.shortcuts(toValue(channelId)) }),
  })
}

/** Switching a kind on or off; enabling makes TikTok recreate every stored item, so the answer replaces the list. */
export function useEnableInboxTikTokShortcuts(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const id = computed(() => toValue(channelId))
  return useMutation({
    mutationFn: (body: InboxTikTokShortcutEnable) => $api(`${shortcutsPath(id.value)}/enable`, {
      method: 'POST', body, schema: InboxTikTokShortcutEnableResultSchema,
    }),
    // The answer carries the switch state too; the list query keeps only its items.
    onSuccess: answer => qc.setQueryData(inboxTikTokKeys.shortcuts(id.value), { items: answer.items, total: answer.total }),
  })
}

/** The channel's latest history import, null before the first one. */
export function useInboxTikTokSync(channelId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxTikTokKeys.sync(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(syncPath(toValue(channelId) ?? 0), { schema: InboxTikTokSyncAnswerSchema }),
  })
}

/** Queues an import of the last 90 days; a second one while it runs is refused with `inbox_tiktok_sync_running`. */
export function useStartInboxTikTokSync(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const id = computed(() => toValue(channelId))
  return useMutation({
    mutationFn: () => $api(syncPath(id.value), { method: 'POST', schema: InboxTikTokSyncSchema }),
    onSuccess: job => qc.setQueryData(inboxTikTokKeys.sync(id.value), { job }),
  })
}
