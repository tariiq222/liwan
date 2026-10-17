import type { ChatMessage } from '@webvue/contracts'

export const CHAT_POLL_MS = 5_000
export const CHAT_TYPING_MS = 6_000
export const CHAT_PAGE_SIZE = 50
export type ChatFilter = 'all' | 'unread' | 'groups' | 'channels' | 'starred'
export const CHAT_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢'] as const
export type ChatListRoute = { q: string; filter: ChatFilter; offset: number }
export type ChatSendState = 'pending' | 'sent'

const FILTERS: ChatFilter[] = ['all', 'unread', 'groups', 'channels', 'starred']

export function parseChatListRoute(query: Record<string, unknown>): ChatListRoute {
  const rawFilter = typeof query.filter === 'string' ? query.filter : 'all'
  const filter = FILTERS.includes(rawFilter as ChatFilter) ? rawFilter as ChatFilter : 'all'
  const q = typeof query.q === 'string' ? query.q : ''
  const rawOffset = typeof query.offset === 'string' ? Number(query.offset) : typeof query.offset === 'number' ? query.offset : 0
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return { q, filter, offset }
}

export function serializeChatListRoute(route: ChatListRoute): Record<string, string | undefined> {
  return {
    q: route.q.trim() || undefined,
    filter: route.filter === 'all' ? undefined : route.filter,
    offset: route.offset > 0 ? String(route.offset) : undefined,
  }
}

export function chatListQuery(route: ChatListRoute) {
  return {
    q: route.q.trim() || undefined,
    filter: route.filter,
    limit: CHAT_PAGE_SIZE,
    offset: route.offset,
  }
}

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[], mode: 'replace' | 'older' | 'newer'): ChatMessage[] {
  if (mode === 'replace') return incoming.slice()
  const seen = new Set(current.map(item => item.id))
  const updates = new Map(incoming.map(item => [item.id, item]))
  const refreshed = current.map(item => updates.get(item.id) ?? item)
  if (mode === 'older') {
    const prepended = incoming.filter(item => !seen.has(item.id))
    return [...prepended, ...refreshed]
  }
  const appended = incoming.filter(item => !seen.has(item.id))
  return [...refreshed, ...appended]
}

export function preserveFailedDraft(sent: string, failed: boolean, next = ''): string {
  return failed ? sent : next
}

export function shouldSendOnEnter(event: { key: string; shiftKey: boolean; isComposing?: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  const composing = event.isComposing || event.nativeEvent?.isComposing
  return event.key === 'Enter' && !event.shiftKey && !composing
}

export function chatCacheScope(userId: number | undefined) {
  return ['chat', userId ?? 'anonymous'] as const
}

export function isFatalChatStatus(status: number | undefined): boolean {
  return status === 403 || status === 404
}

export function chatPollInterval(status: number | undefined): number | false {
  return isFatalChatStatus(status) ? false : CHAT_POLL_MS
}

export function visibleReadMessageId(opts: {
  tabVisible: boolean
  pageVisible: boolean
  visibleIds: number[]
}): number | null {
  if (!opts.tabVisible || !opts.pageVisible || !opts.visibleIds.length) return null
  return Math.max(...opts.visibleIds)
}

export function messageDayKey(iso: string): string {
  return iso.slice(0, 10)
}

export function needsMessageCatchUp(lastKnownId: number | undefined, incoming: ChatMessage[]): boolean {
  if (!lastKnownId || !incoming.length) return false
  return incoming.length >= CHAT_PAGE_SIZE
}

export function nextListOffset(offset: number, total: number, delta: number): number {
  const next = offset + delta
  if (next < 0 || next >= total) return offset
  return next
}
