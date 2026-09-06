<script setup lang="ts">
import AppearanceForm from '@/components/settings/AppearanceForm.vue'
import SettingsTabs from '@/components/settings/SettingsTabs.vue'

const { t } = useI18n()
</script>

<template>
  <div class="space-y-6">
    <SharedPageHeader :title="t('settings.appearance.title')" :description="t('settings.appearance.description')" />
    <SettingsTabs />
    <div class="max-w-3xl">
      <AppearanceForm />
    </div>
  </div>
</template>
