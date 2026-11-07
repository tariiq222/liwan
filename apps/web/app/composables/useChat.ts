import { useMutation, useQuery, useQueryClient, type MutateOptions } from '@tanstack/vue-query'
import {
  ChatAttachmentListSchema,
  ChatConversationListSchema,
  ChatConversationSchema,
  ChatMemberListSchema,
  ChatMessageDeleteResultSchema,
  ChatMessageListSchema,
  ChatMessageSchema,
  ChatRecipientListSchema,
  type ChatConversation,
  type ChatConversationCreate,
  type ChatConversationPatch,
  type ChatMemberChange,
  type ChatMessagePin,
  type ChatMessageReactionWrite,
  type ChatMessageSend,
  type ChatMessageUpdate,
} from '@liwan/contracts'
import { hasFeature } from '../modules/registry'
import { ApiError } from './useApi'
import { useBus } from './useBus'
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
  messages: (userId: number | undefined, id: number, cursor?: { before?: number; after?: number; q?: string }) => [...chatCacheScope(userId), 'messages', id, cursor ?? {}] as const,
  members: (userId: number | undefined, id: number, offset = 0) => [...chatCacheScope(userId), 'members', id, offset] as const,
  attachments: (userId: number | undefined, id: number, offset = 0) => [...chatCacheScope(userId), 'attachments', id, offset] as const,
  recipients: (userId: number | undefined, q: string, offset = 0) => [...chatCacheScope(userId), 'recipients', q, offset] as const,
}

function currentUserId() {
  const { me } = useMe()
  return computed(() => me.value?.id)
}

/**
 * Whether this tenant may still write to chat. A read-only tenant (an expired subscription, or
 * `chat.enabled` kept only as a retained read feature) answers every write route with a 403, so the
 * composer and the message actions must not be offered at all.
 */
export function useChatWritable() {
  const { me } = useMe()
  return computed(() => hasFeature(me.value, 'chat.enabled', true))
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
  const { connected } = useBus()
  return {
    retry: false as const,
    staleTime: 0,
    refetchIntervalInBackground: false as const,
    refetchInterval: (query: { state: { error: unknown } }) => {
      const fallback = chatPollInterval(errorStatus(query.state.error))
      return fallback && connected.value ? 30_000 : fallback
    },
  }
}

export function useChatConversations(route: MaybeRefOrGetter<ChatListRoute>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.list(userId.value, toValue(route))),
    queryFn: ({ queryKey, signal }) => $api('/api/v1/chat/conversations', {
      signal,
      query: queryKey[3],
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
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/chat/conversations/${queryKey[3]}`, { signal, schema: ChatConversationSchema }),
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
    queryKey: computed(() => chatKeys.messages(userId.value, toValue(id) || 0, { ...toValue(cursor), q: toValue(q) || undefined })),
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/chat/conversations/${queryKey[3]}/messages`, {
      signal,
      query: { limit: CHAT_PAGE_SIZE, ...queryKey[4] },
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
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/chat/conversations/${queryKey[3]}/members`, {
      signal,
      query: { limit: CHAT_PAGE_SIZE, offset: queryKey[4] },
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
    queryFn: ({ queryKey, signal }) => $api(`/api/v1/chat/conversations/${queryKey[3]}/attachments`, {
      signal,
      query: { limit: CHAT_PAGE_SIZE, offset: queryKey[4] },
      schema: ChatAttachmentListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value) && Boolean(toValue(id))),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

export function useChatRecipients(q: MaybeRefOrGetter<string>, offset: MaybeRefOrGetter<number> = 0, active: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useQuery({
    ...chatQueryBase(),
    queryKey: computed(() => chatKeys.recipients(userId.value, toValue(q), toValue(offset))),
    queryFn: ({ queryKey, signal }) => $api('/api/v1/chat/recipients', {
      signal,
      query: { q: queryKey[3] || undefined, limit: CHAT_PAGE_SIZE, offset: queryKey[4] },
      schema: ChatRecipientListSchema,
    }),
    enabled: computed(() => import.meta.client && Boolean(userId.value) && toValue(active)),
    throwOnError: (error) => {
      applyChatAccessFailure(qc, userId.value, error)
      return false
    },
  })
}

function invalidateChatConversation(qc: ReturnType<typeof useQueryClient>, userId: number | undefined, id: number) {
  return qc.invalidateQueries({ queryKey: chatKeys.root(userId), predicate: q => q.queryKey[2] === 'list' || q.queryKey[3] === id }, { cancelRefetch: false })
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...chatKeys.root(userId.value), 'list'] }),
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(id)),
  })
}

export function useMarkChatRead(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  const { me } = useMe()
  const { t } = useI18n()
  const identity = () => me.value ? `${me.value.company.id}:${me.value.id}` : 'anonymous'
  type CapturedRead = { conversationId: number; messageId: number; owner: string }
  const mutation = useMutation({
    retry: false,
    onMutate: (input: CapturedRead) => input.owner,
    mutationFn: ({ conversationId, messageId, owner }: CapturedRead) => {
      if (owner !== identity()) throw new ApiError(409, 'identity_changed', t('errors.generic'))
      return $api(`/api/v1/chat/conversations/${conversationId}/read`, {
        method: 'POST', body: { message_id: messageId }, schema: ChatConversationSchema,
      })
    },
    onSuccess: (detail, _input, owner) => {
      if (owner !== identity()) return
      qc.setQueryData(chatKeys.detail(userId.value, detail.id), detail)
      void qc.invalidateQueries({ queryKey: [...chatKeys.root(userId.value), 'list'] }, { cancelRefetch: false })
    },
  })
  const capture = (messageId: number): CapturedRead => ({ conversationId: toValue(id), messageId, owner: identity() })
  // Keep the public scalar message-id API while snapshotting before native mutation scheduling.
  type Callbacks = MutateOptions<ChatConversation, Error, number, string>
  const capturedCallbacks = (options?: Callbacks): MutateOptions<ChatConversation, Error, CapturedRead, string> | undefined => options && ({
    onSuccess: (detail, input, result, context) => options.onSuccess?.(detail, input.messageId, result, context),
    onError: (error, input, result, context) => options.onError?.(error, input.messageId, result, context),
    onSettled: (detail, error, input, result, context) => options.onSettled?.(detail, error, input.messageId, result, context),
  })
  return {
    ...mutation,
    variables: computed(() => mutation.variables.value?.messageId),
    mutate: (messageId: number, options?: Callbacks) => mutation.mutate(capture(messageId), capturedCallbacks(options)),
    mutateAsync: (messageId: number, options?: Callbacks) => mutation.mutateAsync(capture(messageId), capturedCallbacks(options)),
  }
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(id)),
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(id)),
  })
}

export function useRemoveChatMember(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (memberId: number) => $api(`/api/v1/chat/conversations/${toValue(id)}/members/${memberId}`, {
      method: 'DELETE', schema: ChatConversationSchema,
    }),
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(id)),
  })
}

export function useLeaveConversation(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: () => $api(`/api/v1/chat/conversations/${toValue(id)}/leave`, { method: 'POST' }),
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(id)),
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(conversationId)),
  })
}

/** Delete a message the caller wrote: the company decides whether its row stays cleared or goes (see the chat settings). */
export function useDeleteChatMessage(conversationId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const userId = currentUserId()
  return useMutation({
    retry: false,
    mutationFn: (messageId: number) => $api(
      `/api/v1/chat/conversations/${toValue(conversationId)}/messages/${messageId}`,
      { method: 'DELETE', schema: ChatMessageDeleteResultSchema },
    ),
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(conversationId)),
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(conversationId)),
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(conversationId)),
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
    onSuccess: () => invalidateChatConversation(qc, userId.value, toValue(conversationId)),
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
