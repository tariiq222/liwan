<script setup lang="ts">
import AppearanceForm from '@/components/settings/AppearanceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('settings.appearance.title')" />
    <div class="space-y-6" data-testid="appearance-form">
      <AppearanceForm />
    </div>
  </SettingsLayout>
</template>
