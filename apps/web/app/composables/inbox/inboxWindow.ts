import type { InboxChannelKind, InboxConversation } from '@liwan/contracts'

/**
 * Whether a free-form reply is still accepted: the window closes 24 hours after the customer's last message on
 * WhatsApp and 48 on TikTok (D4) — the server's `REPLY_WINDOWS` owns those hours. Past it, or with no inbound
 * message at all, WhatsApp may still send an approved template and TikTok may send nothing at all. The server
 * enforces the same rule (422 `invalid`).
 */
export function replyWindowOpen(conversation: Pick<InboxConversation, 'reply_window_ends_at'>, now: number = Date.now()): boolean {
  if (!conversation.reply_window_ends_at) return false
  return Date.parse(conversation.reply_window_ends_at) > now
}

/** The sentence that explains a closed window, in the rule of the conversation's channel. */
export const windowClosedDescriptionKey = (kind: InboxChannelKind): string => `inbox.composer.windowClosedByKind.${kind}`

/** The reason the server names when it refuses a send because the reply window closed; both kinds share it. */
const WINDOW_CLOSED_REASON = 'inbox_window_closed'

/**
 * The translated line of that refusal, in the rule of the conversation's channel: WhatsApp may still send an
 * approved template after the window, TikTok can send nothing at all (D4). Null for any other refusal, and for a
 * conversation whose kind is not loaded yet — the generic reason text answers then.
 */
export function windowClosedErrorKey(error: unknown, kind: InboxChannelKind | null | undefined): string | null {
  const reason = (error as { details?: { reason?: unknown } } | null | undefined)?.details?.reason
  return reason === WINDOW_CLOSED_REASON && kind ? `inbox.inbox_window_closed.${kind}` : null
}

/** A template body with its parameters filled in, for the preview under the picker. Missing values keep their placeholder. */
export function renderTemplateBody(body: string, params: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (placeholder, index: string) => params[Number(index) - 1]?.trim() || placeholder)
}

/** Canned replies whose shortcut starts with what follows the slash the agent typed at the start of the draft. */
export function cannedSuggestions<T extends { shortcut: string }>(draft: string, replies: readonly T[], limit = 6): T[] {
  const match = /^\/(\S*)$/.exec(draft)
  if (!match) return []
  const typed = match[1]!.toLowerCase()
  return replies.filter(reply => reply.shortcut.replace(/^\//, '').toLowerCase().startsWith(typed)).slice(0, limit)
}
