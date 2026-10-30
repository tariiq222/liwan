<script setup lang="ts">
const { t } = useI18n()
const { me } = useMe()
const { connected } = useBus()
const hydrated = useHydrated()
const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
</script>

<template>
  <UButton
      to="/account"
      data-slot="header-account"
      data-testid="account-menu"
      class="header-account"
      color="neutral"
      variant="ghost"
      :disabled="!hydrated"
      :aria-label="me?.name ? t('nav.account') + ': ' + me.name : t('nav.account')"
    >
      <span class="relative shrink-0">
        <UAvatar size="sm" class="header-avatar text-xs" :text="initials" :alt="me?.name ?? t('nav.account')" />
        <ClientOnly>
          <span
            class="absolute -end-px -top-px block size-2.5 rounded-full ring-2 ring-(--ui-bg)"
            :class="connected ? 'liwan-status-dot-success' : 'bg-(--ui-text-dimmed)'"
            :title="connected ? t('bus.connected') : t('bus.disconnected')"
            :aria-label="connected ? t('bus.connected') : t('bus.disconnected')"
            role="status"
          />
        </ClientOnly>
      </span>
      <span class="account-copy">
        <span class="account-name">{{ me?.name }}</span>
      </span>
  </UButton>
</template>
