import type { InboxChannelKind, InboxConversation } from '@liwan/contracts'

/** The customer-service window by kind: WhatsApp closes it 24 hours after the customer's last message, TikTok 48 (D4). */
export const REPLY_WINDOW_HOURS: Record<InboxChannelKind, number> = { whatsapp: 24, tiktok: 48 }

/**
 * Whether a free-form reply is still accepted: the window closes `REPLY_WINDOW_HOURS` after the customer's
 * last message. Past it, or with no inbound message at all, WhatsApp may still send an approved template and
 * TikTok may send nothing at all. The server enforces the same rule (422 `invalid`).
 */
export function replyWindowOpen(conversation: Pick<InboxConversation, 'reply_window_ends_at'>, now: number = Date.now()): boolean {
  if (!conversation.reply_window_ends_at) return false
  return Date.parse(conversation.reply_window_ends_at) > now
}

/** The sentence that explains a closed window, in the rule of the conversation's channel. */
export const windowClosedDescriptionKey = (kind: InboxChannelKind): string => `inbox.composer.windowClosedByKind.${kind}`

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
