<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import { useNotifications } from '@/composables/useNotifications'
import { NOTIFICATIONS_PANEL, slideOverId, useSlideOver } from '@/composables/useSlideOver'

// The bell of the top bar: its badge is the unread count, and it toggles the notifications slide-over.
const { t } = useI18n()
const hydrated = useHydrated()
const slideOver = useSlideOver()
const { data } = useNotifications(hydrated)
const unread = computed(() => (hydrated.value ? data.value?.unread_count ?? 0 : 0))
const label = computed(() => unread.value ? joinList([t('notifications.title'), `${unread.value} ${t('notifications.unread')}`], t) : t('notifications.title'))
</script>

<template>
  <ShellToolButton
    data-testid="notification-bell"
    icon="i-lucide-bell"
    :label="label"
    :badge="unread"
    badge-test-id="notification-count"
    :open="slideOver.open.value === NOTIFICATIONS_PANEL"
    :controls="slideOverId(NOTIFICATIONS_PANEL)"
    haspopup="dialog"
    :disabled="!hydrated"
    @click="slideOver.toggle(NOTIFICATIONS_PANEL, $event.currentTarget as HTMLElement)"
  />
</template>
