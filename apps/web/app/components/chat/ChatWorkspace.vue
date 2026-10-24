<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'
import EmptyState from '@webvue/ui/app/components/shared/feedback/EmptyState.vue'
import ChatInfoPanel from '@/components/chat/ChatInfoPanel.vue'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageHistory from '@/components/chat/MessageHistory.vue'
import MessageComposer from '@/components/chat/MessageComposer.vue'
import { ApiError } from '@/composables/useApi'
import { applyChatAccessFailure, chatKeys } from '@/composables/useChat'
import { chatTypingEvent } from '@/composables/useBus'
import { isFatalChatStatus, parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'
import type { ChatMessage } from '@webvue/contracts'

// The conversation screen on SharedConversationLayout. From 768px the list is the shell's context-sidebar panel
// (ChatSidebarPanel); below it the list, the thread and the info panel replace one another. The info panel is the URL
// /chat/<id>/info, so a direct link, a refresh and Back all work.
const props = defineProps<{ conversationId?: number; infoOpen?: boolean }>()
const { t } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const qc = useQueryClient()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const { data, error } = useChatConversation(() => props.conversationId)
const { data: conversations } = useChatConversations(() => routeState.value)
// True once any conversation exists or a filter/search is active, so «no conversations yet» only shows for a truly empty inbox.
const hasConversations = computed(() => (conversations.value?.total ?? 0) > 0 || routeState.value.q !== '' || routeState.value.filter !== 'all')
const denied = ref(false)
const pendingBody = ref('')
const replyTo = ref<ChatMessage | null>(null)
// Keep the draft owned by the conversation while its thread is hidden behind info.
const draft = ref('')
const mentionIds = ref<number[]>([])
const messageQuery = ref('')
const showMessageSearch = ref(false)
function toggleMessageSearch() {
  showMessageSearch.value = !showMessageSearch.value
  if (!showMessageSearch.value) messageQuery.value = ''
}
const listQuery = computed(() => serializeChatListRoute(routeState.value))
const composerOpen = computed(() => Boolean(props.conversationId) && !denied.value)
const infoOpen = computed(() => Boolean(props.infoOpen) && composerOpen.value)
const threadTo = computed(() => ({ path: `/chat/${props.conversationId}`, query: listQuery.value }))
const infoTo = computed(() => ({ path: `/chat/${props.conversationId}/info`, query: listQuery.value }))
// Escape leaves the open info panel for the thread, as it leaves a record page for its list.
useEscapeBack(() => (infoOpen.value ? threadTo.value : undefined))

const typingLabel = computed(() => {
  const event = chatTypingEvent.value
  if (!props.conversationId || !event?.isTyping) return ''
  if (event.conversationId !== props.conversationId || event.userId === me.value?.id) return ''
  return t('chat.typing', { name: event.userName || data.value?.name || '' })
})

watch(() => props.conversationId, () => {
  denied.value = false
  pendingBody.value = ''
  replyTo.value = null
  draft.value = ''
  mentionIds.value = []
  messageQuery.value = ''
  showMessageSearch.value = false
  qc.cancelQueries({ queryKey: chatKeys.root(me.value?.id) })
})

watch(error, (value) => {
  if (value instanceof ApiError && isFatalChatStatus(value.status)) {
    denied.value = true
    pendingBody.value = ''
    applyChatAccessFailure(qc, me.value?.id, value)
  }
})

function onDenied() {
  denied.value = true
  pendingBody.value = ''
  applyChatAccessFailure(qc, me.value?.id, new ApiError(403, 'forbidden', 'forbidden'))
}

function updateRoute(next: ChatListRoute) {
  // Keep the selected conversation while updating its list filters.
  void router.replace({ path: route.path, query: serializeChatListRoute(next) })
}
</script>

<template>
  <SharedConversationLayout :has-selection="Boolean(props.conversationId)" :info-open="infoOpen">
    <template #list>
      <ConversationList page-heading :route-state="routeState" :selected-id="props.conversationId" @update:route-state="updateRoute" @denied="onDenied" />
    </template>

    <template v-if="composerOpen" #header>
      <header class="webvue-chat-thread-header" data-testid="chat-thread-header">
        <UTooltip v-if="!isDesktop" :text="t('app.back')">
          <UButton color="neutral" variant="ghost" square :to="{ path: '/chat', query: listQuery }" :aria-label="t('app.back')">
            <UIcon name="i-lucide-arrow-left" class="size-5 rtl:rotate-180" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UAvatar v-bind="avatarProps(data?.name, props.conversationId)" size="lg" class="shrink-0" />
        <div class="min-w-0 flex-1 text-start">
          <h1 class="truncate text-lg font-semibold text-highlighted">{{ data?.name || t('chat.title') }}</h1>
          <p class="truncate text-xs text-muted">{{ typingLabel || (data?.type ? t(`chat.${data.type}`) : '') }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <UTooltip :text="t('chat.searchMessages')">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-search"
              :aria-pressed="showMessageSearch"
              :aria-label="t('chat.searchMessages')"
              :disabled="!hydrated"
              @click="toggleMessageSearch"
            />
          </UTooltip>
          <UTooltip :text="t('chat.info')">
            <UButton
              color="neutral"
              :variant="infoOpen ? 'soft' : 'ghost'"
              square
              :to="infoOpen ? threadTo : infoTo"
              :aria-pressed="infoOpen"
              :aria-label="t('chat.info')"
            >
              <UIcon name="i-lucide-info" class="size-5" aria-hidden="true" />
            </UButton>
          </UTooltip>
        </div>
        <UInput v-if="showMessageSearch" v-model="messageQuery" class="webvue-chat-thread-search" icon="i-lucide-search" :placeholder="t('chat.searchMessages')" :disabled="!hydrated" />
      </header>
    </template>

    <template #thread>
      <div class="flex min-h-0 flex-1 flex-col" data-testid="chat-thread">
        <MessageHistory
          v-if="composerOpen"
          :conversation-id="props.conversationId!"
          :pending-body="pendingBody"
          :peer-seen-message-id="data?.peer_seen_message_id"
          :direct="data?.type === 'direct'"
          :q="messageQuery"
          @denied="onDenied"
          @reply="replyTo = $event"
        />
        <template v-else>
          <!-- The one page heading when no thread header is shown. -->
          <h1 class="sr-only">{{ t('chat.title') }}</h1>
          <EmptyState :title="t('chat.unavailable')" />
        </template>
      </div>
    </template>

    <template v-if="composerOpen" #composer>
      <MessageComposer
        v-model:draft="draft"
        v-model:mention-ids="mentionIds"
        :conversation-id="props.conversationId!"
        :reply-to="replyTo"
        @update:pending="pendingBody = $event"
        @clear-reply="replyTo = null"
      />
    </template>

    <template #info="{ headingLevel }">
      <header class="webvue-chat-thread-header">
        <UTooltip :text="t('app.back')">
          <UButton color="neutral" variant="ghost" square :to="threadTo" :aria-label="t('app.back')">
            <UIcon name="i-lucide-x" class="size-5" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <component :is="headingLevel" class="min-w-0 flex-1 truncate text-base font-semibold text-highlighted">{{ t('chat.info') }}</component>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <ChatInfoPanel v-if="props.conversationId" :conversation-id="props.conversationId" />
      </div>
    </template>

    <template #empty>
      <div class="grid w-full max-w-md place-items-center">
        <!-- The one page heading when no thread is open. -->
        <h1 class="sr-only">{{ t('chat.title') }}</h1>
        <!-- The one empty state: the list beside it stays quiet when there are no conversations at all. -->
        <EmptyState
          class="w-full"
          :title="hasConversations ? t('chat.select') : t('chat.empty')"
          :description="hasConversations ? t('chat.description') : t('chat.emptyDescription')"
        >
          <template #icon>
            <UIcon name="i-lucide-messages-square" class="size-8" />
          </template>
          <template #action>
            <UButton :to="{ path: '/chat/new', query: listQuery }" icon="i-lucide-message-square-plus" :label="t('chat.start')" />
          </template>
        </EmptyState>
      </div>
    </template>
  </SharedConversationLayout>
</template>
