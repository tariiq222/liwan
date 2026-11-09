<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useNotifications, useMarkNotificationRead, isDigestNotification, isKnownNotification, type BellNotification } from '@/composables/useNotifications'
import { useSlideOver } from '@/composables/useSlideOver'
import { bellKindFor } from '@/modules/surfaces'
import { declaredBellTitle } from '@/utils/bellTitle'
import { formatNotificationTimestamp, genericNotificationText, isUserWrittenNotificationKind, notificationBody, notificationPreviewCaptionKey } from '@/utils/notificationPresentation'

// The notifications slide-over body (foundation, not an application panel): the latest rows, newest first, read and
// unread. Opening one marks it read and goes to its page; a kind this build does not know only marks it read.
const PANEL_ROWS = 8
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { me } = useMe()
const slideOver = useSlideOver()
const { data, isLoading, error, refetch } = useNotifications(hydrated)
const { mutateAsync: markRead, isPending } = useMarkNotificationRead()
const rows = computed(() => (data.value?.items ?? []).slice(0, PANEL_ROWS))
const timeZone = computed(() => me.value?.tz || 'UTC')

// A bell row is a plain object, so it is assignable to the manifest callbacks' row type without a cast.
const asRow = (item: BellNotification): Record<string, unknown> => item
const hrefOf = (item: BellNotification) => bellKindFor(item.kind)?.href(asRow(item)) ?? null
const titleOf = (item: BellNotification) => declaredBellTitle(item, t) ?? genericNotificationText(item).title
function detailOf(item: BellNotification) {
  if (isUserWrittenNotificationKind(item.kind) || isDigestNotification(item)) return notificationBody(item)
  return isKnownNotification(item) ? '' : genericNotificationText(item).secondary
}
function captionOf(item: BellNotification) {
  const when = formatNotificationTimestamp(item.created_at, timeZone.value)?.label
  return [detailOf(item) || t(notificationPreviewCaptionKey(item.kind)), when].filter(Boolean).join(' · ')
}

async function openNotification(item: BellNotification) {
  if (isPending.value) return
  try {
    if (!item.is_read) await markRead(item.id)
    slideOver.close({ restoreFocus: false })
    const href = hrefOf(item)
    if (href) await navigateTo(href)
  } catch (failure) {
    toast.add({ title: failure instanceof ApiError ? failure.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <div data-testid="notification-preview">
    <ShellPanelStatus v-if="error" kind="error" :message="t('notifications.loadError')" :retry-label="t('notifications.retry')" @retry="refetch()" />
    <ShellPanelStatus v-else-if="isLoading" kind="loading" :message="t('notifications.loading')" />
    <ShellPanelStatus v-else-if="!rows.length" kind="empty" :message="t('notifications.empty')" />
    <template v-else>
      <ShellPanelRow
        v-for="item in rows"
        :key="item.id"
        icon="i-lucide-bell"
        :unread="!item.is_read"
        :title="titleOf(item)"
        :caption="captionOf(item)"
        :test-id="`notification-preview-${item.id}`"
        @select="openNotification(item)"
      >
        <span v-if="!item.is_read" class="sr-only">{{ t('notifications.unread') }}</span>
      </ShellPanelRow>
    </template>
  </div>
</template>
