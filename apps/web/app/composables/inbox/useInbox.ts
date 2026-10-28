import type { MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxAgentListSchema,
  InboxCannedReplyListSchema,
  InboxContactSchema,
  InboxConversationDetailSchema,
  InboxConversationListSchema,
  InboxMessageListSchema,
  InboxMessageSchema,
  InboxTagListSchema,
  InboxTemplateListSchema,
  type InboxContactPatch,
  type InboxMessage,
  type InboxConversationPatch,
  type InboxNoteCreate,
  type InboxReplyCreate,
} from '@webvue/contracts'
import { inboxListQuery, type InboxListRoute } from './inboxListRoute'

// Every key starts with 'inbox', so the bus handler's invalidation of ['inbox'] (type 'webvue/inbox') refreshes them all.
export const inboxKeys = {
  all: ['inbox'] as const,
  list: (route: InboxListRoute) => ['inbox', 'conversations', inboxListQuery(route)] as const,
  detail: (id: number) => ['inbox', 'conversation', id] as const,
  messagesOf: (id: number) => ['inbox', 'messages', id] as const,
  canned: ['inbox', 'canned-replies'] as const,
  templates: (channelId: number) => ['inbox', 'templates', channelId] as const,
  tags: ['inbox', 'tags'] as const,
  agents: ['inbox', 'agents'] as const,
}

export function useInboxConversations(route: MaybeRefOrGetter<InboxListRoute>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.list(toValue(route))),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/conversations', { query: inboxListQuery(toValue(route)), schema: InboxConversationListSchema }),
  })
}

export function useInboxConversation(id: MaybeRefOrGetter<number | undefined>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/conversations/${toValue(id)}`, { schema: InboxConversationDetailSchema }),
  })
}

/** Opening an unread conversation marks it read; a refusal (a read-only tenant) leaves it unread and is not an error to show. */
export function useMarkInboxConversationRead() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/conversations/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] }),
  })
}

/** Messages fetched per page; the server clamps a page to 200. */
export const INBOX_MESSAGE_PAGE = 100

type MessagePage = { items: InboxMessage[]; total: number }

/** Pages arrive newest first (offset counts from the newest); the thread reads oldest first. A message that moved between pages while new ones arrived is kept once. */
export function mergeMessagePages(pages: readonly MessagePage[]): InboxMessage[] {
  const seen = new Set<number>()
  const merged: InboxMessage[] = []
  for (const page of [...pages].reverse()) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged
}

/** The offset of the next older page, or undefined when everything is loaded. */
export function nextOlderOffset(pages: readonly MessagePage[]): number | undefined {
  const last = pages.at(-1)
  if (!last) return undefined
  const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
  return last.items.length > 0 && loaded < last.total ? loaded : undefined
}

/** The conversation's messages, oldest first, newest page first on the wire; `fetchNextPage` loads the next older page. */
export function useInboxMessages(id: MaybeRefOrGetter<number | undefined>) {
  const { $api } = useApi()
  const query = useInfiniteQuery({
    queryKey: computed(() => inboxKeys.messagesOf(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => $api(`/api/v1/inbox/conversations/${toValue(id)}/messages`, { query: { limit: INBOX_MESSAGE_PAGE, offset: pageParam }, schema: InboxMessageListSchema }),
    getNextPageParam: (_last, pages) => nextOlderOffset(pages),
  })
  const items = computed(() => mergeMessagePages(query.data.value?.pages ?? []))
  return { ...query, items }
}

export function useInboxCannedReplies() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxKeys.canned,
    queryFn: () => $api('/api/v1/inbox/canned-replies', { schema: InboxCannedReplyListSchema }),
  })
}

/** The approved templates of one channel, for a reply after the customer-service window has closed. */
export function useInboxTemplates(channelId: MaybeRefOrGetter<number | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.templates(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/templates`, { schema: InboxTemplateListSchema }),
  })
}

/** The tags an agent may put on a conversation (readable with the read capability). */
/** The company's users who may reply: the only valid assignees. */
export function useInboxAgents(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxKeys.agents,
    queryFn: () => $api('/api/v1/inbox/agents', { query: { limit: 200 }, schema: InboxAgentListSchema }),
    enabled: () => toValue(enabled),
  })
}

export function useInboxTags() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxKeys.tags,
    queryFn: () => $api('/api/v1/inbox/tags', { schema: InboxTagListSchema }),
  })
}

function useRefreshConversation(id: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: inboxKeys.messagesOf(toValue(id)) }),
      qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] }),
    ])
  }
}

export function useSendInboxReply(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(id)
  return useMutation({
    mutationFn: (body: InboxReplyCreate) => $api(`/api/v1/inbox/conversations/${toValue(id)}/messages`, { method: 'POST', body, schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

export function useSendInboxNote(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(id)
  return useMutation({
    mutationFn: (body: InboxNoteCreate) => $api(`/api/v1/inbox/conversations/${toValue(id)}/notes`, { method: 'POST', body, schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

export function useRetryInboxMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const refresh = useRefreshConversation(conversationId)
  return useMutation({
    mutationFn: (messageId: number) => $api(`/api/v1/inbox/messages/${messageId}/retry`, { method: 'POST', schema: InboxMessageSchema }),
    onSuccess: refresh,
  })
}

/** Assign, move, close, prioritise or tag a conversation; the response replaces the cached detail. */
export function usePatchInboxConversation(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxConversationPatch) => $api(`/api/v1/inbox/conversations/${toValue(id)}`, { method: 'PATCH', body, schema: InboxConversationDetailSchema }),
    onSuccess: async (detail) => {
      qc.setQueryData(inboxKeys.detail(detail.id), detail)
      await qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] })
    },
  })
}

export function usePatchInboxContact(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxContactPatch) => $api(`/api/v1/inbox/contacts/${toValue(id)}`, { method: 'PATCH', body, schema: InboxContactSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  })
}
