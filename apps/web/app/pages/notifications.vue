<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import {
  isDigestNotification,
  isKnownNotification,
  isMeetingNotification,
  isProjectNotification,
  NOTIFICATION_PAGE_SIZE,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsPage,
  type BellNotification,
} from '@/composables/useNotifications'
import { bellKindFor } from '@/modules/surfaces'
import { declaredBellTitle } from '@/utils/bellTitle'
import { formatNotificationTimestamp, genericNotificationText, isUserWrittenNotificationKind, notificationBody } from '@/utils/notificationPresentation'

const { t, locale } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { me } = useMe()
const {
  data,
  isLoading,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  isError: hasQueryError,
  isFetchNextPageError,
  fetchNextPage,
  refetch,
} = useNotificationsPage()
const { mutateAsync: markRead } = useMarkNotificationRead()
const { mutateAsync: markAllRead, isPending: markingAll } = useMarkAllNotificationsRead()
const allItems = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items))
// The filter lives in the URL (?filter=unread|mentions) so refresh and back keep it.
const route = useRoute()
type NotificationFilter = 'all' | 'unread' | 'mentions'
const filter = computed<NotificationFilter>(() => (route.query.filter === 'unread' || route.query.filter === 'mentions' ? route.query.filter : 'all'))
const filters = computed(() => (['all', 'unread', 'mentions'] as const).map(id => ({
  value: id,
  label: t(`notifications.filter${id[0]!.toUpperCase()}${id.slice(1)}`),
})))
const router = useRouter()
function setFilter(id: string) {
  void router.replace({ path: route.path, query: { ...route.query, filter: id === 'all' ? undefined : id } })
}
const items = computed(() => allItems.value.filter((item) => {
  if (filter.value === 'unread') return !item.is_read
  if (filter.value === 'mentions') return item.kind === 'mention'
  return true
}))
// The server list has no mentions/unread parameter, so a narrowed view keeps loading pages until it fills one page or runs out.
watch([filter, hasNextPage, isFetchingNextPage, isFetchNextPageError, () => items.value.length], () => {
  if (filter.value !== 'all' && hasNextPage.value && !isFetchingNextPage.value && !isFetchNextPageError.value && items.value.length < NOTIFICATION_PAGE_SIZE) void fetchNextPage()
})
const emptyText = computed(() => (filter.value !== 'all' && allItems.value.length ? t('notifications.emptyFiltered') : t('notifications.empty')))
const listEl = ref<HTMLElement | null>(null)
useRowNavigation(listEl)
const unreadCount = computed(() => data.value?.pages[0]?.unread_count ?? 0)
const notificationTimeZone = computed(() => me.value?.tz || 'UTC')
const notificationTimestamps = computed(() => new Map(
  items.value.map(item => [item.id, formatNotificationTimestamp(item.created_at, locale.value, notificationTimeZone.value)] as const),
))
const pendingReadId = ref<number | null>(null)
const actionPending = computed(() => pendingReadId.value !== null || markingAll.value)

function kindLabel(item: BellNotification) {
  if (!isKnownNotification(item)) return t('notifications.preview.other')
  if (isDigestNotification(item)) return t('tasks.digest.kind')
  if (item.kind === 'tasks.assigned') return t('notifications.assignment', { task: item.task_name })
  if (isMeetingNotification(item)) return t(`meetingsUi.notify.${item.kind}`)
  if (isProjectNotification(item)) return t(`notifications.preview.${item.kind}`)
  if (isUserWrittenNotificationKind(item.kind)) return t(`notifications.${item.kind}`)
  return t(`notifications.${item.kind}`, { task: item.task_name })
}

function itemTitle(item: BellNotification) {
  if (isDigestNotification(item)) return t('tasks.digest.count', { n: item.overdue_count }, item.overdue_count)
  if (isMeetingNotification(item)) return item.meeting_name
  if (isProjectNotification(item)) return item.project_name
  if (isKnownNotification(item)) return item.task_name
  // A kind an application registers words its own title; the sentence is not the plain name.
  return declaredBellTitle(item, t) ?? genericNotificationText(item).title
}

function itemSecondary(item: BellNotification) {
  if (isKnownNotification(item) || bellKindFor(item.kind)?.title) return ''
  return genericNotificationText(item).secondary
}

function notificationTimestamp(item: BellNotification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

async function openNotification(item: BellNotification) {
  if (actionPending.value) return
  pendingReadId.value = item.id
  try {
    await markRead(item.id)
    if (isDigestNotification(item)) await navigateTo(`/notification-digests/${item.id}`)
    else if (isMeetingNotification(item)) await navigateTo(`/meetings/${item.meeting_id}`)
    else if (isProjectNotification(item)) await navigateTo(`/projects/${item.project_id}/charter`)
    else if (isKnownNotification(item)) await navigateTo(`/tasks/${item.task_id}`)
    else {
      // A kind an application registers in its manifest opens where that application says; an undeclared one only marks read.
      const href = bellKindFor(item.kind)?.href(item)
      if (href) await navigateTo(href)
    }
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    if (pendingReadId.value === item.id) pendingReadId.value = null
  }
}

async function markAll() {
  if (actionPending.value) return
  try {
    await markAllRead()
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}

async function retryNotifications() {
  if (actionPending.value || isFetching.value) return
  await refetch()
}

async function retryNextPage() {
  if (actionPending.value || isFetchingNextPage.value) return
  await fetchNextPage()
}
</script>

<template>
  <SharedListPage data-testid="notification-center" :title="t('notifications.title')">
    <template v-if="hydrated && unreadCount" #actions>
      <UButton
        v-if="hydrated && unreadCount"
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-check-check"
        :disabled="actionPending"
        :label="t('notifications.markAllRead')"
        @click="markAll"
      />
    </template>

    <div v-if="hasQueryError && !allItems.length" class="grid gap-2 py-8 text-center" role="alert" data-testid="notifications-load-error">
      <p class="text-sm text-error">{{ t('notifications.loadError') }}</p>
      <UButton type="button" color="neutral" variant="outline" class="mx-auto" :disabled="!hydrated || isFetching" :label="t('notifications.retry')" @click="retryNotifications" />
    </div>
    <SharedPageState v-else :loading="isLoading && !allItems.length">
      <SharedListCard>
        <template #filters>
          <SharedSegmentedControl
            :model-value="filter"
            :items="filters"
            :label="t('nav.notificationsFilters')"
            data-testid="notification-filters"
            @update:model-value="setFilter"
          />
        </template>
        <ul v-if="items.length" ref="listEl" class="divide-y divide-default">
          <li v-for="item in items" :key="item.id">
            <UButton
              data-shortcut-row
              type="button"
              color="neutral"
              variant="ghost"
              class="grid w-full gap-1 rounded-none px-(--webvue-card-pad-dense) py-3 text-start transition-colors hover:bg-elevated"
              :disabled="!hydrated || actionPending"
              :data-testid="`notification-${item.id}`"
              @click="openNotification(item)"
            >
              <span class="flex items-center gap-2 text-xs font-medium" :class="item.is_read ? 'text-muted' : 'text-highlighted'">
                <span>{{ kindLabel(item) }}</span>
                <span v-if="!item.is_read" class="inline-flex items-center gap-1.5 font-semibold">
                  <!-- The primary fill, never text: the dot marks unread, the word keeps it readable without colour. -->
                  <span class="size-2 shrink-0 rounded-full bg-primary" data-testid="notification-unread-dot" aria-hidden="true" />
                  {{ t('notifications.unread') }}
                </span>
              </span>
              <span v-if="itemTitle(item)" :class="item.is_read ? 'font-medium' : 'font-semibold text-highlighted'">{{ itemTitle(item) }}</span>
              <span v-if="isUserWrittenNotificationKind(item.kind)" class="line-clamp-3 text-sm text-muted">{{ notificationBody(item) }}</span>
              <span v-else-if="itemSecondary(item)" class="line-clamp-3 text-sm text-muted">{{ itemSecondary(item) }}</span>
              <time v-if="notificationTimestamp(item)" class="text-xs text-muted" :datetime="notificationTimestamp(item)?.datetime">{{ notificationTimestamp(item)?.label }}</time>
            </UButton>
          </li>
        </ul>
        <div v-else class="p-4"><SharedEmptyState :title="emptyText" /></div>
        <div v-if="hasQueryError && items.length && !isFetchNextPageError" class="grid gap-2 border-t border-default py-4 text-center" role="alert">
          <p class="text-sm text-error">{{ t('notifications.loadError') }}</p>
          <UButton type="button" color="neutral" variant="outline" class="mx-auto" :disabled="!hydrated || isFetching" :label="t('notifications.retry')" @click="retryNotifications" />
        </div>
        <div v-if="isFetchNextPageError" class="grid gap-2 border-t border-default p-4 text-center" role="alert">
          <p class="text-sm text-error">{{ t('notifications.loadError') }}</p>
          <UButton type="button" color="neutral" variant="outline" class="mx-auto" :disabled="!hydrated || actionPending || isFetchingNextPage" :label="t('notifications.retry')" @click="retryNextPage" />
        </div>
        <template v-if="items.length" #footer>
          <span class="tabular-nums" data-testid="notification-count">{{ t('notifications.shown', { n: items.length }, items.length) }}</span>
          <UButton v-if="hasNextPage && !isFetchNextPageError" color="neutral" variant="outline" size="sm" :disabled="!hydrated || actionPending || isFetchingNextPage" :label="t('app.loadMore')" @click="fetchNextPage()" />
        </template>
      </SharedListCard>
    </SharedPageState>
  </SharedListPage>
</template>
