<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import {
  isDigestNotification,
  isMeetingNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsPage,
  type Notification,
} from '@/composables/useNotifications'
import { formatNotificationTimestamp } from '@/utils/notificationPresentation'

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
  error: queryError,
  fetchNextPage,
  refetch,
} = useNotificationsPage()
const { mutateAsync: markRead } = useMarkNotificationRead()
const { mutateAsync: markAllRead, isPending: markingAll } = useMarkAllNotificationsRead()
const items = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items))
const unreadCount = computed(() => data.value?.pages[0]?.unread_count ?? 0)
const notificationTimeZone = computed(() => me.value?.tz || 'UTC')
const notificationTimestamps = computed(() => new Map(
  items.value.map(item => [item.id, formatNotificationTimestamp(item.created_at, locale.value, notificationTimeZone.value)] as const),
))
const pendingReadId = ref<number | null>(null)
const actionPending = computed(() => pendingReadId.value !== null || markingAll.value)
const queryErrorMessage = computed(() => (
  queryError.value instanceof ApiError ? queryError.value.message : t('notifications.loadError')
))

function kindLabel(item: Notification) {
  if (isDigestNotification(item)) return t('tasks.digest.kind')
  if (isMeetingNotification(item)) return t(`meetingsUi.notify.${item.kind}`)
  if (item.kind === 'comment' || item.kind === 'mention') return t(`notifications.${item.kind}`)
  return t(`notifications.${item.kind}`, { task: item.task_name })
}

function itemTitle(item: Notification) {
  if (isDigestNotification(item)) return t('tasks.digest.count', { n: item.overdue_count })
  if (isMeetingNotification(item)) return item.meeting_name
  return item.task_name
}

function notificationTimestamp(item: Notification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

async function openNotification(item: Notification) {
  if (actionPending.value) return
  pendingReadId.value = item.id
  try {
    await markRead(item.id)
    if (isDigestNotification(item)) await navigateTo(`/notification-digests/${item.id}`)
    else if (isMeetingNotification(item)) await navigateTo(`/meetings/${item.meeting_id}`)
    else await navigateTo(`/tasks/${item.task_id}`)
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
  <SharedPageContainer data-testid="notification-center" width="list">
    <SharedPageHeader :title="t('notifications.title')" :description="hydrated ? `${unreadCount} ${t('notifications.unread')}` : undefined">
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
    </SharedPageHeader>

    <SharedPageState
      :loading="isLoading && !items.length"
      :error="hasQueryError && !items.length ? queryError : null"
      :empty="!items.length"
      :empty-text="t('notifications.empty')"
      @retry="retryNotifications"
    >
      <div class="rounded-lg ring ring-default bg-default overflow-hidden">
        <div class="grid gap-0">
          <UButton
            v-for="item in items"
            :key="item.id"
            type="button"
            color="neutral"
            variant="ghost"
            class="grid w-full gap-1 rounded-none border-b border-default p-3 text-start transition-colors last:border-b-0 hover:bg-elevated"
            :class="item.is_read ? 'bg-default' : 'border-s-2 border-s-brand-link bg-brand-soft'"
            :disabled="!hydrated || actionPending"
            :data-testid="`notification-${item.id}`"
            @click="openNotification(item)"
          >
            <span class="flex items-center gap-2 text-xs font-medium" :class="item.is_read ? 'text-muted' : 'text-brand-link'">
              <span>{{ kindLabel(item) }}</span>
              <span v-if="!item.is_read" class="inline-flex items-center gap-1 font-semibold">
                <span class="size-1.5 shrink-0 rounded-full bg-brand-link" aria-hidden="true" />
                {{ t('notifications.unread') }}
              </span>
            </span>
            <span class="font-medium">{{ itemTitle(item) }}</span>
            <span v-if="item.kind === 'comment' || item.kind === 'mention'" class="line-clamp-3 text-sm text-muted">{{ item.body }}</span>
            <time v-if="notificationTimestamp(item)" class="text-xs text-muted" :datetime="notificationTimestamp(item)?.datetime">{{ notificationTimestamp(item)?.label }}</time>
          </UButton>
        </div>
        <div v-if="hasQueryError && items.length && !isFetchNextPageError" class="grid gap-2 py-4 text-center" role="alert">
          <p class="text-sm text-error">{{ queryErrorMessage }}</p>
          <UButton type="button" color="neutral" variant="outline" class="mx-auto" :disabled="!hydrated || isFetching" :label="t('notifications.retry')" @click="retryNotifications" />
        </div>
        <div v-if="isFetchNextPageError" class="grid gap-2 border-t border-default p-4 text-center" role="alert">
          <p class="text-sm text-error">{{ queryErrorMessage }}</p>
          <UButton type="button" color="neutral" variant="outline" class="mx-auto" :disabled="!hydrated || actionPending || isFetchingNextPage" :label="t('notifications.retry')" @click="retryNextPage" />
        </div>
        <div v-else-if="hasNextPage" class="border-t border-default p-4 text-center">
          <UButton color="neutral" variant="outline" :disabled="!hydrated || actionPending || isFetchingNextPage" :label="t('app.loadMore')" @click="fetchNextPage()" />
        </div>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
