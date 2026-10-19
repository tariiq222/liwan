<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('settings.branding.manage'))
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('settings.branding.title')" />
    <SharedForbiddenState v-if="forbidden" :description="t('settings.forbidden')" />
    <BrandingForm v-else />
  </SharedSettingsPage>
</template>
