<script setup lang="ts">
import { MessageSquarePlus, Search, UsersRound } from '@lucide/vue'
import EmptyState from '@/components/shared/EmptyState.vue'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, initialsFor, isFatalChatStatus, nextListOffset, serializeChatListRoute, type ChatFilter, type ChatListRoute } from '@/utils/chatState'

const props = defineProps<{
  routeState: ChatListRoute
  selectedId?: number
}>()
const emit = defineEmits<{ 'update:routeState': [ChatListRoute]; denied: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { data, isError, isFetching, refetch, error } = useChatConversations(() => props.routeState)
const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const q = ref(props.routeState.q)
const timeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', calendar: 'gregory' }))
const listQuery = computed(() => serializeChatListRoute(props.routeState))
const filters: ChatFilter[] = ['all', 'unread', 'groups', 'channels', 'starred']
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
function filterLabel(filter: ChatFilter) {
  if (filter === 'unread') return t('chat.filterUnread')
  if (filter === 'groups') return t('chat.filterGroups')
  if (filter === 'channels') return t('chat.filterChannels')
  if (filter === 'starred') return t('chat.filterStarred')
  return t('chat.filterAll')
}
function page(delta: number) {
  emit('update:routeState', { ...props.routeState, offset: nextListOffset(props.routeState.offset, total.value, delta) })
}
function conversationTo(id: number) {
  return { path: `/chat/${id}`, query: listQuery.value }
}
</script>

<template>
  <section class="nasq-chat-list flex h-full min-h-0 flex-col" data-testid="chat-list">
    <header class="nasq-chat-list-toolbar">
      <form class="nasq-chat-list-search" @submit.prevent="applySearch">
        <Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          id="chat-list-search"
          v-model="q"
          class="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0"
          :placeholder="t('chat.search')"
          :disabled="!hydrated"
        />
      </form>
      <div class="flex shrink-0 items-center gap-1">
        <NuxtLink
          class="nasq-chat-icon-btn"
          :to="{ path: '/chat/new', query: listQuery }"
          :aria-label="t('chat.new')"
          :title="t('chat.new')"
        >
          <MessageSquarePlus class="size-5" aria-hidden="true" />
        </NuxtLink>
        <NuxtLink
          class="nasq-chat-icon-btn"
          :to="{ path: '/chat/new', query: { ...listQuery, kind: 'group' } }"
          :aria-label="t('chat.newGroup')"
          :title="t('chat.newGroup')"
        >
          <UsersRound class="size-5" aria-hidden="true" />
        </NuxtLink>
      </div>
    </header>
    <div class="nasq-chat-list-filters" role="toolbar" :aria-label="t('chat.filters')">
      <button
        v-for="filter in filters"
        :key="filter"
        type="button"
        class="nasq-chat-filter"
        :data-active="props.routeState.filter === filter"
        :disabled="!hydrated"
        @click="setFilter(filter)"
      >{{ filterLabel(filter) }}</button>
    </div>
    <div v-if="isError" class="grid gap-2 p-4 text-center" role="alert">
      <p class="text-sm text-destructive">{{ t('chat.unavailable') }}</p>
      <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" @click="refetch()">{{ t('app.retry') }}</Button>
    </div>
    <EmptyState v-else-if="!items.length" :title="props.routeState.q || props.routeState.filter !== 'all' ? t('chat.emptyFiltered') : t('chat.empty')" />
    <ul v-else class="min-h-0 flex-1 overflow-y-auto">
      <li v-for="item in items" :key="item.id">
        <NuxtLink
          :to="conversationTo(item.id)"
          class="nasq-chat-conversation-link"
          :data-selected="props.selectedId === item.id"
          :aria-current="props.selectedId === item.id ? 'page' : undefined"
        >
          <span class="relative shrink-0">
            <span class="nasq-chat-avatar">{{ initialsFor(item.name) }}</span>
            <span
              v-if="item.type === 'direct' && item.im_status"
              class="absolute end-0 bottom-0 size-3 rounded-full border-2 border-background"
              :class="item.im_status === 'online' ? 'nasq-status-dot-success' : 'bg-muted-foreground'"
              :title="item.im_status === 'online' ? t('chat.online') : t('chat.offline')"
            />
            <span v-else-if="item.type !== 'direct'" class="nasq-chat-avatar-badge" :title="t(`chat.${item.type}`)">
              <UsersRound class="size-3" aria-hidden="true" />
            </span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center justify-between gap-2">
              <span class="truncate font-medium">{{ item.name }}{{ item.muted ? ` · ${t('chat.muted')}` : '' }}</span>
              <time v-if="item.last_message_at" class="nasq-chat-list-time" :class="{ 'text-primary': item.unread_count }">{{ timeFmt.format(new Date(item.last_message_at)) }}</time>
            </span>
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-sm text-muted-foreground">{{ item.last_message_preview || t(`chat.${item.type}`) }}</span>
              <span v-if="item.unread_count" class="nasq-unread-count rounded-full px-1.5 text-[11px] font-semibold">{{ item.unread_count }}</span>
            </span>
          </span>
        </NuxtLink>
      </li>
    </ul>
    <nav v-if="total > CHAT_PAGE_SIZE" class="flex items-center justify-between gap-2 border-t p-2 text-xs text-muted-foreground">
      <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || props.routeState.offset === 0" @click="page(-CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
      <span>{{ t('chat.pageOf', { page: Math.floor(props.routeState.offset / CHAT_PAGE_SIZE) + 1, pages: Math.max(1, Math.ceil(total / CHAT_PAGE_SIZE)) }) }}</span>
      <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || props.routeState.offset + CHAT_PAGE_SIZE >= total" @click="page(CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
    </nav>
  </section>
</template>
