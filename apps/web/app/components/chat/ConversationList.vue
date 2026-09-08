<script setup lang="ts">
import EmptyState from '@/components/shared/EmptyState.vue'
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
function page(delta: number) {
  emit('update:routeState', { ...props.routeState, offset: nextListOffset(props.routeState.offset, total.value, delta) })
}
function conversationTo(id: number) {
  return { path: `/chat/${id}`, query: serializeChatListRoute(props.routeState) }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" data-testid="chat-list">
    <form class="flex flex-col gap-2 p-3" @submit.prevent="applySearch">
      <Input v-model="q" :placeholder="t('chat.search')" :disabled="!hydrated" />
      <div class="flex flex-wrap gap-2">
        <Button type="button" size="sm" :variant="props.routeState.filter === 'all' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('all')">{{ t('chat.filterAll') }}</Button>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'unread' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('unread')">{{ t('chat.filterUnread') }}</Button>
        <Button type="button" size="sm" :variant="props.routeState.filter === 'groups' ? 'default' : 'outline'" :disabled="!hydrated" @click="setFilter('groups')">{{ t('chat.filterGroups') }}</Button>
      </div>
    </form>
    <div v-if="isError" class="grid gap-2 p-4 text-center" role="alert">
      <p class="text-sm text-destructive">{{ t('chat.unavailable') }}</p>
      <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" @click="refetch()">{{ t('app.retry') }}</Button>
    </div>
    <EmptyState v-else-if="!items.length" :title="props.routeState.q || props.routeState.filter !== 'all' ? t('chat.emptyFiltered') : t('chat.empty')" />
    <ul v-else class="min-h-0 flex-1 overflow-y-auto">
      <li v-for="item in items" :key="item.id">
        <NuxtLink
          :to="conversationTo(item.id)"
          class="flex items-center gap-3 px-3 py-2.5 text-start hover:bg-muted"
          :class="{ 'bg-muted': props.selectedId === item.id }"
          :aria-current="props.selectedId === item.id ? 'page' : undefined"
        >
          <span class="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{{ initialsFor(item.name) }}</span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center justify-between gap-2">
              <span class="truncate font-medium">{{ item.name }}</span>
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
