<script setup lang="ts">
import { ArrowLeft, Info, Search } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'
import EmptyState from '@/components/shared/EmptyState.vue'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageHistory from '@/components/chat/MessageHistory.vue'
import MessageComposer from '@/components/chat/MessageComposer.vue'
import { ApiError } from '@/composables/useApi'
import { applyChatAccessFailure, chatKeys } from '@/composables/useChat'
import { chatTypingEvent } from '@/composables/useBus'
import { initialsFor, isFatalChatStatus, parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'
import type { ChatMessage } from '@nasq/contracts'

const props = defineProps<{ conversationId?: number }>()
const { t } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const qc = useQueryClient()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const { data, error } = useChatConversation(() => props.conversationId)
const denied = ref(false)
const pendingBody = ref('')
const replyTo = ref<ChatMessage | null>(null)
const messageQuery = ref('')
const showMessageSearch = ref(false)
function toggleMessageSearch() {
  showMessageSearch.value = !showMessageSearch.value
  if (!showMessageSearch.value) messageQuery.value = ''
}
const showList = computed(() => !isDesktop.value && !props.conversationId)
const showConversation = computed(() => isDesktop.value || Boolean(props.conversationId))
const listQuery = computed(() => serializeChatListRoute(routeState.value))
const composerOpen = computed(() => Boolean(props.conversationId) && !denied.value)

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
  void router.replace({ path: route.path, query: serializeChatListRoute(next) })
}
</script>

<template>
  <SharedPageContainer width="list" class="nasq-chat-workspace flex min-h-0 flex-col">
    <div class="nasq-chat-pane flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConversationList v-if="showList" page-heading :route-state="routeState" :selected-id="props.conversationId" @update:route-state="updateRoute" @denied="onDenied" />
      <section v-if="showConversation" class="nasq-chat-thread flex min-h-0 flex-1 flex-col" data-testid="chat-thread">
        <header v-if="props.conversationId && !denied" class="nasq-chat-thread-header">
          <UButton color="neutral" variant="ghost" square
            v-if="!isDesktop"
            :to="{ path: '/chat', query: listQuery }"
            :aria-label="t('app.back')"
            :title="t('app.back')"
          >
            <ArrowLeft class="size-5 rtl:rotate-180" aria-hidden="true" />
          </UButton>
          <span class="nasq-chat-avatar shrink-0">{{ initialsFor(data?.name || '') }}</span>
          <div class="min-w-0 flex-1 text-start">
            <h1 class="truncate text-base font-semibold">{{ data?.name || t('chat.title') }}</h1>
            <p class="truncate text-xs text-muted-foreground">{{ typingLabel || (data?.type ? t(`chat.${data.type}`) : '') }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              square
                :aria-pressed="showMessageSearch"
              :aria-label="t('chat.searchMessages')"
              :title="t('chat.searchMessages')"
              :disabled="!hydrated"
              @click="toggleMessageSearch"
              icon="i-lucide-search"
            />
            <UButton color="neutral" variant="ghost" square
                :to="{ path: `/chat/${props.conversationId}/info`, query: listQuery }"
              :aria-label="t('chat.info')"
              :title="t('chat.info')"
            >
              <Info class="size-5" aria-hidden="true" />
            </UButton>
          </div>
          <UInput
            v-if="showMessageSearch"
            v-model="messageQuery"
            class="nasq-chat-thread-search"
            icon="i-lucide-search"
            :placeholder="t('chat.searchMessages')"
            :disabled="!hydrated"
          />
        </header>
        <template v-if="props.conversationId && !denied">
          <MessageHistory
            :conversation-id="props.conversationId"
            :pending-body="pendingBody"
            :peer-seen-message-id="data?.peer_seen_message_id"
            :direct="data?.type === 'direct'"
            :q="messageQuery"
            @denied="onDenied"
            @reply="replyTo = $event"
          />
          <MessageComposer
            v-if="composerOpen"
            :conversation-id="props.conversationId"
            :reply-to="replyTo"
            @update:pending="pendingBody = $event"
            @clear-reply="replyTo = null"
          />
        </template>
        <template v-else-if="denied">
          <h1 class="sr-only">{{ t('chat.title') }}</h1>
          <EmptyState :title="t('chat.unavailable')" />
        </template>
        <template v-else>
          <h1 class="sr-only">{{ t('chat.title') }}</h1>
          <EmptyState :title="t('chat.select')" :description="t('chat.description')" />
        </template>
      </section>
    </div>
  </SharedPageContainer>
</template>
