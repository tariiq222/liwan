<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import SettingsTabs from '@/components/settings/SettingsTabs.vue'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('settings.branding.manage'))
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-8">
    <SharedPageHeader :title="t('nav.branding')" />
    <SettingsTabs />
    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <BrandingForm v-else />
  </div>
</template>
