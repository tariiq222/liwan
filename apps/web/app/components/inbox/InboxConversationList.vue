<script setup lang="ts">
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'
import EmptyState from '@webvue/ui/app/components/shared/feedback/EmptyState.vue'
import { useInboxConversations } from '@/composables/inbox/useInbox'
import { useInboxDepartments } from '@/composables/inbox/useInboxSettings'
import { CONVERSATION_STATES, CONVERSATION_STATE_TONE, inboxListTime } from '@/composables/inbox/inboxPresentation'
import { INBOX_PAGE_SIZE, inboxListQuery, inboxPageOffset, serializeInboxListRoute, type InboxListRoute } from '@/composables/inbox/inboxListRoute'

// The conversation list: filters (assignee, state, department, search) are the URL query, owned by the page that hosts
// this list. The component only reads them and emits the next filter state.
const props = defineProps<{ routeState: InboxListRoute; selectedId?: number; pageHeading?: boolean }>()
const emit = defineEmits<{ 'update:routeState': [InboxListRoute, options?: { replace: boolean }] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const { data, isLoading, isError, error, refetch } = useInboxConversations(() => props.routeState)
const departments = useInboxDepartments()
const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const filtered = computed(() => props.routeState.assignee !== 'all' || !!props.routeState.state || !!props.routeState.departmentId || !!props.routeState.q)
const q = ref(props.routeState.q)
watch(() => props.routeState.q, (value) => { q.value = value })
// Clearing the box resets the results; any other change waits for Enter.
watch(q, (value) => {
  if (!value && props.routeState.q) applySearch()
})

const ALL = 'all'
const scopeItems = computed(() => [
  { value: 'all', label: t('inbox.list.scopeAll') },
  { value: 'me', label: t('inbox.list.scopeMine') },
  { value: 'unassigned', label: t('inbox.list.scopeUnassigned') },
])
const stateItems = computed(() => [
  { value: ALL, label: t('inbox.list.anyState') },
  ...CONVERSATION_STATES.map(value => ({ value, label: t(`inbox.states.${value}`) })),
])
const departmentItems = computed(() => [
  { value: ALL, label: t('inbox.list.anyDepartment') },
  ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })),
])
const showDepartments = computed(() => (departments.data.value?.items.length ?? 0) > 0)

function update(patch: Partial<InboxListRoute>) {
  emit('update:routeState', { ...props.routeState, ...patch, offset: 0 })
}
function applySearch() {
  update({ q: q.value.trim() })
}
const currentPage = computed(() => Math.floor(props.routeState.offset / INBOX_PAGE_SIZE) + 1)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / INBOX_PAGE_SIZE)))
function goToPage(page: number) {
  if (hydrated.value) emit('update:routeState', { ...props.routeState, offset: inboxPageOffset(page, total.value) })
}
// A link whose offset is past the end lands on the last page instead of an empty list; it replaces that entry so Back does not return to it.
watch(() => [data.value?.total, props.routeState.offset] as const, ([count, offset]) => {
  if (count && offset >= count) emit('update:routeState', { ...props.routeState, offset: inboxPageOffset(Math.ceil(count / INBOX_PAGE_SIZE), count) }, { replace: true })
})
const listQuery = computed(() => serializeInboxListRoute(props.routeState))
const conversationTo = (id: number) => ({ path: `/inbox/${id}`, query: listQuery.value })
// The export takes the same filters as the list, without the page window.
const exportHref = computed(() => {
  const { limit: _limit, offset: _offset, ...filters } = inboxListQuery(props.routeState)
  const search = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)])).toString()
  return `/api/v1/inbox/conversations/export.csv${search ? `?${search}` : ''}`
})
const empty = computed(() => hydrated.value && !isLoading.value && !isError.value && !items.value.length)
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" data-testid="inbox-list" :aria-label="t('inbox.list.label')">
    <h1 v-if="props.pageHeading" class="px-3 pt-3 text-lg font-semibold text-highlighted">{{ t('inbox.title') }}</h1>
    <header class="flex flex-none items-center gap-2 px-3 pt-2 pb-1">
      <form class="flex min-w-0 flex-1" @submit.prevent="applySearch">
        <UInput
          id="inbox-list-search"
          v-model="q"
          class="w-full"
          :ui="{ base: 'rounded-full px-9 text-center' }"
          icon="i-lucide-search"
          :placeholder="t('inbox.list.search')"
          :aria-label="t('inbox.list.search')"
          :disabled="!hydrated"
        />
      </form>
      <UTooltip v-if="can('inbox.conversations.export')" :text="t('inbox.list.export')">
        <UButton :href="exportHref" external download color="neutral" variant="ghost" square icon="i-lucide-download" :aria-label="t('inbox.list.export')" data-testid="inbox-export" />
      </UTooltip>
    </header>
    <div class="flex flex-none flex-col gap-2 px-3 pt-0.5 pb-2">
      <SharedSegmentedControl
        class="w-full"
        block
        :model-value="props.routeState.assignee"
        :items="scopeItems"
        :label="t('inbox.list.scope')"
        @update:model-value="update({ assignee: $event as InboxListRoute['assignee'] })"
      />
      <div class="flex gap-2">
        <USelect
          :model-value="props.routeState.state || ALL"
          :items="stateItems"
          class="min-w-0 flex-1"
          :aria-label="t('inbox.list.state')"
          :disabled="!hydrated"
          @update:model-value="update({ state: $event === ALL ? '' : ($event as InboxListRoute['state']) })"
        />
        <USelect
          v-if="showDepartments"
          :model-value="props.routeState.departmentId ? String(props.routeState.departmentId) : ALL"
          :items="departmentItems"
          class="min-w-0 flex-1"
          :aria-label="t('inbox.list.department')"
          :disabled="!hydrated"
          @update:model-value="update({ departmentId: $event === ALL ? null : Number($event) })"
        />
      </div>
    </div>
    <EmptyState v-if="empty && !filtered" class="m-4" :title="t('inbox.list.empty')" :description="t('inbox.list.emptyDescription')">
      <template #icon>
        <UIcon name="i-lucide-inbox" class="size-8" />
      </template>
    </EmptyState>
    <SharedPageState
      v-else
      :loading="isLoading || !hydrated"
      :error="isError ? error : undefined"
      :empty="empty"
      :empty-text="t('inbox.list.emptyFiltered')"
      @retry="refetch()"
    >
      <ul class="min-h-0 flex-1 overflow-y-auto">
        <li v-for="item in items" :key="item.id">
          <NuxtLink
            :to="conversationTo(item.id)"
            class="flex min-h-[72px] items-center gap-3 px-4 py-2 text-start text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-[current=page]:bg-primary/10"
            :aria-current="props.selectedId === item.id ? 'page' : undefined"
            :data-testid="`inbox-conversation-${item.id}`"
          >
            <UAvatar v-bind="avatarProps(item.contact.name, item.contact.id)" size="xl" class="shrink-0" />
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-2">
                <span class="truncate" :class="item.unread ? 'font-semibold' : 'font-medium'">{{ item.contact.name }}</span>
                <time v-if="item.last_message_at" class="shrink-0 text-xs text-muted" :class="{ 'text-brand-link': item.unread }">{{ inboxListTime(item.last_message_at, locale) }}</time>
              </span>
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-sm text-muted">{{ item.last_message_preview || item.contact.phone || t('inbox.list.noMessages') }}</span>
                <span v-if="item.unread" class="size-2.5 shrink-0 rounded-full bg-primary" :title="t('inbox.list.unread')" role="img" :aria-label="t('inbox.list.unread')" />
              </span>
              <span class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                <SharedStatusBadge size="sm" :tone="CONVERSATION_STATE_TONE[item.state]" :label="t(`inbox.states.${item.state}`)" />
                <span class="truncate">{{ item.assignee?.name ?? t('inbox.unassigned') }}</span>
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </SharedPageState>
    <SharedPagination class="border-t border-default p-2" :page="currentPage" :pages="pageCount" @update:page="goToPage" />
  </section>
</template>
