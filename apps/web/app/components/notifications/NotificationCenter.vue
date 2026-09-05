<script setup lang="ts">
import { Bell } from 'lucide-vue-next'
import { useNotifications } from '@/composables/useNotifications'

const { t } = useI18n()
const { data } = useNotifications()
</script>

<template>
  <NuxtLink
    to="/notifications"
    data-testid="notification-bell"
    :aria-label="t('notifications.title')"
    class="relative inline-grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  >
    <Bell class="size-4" />
    <span
      v-if="data?.unread_count"
      data-testid="notification-count"
      class="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground"
    >{{ data.unread_count > 99 ? '99+' : data.unread_count }}</span>
  </NuxtLink>
</template>

