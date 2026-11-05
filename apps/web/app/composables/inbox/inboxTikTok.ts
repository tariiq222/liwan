import { useMutation } from '@tanstack/vue-query'
import { InboxTikTokConnectResponseSchema, type InboxTikTokConnect } from '@liwan/contracts'
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
