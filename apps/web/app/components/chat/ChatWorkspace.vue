<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import EmptyState from '@liwan/ui/app/components/shared/feedback/EmptyState.vue'
import ChatInfoPanel from '@/components/chat/ChatInfoPanel.vue'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageHistory from '@/components/chat/MessageHistory.vue'
import MessageComposer from '@/components/chat/MessageComposer.vue'
import { ApiError } from '@/composables/useApi'
import { applyChatAccessFailure, chatKeys, useChatWritable } from '@/composables/useChat'
import { chatTypists } from '@/composables/useBus'
import { chatDrafts } from '@/utils/chatDrafts'
import { isFatalChatStatus, parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'
import { avatarProps } from '@liwan/ui/app/utils/avatarTone'
import type { ChatMessage } from '@liwan/contracts'

// The chat page: the page header, then one 24px frame with the conversation list on the inline-start (360px) and the
// thread beside it. Below 768px the list, the thread and the info panel replace one another; an open info panel sits
// beside the thread from 1280px and replaces it below that. The info panel is the URL /chat/<id>/info, so a direct link,
// a refresh and Back all work.
const props = defineProps<{ conversationId?: number; infoOpen?: boolean }>()
const { t, locale } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const qc = useQueryClient()
const routeState = computed(() => parseChatListRoute(route.query))
const { data, error } = useChatConversation(() => props.conversationId)
const { data: conversations } = useChatConversations(() => routeState.value)
// True once any conversation exists or a filter/search is active, so «no conversations yet» only shows for a truly empty inbox.
const hasConversations = computed(() => (conversations.value?.total ?? 0) > 0 || routeState.value.q !== '' || routeState.value.filter !== 'all')
const writable = useChatWritable()
const denied = ref(false)
const deniedStatus = ref(404)
const pendingBody = ref('')
const replyTo = ref<ChatMessage | null>(null)
// Keep the draft owned by the conversation while its thread is hidden behind info. The text is also kept per
// conversation in sessionStorage, so leaving a conversation and coming back restores it; a successful send clears it.
const draft = ref('')
const messageQuery = ref('')
const showMessageSearch = ref(false)
function toggleMessageSearch() {
  showMessageSearch.value = !showMessageSearch.value
  if (!showMessageSearch.value) messageQuery.value = ''
}
const listQuery = computed(() => serializeChatListRoute(routeState.value))
const composerOpen = computed(() => Boolean(props.conversationId) && !denied.value)
const infoOpen = computed(() => Boolean(props.infoOpen) && composerOpen.value)
const hasSelection = computed(() => Boolean(props.conversationId))
const threadTo = computed(() => ({ path: `/chat/${props.conversationId}`, query: listQuery.value }))
const infoTo = computed(() => ({ path: `/chat/${props.conversationId}/info`, query: listQuery.value }))
// Escape leaves the open info panel for the thread, as it leaves a record page for its list.
useEscapeBack(() => (infoOpen.value ? threadTo.value : undefined))

// Only the people typing in the open channel, never the reader; one or several are named in the user's language.
const typingLabel = computed(() => {
  if (!props.conversationId) return ''
  const names = chatTypists.value
    .filter(entry => entry.conversationId === props.conversationId && entry.userId !== me.value?.id)
    .map(entry => entry.userName || data.value?.name || '')
  if (!names.length) return ''
  const list = new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }).format(names)
  return t(names.length === 1 ? 'chat.typing' : 'chat.typingMany', { name: list })
})

function restoreDraft() {
  draft.value = me.value?.id && props.conversationId ? chatDrafts.get(me.value.id, props.conversationId) : ''
}
// Restored after mount so the server-rendered and first client render agree (storage is client-only).
onMounted(restoreDraft)
watch(draft, (text) => {
  if (hydrated.value && me.value?.id && props.conversationId) chatDrafts.set(me.value.id, props.conversationId, text)
})
watch(() => props.conversationId, (id, previous) => {
  // The old conversation keeps what was typed (the draft watcher stored it); the new one shows its own.
  if (previous && me.value?.id) chatDrafts.set(me.value.id, previous, draft.value)
  restoreDraft()
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
    deniedStatus.value = value.status
    pendingBody.value = ''
    applyChatAccessFailure(qc, me.value?.id, value)
  }
})

function onDenied() {
  denied.value = true
  deniedStatus.value = 403
  pendingBody.value = ''
  applyChatAccessFailure(qc, me.value?.id, new ApiError(403, 'forbidden', 'forbidden'))
}

function updateRoute(next: ChatListRoute) {
  // Keep the selected conversation while updating its list filters.
  void router.replace({ path: route.path, query: serializeChatListRoute(next) })
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('chat.title')" />
    <SharedConversationLayout :has-selection="hasSelection" :info-open="infoOpen">
      <template #list>
        <ConversationList class="min-h-0 flex-1" :route-state="routeState" :selected-id="props.conversationId" @update:route-state="updateRoute" @denied="onDenied" />
      </template>
      <template v-if="composerOpen" #header>
        <header class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-default bg-default px-[18px] py-3" data-testid="chat-thread-header">
          <UTooltip :text="t('app.back')">
            <UButton class="md:hidden" color="neutral" variant="ghost" square :to="{ path: '/chat', query: listQuery }" :aria-label="t('app.back')">
              <UIcon name="i-lucide-arrow-left" class="size-5 rtl:rotate-180" aria-hidden="true" />
            </UButton>
          </UTooltip>
          <UAvatar v-bind="avatarProps(data?.name, props.conversationId)" class="size-10 shrink-0" />
          <div class="min-w-0 flex-1 text-start">
            <h2 class="truncate text-(length:--liwan-fs-conversation-title)/[1.3] font-semibold text-highlighted">{{ data?.name || t('chat.title') }}</h2>
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
          <UInput v-if="showMessageSearch" v-model="messageQuery" class="w-full flex-[1_1_100%]" icon="i-lucide-search" :placeholder="t('chat.searchMessages')" :disabled="!hydrated" />
        </header>
      </template>
      <template #thread>
        <div class="flex min-h-0 flex-1 flex-col" data-testid="chat-thread">
          <MessageHistory
            v-if="composerOpen"
            :conversation-id="props.conversationId!"
            :writable="writable"
            :pending-body="pendingBody"
            :peer-seen-message-id="data?.peer_seen_message_id"
            :direct="data?.type === 'direct'"
            :q="messageQuery"
            @denied="onDenied"
            @reply="replyTo = $event"
          />
          <template v-else>
            <SharedForbiddenState v-if="deniedStatus === 403" :description="t('chat.unavailable')" />
            <SharedNotFoundState v-else class="m-4" :back-to="{ path: '/chat', query: listQuery }" :back-label="t('chat.title')" />
          </template>
        </div>
      </template>
      <template v-if="composerOpen" #composer>
        <MessageComposer
          v-if="writable"
          v-model:draft="draft"
          :conversation-id="props.conversationId!"
          :reply-to="replyTo"
          @update:pending="pendingBody = $event"
          @clear-reply="replyTo = null"
        />
        <!-- A read-only tenant keeps the whole thread readable; every write route would answer 403. -->
        <UAlert
          v-else
          class="m-2"
          color="neutral"
          variant="subtle"
          icon="i-lucide-eye"
          data-testid="chat-read-only"
          :title="t('chat.readOnly')"
          :description="t('chat.readOnlyDescription')"
        />
      </template>
      <template #empty>
        <div class="grid w-full max-w-md place-items-center">
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
      <template #info>
        <header class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-default bg-default px-[18px] py-3">
          <UTooltip :text="t('app.back')">
            <UButton color="neutral" variant="ghost" square :to="threadTo" :aria-label="t('app.back')">
              <UIcon name="i-lucide-x" class="size-5" aria-hidden="true" />
            </UButton>
          </UTooltip>
          <h2 class="min-w-0 flex-1 truncate text-base font-semibold text-highlighted">{{ t('chat.info') }}</h2>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <ChatInfoPanel v-if="props.conversationId" :conversation-id="props.conversationId" />
        </div>
      </template>
    </SharedConversationLayout>
  </SharedPageContainer>
</template>
