<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'

const queryClient = useQueryClient()
const { t } = useI18n()
const { me } = useMe()
const { connected } = useBus()
const hydrated = useHydrated()

const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
const navPreferenceKey = computed(() => `nasq-nav:${me.value?.id ?? 'anonymous'}`)

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST', body: {} })
  sessionStorage.removeItem(navPreferenceKey.value)
  await queryClient.cancelQueries()
  queryClient.clear()
  await refreshNuxtData('me')
  await navigateTo('/login')
}

const items = computed(() => [
  [
    { label: t('nav.account'), to: '/account', nasqIcon: 'i-lucide-user-round' },
  ],
  [
    { label: t('nav.logout'), color: 'error' as const, nasqIcon: 'i-lucide-log-out', onSelect: () => { void logout() } },
  ],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :modal="false"
    :disabled="!hydrated"
    :content="{
      align: 'end',
      sideOffset: 4,
      avoidCollisions: false,
      sticky: 'always',
      updatePositionStrategy: 'always',
    }"
    :ui="{ content: 'approved-account-menu z-[80] min-w-52' }"
    :external-icon="false"
  >
    <UButton
      type="button"
      data-slot="header-account"
      class="header-account"
      color="neutral"
      variant="ghost"
      :disabled="!hydrated"
      :aria-label="me?.name ? t('nav.account') + ': ' + me.name : t('nav.account')"
    >
      <span class="relative shrink-0">
        <UAvatar size="sm" :text="initials" :alt="me?.name ?? t('nav.account')" />
        <ClientOnly>
          <span
            class="absolute -bottom-0.5 -end-0.5 block size-2.5 rounded-full ring-2 ring-background"
            :class="connected ? 'nasq-status-dot-success' : 'bg-muted-foreground/50'"
            :title="connected ? t('bus.connected') : t('bus.disconnected')"
            :aria-label="connected ? t('bus.connected') : t('bus.disconnected')"
            role="status"
          />
        </ClientOnly>
      </span>
      <span class="account-copy">
        <span class="account-name">{{ me?.name }}</span>
        <span class="account-role">{{ me?.company.name }}</span>
      </span>
    </UButton>
    <template #item-leading="{ item }">
      <UIcon :name="item.nasqIcon" class="nasq-shell-icon size-[18px] shrink-0" aria-hidden="true" />
    </template>
  </UDropdownMenu>
</template>
