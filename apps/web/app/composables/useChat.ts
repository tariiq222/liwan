import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  ChatAttachmentListSchema,
  ChatConversationListSchema,
  ChatConversationSchema,
  ChatMemberListSchema,
  ChatMessageListSchema,
  ChatMessageSchema,
  ChatRecipientListSchema,
  type ChatConversationCreate,
  type ChatConversationPatch,
  type ChatMemberChange,
  type ChatMessagePin,
  type ChatMessageReactionWrite,
  type ChatMessageSend,
  type ChatMessageUpdate,
} from '@nasq/contracts'
import { ApiError } from './useApi'
import {
  CHAT_PAGE_SIZE,
  chatCacheScope,
  chatListQuery,
  chatPollInterval,
  isFatalChatStatus,
  type ChatListRoute,
} from '../utils/chatState'

export const chatKeys = {
  root: (userId?: number) => chatCacheScope(userId),
  list: (userId: number | undefined, route: ChatListRoute) => [...chatCacheScope(userId), 'list', chatListQuery(route)] as const,
  detail: (userId: number | undefined, id: number) => [...chatCacheScope(userId), 'detail', id] as const,
  messages: (userId: number | undefined, id: number, cursor?: { before?: number; after?: number }) => [...chatCacheScope(userId), 'messages', id, cursor ?? {}] as const,
  members: (userId: number | undefined, id: number, offset = 0) => [...chatCacheScope(userId), 'members', id, offset] as const,
  attachments: (userId: number | undefined, id: number, offset = 0) => [...chatCacheScope(userId), 'attachments', id, offset] as const,
  recipients: (userId: number | undefined, q: string, offset = 0) => [...chatCacheScope(userId), 'recipients', q, offset] as const,
}

function currentUserId() {
  const { me } = useMe()
  return computed(() => me.value?.id)
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined
}

export function applyChatAccessFailure(qc: { removeQueries: (opts: { queryKey: readonly unknown[] }) => void; cancelQueries: (opts: { queryKey: readonly unknown[] }) => void }, userId: number | undefined, error: unknown): boolean {
  if (!isFatalChatStatus(errorStatus(error))) return false
  const key = chatKeys.root(userId)
  qc.cancelQueries({ queryKey: key })
  qc.removeQueries({ queryKey: key })
  return true
}

function chatQueryBase() {
  return {
    retry: false as const,
    staleTime: 0,
    refetchIntervalInBackground: false as const,
    refetchInterval: (query: { state: { error: unknown } }) => chatPollInterval(errorStatus(query.state.error)),
  }
}

export function useChatConversations(route: MaybeRefOrGetter<ChatListRoute>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.list(userId.value, toValue(route))),
    queryFn: () => $api('/api/v1/chat/conversations', {
      query: chatListQuery(toValue(route)),
      schema: ChatConversationListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value)),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useChatConversation(id: MaybeRefOrGetter<number | undefined>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.detail(userId.value, toValue(id) || 0)),
    queryFn: () => $api(`/api/v1/chat/conversations/${toValue(id)}`, { schema: ChatConversationSchema }),
    enabled: computed(() => import.meta.client && Boolean(userId.value) && Boolean(toValue(id))),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useChatMessages(
  id: MaybeRefOrGetter<number | undefined>,
  cursor: MaybeRefOrGetter<{ before?: number; after?: number } | undefined> = {},
  q: MaybeRefOrGetter<string> = '',
) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.messages(userId.value, toValue(id) || 0, { ...toValue(cursor), q: toValue(q) || undefined } as { before?: number; after?: number })),
    queryFn: () => $api(`/api/v1/chat/conversations/${toValue(id)}/messages`, {
      query: { limit: CHAT_PAGE_SIZE, q: toValue(q) || undefined, ...toValue(cursor) },
      schema: ChatMessageListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value) && Boolean(toValue(id))),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useChatMembers(id: MaybeRefOrGetter<number | undefined>, offset: MaybeRefOrGetter<number> = 0) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.members(userId.value, toValue(id) || 0, toValue(offset))),
    queryFn: () => $api(`/api/v1/chat/conversations/${toValue(id)}/members`, {
      query: { limit: CHAT_PAGE_SIZE, offset: toValue(offset) },
      schema: ChatMemberListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value) && Boolean(toValue(id))),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useChatAttachments(id: MaybeRefOrGetter<number | undefined>, offset: MaybeRefOrGetter<number> = 0) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.attachments(userId.value, toValue(id) || 0, toValue(offset))),
    queryFn: () => $api(`/api/v1/chat/conversations/${toValue(id)}/attachments`, {
      query: { limit: CHAT_PAGE_SIZE, offset: toValue(offset) },
      schema: ChatAttachmentListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value) && Boolean(toValue(id))),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useChatRecipients(q: MaybeRefOrGetter<string>, offset: MaybeRefOrGetter<number> = 0) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.recipients(userId.value, toValue(q), toValue(offset))),
    queryFn: () => $api('/api/v1/chat/recipients', {
      query: { q: toValue(q) || undefined, limit: CHAT_PAGE_SIZE, offset: toValue(offset) },
      schema: ChatRecipientListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value)),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useCreateConversation() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (body: ChatConversationCreate) => $api('/api/v1/chat/conversations', {
      method: 'POST',
      body,
      schema: ChatConversationSchema,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useSendChatMessage(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (body: ChatMessageSend) => $api(`/api/v1/chat/conversations/${toValue(id)}/messages`, {
      method: 'POST',
      body,
      schema: ChatMessageSchema,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useMarkChatRead(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (messageId: number) => $api(`/api/v1/chat/conversations/${toValue(id)}/read`, {
      method: 'POST',
      body: { message_id: messageId },
      schema: ChatConversationSchema,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function usePatchConversation(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (body: ChatConversationPatch) => $api(`/api/v1/chat/conversations/${toValue(id)}`, {
      method: 'PATCH', body, schema: ChatConversationSchema,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useAddChatMembers(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (body: ChatMemberChange) => $api(`/api/v1/chat/conversations/${toValue(id)}/members`, {
      method: 'POST', body, schema: ChatConversationSchema,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useRemoveChatMember(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (memberId: number) => $api(`/api/v1/chat/conversations/${toValue(id)}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useLeaveConversation(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: () => $api(`/api/v1/chat/conversations/${toValue(id)}/leave`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function usePatchChatMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: ({ messageId, body }: ChatMessageUpdate & { messageId: number }) => $api(
      `/api/v1/chat/conversations/${toValue(conversationId)}/messages/${messageId}`,
      { method: 'PATCH', body: { body }, schema: ChatMessageSchema },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useReactChatMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: ({ messageId, ...body }: ChatMessageReactionWrite & { messageId: number }) => $api(
      `/api/v1/chat/conversations/${toValue(conversationId)}/messages/${messageId}/reactions`,
      { method: 'POST', body, schema: ChatMessageSchema },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function usePinChatMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: ({ messageId, pinned }: ChatMessagePin & { messageId: number }) => $api(
      `/api/v1/chat/conversations/${toValue(conversationId)}/messages/${messageId}/pin`,
      { method: 'POST', body: { pinned }, schema: ChatMessageSchema },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useStarChatMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (messageId: number) => $api(
      `/api/v1/chat/conversations/${toValue(conversationId)}/messages/${messageId}/star`,
      { method: 'POST', schema: ChatMessageSchema },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.root(userId.value) }),
  })
}

export function useChatTyping(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useMutation({
    retry: false,
    mutationFn: (is_typing: boolean) => $api(`/api/v1/chat/conversations/${toValue(conversationId)}/typing`, {
      method: 'POST', body: { is_typing },
    }),
  })
}
