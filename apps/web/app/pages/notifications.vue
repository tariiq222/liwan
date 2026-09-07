<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import {
  isDigestNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsPage,
  type Notification,
} from '@/composables/useNotifications'

const { t, localeProperties } = useI18n()
const hydrated = useHydrated()
const router = useRouter()
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
const isRtl = computed(() => localeProperties.value.dir === 'rtl')
const items = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items))
const unreadCount = computed(() => data.value?.pages[0]?.unread_count ?? 0)
const pendingReadId = ref<number | null>(null)
const actionPending = computed(() => pendingReadId.value !== null || markingAll.value)
const queryErrorMessage = computed(() => (
  queryError.value instanceof ApiError ? queryError.value.message : t('notifications.loadError')
))

function kindLabel(item: Notification) {
  if (isDigestNotification(item)) return t('tasks.digest.kind')
  return item.kind === 'comment' ? t('notifications.comment') : t(`notifications.${item.kind}`, { task: item.task_name })
}

function itemTitle(item: Notification) {
  return isDigestNotification(item) ? t('tasks.digest.count', { n: item.overdue_count }) : item.task_name
}

async function openNotification(item: Notification) {
  if (actionPending.value) return
  pendingReadId.value = item.id
  try {
    await markRead(item.id)
    if (isDigestNotification(item)) await navigateTo(`/notification-digests/${item.id}`)
    else await navigateTo(`/tasks/${item.task_id}`)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  } finally {
    if (pendingReadId.value === item.id) pendingReadId.value = null
  }
}

async function markAll() {
  if (actionPending.value) return
  try {
    await markAllRead()
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
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
  <SharedPageContainer data-testid="notification-center" width="form" class="flex min-h-[calc(100vh-7rem)] flex-col">
    <SharedPageHeader :title="t('notifications.title')" :description="hydrated ? `${unreadCount} ${t('notifications.unread')}` : undefined">
      <template #back>
        <Button variant="ghost" size="sm" class="gap-2 px-2 text-muted-foreground" type="button" @click="router.back()">
          <component :is="isRtl ? ArrowRight : ArrowLeft" class="size-[18px]" />
          {{ t('notifications.back') }}
        </Button>
      </template>
        <Button
          v-if="hydrated && unreadCount"
          type="button"
          variant="outline"
          size="sm"
          :disabled="!hydrated || actionPending"
          @click="markAll"
        >{{ t('notifications.markAllRead') }}</Button>
    </SharedPageHeader>

    <section class="nasq-panel flex min-h-0 flex-1 flex-col overflow-hidden">

      <div class="flex-1 overflow-y-auto">
        <div v-if="hasQueryError && !items.length" class="grid gap-3 py-8 text-center" role="alert">
          <p class="text-sm text-destructive">{{ queryErrorMessage }}</p>
          <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" @click="retryNotifications">
            {{ t('notifications.retry') }}
          </Button>
        </div>
        <p v-else-if="isLoading" class="py-8 text-center text-sm text-muted-foreground" aria-live="polite">{{ t('notifications.loading') }}</p>
        <p v-else-if="!items.length" class="py-8 text-center text-sm text-muted-foreground">{{ t('notifications.empty') }}</p>
        <div v-else class="grid gap-0">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="grid gap-1 border-b border-border/80 p-3 text-start transition-colors last:border-b-0 hover:bg-muted/70"
            :class="item.is_read ? 'bg-background' : 'border-s-2 border-s-brand-link bg-brand-soft'"
            :disabled="!hydrated || actionPending"
            :data-testid="`notification-${item.id}`"
            @click="openNotification(item)"
          >
            <span class="flex items-center gap-2 text-xs font-medium" :class="item.is_read ? 'text-muted-foreground' : 'text-brand-link'">
              <span>{{ kindLabel(item) }}</span>
              <span v-if="!item.is_read" class="inline-flex items-center gap-1 font-semibold">
                <span class="size-1.5 shrink-0 rounded-full bg-brand-link" aria-hidden="true" />
                {{ t('notifications.unread') }}
              </span>
            </span>
            <span class="font-medium">{{ itemTitle(item) }}</span>
            <span v-if="item.kind === 'comment'" class="line-clamp-3 text-sm text-muted-foreground">{{ item.body }}</span>
            <span class="text-xs text-muted-foreground" dir="ltr">{{ item.created_at }}</span>
          </button>
        </div>

        <div v-if="hasQueryError && items.length && !isFetchNextPageError" class="grid gap-2 py-4 text-center" role="alert">
          <p class="text-sm text-destructive">{{ queryErrorMessage }}</p>
          <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || isFetching" @click="retryNotifications">
            {{ t('notifications.retry') }}
          </Button>
        </div>
      </div>

      <div v-if="isFetchNextPageError" class="grid gap-2 border-t p-4 text-center" role="alert">
        <p class="text-sm text-destructive">{{ queryErrorMessage }}</p>
        <Button type="button" variant="outline" size="sm" class="mx-auto" :disabled="!hydrated || actionPending || isFetchingNextPage" @click="retryNextPage">
          {{ t('notifications.retry') }}
        </Button>
      </div>
      <div v-else-if="hasNextPage" class="border-t p-4 text-center">
        <Button variant="outline" size="sm" :disabled="!hydrated || actionPending || isFetchingNextPage" @click="fetchNextPage()">
          {{ t('app.loadMore') }}
        </Button>
      </div>
    </section>
  </SharedPageContainer>
</template>
