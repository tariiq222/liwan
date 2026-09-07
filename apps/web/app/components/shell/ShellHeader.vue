<script setup lang="ts">
import { firstAllowedPath } from '@/utils/accessPolicy'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'

const { t } = useI18n()
const { me } = useMe()
const { branding } = useBranding()
const { can } = useAccess()
const homePath = computed(() => firstAllowedPath(me.value))
</script>

<template>
  <header data-testid="shell-header" class="nasq-shell-header" :aria-label="t('nav.header')">
    <NuxtLink :to="homePath" class="nasq-shell-brand" :aria-label="`${branding?.name ?? t('app.productName')} — ${t('nav.home')}`">
      <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="nasq-shell-brand-logo" />
      <span v-else class="nasq-shell-brand-mark">{{ (branding?.name ?? t('app.productName')).slice(0, 1) }}</span>
      <span class="nasq-shell-brand-name">{{ branding?.name ?? t('app.productName') }}</span>
    </NuxtLink>
    <GlobalSearch />
    <div class="nasq-shell-header-actions">
      <NotificationCenter v-if="can('nasq.notifications')" />
      <AppAccountMenu />
    </div>
  </header>
</template>
