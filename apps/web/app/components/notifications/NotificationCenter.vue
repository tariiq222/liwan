<script setup lang="ts">
import { Bell } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useNotifications, useMarkNotificationRead, isDigestNotification, type Notification } from '@/composables/useNotifications'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const { t, localeProperties } = useI18n()
const hydrated = useHydrated()
const open = ref(false)
const route = useRoute()
const { data, isLoading, error, refetch, isFetching } = useNotifications()
const { mutateAsync: markRead, isPending } = useMarkNotificationRead()
// The API orders newest first (id desc), including read and unread records.
const items = computed(() => data.value?.items.slice(0, 5) ?? [])
watch(() => route.fullPath, () => { open.value = false })
function notificationHref(item: Notification) {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  return `/tasks/${item.task_id}`
}

async function openNotification(item: Notification) {
  if (isPending.value) return
  try {
    if (!item.is_read) await markRead(item.id)
    open.value = false
    await navigateTo(notificationHref(item))
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button data-testid="notification-bell" :aria-label="hydrated && data?.unread_count ? `${t('notifications.title')}، ${data.unread_count} ${t('notifications.unread')}` : t('notifications.title')" variant="outline" size="icon" :disabled="!hydrated" class="relative text-muted-foreground">
        <Bell />
        <span v-if="hydrated && data?.unread_count" data-testid="notification-count" dir="ltr" class="pointer-events-none absolute -end-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-[4px] text-[11px] leading-none font-bold text-white tabular-nums ring-2 ring-background">{{ data.unread_count > 99 ? '99+' : data.unread_count }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent data-testid="notification-preview" :dir="localeProperties.dir === 'rtl' ? 'rtl' : 'ltr'" :aria-label="t('notifications.title')" align="end" :side-offset="12" class="flex max-h-[min(600px,80dvh)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg p-0">
      <div class="flex items-center justify-between border-b p-4">
        <h2 class="font-semibold">{{ t('notifications.title') }}</h2>
        <span class="text-xs text-muted-foreground">{{ t('notifications.latestFive') }}</span>
      </div>
      <div class="min-h-0 overflow-y-auto p-2">
        <div v-if="error" role="alert" class="space-y-2 p-4 text-center">
          <p class="text-sm text-destructive">{{ t('notifications.loadError') }}</p>
          <Button variant="outline" size="sm" :disabled="isFetching" @click="refetch()">{{ t('notifications.retry') }}</Button>
        </div>
        <p v-else-if="isLoading" role="status" class="p-6 text-center text-sm text-muted-foreground">{{ t('notifications.loading') }}</p>
        <p v-else-if="!items.length" class="p-6 text-center text-sm text-muted-foreground">{{ t('notifications.empty') }}</p>
        <div v-else class="space-y-1">
          <button v-for="item in items" :key="item.id" data-notification-preview-item :data-testid="`notification-preview-${item.id}`" type="button" class="grid w-full gap-1 rounded-lg p-3 text-start transition-colors hover:bg-muted focus-visible:bg-muted" :class="!item.is_read ? 'bg-brand-soft' : ''" :disabled="isPending" @click="openNotification(item)">
            <span class="text-xs text-muted-foreground">{{ isDigestNotification(item) ? t('tasks.digest.kind') : item.kind === 'comment' ? t('notifications.comment') : t(`notifications.${item.kind}`, { task: item.task_name }) }}</span>
            <span v-if="!item.is_read" class="sr-only">{{ t('notifications.unread') }}</span>
            <span class="line-clamp-2 text-sm font-medium">{{ isDigestNotification(item) ? t('tasks.digest.count', item.overdue_count) : item.task_name }}</span>
            <span v-if="item.kind === 'comment' || isDigestNotification(item)" class="line-clamp-2 text-xs text-muted-foreground">{{ item.body }}</span>
            <span class="text-xs text-muted-foreground" dir="ltr">{{ item.created_at }}</span>
          </button>
        </div>
      </div>
      <NuxtLink to="/notifications" class="border-t p-3 text-center text-sm font-medium text-brand-link hover:bg-muted focus-visible:bg-muted" @click="open = false">{{ t('notifications.more') }}</NuxtLink>
    </PopoverContent>
  </Popover>
</template>
