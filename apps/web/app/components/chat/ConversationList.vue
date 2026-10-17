<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import EmptyState from '@webvue/ui/app/components/shared/feedback/EmptyState.vue'
import { ApiError } from '@/composables/useApi'
import { formatTime } from '@webvue/ui/app/utils/formatDate'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'
import { CHAT_PAGE_SIZE, isFatalChatStatus, nextListOffset, serializeChatListRoute, type ChatFilter, type ChatListRoute } from '@/utils/chatState'

const props = defineProps<{
  routeState: ChatListRoute
  selectedId?: number
  pageHeading?: boolean
}>()
const emit = defineEmits<{ 'update:routeState': [ChatListRoute]; denied: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { data, isLoading, isError, refetch, error } = useChatConversations(() => props.routeState)
const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const noConversations = computed(() => hydrated.value && !isLoading.value && !isError.value && !items.value.length && !props.routeState.q && props.routeState.filter === 'all')
const showStartEmpty = computed(() => noConversations.value && !isDesktop.value)
const quietEmpty = computed(() => noConversations.value && isDesktop.value)
const q = ref(props.routeState.q)
const timeFmt = { format: (value: Date) => formatTime(value) }
const listQuery = computed(() => serializeChatListRoute(props.routeState))
watch(() => props.routeState.q, value => { q.value = value })
watch(error, (value) => {
  if (value instanceof ApiError && isFatalChatStatus(value.status)) emit('denied')
})

function setFilter(filter: ChatListRoute['filter']) {
  emit('update:routeState', { ...props.routeState, filter, offset: 0 })
}
function applySearch() {
  emit('update:routeState', { ...props.routeState, q: q.value, offset: 0 })
}
const filterItems = computed(() => [
  { value: 'all', label: t('chat.filterAll') },
  { value: 'unread', label: t('chat.filterUnread') },
  { value: 'groups', label: t('chat.filterGroups') },
  { value: 'channels', label: t('chat.filterChannels') },
  { value: 'starred', label: t('chat.filterStarred') },
])
const currentPage = computed(() => Math.floor(props.routeState.offset / CHAT_PAGE_SIZE) + 1)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / CHAT_PAGE_SIZE)))
function goToPage(next: number) {
  if (!hydrated.value) return
  emit('update:routeState', { ...props.routeState, offset: nextListOffset(0, total.value, (next - 1) * CHAT_PAGE_SIZE) })
}
function conversationTo(id: number) {
  return { path: `/chat/${id}`, query: listQuery.value }
}
</script>

<template>
  <section class="webvue-chat-list flex h-full min-h-0 flex-col" data-testid="chat-list">
    <h1 v-if="props.pageHeading" class="px-3 pt-3 text-lg font-semibold text-highlighted">{{ t('chat.title') }}</h1>
    <header class="webvue-chat-list-toolbar">
      <form class="webvue-chat-list-search" @submit.prevent="applySearch">
        <UInput
          id="chat-list-search"
          v-model="q"
          class="w-full"
          icon="i-lucide-search"
          :placeholder="t('chat.search')"
          :disabled="!hydrated"
        />
      </form>
      <div class="flex shrink-0 items-center gap-1">
        <UTooltip :text="t('chat.new')">
          <UButton
            color="neutral" variant="ghost" square
            :to="{ path: '/chat/new', query: listQuery }"
            :aria-label="t('chat.new')"
          >
            <UIcon name="i-lucide-message-square-plus" class="size-5" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UTooltip :text="t('chat.newGroup')">
          <UButton
            color="neutral" variant="ghost" square
            :to="{ path: '/chat/new', query: { ...listQuery, kind: 'group' } }"
            :aria-label="t('chat.newGroup')"
          >
            <UIcon name="i-lucide-users-round" class="size-5" aria-hidden="true" />
          </UButton>
        </UTooltip>
      </div>
    </header>
    <div class="webvue-chat-list-filters">
      <SharedSegmentedControl
        :model-value="props.routeState.filter"
        :items="filterItems"
        :label="t('chat.filters')"
        @update:model-value="setFilter($event as ChatFilter)"
      />
    </div>
    <!-- With no conversations at all, the thread column carries the single empty state (with its start action); below 768px the list is the only column, so it carries it. -->
    <EmptyState v-if="showStartEmpty" class="m-4" :title="t('chat.empty')" :description="t('chat.emptyDescription')">
      <template #action>
        <UButton :to="{ path: '/chat/new', query: listQuery }" icon="i-lucide-message-square-plus" :label="t('chat.start')" />
      </template>
    </EmptyState>
    <div v-else-if="quietEmpty" class="flex-1" />
    <SharedPageState
      v-else
      :loading="isLoading || !hydrated"
      :error="isError ? error : undefined"
      :empty="!items.length"
      :empty-text="t('chat.emptyFiltered')"
      @retry="refetch()"
    >
      <ul class="min-h-0 flex-1 overflow-y-auto">
        <li v-for="item in items" :key="item.id">
          <NuxtLink
            :to="conversationTo(item.id)"
            class="webvue-chat-conversation-link"
            :data-selected="props.selectedId === item.id"
            :aria-current="props.selectedId === item.id ? 'page' : undefined"
          >
            <span class="relative shrink-0">
              <UAvatar v-bind="avatarProps(item.name, item.id)" size="xl" />
              <span
                v-if="item.type === 'direct' && item.im_status"
                class="absolute end-0 bottom-0 z-10 size-3 rounded-full border-2 border-(--ui-bg)"
                :class="item.im_status === 'online' ? 'webvue-status-dot-success' : 'bg-(--ui-text-dimmed)'"
                :title="item.im_status === 'online' ? t('chat.online') : t('chat.offline')"
              />
              <span v-else-if="item.type !== 'direct'" class="webvue-chat-avatar-badge" :title="t(`chat.${item.type}`)">
                <UIcon name="i-lucide-users-round" class="size-3" aria-hidden="true" />
              </span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-2">
                <span class="truncate font-medium">{{ item.name }}{{ item.muted ? ` · ${t('chat.muted')}` : '' }}</span>
                <time v-if="item.last_message_at" class="webvue-chat-list-time" :class="{ 'text-brand-link': item.unread_count }">{{ timeFmt.format(new Date(item.last_message_at)) }}</time>
              </span>
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-sm text-muted">{{ item.last_message_preview || t(`chat.${item.type}`) }}</span>
                <UBadge v-if="item.unread_count" size="xs" variant="solid">{{ item.unread_count }}</UBadge>
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </SharedPageState>
    <SharedPagination class="border-t border-default p-2" :page="currentPage" :pages="pageCount" @update:page="goToPage" />
  </section>
</template>
