<script setup lang="ts">
import AppearanceForm from '@/components/settings/AppearanceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
</script>

<template>
  <SettingsLayout>
    <div class="nasq-page-stack">
      <SharedPageHeader :title="t('settings.appearance.title')" />
      <AppearanceForm />
    </div>
  </SettingsLayout>
</template>
