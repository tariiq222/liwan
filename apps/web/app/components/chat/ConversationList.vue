<script setup lang="ts">
import EmptyState from '@/components/shared/EmptyState.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, initialsFor, isFatalChatStatus, nextListOffset, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'

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
const activeFilterCount = computed(() => Number(Boolean(props.routeState.q.trim())) + Number(props.routeState.filter !== 'all'))
const timeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', calendar: 'gregory' }))
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
function clearFilters() {
  q.value = ''
  emit('update:routeState', { ...props.routeState, q: '', filter: 'all', offset: 0 })
}
function filterLabel(filter: ChatListRoute['filter']) {
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
  return { path: `/chat/${id}`, query: serializeChatListRoute(props.routeState) }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" data-testid="chat-list">
    <div class="min-w-0 shrink-0 p-3">
    <FilterBar
      class="w-full"
      :active-count="activeFilterCount"
      :disabled="!hydrated"
      @clear="clearFilters"
    >
      <template #search>
        <form class="flex min-w-0 flex-col gap-2" @submit.prevent="applySearch">
          <Input v-model="q" :placeholder="t('chat.search')" :disabled="!hydrated" />
        </form>
      </template>
      <template #view>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'all' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('all')">{{ t('chat.filterAll') }}</Button>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'unread' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('unread')">{{ t('chat.filterUnread') }}</Button>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'groups' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('groups')">{{ t('chat.filterGroups') }}</Button>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'channels' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('channels')">{{ t('chat.filterChannels') }}</Button>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'starred' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('starred')">{{ t('chat.filterStarred') }}</Button>
      </template>
      <template #active>
        <Badge v-if="props.routeState.q.trim()" variant="secondary">{{ props.routeState.q }}</Badge>
        <Badge v-if="props.routeState.filter !== 'all'" variant="secondary">{{ filterLabel(props.routeState.filter) }}</Badge>
      </template>
    </FilterBar>
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
            <span class="nasq-chat-avatar grid size-10 place-items-center rounded-full bg-muted text-xs font-semibold">{{ initialsFor(item.name) }}</span>
            <span
              v-if="item.type === 'direct' && item.im_status"
              class="absolute end-0 bottom-0 size-2.5 rounded-full border border-background"
              :class="item.im_status === 'online' ? 'nasq-status-dot-success' : 'bg-muted-foreground'"
              :title="item.im_status === 'online' ? t('chat.online') : t('chat.offline')"
            />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center justify-between gap-2">
              <span class="truncate font-medium">{{ item.name }}{{ item.muted ? ` · ${t('chat.muted')}` : '' }}</span>
              <time v-if="item.last_message_at" class="shrink-0 text-[11px] text-muted-foreground">{{ timeFmt.format(new Date(item.last_message_at)) }}</time>
            </span>
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-sm text-muted-foreground">{{ item.last_message_preview || t(`chat.${item.type}`) }}</span>
              <span v-if="item.unread_count" class="nasq-unread-count rounded-full px-1.5 text-[11px]">{{ item.unread_count }}</span>
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
