<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'
import EmptyState from '@/components/shared/EmptyState.vue'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageHistory from '@/components/chat/MessageHistory.vue'
import MessageComposer from '@/components/chat/MessageComposer.vue'
import { ApiError } from '@/composables/useApi'
import { applyChatAccessFailure, chatKeys } from '@/composables/useChat'
import { initialsFor, isFatalChatStatus, parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'

const props = defineProps<{ conversationId?: number }>()
const { t } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const qc = useQueryClient()
const isDesktop = useMediaQuery('(min-width: 761px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const { data, error } = useChatConversation(() => props.conversationId)
const denied = ref(false)
const pendingBody = ref('')
const showList = computed(() => !isDesktop.value && !props.conversationId)
const showConversation = computed(() => isDesktop.value || Boolean(props.conversationId))
const listQuery = computed(() => serializeChatListRoute(routeState.value))
const composerOpen = computed(() => Boolean(props.conversationId) && !denied.value)

watch(() => props.conversationId, () => {
  denied.value = false
  pendingBody.value = ''
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
  <SharedPageContainer width="list" class="flex min-h-[calc(100vh-7rem)] flex-col">
    <SharedPageHeader v-if="!props.conversationId" :title="t('chat.title')" :description="t('chat.description')" />
    <div class="nasq-panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConversationList v-if="showList" :route-state="routeState" :selected-id="props.conversationId" @update:route-state="updateRoute" @denied="onDenied" />
      <section v-if="showConversation" class="flex min-h-0 flex-col" data-testid="chat-thread">
        <header v-if="props.conversationId && !denied" class="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div class="flex min-w-0 items-center gap-3 text-start">
            <NuxtLink v-if="!isDesktop" :to="{ path: '/chat', query: listQuery }" class="text-sm text-muted-foreground">{{ t('app.back') }}</NuxtLink>
            <span class="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{{ initialsFor(data?.name || '') }}</span>
            <div class="min-w-0">
              <h1 class="truncate text-base font-semibold">{{ data?.name || t('chat.title') }}</h1>
              <p v-if="data?.type" class="text-xs text-muted-foreground">{{ t(`chat.${data.type}`) }}</p>
            </div>
          </div>
          <NuxtLink :to="{ path: `/chat/${props.conversationId}/info`, query: listQuery }">
            <Button variant="outline" size="sm" :disabled="!hydrated">{{ t('chat.info') }}</Button>
          </NuxtLink>
        </header>
        <template v-if="props.conversationId && !denied">
          <MessageHistory :conversation-id="props.conversationId" :pending-body="pendingBody" @denied="onDenied" />
          <MessageComposer v-if="composerOpen" :conversation-id="props.conversationId" @update:pending="pendingBody = $event" />
        </template>
        <EmptyState v-else-if="denied" :title="t('chat.unavailable')" />
        <EmptyState v-else :title="t('chat.select')" />
      </section>
    </div>
  </SharedPageContainer>
</template>
