<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useNotifications, useMarkNotificationRead, isDigestNotification, isKnownNotification, isMeetingNotification, type BellNotification } from '@/composables/useNotifications'
import { formatNotificationTimestamp, genericNotificationText, notificationPreviewCaptionKey } from '@/utils/notificationPresentation'

const { t, locale, localeProperties } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const open = ref(false)
const route = useRoute()
const { me } = useMe()
const { data, isLoading, error, refetch, isFetching } = useNotifications()
const { mutateAsync: markRead, isPending } = useMarkNotificationRead()
// The API orders newest first (id desc), including read and unread records.
const items = computed(() => data.value?.items.slice(0, 5) ?? [])
const notificationTimeZone = computed(() => me.value?.tz || 'UTC')
const notificationTimestamps = computed(() => new Map(
  items.value.map(item => [item.id, formatNotificationTimestamp(item.created_at, locale.value, notificationTimeZone.value)] as const),
))
watch(() => route.fullPath, () => { open.value = false })

function notificationTimestamp(item: BellNotification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

function notificationHref(item: BellNotification): string | null {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  if (isKnownNotification(item)) return `/tasks/${item.task_id}`
  // A newer application's row has no client route in this build: opening it only marks it read.
  return null
}

function previewTitle(item: BellNotification): string {
  if (isDigestNotification(item)) return t('tasks.digest.count', item.overdue_count)
  if (isMeetingNotification(item)) return item.meeting_name
  if (isKnownNotification(item)) return item.task_name
  return genericNotificationText(item, t(notificationPreviewCaptionKey(item.kind))).title
}

function previewSecondary(item: BellNotification): string {
  if (isKnownNotification(item)) return ''
  return genericNotificationText(item, '').secondary
}

async function openNotification(item: BellNotification) {
  if (isPending.value) return
  try {
    if (!item.is_read) await markRead(item.id)
    open.value = false
    const href = notificationHref(item)
    if (href) await navigateTo(href)
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'end', sideOffset: 12 }"
    :ui="{ content: 'nasq-notification-preview flex max-h-[min(600px,80dvh)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg p-0' }"
  >
    <UButton
      data-testid="notification-bell"
      :aria-label="hydrated && data?.unread_count ? `${t('notifications.title')}، ${data.unread_count} ${t('notifications.unread')}` : t('notifications.title')"
      color="neutral"
      variant="outline"
      square
      :disabled="!hydrated"
      class="relative text-muted"
    >
      <template #leading>
        <UIcon name="i-lucide-bell" class="size-4.5" aria-hidden="true" />
      </template>
      <span
        v-if="hydrated && data?.unread_count"
        data-testid="notification-count"
        dir="ltr"
        class="nasq-unread-count pointer-events-none absolute -end-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[4px] text-xs leading-none font-bold tabular-nums ring-2 ring-(--ui-bg)"
      >{{ data.unread_count > 99 ? '99+' : data.unread_count }}</span>
    </UButton>
    <template #content>
      <div data-testid="notification-preview" :dir="localeProperties.dir === 'rtl' ? 'rtl' : 'ltr'" :aria-label="t('notifications.title')" class="flex max-h-[min(600px,80dvh)] flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">{{ t('notifications.title') }}</h2>
          <span class="text-xs text-muted">{{ t('notifications.latestFive') }}</span>
        </div>
        <div class="min-h-0 overflow-y-auto p-2">
          <div v-if="error" role="alert" class="space-y-2 p-4 text-center">
            <p class="text-sm text-error">{{ t('notifications.loadError') }}</p>
            <UButton color="neutral" variant="outline" size="sm" :disabled="isFetching" :label="t('notifications.retry')" @click="refetch()" />
          </div>
          <p v-else-if="isLoading" role="status" class="p-6 text-center text-sm text-muted">{{ t('notifications.loading') }}</p>
          <p v-else-if="!items.length" class="p-6 text-center text-sm text-muted">{{ t('notifications.empty') }}</p>
          <div v-else class="space-y-1">
            <UButton
              v-for="item in items"
              :key="item.id"
              data-notification-preview-item
              :data-testid="`notification-preview-${item.id}`"
              type="button"
              color="neutral"
              variant="ghost"
              class="h-auto min-w-0 w-full justify-start rounded-lg p-3"
              :class="!item.is_read ? 'bg-brand-soft/50' : ''"
              :disabled="isPending"
              @click="openNotification(item)"
            >
              <span class="grid min-w-0 w-full gap-1 text-start">
                <span class="min-w-0 break-words text-xs text-muted">{{ t(notificationPreviewCaptionKey(item.kind)) }}</span>
                <span v-if="!item.is_read" class="sr-only">{{ t('notifications.unread') }}</span>
                <span class="min-w-0 break-words line-clamp-2 text-start text-sm font-medium"><bdi dir="auto">{{ previewTitle(item) }}</bdi></span>
                <span v-if="item.kind === 'comment' || item.kind === 'mention' || isDigestNotification(item)" class="min-w-0 break-words line-clamp-2 text-start text-xs text-muted"><bdi dir="auto">{{ item.body }}</bdi></span>
                <span v-else-if="previewSecondary(item)" class="min-w-0 break-words line-clamp-2 text-start text-xs text-muted"><bdi dir="auto">{{ previewSecondary(item) }}</bdi></span>
                <time v-if="notificationTimestamp(item)" :datetime="notificationTimestamp(item)?.datetime" class="text-xs text-muted">{{ notificationTimestamp(item)?.label }}</time>
              </span>
            </UButton>
          </div>
        </div>
        <UButton to="/notifications" color="neutral" variant="outline" block class="rounded-none" :label="t('notifications.more')" @click="open = false" />
      </div>
    </template>
  </UPopover>
</template>
